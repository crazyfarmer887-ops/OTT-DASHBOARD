import {
  applyYouTubeInvitationTransition,
  ensureYouTubeInvitationJob,
  isYouTubeIsoTimestamp,
  reconcileYouTubeInvitationProviderStatus,
  YouTubeFamilyGroupsStore,
  YouTubeInvitationJobsStore,
  type YouTubeFamilyGroupsStoreData,
  type YouTubeInvitationJob,
  type YouTubeInvitationJobsStoreData,
} from './youtube-invitations';
import { withYouTubeCapacityLock } from './youtube-capacity-lock';
import {
  YouTubeProductRegistrationsStore,
  type YouTubeProductRegistrationRecord,
} from './youtube-product-registrations';

const DEFAULT_FAMILY_GROUPS_PATH = 'data/youtube-family-groups.json';
const DEFAULT_INVITATIONS_PATH = 'data/youtube-invitations.json';
const DEFAULT_PRODUCT_REGISTRATIONS_PATH = 'data/youtube-product-registrations.json';

const PROVIDER_TERMINAL_STATUSES = new Set([
  'Cancelled',
  'CancelByDepositRejection',
  'CancelByInspectionRejection',
  'CancelByNoShow',
  'CancelByLendingRejection',
  'FinishedByBorrowerRequest',
  'FinishedByLenderRequest',
  'NormalFinished',
]);
const SUPPORTED_PROVIDER_STATUSES = new Set([
  'Delivering',
  'Delivered',
  'Using',
  ...PROVIDER_TERMINAL_STATUSES,
]);

export interface YouTubeInvitationProviderDeal {
  dealUsid?: unknown;
  productUsid?: unknown;
  chatRoomUuid?: unknown;
  uuid?: unknown;
  borrowerName?: unknown;
  endDateTime?: unknown;
  dealStatus?: unknown;
  [key: string]: unknown;
}

export interface YouTubeInvitationPollReconcileResult {
  enabled: boolean;
  observed: number;
  created: number;
  transitioned: number;
  conflicts: number;
  unchanged: number;
  changed: boolean;
}

interface FamilyGroupsReader {
  read(): YouTubeFamilyGroupsStoreData;
}
interface InvitationJobsStore {
  read(): YouTubeInvitationJobsStoreData;
  readOrInitializeEmpty?(): YouTubeInvitationJobsStoreData;
  write(data: YouTubeInvitationJobsStoreData): void;
}
interface ProductRegistrationsReader {
  listForCapacityValidation(): YouTubeProductRegistrationRecord[];
}

export interface YouTubeInvitationPollerDependencies {
  env?: NodeJS.ProcessEnv;
  now?: () => string;
  logger?: (message: string) => void;
  withLock?: <T>(operation: () => T) => T;
  familyGroupsStore?: FamilyGroupsReader;
  invitationJobsStore?: InvitationJobsStore;
  productRegistrationsStore?: ProductRegistrationsReader;
}

function automationEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.YOUTUBE_INVITE_SALES_ENABLED === 'true'
    && env.YOUTUBE_INVITE_PROVIDER_AUTOMATION_ENABLED === 'true';
}

function exactNonBlankText(value: unknown, max = 300): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= max
    && value.trim() === value
    && !/[\x00-\x1f\x7f]/.test(value);
}

interface ValidProviderDeal {
  dealUsid: string;
  productUsid: string;
  chatRoomUuid: string;
  borrowerName: string;
  endDateTime: string | null;
  dealStatus: string;
}

type ProviderDealIdentity = Pick<ValidProviderDeal, 'dealUsid' | 'productUsid' | 'dealStatus'>;

function parseProviderDealIdentity(deal: YouTubeInvitationProviderDeal): ProviderDealIdentity | null {
  if (!exactNonBlankText(deal.dealUsid, 200)
    || !exactNonBlankText(deal.productUsid, 200)
    || !exactNonBlankText(deal.dealStatus, 100)
    || !SUPPORTED_PROVIDER_STATUSES.has(deal.dealStatus)) {
    return null;
  }
  return { dealUsid: deal.dealUsid, productUsid: deal.productUsid, dealStatus: deal.dealStatus };
}

function parseProviderDealForIngest(
  deal: YouTubeInvitationProviderDeal,
  identity: ProviderDealIdentity,
): ValidProviderDeal | null {
  const room = deal.chatRoomUuid ?? deal.uuid;
  if (!exactNonBlankText(room, 300)
    || !exactNonBlankText(deal.borrowerName, 200)
    || !(deal.endDateTime === null || isYouTubeIsoTimestamp(deal.endDateTime))) {
    return null;
  }
  return {
    ...identity,
    chatRoomUuid: room,
    borrowerName: deal.borrowerName,
    endDateTime: deal.endDateTime,
  };
}

function replaceJob(jobs: readonly YouTubeInvitationJob[], updated: YouTubeInvitationJob): YouTubeInvitationJob[] {
  return jobs.map((job) => job.id === updated.id ? updated : job);
}

function normalizedIdentity(value: string): string {
  return value.trim().toLowerCase();
}

function emptyResult(): YouTubeInvitationPollReconcileResult {
  return {
    enabled: false,
    observed: 0,
    created: 0,
    transitioned: 0,
    conflicts: 0,
    unchanged: 0,
    changed: false,
  };
}

/**
 * Reconcile already-fetched provider snapshots. This function performs no network
 * requests and does not invoke any delivery, chat, or invitation side effects.
 */
export function reconcileYouTubeInvitationProviderDeals(
  deals: readonly YouTubeInvitationProviderDeal[],
  dependencies: YouTubeInvitationPollerDependencies = {},
): YouTubeInvitationPollReconcileResult {
  const env = dependencies.env ?? process.env;
  if (!automationEnabled(env)) return emptyResult();

  const familyGroupsStore = dependencies.familyGroupsStore
    ?? new YouTubeFamilyGroupsStore(env.YOUTUBE_FAMILY_GROUPS_PATH || DEFAULT_FAMILY_GROUPS_PATH);
  const invitationJobsStore = dependencies.invitationJobsStore
    ?? new YouTubeInvitationJobsStore(env.YOUTUBE_INVITATIONS_PATH || DEFAULT_INVITATIONS_PATH);
  const productRegistrationsStore = dependencies.productRegistrationsStore
    ?? new YouTubeProductRegistrationsStore(env.YOUTUBE_PRODUCT_REGISTRATIONS_PATH || DEFAULT_PRODUCT_REGISTRATIONS_PATH);
  const lock = dependencies.withLock ?? withYouTubeCapacityLock;
  const now = dependencies.now ?? (() => new Date().toISOString());

  const result = lock(() => {
    const families = familyGroupsStore.read().familyGroups;
    let jobs = (invitationJobsStore.readOrInitializeEmpty?.() ?? invitationJobsStore.read()).jobs;
    const registrations = productRegistrationsStore.listForCapacityValidation();
    const registeredByProduct = new Map(
      registrations
        .filter((record) => record.status === 'registered' && record.productUsid !== null)
        .map((record) => [record.productUsid!, record]),
    );
    const familyIds = new Set(families.map((family) => family.id));
    const counts: YouTubeInvitationPollReconcileResult = {
      enabled: true,
      observed: deals.length,
      created: 0,
      transitioned: 0,
      conflicts: 0,
      unchanged: 0,
      changed: false,
    };

    for (const snapshot of deals) {
      const identity = parseProviderDealIdentity(snapshot);
      if (!identity) {
        counts.conflicts += 1;
        continue;
      }

      let index = jobs.findIndex((job) => job.dealUsid === identity.dealUsid);
      let parsed: ValidProviderDeal | ProviderDealIdentity = identity;
      if (index < 0) {
        if (jobs.some((job) => normalizedIdentity(job.dealUsid) === normalizedIdentity(identity.dealUsid))) {
          counts.conflicts += 1;
          continue;
        }
        const ingest = parseProviderDealForIngest(snapshot, identity);
        if (!ingest) {
          counts.conflicts += 1;
          continue;
        }
        parsed = ingest;
        const registration = registeredByProduct.get(parsed.productUsid);
        if (!registration || !familyIds.has(registration.familyGroupId)) {
          counts.conflicts += 1;
          continue;
        }
        const createdAt = now();
        if (!isYouTubeIsoTimestamp(createdAt)) {
          counts.conflicts += 1;
          continue;
        }
        const ensured = ensureYouTubeInvitationJob(jobs, {
          dealUsid: parsed.dealUsid,
          productUsid: parsed.productUsid,
          chatRoomUuid: parsed.chatRoomUuid,
          familyGroupId: registration.familyGroupId,
          buyerName: parsed.borrowerName,
          buyerGoogleEmail: null,
          endDateTime: parsed.endDateTime,
        }, createdAt);
        if (!ensured.created
          || ensured.job.dealUsid !== parsed.dealUsid
          || ensured.job.productUsid !== parsed.productUsid) {
          counts.conflicts += 1;
          continue;
        }
        const waiting = applyYouTubeInvitationTransition(ensured.job, 'waiting_for_buyer_email', {
          actor: 'provider-poll-reconciler',
          reason: 'registered provider deal observed',
          at: createdAt,
        });
        index = ensured.jobs.findIndex((job) => job === ensured.job);
        if (index < 0) {
          counts.conflicts += 1;
          continue;
        }
        jobs = ensured.jobs.map((job, jobIndex) => jobIndex === index ? waiting : job);
        counts.created += 1;
        counts.changed = true;
      }

      const current = jobs[index];
      if (current.dealUsid !== parsed.dealUsid || current.productUsid !== parsed.productUsid) {
        counts.conflicts += 1;
        continue;
      }
      if (parsed.dealStatus === 'Delivering') {
        counts.unchanged += 1;
        continue;
      }

      try {
        const updated = reconcileYouTubeInvitationProviderStatus(current, parsed.dealStatus, {
          actor: 'provider-poll-reconciler',
          reason: 'authoritative provider status observed',
          at: now(),
        }, jobs);
        if (updated === current) {
          counts.unchanged += 1;
        } else {
          jobs = replaceJob(jobs, updated);
          counts.transitioned += 1;
          counts.changed = true;
        }
      } catch {
        counts.conflicts += 1;
      }
    }

    if (counts.changed) invitationJobsStore.write({ version: 1, jobs });
    return counts;
  });

  const log = dependencies.logger ?? ((message: string) => console.log(message));
  log('[YouTubeInvitePoller] '
    + `observed=${result.observed} created=${result.created} transitioned=${result.transitioned} `
    + `conflicts=${result.conflicts} unchanged=${result.unchanged} changed=${result.changed}`);
  return result;
}

/** Only combine snapshots when the after/active source is authoritative. */
export function observeYouTubeInvitationPollSources(
  beforeDeals: readonly YouTubeInvitationProviderDeal[],
  afterDeals: readonly YouTubeInvitationProviderDeal[],
  beforeAuthoritative: boolean,
  afterAuthoritative: boolean,
  reconcile: (deals: readonly YouTubeInvitationProviderDeal[]) => unknown = reconcileYouTubeInvitationProviderDeals,
): { skipped: boolean } {
  if (!beforeAuthoritative || !afterAuthoritative) return { skipped: true };
  reconcile([...beforeDeals, ...afterDeals]);
  return { skipped: false };
}
