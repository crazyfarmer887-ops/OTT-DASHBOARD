import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, dirname, parse, resolve } from 'node:path';
import { withYouTubeCapacityLock } from './youtube-capacity-lock';
import { assertYouTubeCapacityInvariant } from './youtube-capacity-invariant';
import { YouTubeProductRegistrationsStore } from './youtube-product-registrations';

export { YouTubeCapacityInvariantError } from './youtube-capacity-invariant';

export type YouTubeInvitationStatus =
  | 'waiting_for_group_assignment'
  | 'waiting_for_buyer_email'
  | 'email_candidate_found'
  | 'email_confirmed'
  | 'invite_sent'
  | 'delivery_completion_pending'
  | 'delivered_waiting_inspection'
  | 'active'
  | 'failed'
  | 'ended';

export interface YouTubeInvitationHistoryEntry {
  from: YouTubeInvitationStatus | null;
  to: YouTubeInvitationStatus;
  actor: string;
  reason: string;
  at: string;
}

export interface YouTubeFamilyGroup {
  id: string;
  label: string;
  managerEmail: string;
  subscriptionEndDate: string | null;
  sellableSeats: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface YouTubeInvitationJob {
  id: string;
  dealUsid: string;
  productUsid: string;
  chatRoomUuid: string;
  familyGroupId: string;
  buyerName: string;
  buyerGoogleEmail: string | null;
  endDateTime: string | null;
  status: YouTubeInvitationStatus;
  createdAt: string;
  updatedAt: string;
  history: YouTubeInvitationHistoryEntry[];
}

export type YouTubeInvitationJobInput = Pick<
  YouTubeInvitationJob,
  | 'dealUsid'
  | 'productUsid'
  | 'chatRoomUuid'
  | 'familyGroupId'
  | 'buyerName'
  | 'buyerGoogleEmail'
  | 'endDateTime'
>;

export interface EnsureYouTubeInvitationJobResult {
  job: YouTubeInvitationJob;
  jobs: YouTubeInvitationJob[];
  created: boolean;
}

function normalizeInvitationIdentity(value: string | null): string {
  return String(value ?? '').trim().toLowerCase();
}

const YOUTUBE_EMAIL_PATTERN = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

export function normalizeYouTubeInvitationEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length <= 254 && YOUTUBE_EMAIL_PATTERN.test(normalized) ? normalized : null;
}

const normalizeYouTubeEmail = normalizeYouTubeInvitationEmail;

export function normalizeYouTubeManagerEmail(value: unknown): string | null {
  return normalizeYouTubeInvitationEmail(value);
}

export function ensureYouTubeInvitationJob(
  jobs: readonly YouTubeInvitationJob[],
  input: YouTubeInvitationJobInput,
  at = new Date().toISOString(),
): EnsureYouTubeInvitationJobResult {
  const dealUsid = normalizeInvitationIdentity(input.dealUsid);
  if (!dealUsid) throw new Error('YouTube invitation dealUsid cannot be empty');
  const productUsid = normalizeInvitationIdentity(input.productUsid);
  if (!productUsid) throw new Error('YouTube invitation productUsid cannot be empty');
  if (input.familyGroupId === null || typeof input.familyGroupId !== 'string') {
    throw new Error('YouTube invitation familyGroupId must be a string');
  }

  const existing = jobs.find((job) => normalizeInvitationIdentity(job.dealUsid) === dealUsid);
  if (existing) return { job: existing, jobs: [...jobs], created: false };

  const job: YouTubeInvitationJob = {
    ...input,
    id: `youtube-invitation:${dealUsid}`,
    dealUsid,
    productUsid,
    familyGroupId: normalizeInvitationIdentity(input.familyGroupId),
    status: 'waiting_for_group_assignment',
    createdAt: at,
    updatedAt: at,
    history: [],
  };
  return { job, jobs: [...jobs, job], created: true };
}

export interface YouTubeInvitationTransitionContext {
  actor: string;
  reason: string;
  at?: string;
}

const ALLOWED_TRANSITIONS: Partial<Record<YouTubeInvitationStatus, readonly YouTubeInvitationStatus[]>> = {
  waiting_for_group_assignment: ['waiting_for_buyer_email', 'failed'],
  waiting_for_buyer_email: ['email_candidate_found', 'failed'],
  email_candidate_found: ['email_confirmed', 'failed'],
  email_confirmed: ['invite_sent', 'failed'],
  invite_sent: ['delivery_completion_pending', 'delivered_waiting_inspection', 'failed'],
  delivery_completion_pending: ['delivered_waiting_inspection', 'failed'],
  delivered_waiting_inspection: ['failed'],
  active: ['ended', 'failed'],
};

export function isYouTubeInvitationTransitionAllowed(
  from: YouTubeInvitationStatus,
  to: YouTubeInvitationStatus,
): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

function appendYouTubeInvitationTransition(
  job: YouTubeInvitationJob,
  to: YouTubeInvitationStatus,
  context: YouTubeInvitationTransitionContext,
): YouTubeInvitationJob {
  const at = context.at ?? new Date().toISOString();
  return {
    ...job,
    status: to,
    updatedAt: at,
    history: [...job.history, { from: job.status, to, actor: context.actor, reason: context.reason, at }],
  };
}

export function applyYouTubeInvitationTransition(
  job: YouTubeInvitationJob,
  to: YouTubeInvitationStatus,
  context: YouTubeInvitationTransitionContext,
): YouTubeInvitationJob {
  if (!isYouTubeInvitationTransitionAllowed(job.status, to)) {
    throw new Error(`Illegal YouTube invitation transition: ${job.status} -> ${to}`);
  }
  return appendYouTubeInvitationTransition(job, to, context);
}

const FAILED_RECOVERY_STATUSES = new Set<YouTubeInvitationStatus>([
  'waiting_for_group_assignment',
  'waiting_for_buyer_email',
  'email_candidate_found',
  'email_confirmed',
  'invite_sent',
  'delivery_completion_pending',
  'delivered_waiting_inspection',
  'active',
]);

export function resumeFailedYouTubeInvitation(
  job: YouTubeInvitationJob,
  context: YouTubeInvitationTransitionContext,
): YouTubeInvitationJob {
  if (job.status !== 'failed') throw new Error('YouTube invitation is not failed');
  if (!hasValidInvitationHistory(job)) throw new Error('YouTube invitation failed history is malformed');
  const failedEntry = job.history.at(-1);
  if (!failedEntry || failedEntry.to !== 'failed' || failedEntry.from === null
    || !FAILED_RECOVERY_STATUSES.has(failedEntry.from)) {
    throw new Error('YouTube invitation failed history is missing');
  }
  return appendYouTubeInvitationTransition(job, failedEntry.from, context);
}

export interface DuplicateActiveYouTubeInvitationInput {
  familyGroupId: string;
  buyerGoogleEmail: string | null;
  excludeJobId?: string;
}

export function findDuplicateActiveYouTubeInvitation(
  jobs: readonly YouTubeInvitationJob[],
  input: DuplicateActiveYouTubeInvitationInput,
): YouTubeInvitationJob | null {
  const familyGroupId = normalizeInvitationIdentity(input.familyGroupId);
  const buyerGoogleEmail = normalizeYouTubeEmail(input.buyerGoogleEmail);
  if (!familyGroupId || !buyerGoogleEmail) return null;
  return jobs.find((job) =>
    job.id !== input.excludeJobId
    && job.status === 'active'
    && normalizeInvitationIdentity(job.familyGroupId) === familyGroupId
    && normalizeYouTubeEmail(job.buyerGoogleEmail) === buyerGoogleEmail
  ) ?? null;
}

export interface YouTubeRecruitingProduct {
  familyGroupId: string;
  productUsid: string;
}

export interface YouTubeFamilyGroupCapacityInput {
  familyGroup: YouTubeFamilyGroup;
  invitationJobs: readonly YouTubeInvitationJob[];
  recruitingProducts: readonly YouTubeRecruitingProduct[];
}

const CAPACITY_CONSUMING_STATUSES = new Set<YouTubeInvitationStatus>([
  'waiting_for_group_assignment',
  'waiting_for_buyer_email',
  'email_candidate_found',
  'email_confirmed',
  'invite_sent',
  'delivery_completion_pending',
  'delivered_waiting_inspection',
  'active',
]);

export function calculateYouTubeFamilyGroupAvailableCapacity(
  input: YouTubeFamilyGroupCapacityInput,
): number {
  if (!input.familyGroup.enabled) return 0;
  const familyGroupId = normalizeInvitationIdentity(input.familyGroup.id);
  const occupiedSeats = new Set<string>();
  for (const job of input.invitationJobs) {
    if (!CAPACITY_CONSUMING_STATUSES.has(job.status)) continue;
    if (normalizeInvitationIdentity(job.familyGroupId) !== familyGroupId) continue;
    const productUsid = normalizeInvitationIdentity(job.productUsid);
    const dealUsid = normalizeInvitationIdentity(job.dealUsid);
    if (productUsid) occupiedSeats.add(`product:${productUsid}`);
    else if (dealUsid) occupiedSeats.add(`legacy-deal:${dealUsid}`);
  }
  for (const product of input.recruitingProducts) {
    if (normalizeInvitationIdentity(product.familyGroupId) !== familyGroupId) continue;
    const productUsid = normalizeInvitationIdentity(product.productUsid);
    if (productUsid) occupiedSeats.add(`product:${productUsid}`);
  }
  return Math.max(0, input.familyGroup.sellableSeats - occupiedSeats.size);
}

const YOUTUBE_PROVIDER_TERMINAL_STATUSES = new Set<string>([
  'Cancelled',
  'CancelByDepositRejection',
  'CancelByInspectionRejection',
  'CancelByNoShow',
  'CancelByLendingRejection',
  'FinishedByBorrowerRequest',
  'FinishedByLenderRequest',
  'NormalFinished',
]);

export function reconcileYouTubeInvitationProviderStatus(
  job: YouTubeInvitationJob,
  providerStatus: string,
  context: YouTubeInvitationTransitionContext,
  jobs: readonly YouTubeInvitationJob[],
): YouTubeInvitationJob {
  if (providerStatus === 'Delivered') {
    if (job.status === 'delivered_waiting_inspection') return job;
    if (job.status !== 'invite_sent' && job.status !== 'delivery_completion_pending') {
      throw new Error(`Illegal YouTube provider transition: ${job.status} -> delivered_waiting_inspection`);
    }
    return appendYouTubeInvitationTransition(job, 'delivered_waiting_inspection', context);
  }
  if (providerStatus === 'Using') {
    if (!normalizeInvitationIdentity(job.familyGroupId) || normalizeYouTubeEmail(job.buyerGoogleEmail) === null) {
      throw new Error('YouTube invitation activation identifiers are invalid');
    }
    if (findDuplicateActiveYouTubeInvitation(jobs, {
      familyGroupId: job.familyGroupId,
      buyerGoogleEmail: job.buyerGoogleEmail,
      excludeJobId: job.id,
    })) {
      throw new Error('Duplicate active YouTube invitation');
    }
    if (job.status === 'active') return job;
    if (job.status !== 'delivered_waiting_inspection') {
      throw new Error(`Illegal YouTube provider transition: ${job.status} -> active`);
    }
    return appendYouTubeInvitationTransition(job, 'active', context);
  }
  if (YOUTUBE_PROVIDER_TERMINAL_STATUSES.has(providerStatus)) {
    if (job.status === 'ended') return job;
    return appendYouTubeInvitationTransition(job, 'ended', context);
  }
  throw new Error(`Unsupported YouTube provider status: ${providerStatus}`);
}

export interface YouTubeFamilyGroupsStoreData {
  version: 1;
  familyGroups: YouTubeFamilyGroup[];
}

export interface YouTubeInvitationJobsStoreData {
  version: 1;
  jobs: YouTubeInvitationJob[];
}

export interface YouTubeCapacityValidationContext {
  capacityValidation?: boolean;
  familyGroupsPath?: string;
  invitationJobsPath?: string;
  productRegistrationsPath?: string;
}

export class YouTubeInvitationsStoreCorruptionError extends Error {
  constructor(message = 'YouTube invitations store is corrupt') {
    super(message);
    this.name = 'YouTubeInvitationsStoreCorruptionError';
  }
}

const YOUTUBE_INVITATION_STATUSES = new Set<string>([
  'waiting_for_group_assignment',
  'waiting_for_buyer_email',
  'email_candidate_found',
  'email_confirmed',
  'invite_sent',
  'delivery_completion_pending',
  'delivered_waiting_inspection',
  'active',
  'failed',
  'ended',
]);

const YOUTUBE_DATE_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;

export function normalizeYouTubeSubscriptionDate(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string' || !YOUTUBE_DATE_PATTERN.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value ? undefined : value;
}

export function normalizeYouTubeSellableSeats(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= 20
    ? value as number
    : null;
}

export function isYouTubeIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isNonBlankString(value: unknown): value is string {
  return isString(value) && value.trim().length > 0;
}

function isInvitationStatus(value: unknown): value is YouTubeInvitationStatus {
  return isString(value) && YOUTUBE_INVITATION_STATUSES.has(value);
}

function isFamilyGroup(value: unknown): value is YouTubeFamilyGroup {
  return isRecord(value)
    && hasExactKeys(value, ['id', 'label', 'managerEmail', 'subscriptionEndDate', 'sellableSeats', 'enabled', 'createdAt', 'updatedAt'])
    && isNonBlankString(value.id)
    && isNonBlankString(value.label)
    && normalizeYouTubeManagerEmail(value.managerEmail) === value.managerEmail
    && normalizeYouTubeSubscriptionDate(value.subscriptionEndDate) === value.subscriptionEndDate
    && normalizeYouTubeSellableSeats(value.sellableSeats) === value.sellableSeats
    && typeof value.enabled === 'boolean'
    && isYouTubeIsoTimestamp(value.createdAt)
    && isYouTubeIsoTimestamp(value.updatedAt);
}

function isHistoryEntry(value: unknown): value is YouTubeInvitationHistoryEntry {
  return isRecord(value)
    && hasExactKeys(value, ['from', 'to', 'actor', 'reason', 'at'])
    && (value.from === null || isInvitationStatus(value.from))
    && isInvitationStatus(value.to)
    && isNonBlankString(value.actor)
    && isNonBlankString(value.reason)
    && isYouTubeIsoTimestamp(value.at);
}

function isNormalHistoryTransitionAllowed(
  from: YouTubeInvitationStatus,
  to: YouTubeInvitationStatus,
): boolean {
  return isYouTubeInvitationTransitionAllowed(from, to)
    || (from === 'delivered_waiting_inspection' && to === 'active')
    || (from !== 'ended' && to === 'ended');
}

function hasValidInvitationHistory(job: YouTubeInvitationJob): boolean {
  if (job.history.length === 0) return job.status === 'waiting_for_group_assignment';
  const first = job.history[0];
  if (first.from === null) {
    if (first.to !== 'waiting_for_group_assignment') return false;
  } else if (first.from !== 'waiting_for_group_assignment') {
    return false;
  }

  for (const [index, entry] of job.history.entries()) {
    if (index > 0 && entry.from !== job.history[index - 1].to) return false;
    if (entry.from === null) {
      if (index !== 0 || entry.to !== 'waiting_for_group_assignment') return false;
      continue;
    }
    if (entry.from === 'failed') {
      if (entry.to === 'ended') continue;
      const failedEdge = index > 0 ? job.history[index - 1] : undefined;
      if (!failedEdge || failedEdge.to !== 'failed' || failedEdge.from !== entry.to
        || !FAILED_RECOVERY_STATUSES.has(entry.to)) return false;
      continue;
    }
    if (!isNormalHistoryTransitionAllowed(entry.from, entry.to)) return false;
  }
  return job.history.at(-1)?.to === job.status;
}

function isInvitationJob(value: unknown): value is YouTubeInvitationJob {
  if (!(isRecord(value)
    && hasExactKeys(value, ['id', 'dealUsid', 'productUsid', 'chatRoomUuid', 'familyGroupId', 'buyerName', 'buyerGoogleEmail', 'endDateTime', 'status', 'createdAt', 'updatedAt', 'history'])
    && isNonBlankString(value.id)
    && isString(value.dealUsid)
    && normalizeInvitationIdentity(value.dealUsid).length > 0
    && value.id === `youtube-invitation:${normalizeInvitationIdentity(value.dealUsid)}`
    && isNonBlankString(value.productUsid)
    && isNonBlankString(value.chatRoomUuid)
    && isString(value.familyGroupId)
    && isNonBlankString(value.buyerName)
    && (value.buyerGoogleEmail === null || normalizeYouTubeEmail(value.buyerGoogleEmail) === value.buyerGoogleEmail)
    && (value.endDateTime === null || isYouTubeIsoTimestamp(value.endDateTime))
    && isInvitationStatus(value.status)
    && isYouTubeIsoTimestamp(value.createdAt)
    && isYouTubeIsoTimestamp(value.updatedAt)
    && Array.isArray(value.history)
    && value.history.every(isHistoryEntry))) return false;
  if (value.status === 'active'
    && (!normalizeInvitationIdentity(value.familyGroupId) || normalizeYouTubeEmail(value.buyerGoogleEmail) === null)) {
    return false;
  }
  return hasValidInvitationHistory(value as unknown as YouTubeInvitationJob);
}

function hasUniqueNormalizedValues(values: readonly string[]): boolean {
  const normalized = values.map(normalizeInvitationIdentity);
  return normalized.every(Boolean) && new Set(normalized).size === normalized.length;
}

function hasUniqueActiveInvitationIdentities(jobs: readonly YouTubeInvitationJob[]): boolean {
  const identities = jobs
    .filter((job) => job.status === 'active')
    .map((job) => JSON.stringify([
      normalizeInvitationIdentity(job.familyGroupId),
      normalizeYouTubeEmail(job.buyerGoogleEmail),
    ]));
  return new Set(identities).size === identities.length;
}

function validateFamilyGroupsStoreData(value: unknown): asserts value is YouTubeFamilyGroupsStoreData {
  if (!isRecord(value)
    || !hasExactKeys(value, ['version', 'familyGroups'])
    || value.version !== 1
    || !Array.isArray(value.familyGroups)
    || !value.familyGroups.every(isFamilyGroup)
    || !hasUniqueNormalizedValues(value.familyGroups.map((group) => (group as YouTubeFamilyGroup).id))) {
    throw new YouTubeInvitationsStoreCorruptionError('YouTube family groups store schema is invalid');
  }
}

function validateInvitationJobsStoreData(value: unknown): asserts value is YouTubeInvitationJobsStoreData {
  if (!isRecord(value)
    || !hasExactKeys(value, ['version', 'jobs'])
    || value.version !== 1
    || !Array.isArray(value.jobs)
    || !value.jobs.every(isInvitationJob)
    || !hasUniqueNormalizedValues(value.jobs.map((job) => (job as YouTubeInvitationJob).id))
    || !hasUniqueNormalizedValues(value.jobs.map((job) => (job as YouTubeInvitationJob).dealUsid))
    || !hasUniqueActiveInvitationIdentities(value.jobs as YouTubeInvitationJob[])) {
    throw new YouTubeInvitationsStoreCorruptionError('YouTube invitation jobs store schema is invalid');
  }
}

function isOwnedByCurrentUser(uid: number): boolean {
  return typeof process.getuid !== 'function' || uid === process.getuid();
}

function readPrivateRegularFile(filePath: string): string {
  const directory = dirname(filePath);
  const targetName = basename(filePath);
  let directoryDescriptor: number | null = null;
  let fileDescriptor: number | null = null;
  try {
    directoryDescriptor = openVerifiedPrivateDirectory(directory, false);

    const targetPath = `/proc/self/fd/${directoryDescriptor}/${targetName}`;
    const fileStat = lstatSync(targetPath);
    if (!fileStat.isFile() || fileStat.isSymbolicLink() || !isOwnedByCurrentUser(fileStat.uid)) {
      throw new Error('Unsafe store file');
    }
    fileDescriptor = openSync(targetPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const openedFileStat = fstatSync(fileDescriptor);
    if (!openedFileStat.isFile() || !isOwnedByCurrentUser(openedFileStat.uid)
      || openedFileStat.dev !== fileStat.dev || openedFileStat.ino !== fileStat.ino) {
      throw new Error('Unsafe store file');
    }
    fchmodSync(fileDescriptor, 0o600);
    return readFileSync(fileDescriptor, 'utf8');
  } catch (error) {
    if (error instanceof YouTubeInvitationsStoreCorruptionError) throw error;
    throw new YouTubeInvitationsStoreCorruptionError('YouTube invitations store path is unsafe');
  } finally {
    if (fileDescriptor !== null) closeSync(fileDescriptor);
    if (directoryDescriptor !== null) closeSync(directoryDescriptor);
  }
}

function readAtomicStore<T>(filePath: string, validate: (value: unknown) => asserts value is T): T {
  const contents = readPrivateRegularFile(filePath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new YouTubeInvitationsStoreCorruptionError('YouTube invitations store JSON is malformed');
  }
  validate(parsed);
  return parsed;
}

function readOptionalAtomicStore<T>(
  filePath: string,
  validate: (value: unknown) => asserts value is T,
): T | null {
  let directoryDescriptor: number | null = null;
  try {
    directoryDescriptor = openVerifiedPrivateDirectory(dirname(filePath), false);
    lstatSync(`/proc/self/fd/${directoryDescriptor}/${basename(filePath)}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    if (error instanceof YouTubeInvitationsStoreCorruptionError) throw error;
    throw new YouTubeInvitationsStoreCorruptionError('YouTube invitations store path is unsafe');
  } finally {
    if (directoryDescriptor !== null) closeSync(directoryDescriptor);
  }
  return readAtomicStore(filePath, validate);
}

function openVerifiedPrivateDirectory(directory: string, createMissing = true): number {
  const resolvedDirectory = resolve(directory);
  const root = parse(resolvedDirectory).root;
  const relativeComponents = resolvedDirectory.slice(root.length).split(/[\\/]+/).filter(Boolean);
  let current = root;
  for (const component of relativeComponents) {
    current = resolve(current, component);
    try {
      const componentStat = lstatSync(current);
      if (!componentStat.isDirectory() || componentStat.isSymbolicLink()) {
        throw new Error('Unsafe store directory ancestor');
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      if (!createMissing) throw error;
      mkdirSync(current, { mode: 0o700 });
      const createdStat = lstatSync(current);
      if (!createdStat.isDirectory() || createdStat.isSymbolicLink()) {
        throw new Error('Unsafe store directory ancestor');
      }
    }
  }

  const directoryStat = lstatSync(resolvedDirectory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()
    || !isOwnedByCurrentUser(directoryStat.uid)) {
    throw new Error('Unsafe store directory');
  }
  if (typeof constants.O_DIRECTORY !== 'number' || typeof constants.O_NOFOLLOW !== 'number') {
    throw new Error('Required secure directory open flags are unavailable');
  }

  const descriptor = openSync(
    resolvedDirectory,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    const openedDirectoryStat = fstatSync(descriptor);
    if (!openedDirectoryStat.isDirectory() || !isOwnedByCurrentUser(openedDirectoryStat.uid)
      || openedDirectoryStat.dev !== directoryStat.dev || openedDirectoryStat.ino !== directoryStat.ino) {
      throw new Error('Unsafe store directory');
    }
    fchmodSync(descriptor, 0o700);
    return descriptor;
  } catch (error) {
    closeSync(descriptor);
    throw error;
  }
}

function writeAtomicStore<T>(filePath: string, data: T, validate: (value: unknown) => asserts value is T): void {
  validate(data);
  const contents = `${JSON.stringify(data, null, 2)}\n`;
  const directory = dirname(filePath);
  const targetName = basename(filePath);
  const temporaryName = `.${targetName}.${process.pid}.${randomUUID()}.tmp`;
  let descriptor: number | null = null;
  let directoryDescriptor: number | null = null;
  let temporaryCreated = false;
  try {
    directoryDescriptor = openVerifiedPrivateDirectory(directory);
    const openedDirectoryPath = `/proc/self/fd/${directoryDescriptor}`;
    const temporaryPath = `${openedDirectoryPath}/${temporaryName}`;
    const targetPath = `${openedDirectoryPath}/${targetName}`;
    if (typeof constants.O_NOFOLLOW !== 'number') {
      throw new Error('Required secure file open flag is unavailable');
    }
    descriptor = openSync(
      temporaryPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    temporaryCreated = true;
    fchmodSync(descriptor, 0o600);
    writeFileSync(descriptor, contents, 'utf8');
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    renameSync(temporaryPath, targetPath);
    temporaryCreated = false;
    fsyncSync(directoryDescriptor);
  } catch (error) {
    if (error instanceof YouTubeInvitationsStoreCorruptionError) throw error;
    throw new YouTubeInvitationsStoreCorruptionError('YouTube invitations store path is unsafe');
  } finally {
    if (descriptor !== null) closeSync(descriptor);
    if (directoryDescriptor !== null) {
      try {
        if (temporaryCreated) {
          try {
            unlinkSync(`/proc/self/fd/${directoryDescriptor}/${temporaryName}`);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          }
        }
      } finally {
        closeSync(directoryDescriptor);
      }
    }
  }
}

const DEFAULT_FAMILY_GROUPS_PATH = 'data/youtube-family-groups.json';
const DEFAULT_INVITATIONS_PATH = 'data/youtube-invitations.json';
const DEFAULT_PRODUCT_REGISTRATIONS_PATH = 'data/youtube-product-registrations.json';

function validationPath(explicit: string | undefined, environmentName: string, fallback: string): string {
  return explicit || process.env[environmentName] || fallback;
}

function readCapacityRegistrations(context: YouTubeCapacityValidationContext) {
  const path = validationPath(
    context.productRegistrationsPath,
    'YOUTUBE_PRODUCT_REGISTRATIONS_PATH',
    DEFAULT_PRODUCT_REGISTRATIONS_PATH,
  );
  return new YouTubeProductRegistrationsStore(path).listForCapacityValidation();
}

export class YouTubeFamilyGroupsStore {
  constructor(
    readonly filePath: string,
    readonly capacityContext: YouTubeCapacityValidationContext = {},
  ) {}
  read(): YouTubeFamilyGroupsStoreData {
    return readAtomicStore(this.filePath, validateFamilyGroupsStoreData);
  }
  write(data: YouTubeFamilyGroupsStoreData): void {
    withYouTubeCapacityLock(() => {
      validateFamilyGroupsStoreData(data);
      if (this.capacityContext.capacityValidation !== false) {
        const jobsPath = validationPath(
          this.capacityContext.invitationJobsPath,
          'YOUTUBE_INVITATIONS_PATH',
          DEFAULT_INVITATIONS_PATH,
        );
        const jobs = readOptionalAtomicStore(jobsPath, validateInvitationJobsStoreData)?.jobs ?? [];
        assertYouTubeCapacityInvariant(data.familyGroups, jobs, readCapacityRegistrations(this.capacityContext));
      }
      writeAtomicStore(this.filePath, data, validateFamilyGroupsStoreData);
    });
  }
}

export class YouTubeInvitationJobsStore {
  constructor(
    readonly filePath: string,
    readonly capacityContext: YouTubeCapacityValidationContext = {},
  ) {}
  read(): YouTubeInvitationJobsStoreData {
    return readAtomicStore(this.filePath, validateInvitationJobsStoreData);
  }
  readOrInitializeEmpty(): YouTubeInvitationJobsStoreData {
    return withYouTubeCapacityLock(() => {
      const existing = readOptionalAtomicStore(this.filePath, validateInvitationJobsStoreData);
      if (existing) return existing;
      const empty = { version: 1 as const, jobs: [] };
      writeAtomicStore(this.filePath, empty, validateInvitationJobsStoreData);
      return empty;
    });
  }
  write(data: YouTubeInvitationJobsStoreData): void {
    withYouTubeCapacityLock(() => {
      validateInvitationJobsStoreData(data);
      if (this.capacityContext.capacityValidation !== false) {
        const groupsPath = validationPath(
          this.capacityContext.familyGroupsPath,
          'YOUTUBE_FAMILY_GROUPS_PATH',
          DEFAULT_FAMILY_GROUPS_PATH,
        );
        const groups = readOptionalAtomicStore(groupsPath, validateFamilyGroupsStoreData)?.familyGroups ?? [];
        assertYouTubeCapacityInvariant(groups, data.jobs, readCapacityRegistrations(this.capacityContext));
      }
      writeAtomicStore(this.filePath, data, validateInvitationJobsStoreData);
    });
  }
}
