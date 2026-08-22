import { createHash, randomUUID } from 'node:crypto';
import { lstatSync } from 'node:fs';
import { Hono } from 'hono';
import {
  applyYouTubeInvitationTransition,
  ensureYouTubeInvitationJob,
  isYouTubeIsoTimestamp,
  normalizeYouTubeManagerEmail,
  normalizeYouTubeSellableSeats,
  normalizeYouTubeSubscriptionDate,
  reconcileYouTubeInvitationProviderStatus,
  resumeFailedYouTubeInvitation,
  YouTubeFamilyGroupsStore,
  YouTubeInvitationJobsStore,
  type YouTubeFamilyGroup,
  type YouTubeFamilyGroupsStoreData,
  type YouTubeInvitationJob,
  type YouTubeInvitationJobsStoreData,
  type YouTubeInvitationStatus,
} from '../lib/youtube-invitations';
import { buildYouTubeSharingNoKeepProductModel, type YouTubeSharingNoKeepProductModel } from '../lib/graytag-fill';
import { fingerprintYouTubeProductRegistration, YouTubeProductRegistrationsStore, type YouTubeProductRegistrationRecord } from '../lib/youtube-product-registrations';
import { withYouTubeCapacityLock } from '../lib/youtube-capacity-lock';
import { maskYouTubeInviteEmail, parseYouTubeInviteEmailCandidates } from '../lib/youtube-invite-email';
import { normalizeYouTubeAuditReason } from '../lib/youtube-audit-reason';
import { assertYouTubeCapacityInvariant, occupiedYouTubeFamilyGroupSeats, YouTubeCapacityInvariantError } from '../lib/youtube-capacity-invariant';
import { appendYouTubeListingCode, removeYouTubeListingCode, youtubeListingCodeFromManagerEmail } from '../lib/youtube-listing-code';

const DEFAULT_FAMILY_GROUPS_PATH = 'data/youtube-family-groups.json';
const DEFAULT_INVITATIONS_PATH = 'data/youtube-invitations.json';
const DEFAULT_PRODUCT_REGISTRATIONS_PATH = 'data/youtube-product-registrations.json';
const CREATE_FIELDS = ['label', 'managerEmail', 'subscriptionEndDate', 'sellableSeats'] as const;
const PATCH_FIELDS = ['label', 'managerEmail', 'subscriptionEndDate', 'sellableSeats', 'enabled'] as const;

function enabled(): boolean {
  return process.env.YOUTUBE_INVITE_SALES_ENABLED === 'true';
}

function familyGroupsStore(): YouTubeFamilyGroupsStore {
  return new YouTubeFamilyGroupsStore(process.env.YOUTUBE_FAMILY_GROUPS_PATH || DEFAULT_FAMILY_GROUPS_PATH);
}

function invitationJobsStore(): YouTubeInvitationJobsStore {
  return new YouTubeInvitationJobsStore(process.env.YOUTUBE_INVITATIONS_PATH || DEFAULT_INVITATIONS_PATH);
}

function productRegistrationsStore(): YouTubeProductRegistrationsStore {
  return new YouTubeProductRegistrationsStore(process.env.YOUTUBE_PRODUCT_REGISTRATIONS_PATH || DEFAULT_PRODUCT_REGISTRATIONS_PATH);
}

function readOrInitialize<T>(
  store: { filePath: string; read(): T; write(data: T): void },
  empty: T,
): T {
  try {
    return store.read();
  } catch (readError) {
    try {
      lstatSync(store.filePath);
    } catch (statError) {
      if ((statError as NodeJS.ErrnoException).code === 'ENOENT') {
        store.write(empty);
        return store.read();
      }
    }
    throw readError;
  }
}

function readOrEmpty<T>(store: { filePath: string; read(): T }, empty: T): T {
  try { return store.read(); }
  catch (readError) {
    try { lstatSync(store.filePath); }
    catch (statError) {
      if ((statError as NodeJS.ErrnoException).code === 'ENOENT') return empty;
    }
    throw readError;
  }
}

function readFamilyGroups(): YouTubeFamilyGroupsStoreData {
  return readOrInitialize(familyGroupsStore(), { version: 1, familyGroups: [] });
}

function readInvitationJobs(): YouTubeInvitationJobsStoreData {
  return readOrInitialize(invitationJobsStore(), { version: 1, jobs: [] });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === fields.length && keys.every((key) => fields.includes(key));
}

function hasOnlyFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  return Object.keys(value).every((key) => fields.includes(key));
}

function normalizeLabel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && normalized.length <= 120 ? normalized : null;
}

function maskManagerEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '[masked]';
  const visible = local.length > 1 ? `${local[0]}***${local.at(-1)}` : `${local[0] ?? ''}***`;
  return `${visible}@${domain}`;
}

function familyGroupDto(familyGroup: YouTubeFamilyGroup) {
  return {
    id: familyGroup.id,
    label: familyGroup.label,
    managerEmailMasked: maskManagerEmail(familyGroup.managerEmail),
    listingCode: youtubeListingCodeFromManagerEmail(familyGroup.managerEmail),
    subscriptionEndDate: familyGroup.subscriptionEndDate,
    sellableSeats: familyGroup.sellableSeats,
    enabled: familyGroup.enabled,
    createdAt: familyGroup.createdAt,
    updatedAt: familyGroup.updatedAt,
  };
}

async function requestBody(c: any): Promise<Record<string, unknown> | null> {
  try {
    const body = await c.req.json();
    return isRecord(body) ? body : null;
  } catch {
    return null;
  }
}

function duplicateManagerEmail(groups: readonly YouTubeFamilyGroup[], email: string, excludeId?: string): boolean {
  return groups.some((group) => group.id !== excludeId && group.managerEmail.trim().toLowerCase() === email);
}

function unavailable(c: any) {
  return c.json({ ok: false, error: 'youtube store unavailable' }, 500);
}

function disabledMutation(c: any) {
  return c.json({ ok: false, enabled: false, error: 'YOUTUBE_INVITE_SALES_DISABLED' }, 503);
}

export interface YouTubeInvitationsAppDependencies {
  registerProduct?: (model: YouTubeSharingNoKeepProductModel) => Promise<Response>;
  reconcileProductRegistration?: (claim: { attemptId: string; requestFingerprint: string; familyGroupId: string }) => Promise<
    { status: 'registered'; productUsid: string } | { status: 'uncertain' }
  >;
  finishDelivery?: (dealUsid: string) => Promise<Response>;
  fetchProviderStatus?: (dealUsid: string) => Promise<string | null>;
  actor?: (context: any) => string;
  audit?: (event: { outcome: 'registered' | 'uncertain' | 'failed'; actor: string; reason: string; familyGroupId: string; productUsid: string | null }) => void;
  invitationAudit?: (event: YouTubeInvitationAuditEvent) => void;
  now?: () => Date;
}

export interface YouTubeInvitationAuditEvent {
  action: 'ingest' | 'email-candidate' | 'confirm-email' | 'invite-sent' | 'finish-delivery' | 'reconcile' | 'resume';
  outcome: 'success' | 'failed' | 'uncertain';
  actor: string;
  reason: string;
  jobId: string;
  dealUsid: string;
}

const INGEST_FIELDS = ['dealUsid', 'productUsid', 'chatRoomUuid', 'buyerName', 'endDateTime', 'providerStatus'] as const;
const EMAIL_CANDIDATE_FIELDS = ['message'] as const;
const CONFIRM_EMAIL_FIELDS = ['email'] as const;
const INVITATION_STATUSES = new Set<YouTubeInvitationStatus>([
  'waiting_for_group_assignment', 'waiting_for_buyer_email', 'email_candidate_found', 'email_confirmed',
  'invite_sent', 'delivery_completion_pending', 'delivered_waiting_inspection', 'active', 'failed', 'ended',
]);

function strictText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= max
    && !/[\x00-\x1f\x7f]/.test(value);
}

function auditReason(c: any): string | null {
  return normalizeYouTubeAuditReason(c.req.header('x-audit-reason'));
}

function privacySafeIdentifier(prefix: string, value: string, length = 12): string {
  const digest = createHash('sha256').update(`${prefix}\0${value}`).digest('hex').slice(0, length);
  return `${prefix}-${digest}`;
}

function publicInvitationId(job: Pick<YouTubeInvitationJob, 'id'>): string {
  return privacySafeIdentifier('invitation', job.id, 20);
}

function findInvitationByPublicId(jobs: readonly YouTubeInvitationJob[], id: string): YouTubeInvitationJob | undefined {
  return jobs.find((job) => publicInvitationId(job) === id);
}

function invitationDto(job: YouTubeInvitationJob) {
  return {
    id: publicInvitationId(job),
    dealDisplayId: privacySafeIdentifier('deal', job.dealUsid),
    productDisplayId: privacySafeIdentifier('product', job.productUsid),
    familyGroupId: job.familyGroupId,
    buyerName: job.buyerName,
    buyerEmailMasked: job.buyerGoogleEmail ? maskYouTubeInviteEmail(job.buyerGoogleEmail) : null,
    endDateTime: job.endDateTime,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    history: job.history.map((entry) => ({ from: entry.from, to: entry.to, reason: entry.reason, at: entry.at })),
  };
}

function replaceInvitationJob(jobs: readonly YouTubeInvitationJob[], updated: YouTubeInvitationJob): YouTubeInvitationJob[] {
  return jobs.map((job) => job.id === updated.id ? updated : job);
}

async function acceptsEmptyJsonBody(c: any): Promise<boolean> {
  try {
    const text = await c.req.text();
    if (!text.trim()) return true;
    const parsed = JSON.parse(text);
    return isRecord(parsed) && Object.keys(parsed).length === 0;
  } catch {
    return false;
  }
}

export function createYouTubeInvitationsApp(dependencies: YouTubeInvitationsAppDependencies = {}) {
const app = new Hono();

const actorFor = (c: any) => dependencies.actor?.(c)?.trim() || 'admin:authenticated';
const emitInvitationAudit = (event: YouTubeInvitationAuditEvent) => {
  try { dependencies.invitationAudit?.(event); } catch { /* audit sink must not expose or undo lifecycle state */ }
};
const auditJob = (
  action: YouTubeInvitationAuditEvent['action'],
  outcome: YouTubeInvitationAuditEvent['outcome'],
  actor: string,
  reason: string,
  job: Pick<YouTubeInvitationJob, 'id' | 'dealUsid'>,
) => emitInvitationAudit({ action, outcome, actor, reason, jobId: job.id, dealUsid: job.dealUsid });

const applyProviderObservation = (
  c: any,
  id: string,
  providerStatus: string,
  action: YouTubeInvitationAuditEvent['action'],
  actor: string,
  reason: string,
) => {
  try {
    const result = withYouTubeCapacityLock(() => {
      const store = invitationJobsStore();
      const data = readOrInitialize(store, { version: 1, jobs: [] } satisfies YouTubeInvitationJobsStoreData);
      const current = findInvitationByPublicId(data.jobs, id);
      if (!current) return { kind: 'not_found' as const };
      let updated: YouTubeInvitationJob;
      try {
        updated = reconcileYouTubeInvitationProviderStatus(current, providerStatus, { actor, reason }, data.jobs);
      } catch {
        return { kind: 'conflict' as const, job: current };
      }
      if (updated !== current) store.write({ version: 1, jobs: replaceInvitationJob(data.jobs, updated) });
      return { kind: 'ok' as const, job: updated };
    });
    if (result.kind === 'not_found') return c.json({ ok: false, error: 'invitation not found' }, 404);
    if (result.kind === 'conflict') {
      auditJob(action, 'failed', actor, reason, result.job);
      return c.json({ ok: false, error: 'invitation lifecycle conflict' }, 409);
    }
    auditJob(action, 'success', actor, reason, result.job);
    return c.json({ ok: true, invitation: invitationDto(result.job), providerStatus });
  } catch {
    return unavailable(c);
  }
};

const reconcileByFetch = async (
  c: any,
  id: string,
  action: YouTubeInvitationAuditEvent['action'],
  actor: string,
  reason: string,
) => {
  let current: YouTubeInvitationJob | undefined;
  try { current = findInvitationByPublicId(readInvitationJobs().jobs, id); } catch { return unavailable(c); }
  if (!current) return c.json({ ok: false, error: 'invitation not found' }, 404);
  let providerStatus: string | null = null;
  try { providerStatus = await dependencies.fetchProviderStatus?.(current.dealUsid) ?? null; } catch { providerStatus = null; }
  if (!providerStatus) {
    auditJob(action, 'uncertain', actor, reason, current);
    return c.json({ ok: false, error: 'provider status unavailable', code: 'YOUTUBE_PROVIDER_STATUS_UNKNOWN' }, 502);
  }
  if (current.status === 'delivery_completion_pending' && providerStatus === 'Delivering') {
    auditJob(action, 'uncertain', actor, reason, current);
    return c.json({
      ok: false,
      error: 'delivery accepted pending provider confirmation',
      code: 'YOUTUBE_DELIVERY_ACCEPTED_PENDING_CONFIRMATION',
      invitation: invitationDto(current),
      providerStatus,
    }, 202);
  }
  return applyProviderObservation(c, id, providerStatus, action, actor, reason);
};

app.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  await next();
});

app.get('/family-groups', (c) => {
  try {
    const snapshot = withYouTubeCapacityLock(() => ({
      groups: readFamilyGroups().familyGroups,
      jobs: readInvitationJobs().jobs,
      registrations: productRegistrationsStore().listForCapacityValidation(),
    }));
    return c.json({
      ok: true,
      enabled: enabled(),
      familyGroups: snapshot.groups.map((familyGroup) => ({
        ...familyGroupDto(familyGroup),
        availableSeats: Math.max(0, familyGroup.sellableSeats - occupiedYouTubeFamilyGroupSeats(
          familyGroup.id, snapshot.jobs, snapshot.registrations,
        )),
      })),
    });
  } catch {
    return unavailable(c);
  }
});

app.post('/family-groups', async (c) => {
  if (!enabled()) return disabledMutation(c);
  const body = await requestBody(c);
  if (!body || !hasExactFields(body, CREATE_FIELDS)) return c.json({ ok: false, error: 'invalid request' }, 400);
  const label = normalizeLabel(body.label);
  const managerEmail = normalizeYouTubeManagerEmail(body.managerEmail);
  const subscriptionEndDate = normalizeYouTubeSubscriptionDate(body.subscriptionEndDate);
  const sellableSeats = normalizeYouTubeSellableSeats(body.sellableSeats);
  if (!label || !managerEmail || subscriptionEndDate === undefined || sellableSeats === null) {
    return c.json({ ok: false, error: 'invalid request' }, 400);
  }
  try {
    return withYouTubeCapacityLock(() => {
      const store = familyGroupsStore();
      const data = readOrInitialize(store, { version: 1, familyGroups: [] } satisfies YouTubeFamilyGroupsStoreData);
      if (duplicateManagerEmail(data.familyGroups, managerEmail)) {
        return c.json({ ok: false, error: 'duplicate manager email' }, 409);
      }
      const now = new Date().toISOString();
      const familyGroup: YouTubeFamilyGroup = {
        id: `youtube-family-group:${randomUUID()}`,
        label,
        managerEmail,
        subscriptionEndDate,
        sellableSeats,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      };
      store.write({ version: 1, familyGroups: [...data.familyGroups, familyGroup] });
      return c.json({ ok: true, enabled: true, familyGroup: familyGroupDto(familyGroup) }, 201);
    });
  } catch {
    return unavailable(c);
  }
});

app.patch('/family-groups/:id', async (c) => {
  if (!enabled()) return disabledMutation(c);
  const body = await requestBody(c);
  if (!body || Object.keys(body).length === 0 || !hasOnlyFields(body, PATCH_FIELDS)) {
    return c.json({ ok: false, error: 'invalid request' }, 400);
  }
  const patch: Partial<Pick<YouTubeFamilyGroup, 'label' | 'managerEmail' | 'subscriptionEndDate' | 'sellableSeats' | 'enabled'>> = {};
  if ('label' in body) {
    const value = normalizeLabel(body.label);
    if (!value) return c.json({ ok: false, error: 'invalid request' }, 400);
    patch.label = value;
  }
  if ('managerEmail' in body) {
    const value = normalizeYouTubeManagerEmail(body.managerEmail);
    if (!value) return c.json({ ok: false, error: 'invalid request' }, 400);
    patch.managerEmail = value;
  }
  if ('subscriptionEndDate' in body) {
    const value = normalizeYouTubeSubscriptionDate(body.subscriptionEndDate);
    if (value === undefined) return c.json({ ok: false, error: 'invalid request' }, 400);
    patch.subscriptionEndDate = value;
  }
  if ('sellableSeats' in body) {
    const value = normalizeYouTubeSellableSeats(body.sellableSeats);
    if (value === null) return c.json({ ok: false, error: 'invalid request' }, 400);
    patch.sellableSeats = value;
  }
  if ('enabled' in body) {
    if (typeof body.enabled !== 'boolean') return c.json({ ok: false, error: 'invalid request' }, 400);
    patch.enabled = body.enabled;
  }
  try {
    return withYouTubeCapacityLock(() => {
      const store = familyGroupsStore();
      const data = readOrInitialize(store, { version: 1, familyGroups: [] } satisfies YouTubeFamilyGroupsStoreData);
      const index = data.familyGroups.findIndex((group) => group.id === c.req.param('id'));
      if (index < 0) return c.json({ ok: false, error: 'not found' }, 404);
      if (patch.managerEmail && duplicateManagerEmail(data.familyGroups, patch.managerEmail, data.familyGroups[index].id)) {
        return c.json({ ok: false, error: 'duplicate manager email' }, 409);
      }
      if (patch.sellableSeats !== undefined) {
        const occupied = occupiedYouTubeFamilySeats(
          data.familyGroups[index].id,
          readInvitationJobs().jobs,
          productRegistrationsStore().list(),
        );
        if (patch.sellableSeats < occupied) {
          return c.json({ ok: false, error: 'sellable seats below occupied capacity' }, 409);
        }
      }
      const familyGroup = { ...data.familyGroups[index], ...patch, updatedAt: new Date().toISOString() };
      const familyGroups = [...data.familyGroups];
      familyGroups[index] = familyGroup;
      store.write({ version: 1, familyGroups });
      return c.json({ ok: true, enabled: true, familyGroup: familyGroupDto(familyGroup) });
    });
  } catch {
    return unavailable(c);
  }
});

app.delete('/family-groups/:id', (c) => {
  if (!enabled()) return disabledMutation(c);
  try {
    return withYouTubeCapacityLock(() => {
      const store = familyGroupsStore();
      const data = readOrInitialize(store, { version: 1, familyGroups: [] } satisfies YouTubeFamilyGroupsStoreData);
      const index = data.familyGroups.findIndex((group) => group.id === c.req.param('id'));
      if (index < 0) return c.json({ ok: false, error: 'not found' }, 404);
      const existing = data.familyGroups[index];
      if (!existing.enabled) return c.json({ ok: true, enabled: true, familyGroup: familyGroupDto(existing) });
      const familyGroup = { ...existing, enabled: false, updatedAt: new Date().toISOString() };
      const familyGroups = [...data.familyGroups];
      familyGroups[index] = familyGroup;
      store.write({ version: 1, familyGroups });
      return c.json({ ok: true, enabled: true, familyGroup: familyGroupDto(familyGroup) });
    });
  } catch {
    return unavailable(c);
  }
});

const PRODUCT_FIELDS = ['familyGroupId', 'endDate', 'price', 'name', 'sellingGuide'] as const;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._~:+-]{8,128}$/;
const CAPACITY_CONSUMING_INVITATION_STATUSES = new Set([
  'waiting_for_group_assignment', 'waiting_for_buyer_email', 'email_candidate_found', 'email_confirmed',
  'invite_sent', 'delivery_completion_pending', 'delivered_waiting_inspection', 'active',
]);
function occupiedYouTubeFamilySeats(
  familyGroupId: string,
  jobs: readonly YouTubeInvitationJob[],
  registrations: readonly YouTubeProductRegistrationRecord[],
): number {
  const normalizedFamilyGroupId = familyGroupId.trim().toLowerCase();
  const occupiedProducts = new Set<string>();
  const fallbackDeals = new Set<string>();
  let productlessReservations = 0;
  for (const job of jobs) {
    if (job.familyGroupId.trim().toLowerCase() !== normalizedFamilyGroupId
      || !CAPACITY_CONSUMING_INVITATION_STATUSES.has(job.status)) continue;
    const productUsid = job.productUsid.trim().toLowerCase();
    if (productUsid) occupiedProducts.add(productUsid);
    else {
      const dealUsid = job.dealUsid.trim().toLowerCase();
      if (dealUsid) fallbackDeals.add(dealUsid);
    }
  }
  for (const registration of registrations) {
    if (registration.familyGroupId.trim().toLowerCase() !== normalizedFamilyGroupId
      || registration.status === 'failed') continue;
    if (registration.status === 'registered' && registration.productUsid) {
      occupiedProducts.add(registration.productUsid.trim().toLowerCase());
    } else if (registration.status === 'submitting' || registration.status === 'uncertain') {
      productlessReservations += 1;
    }
  }
  return occupiedProducts.size + fallbackDeals.size + productlessReservations;
}
const registrationError = (c: any, status: number, code: string) => c.json({ ok: false, error: 'youtube product registration unavailable', code }, status);

app.post('/products', async (c) => {
  if (!enabled()) return disabledMutation(c);
  const reason = auditReason(c);
  if (!reason) return c.json({ ok: false, error: 'invalid audit reason' }, 400);
  const idempotencyKey = c.req.header('idempotency-key')?.trim() || '';
  if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) return c.json({ ok: false, error: 'invalid idempotency key' }, 400);
  const body = await requestBody(c);
  if (!body || !hasExactFields(body, PRODUCT_FIELDS) || typeof body.familyGroupId !== 'string'
    || !body.familyGroupId.trim() || body.familyGroupId !== body.familyGroupId.trim() || body.familyGroupId.length > 200
    || typeof body.endDate !== 'string' || typeof body.name !== 'string' || typeof body.sellingGuide !== 'string'
    || typeof body.price !== 'number') {
    return c.json({ ok: false, error: 'invalid request' }, 400);
  }
  let submittedModel: YouTubeSharingNoKeepProductModel;
  try {
    submittedModel = buildYouTubeSharingNoKeepProductModel({ endDate: body.endDate as string, price: body.price as number, name: body.name as string, sellingGuide: body.sellingGuide as string });
  } catch { return c.json({ ok: false, error: 'invalid request' }, 400); }
  const seoulParts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(dependencies.now?.() ?? new Date()).map((part) => [part.type, part.value]));
  const todayCompact = `${seoulParts.year}${seoulParts.month}${seoulParts.day}`;
  if (submittedModel.endDate.slice(0, 8) <= todayCompact) return c.json({ ok: false, error: 'end date must be after today' }, 400);
  const familyGroupId = body.familyGroupId;
  const actor = dependencies.actor?.(c)?.trim() || 'admin:authenticated';
  let model = submittedModel;
  let requestFingerprint = '';
  let claim;
  try {
    const atomicResult = withYouTubeCapacityLock(() => {
      const familyGroup = readFamilyGroups().familyGroups.find((group) => group.id === familyGroupId);
      if (!familyGroup) return { response: c.json({ ok: false, error: 'not found' }, 404) };
      if (!familyGroup.enabled) return { response: c.json({ ok: false, error: 'family group disabled' }, 409) };
      if (familyGroup.subscriptionEndDate && familyGroup.subscriptionEndDate.replaceAll('-', '') < todayCompact) {
        return { response: c.json({ ok: false, error: 'family group expired' }, 409) };
      }
      if (familyGroup.subscriptionEndDate && submittedModel.endDate.slice(0, 8) > familyGroup.subscriptionEndDate.replaceAll('-', '')) {
        return { response: c.json({ ok: false, error: 'end date exceeds family group subscription' }, 400) };
      }
      const listingCode = youtubeListingCodeFromManagerEmail(familyGroup.managerEmail);
      model = {
        ...submittedModel,
        name: appendYouTubeListingCode(submittedModel.name, listingCode),
      };
      requestFingerprint = fingerprintYouTubeProductRegistration(familyGroupId, model);
      const compatibleRequestFingerprints = [fingerprintYouTubeProductRegistration(familyGroupId, submittedModel)];
      const nameWithoutListingCode = removeYouTubeListingCode(submittedModel.name, listingCode);
      if (nameWithoutListingCode !== submittedModel.name) {
        compatibleRequestFingerprints.push(fingerprintYouTubeProductRegistration(
          familyGroupId,
          { ...submittedModel, name: nameWithoutListingCode },
        ));
      }
      const jobs = readInvitationJobs().jobs;
      const externalOccupiedProductUsids = new Set<string>();
      const fallbackDealIds = new Set<string>();
      for (const job of jobs) {
        if (job.familyGroupId.trim().toLowerCase() !== familyGroupId.trim().toLowerCase()
          || !CAPACITY_CONSUMING_INVITATION_STATUSES.has(job.status)) continue;
        const productUsid = job.productUsid.trim().toLowerCase();
        if (productUsid) externalOccupiedProductUsids.add(productUsid);
        else {
          const dealUsid = job.dealUsid.trim().toLowerCase();
          if (dealUsid) fallbackDealIds.add(dealUsid);
        }
      }
      return {
        claim: productRegistrationsStore().claimWithCapacity(
          { idempotencyKey, requestFingerprint, compatibleRequestFingerprints, familyGroupId, actor, reasonCode: 'registration-requested', at: dependencies.now?.().toISOString() },
          {
            familyCapacity: familyGroup.sellableSeats,
            externalOccupiedProductUsids,
            externalOccupiedFallbackCount: fallbackDealIds.size,
          },
        ),
      };
    });
    if ('response' in atomicResult) return atomicResult.response;
    claim = atomicResult.claim;
  } catch { return unavailable(c); }
  if (claim.kind === 'no_capacity') return c.json({ ok: false, error: 'no available capacity', code: 'YOUTUBE_FAMILY_GROUP_NO_CAPACITY' }, 409);
  if (claim.kind === 'conflict') return registrationError(c, 409, 'YOUTUBE_PRODUCT_IDEMPOTENCY_CONFLICT');
  if (claim.kind === 'replay') return c.json({ ok: true, replayed: true, productUsid: claim.record.productUsid, familyGroupId, status: 'registered' });
  if (claim.kind === 'blocked') {
    const code = claim.record.status === 'uncertain' ? 'YOUTUBE_PRODUCT_REGISTRATION_UNCERTAIN'
      : claim.record.status === 'failed' ? 'YOUTUBE_PRODUCT_REGISTRATION_FAILED' : 'YOUTUBE_PRODUCT_REGISTRATION_IN_PROGRESS';
    return registrationError(c, 409, code);
  }

  if (claim.kind === 'recovery') {
    let observation: { status: 'registered'; productUsid: string } | { status: 'uncertain' } = { status: 'uncertain' };
    try { observation = await dependencies.reconcileProductRegistration?.({ attemptId: claim.record.attemptId, requestFingerprint: claim.record.requestFingerprint, familyGroupId }) ?? observation; } catch {}
    const productUsid = observation.status === 'registered' && typeof observation.productUsid === 'string'
      ? observation.productUsid.trim() : '';
    if (observation.status === 'registered' && productUsid && productUsid.length <= 200) {
      try { productRegistrationsStore().complete(idempotencyKey, 'registered', { attemptId: claim.record.attemptId, actor, reasonCode: 'provider-reconciled', productUsid, at: dependencies.now?.().toISOString() }); }
      catch { return unavailable(c); }
      dependencies.audit?.({ outcome: 'registered', actor, reason, familyGroupId, productUsid });
      return c.json({ ok: true, replayed: true, productUsid, familyGroupId, status: 'registered' });
    }
    try { productRegistrationsStore().complete(idempotencyKey, 'uncertain', { attemptId: claim.record.attemptId, actor, reasonCode: 'provider-reconciliation-uncertain', at: dependencies.now?.().toISOString() }); }
    catch { return unavailable(c); }
    dependencies.audit?.({ outcome: 'uncertain', actor, reason, familyGroupId, productUsid: null });
    return registrationError(c, 409, 'YOUTUBE_PRODUCT_REGISTRATION_UNCERTAIN');
  }

  const finish = (outcome: 'uncertain' | 'failed', reasonCode: string, code: string) => {
    try { productRegistrationsStore().complete(idempotencyKey, outcome, { attemptId: claim.record.attemptId, actor, reasonCode, at: dependencies.now?.().toISOString() }); } catch { return unavailable(c); }
    dependencies.audit?.({ outcome, actor, reason, familyGroupId, productUsid: null });
    return registrationError(c, 502, code);
  };
  let response: Response;
  try {
    if (!dependencies.registerProduct) throw new Error('provider unavailable');
    response = await dependencies.registerProduct(model);
  } catch { return finish('uncertain', 'provider-outcome-uncertain', 'YOUTUBE_PRODUCT_REGISTRATION_UNCERTAIN'); }
  let payload: unknown = null;
  try { payload = await response.json(); } catch {}
  const providerPayload = isRecord(payload) ? payload : null;
  if (response.status >= 500 || (response.status >= 300 && response.status < 400) || response.redirected
    || !providerPayload || typeof providerPayload.succeeded !== 'boolean') {
    return finish('uncertain', 'provider-outcome-uncertain', 'YOUTUBE_PRODUCT_REGISTRATION_UNCERTAIN');
  }
  if (providerPayload.succeeded === false) return finish('failed', 'provider-rejected', 'YOUTUBE_PRODUCT_REGISTRATION_FAILED');
  const productUsid = typeof providerPayload.data === 'string' ? providerPayload.data.trim() : '';
  if (!response.ok || !productUsid || productUsid.length > 200) return finish('uncertain', 'provider-outcome-uncertain', 'YOUTUBE_PRODUCT_REGISTRATION_UNCERTAIN');
  try { productRegistrationsStore().complete(idempotencyKey, 'registered', { attemptId: claim.record.attemptId, actor, reasonCode: 'provider-succeeded', productUsid, at: dependencies.now?.().toISOString() }); }
  catch { return unavailable(c); }
  dependencies.audit?.({ outcome: 'registered', actor, reason, familyGroupId, productUsid });
  return c.json({ ok: true, productUsid, familyGroupId, status: 'registered' }, 201);
});

app.get('/products/registrations', (c) => {
  try {
    const registrations = productRegistrationsStore().list().map(({ idempotencyKey, familyGroupId, status, productUsid, createdAt, updatedAt }) => ({
      registrationDisplayId: privacySafeIdentifier('registration', idempotencyKey),
      familyGroupId,
      status,
      productUsid,
      productDisplayId: productUsid ? privacySafeIdentifier('product', productUsid) : null,
      createdAt,
      updatedAt,
    }));
    return c.json({ ok: true, enabled: enabled(), registrations });
  } catch { return unavailable(c); }
});

app.get('/invitations', (c) => {
  const status = c.req.query('status');
  const familyGroupId = c.req.query('familyGroupId');
  if ((status !== undefined && !INVITATION_STATUSES.has(status as YouTubeInvitationStatus))
    || (familyGroupId !== undefined && !strictText(familyGroupId, 200))) {
    return c.json({ ok: false, error: 'invalid query' }, 400);
  }
  try {
    const invitations = readInvitationJobs().jobs
      .filter((job) => status === undefined || job.status === status)
      .filter((job) => familyGroupId === undefined || job.familyGroupId === familyGroupId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))
      .map(invitationDto);
    return c.json({ ok: true, enabled: enabled(), invitations });
  } catch { return unavailable(c); }
});

app.post('/invitations/ingest', async (c) => {
  if (!enabled()) return disabledMutation(c);
  const reason = auditReason(c);
  if (!reason) return c.json({ ok: false, error: 'invalid audit reason' }, 400);
  const body = await requestBody(c);
  if (!body || !hasExactFields(body, INGEST_FIELDS)
    || !strictText(body.dealUsid, 200) || !strictText(body.productUsid, 200)
    || !strictText(body.chatRoomUuid, 200) || !strictText(body.buyerName, 200)
    || !(body.endDateTime === null || isYouTubeIsoTimestamp(body.endDateTime))
    || body.providerStatus !== 'Delivering') {
    return c.json({ ok: false, error: 'invalid request' }, 400);
  }
  const input = body as {
    dealUsid: string; productUsid: string; chatRoomUuid: string; buyerName: string;
    endDateTime: string | null; providerStatus: 'Delivering';
  };
  const actor = actorFor(c);
  try {
    return withYouTubeCapacityLock(() => {
      const registration = productRegistrationsStore().list().find((record) =>
        record.status === 'registered' && record.productUsid === input.productUsid);
      if (!registration) return c.json({ ok: false, error: 'invitation product binding unavailable' }, 409);
      const store = invitationJobsStore();
      const data = readOrEmpty(store, { version: 1, jobs: [] } satisfies YouTubeInvitationJobsStoreData);
      const ensured = ensureYouTubeInvitationJob(data.jobs, {
        dealUsid: input.dealUsid,
        productUsid: input.productUsid,
        chatRoomUuid: input.chatRoomUuid,
        familyGroupId: registration.familyGroupId,
        buyerName: input.buyerName,
        buyerGoogleEmail: null,
        endDateTime: input.endDateTime,
      });
      if (!ensured.created) {
        const immutableMatch = ensured.job.productUsid === input.productUsid
          && ensured.job.chatRoomUuid === input.chatRoomUuid;
        if (!immutableMatch) {
          auditJob('ingest', 'failed', actor, reason, ensured.job);
          return c.json({ ok: false, error: 'invitation ingest conflict' }, 409);
        }
        auditJob('ingest', 'success', actor, reason, ensured.job);
        return c.json({ ok: true, replayed: true, invitation: invitationDto(ensured.job) });
      }
      const advanced = applyYouTubeInvitationTransition(ensured.job, 'waiting_for_buyer_email', { actor, reason });
      store.write({ version: 1, jobs: replaceInvitationJob(ensured.jobs, advanced) });
      auditJob('ingest', 'success', actor, reason, advanced);
      return c.json({ ok: true, replayed: false, invitation: invitationDto(advanced) }, 201);
    });
  } catch {
    return unavailable(c);
  }
});

app.post('/invitations/:id/email-candidate', async (c) => {
  if (!enabled()) return disabledMutation(c);
  const reason = auditReason(c);
  if (!reason) return c.json({ ok: false, error: 'invalid audit reason' }, 400);
  const body = await requestBody(c);
  if (!body || !hasExactFields(body, EMAIL_CANDIDATE_FIELDS)
    || typeof body.message !== 'string' || body.message.length > 10_000) {
    return c.json({ ok: false, error: 'invalid request' }, 400);
  }
  const result = parseYouTubeInviteEmailCandidates(body.message);
  const actor = actorFor(c);
  try {
    return withYouTubeCapacityLock(() => {
      const store = invitationJobsStore();
      const data = readOrInitialize(store, { version: 1, jobs: [] } satisfies YouTubeInvitationJobsStoreData);
      const current = findInvitationByPublicId(data.jobs, c.req.param('id'));
      if (!current) return c.json({ ok: false, error: 'invitation not found' }, 404);
      if (current.status !== 'waiting_for_buyer_email') {
        auditJob('email-candidate', 'failed', actor, reason, current);
        return c.json({ ok: false, error: 'invitation lifecycle conflict' }, 409);
      }
      if (result.kind !== 'single_candidate') {
        auditJob('email-candidate', 'success', actor, reason, current);
        return c.json({ ok: true, result });
      }
      const updated = applyYouTubeInvitationTransition(
        { ...current, buyerGoogleEmail: result.candidate },
        'email_candidate_found',
        { actor, reason },
      );
      store.write({ version: 1, jobs: replaceInvitationJob(data.jobs, updated) });
      auditJob('email-candidate', 'success', actor, reason, updated);
      return c.json({
        ok: true,
        result: { kind: 'single_candidate', masked: result.masked },
        invitation: invitationDto(updated),
      });
    });
  } catch { return unavailable(c); }
});

app.post('/invitations/:id/confirm-email', async (c) => {
  if (!enabled()) return disabledMutation(c);
  const reason = auditReason(c);
  if (!reason) return c.json({ ok: false, error: 'invalid audit reason' }, 400);
  const body = await requestBody(c);
  if (!body || !hasExactFields(body, CONFIRM_EMAIL_FIELDS)) return c.json({ ok: false, error: 'invalid request' }, 400);
  const email = normalizeYouTubeManagerEmail(body.email);
  if (!email) return c.json({ ok: false, error: 'invalid request' }, 400);
  const actor = actorFor(c);
  try {
    return withYouTubeCapacityLock(() => {
      const store = invitationJobsStore();
      const data = readOrInitialize(store, { version: 1, jobs: [] } satisfies YouTubeInvitationJobsStoreData);
      const current = findInvitationByPublicId(data.jobs, c.req.param('id'));
      if (!current) return c.json({ ok: false, error: 'invitation not found' }, 404);
      if (current.status !== 'email_candidate_found' || current.buyerGoogleEmail !== email) {
        auditJob('confirm-email', 'failed', actor, reason, current);
        return c.json({ ok: false, error: 'invitation lifecycle conflict' }, 409);
      }
      const updated = applyYouTubeInvitationTransition(current, 'email_confirmed', { actor, reason });
      store.write({ version: 1, jobs: replaceInvitationJob(data.jobs, updated) });
      auditJob('confirm-email', 'success', actor, reason, updated);
      return c.json({ ok: true, invitation: invitationDto(updated) });
    });
  } catch { return unavailable(c); }
});

const handleMarkInviteSent = async (c: any) => {
  if (!enabled()) return disabledMutation(c);
  const reason = auditReason(c);
  if (!reason) return c.json({ ok: false, error: 'invalid audit reason' }, 400);
  if (!await acceptsEmptyJsonBody(c)) return c.json({ ok: false, error: 'invalid request' }, 400);
  const actor = actorFor(c);
  try {
    return withYouTubeCapacityLock(() => {
      const store = invitationJobsStore();
      const data = readOrInitialize(store, { version: 1, jobs: [] } satisfies YouTubeInvitationJobsStoreData);
      const current = findInvitationByPublicId(data.jobs, c.req.param('id'));
      if (!current) return c.json({ ok: false, error: 'invitation not found' }, 404);
      if (current.status !== 'email_confirmed') {
        auditJob('invite-sent', 'failed', actor, reason, current);
        return c.json({ ok: false, error: 'invitation lifecycle conflict' }, 409);
      }
      const updated = applyYouTubeInvitationTransition(current, 'invite_sent', { actor, reason });
      store.write({ version: 1, jobs: replaceInvitationJob(data.jobs, updated) });
      auditJob('invite-sent', 'success', actor, reason, updated);
      return c.json({ ok: true, invitation: invitationDto(updated) });
    });
  } catch { return unavailable(c); }
};

app.post('/invitations/:id/mark-invite-sent', handleMarkInviteSent);
app.post('/invitations/:id/invite-sent', handleMarkInviteSent);

app.post('/invitations/:id/finish-delivery', async (c) => {
  if (!enabled()) return disabledMutation(c);
  const reason = auditReason(c);
  if (!reason) return c.json({ ok: false, error: 'invalid audit reason' }, 400);
  if (!await acceptsEmptyJsonBody(c)) return c.json({ ok: false, error: 'invalid request' }, 400);
  const actor = actorFor(c);
  const id = c.req.param('id');
  let pending: YouTubeInvitationJob;
  try {
    const prepared = withYouTubeCapacityLock(() => {
      const store = invitationJobsStore();
      const data = readOrInitialize(store, { version: 1, jobs: [] } satisfies YouTubeInvitationJobsStoreData);
      const current = findInvitationByPublicId(data.jobs, id);
      if (!current) return { kind: 'not_found' as const };
      if (current.status === 'delivery_completion_pending') return { kind: 'reconcile' as const, job: current };
      if (current.status !== 'invite_sent') return { kind: 'conflict' as const, job: current };
      const updated = applyYouTubeInvitationTransition(current, 'delivery_completion_pending', { actor, reason });
      store.write({ version: 1, jobs: replaceInvitationJob(data.jobs, updated) });
      return { kind: 'pending' as const, job: updated };
    });
    if (prepared.kind === 'not_found') return c.json({ ok: false, error: 'invitation not found' }, 404);
    if (prepared.kind === 'conflict') {
      auditJob('finish-delivery', 'failed', actor, reason, prepared.job);
      return c.json({ ok: false, error: 'invitation lifecycle conflict' }, 409);
    }
    if (prepared.kind === 'reconcile') return reconcileByFetch(c, id, 'finish-delivery', actor, reason);
    pending = prepared.job;
  } catch { return unavailable(c); }

  let response: Response | null = null;
  let payload: unknown = null;
  try {
    response = dependencies.finishDelivery ? await dependencies.finishDelivery(pending.dealUsid) : null;
    if (response) payload = await response.json();
  } catch { response = null; payload = null; }
  const providerPayload = isRecord(payload) && typeof payload.succeeded === 'boolean' ? payload : null;
  const trustworthyResponse = response && response.ok && !response.redirected
    && response.status >= 200 && response.status < 300 && providerPayload;
  if (!trustworthyResponse) {
    auditJob('finish-delivery', 'uncertain', actor, reason, pending);
    return c.json({
      ok: false,
      error: 'delivery completion uncertain',
      code: 'YOUTUBE_DELIVERY_OUTCOME_UNCERTAIN',
      invitation: invitationDto(pending),
    }, 502);
  }
  if (providerPayload.succeeded === false) {
    try {
      const failed = withYouTubeCapacityLock(() => {
        const store = invitationJobsStore();
        const data = readInvitationJobs();
        const current = findInvitationByPublicId(data.jobs, id);
        if (!current || current.status !== 'delivery_completion_pending') return null;
        const updated = applyYouTubeInvitationTransition(current, 'failed', { actor, reason: 'provider rejected delivery completion' });
        store.write({ version: 1, jobs: replaceInvitationJob(data.jobs, updated) });
        return updated;
      });
      if (!failed) return c.json({ ok: false, error: 'invitation lifecycle conflict' }, 409);
      auditJob('finish-delivery', 'failed', actor, reason, failed);
      return c.json({ ok: false, error: 'delivery completion rejected', invitation: invitationDto(failed) }, 409);
    } catch { return unavailable(c); }
  }
  let providerStatus: string | null = null;
  try { providerStatus = await dependencies.fetchProviderStatus?.(pending.dealUsid) ?? null; }
  catch { providerStatus = null; }
  if (!providerStatus || providerStatus === 'Delivering') {
    auditJob('finish-delivery', 'uncertain', actor, reason, pending);
    return c.json({
      ok: false,
      error: 'delivery accepted pending provider confirmation',
      code: 'YOUTUBE_DELIVERY_ACCEPTED_PENDING_CONFIRMATION',
      invitation: invitationDto(pending),
      ...(providerStatus ? { providerStatus } : {}),
    }, 202);
  }
  return applyProviderObservation(c, id, providerStatus, 'finish-delivery', actor, reason);
});

app.post('/invitations/:id/reconcile', async (c) => {
  if (!enabled()) return disabledMutation(c);
  const reason = auditReason(c);
  if (!reason) return c.json({ ok: false, error: 'invalid audit reason' }, 400);
  if (!await acceptsEmptyJsonBody(c)) return c.json({ ok: false, error: 'invalid request' }, 400);
  return reconcileByFetch(c, c.req.param('id'), 'reconcile', actorFor(c), reason);
});

app.post('/invitations/:id/resume', async (c) => {
  if (!enabled()) return disabledMutation(c);
  const reason = auditReason(c);
  if (!reason) return c.json({ ok: false, error: 'invalid audit reason' }, 400);
  if (!await acceptsEmptyJsonBody(c)) return c.json({ ok: false, error: 'invalid request' }, 400);
  const actor = actorFor(c);
  try {
    return withYouTubeCapacityLock(() => {
      const store = invitationJobsStore();
      const data = readOrInitialize(store, { version: 1, jobs: [] } satisfies YouTubeInvitationJobsStoreData);
      const current = findInvitationByPublicId(data.jobs, c.req.param('id'));
      if (!current) return c.json({ ok: false, error: 'invitation not found' }, 404);
      let updated: YouTubeInvitationJob;
      try {
        updated = resumeFailedYouTubeInvitation(current, { actor, reason });
        const nextJobs = replaceInvitationJob(data.jobs, updated);
        assertYouTubeCapacityInvariant(
          readFamilyGroups().familyGroups,
          nextJobs,
          productRegistrationsStore().listForCapacityValidation(),
        );
        store.write({ version: 1, jobs: nextJobs });
      } catch (error) {
        auditJob('resume', 'failed', actor, reason, current);
        if (error instanceof YouTubeCapacityInvariantError) {
          return c.json({ ok: false, error: 'youtube capacity unavailable' }, 409);
        }
        return c.json({ ok: false, error: 'invitation lifecycle conflict' }, 409);
      }
      auditJob('resume', 'success', actor, reason, updated);
      return c.json({ ok: true, invitation: invitationDto(updated) });
    });
  } catch { return unavailable(c); }
});

return app;
}

export default createYouTubeInvitationsApp();
