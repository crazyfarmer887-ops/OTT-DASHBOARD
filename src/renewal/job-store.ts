import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { acquireCrashSafeFileLock } from '../lib/youtube-capacity-lock';
import { dirname } from 'node:path';
import type { RegistrationReconciliationDecision, SanitizedRegistrationEvidence } from './reconciliation';

export type RenewalJobStatus = 'preview' | 'registering' | 'registered' | 'messaged' | 'message_sending' | 'message_error' | 'message_unknown' | 'message_skipped' | 'error'
  | 'verifying' | 'registration_failed_safe' | 'verification_needed' | 'uncertain';
export type RenewalMessageSkipReason = 'policy_disabled' | 'target_reached';
export type RenewalCouponStatus = 'not_started' | 'awaiting_review' | 'review_confirmed' | 'coupon_approved' | 'issued' | 'rejected' | 'failed';
export type RenewalReviewAction = 'review_confirm' | 'reject' | 'coupon_approve' | 'mark_issued' | 'mark_failed';

export interface RenewalAuditEntry {
  action: RenewalReviewAction;
  actor: string;
  at: string;
  reason: string;
  evidence?: string;
  from: RenewalCouponStatus;
  to: RenewalCouponStatus;
}

export interface RegistrationReconciliationAuditEntry {
  action: 'verification_started' | 'verification_completed';
  actor: string;
  at: string;
  from: RenewalJobStatus;
  to: RenewalJobStatus;
}

export interface RegistrationRetryAuditEntry {
  action: 'safe_registration_retry_claimed';
  actor: string;
  at: string;
  from: 'registration_failed_safe';
  to: 'registering';
  attempt: number;
}

export interface RenewalJob {
  id: string;
  idempotencyKey: string;
  dealUsid: string;
  productUsid: string;
  chatRoomUuid: string;
  service: string;
  category?: string;
  buyer?: string;
  account?: string;
  oldEnd: string;
  newEnd: string;
  status: RenewalJobStatus;
  couponStatus: RenewalCouponStatus;
  createdAt: string;
  updatedAt: string;
  extensionProductUsid?: string;
  registeredAt?: string;
  messagedAt?: string;
  reviewConfirmedAt?: string;
  couponApprovedAt?: string;
  couponIssuedAt?: string;
  reviewRejectedAt?: string;
  couponFailedAt?: string;
  reviewEvidence?: string;
  reviewReason?: string;
  error?: string;
  messageAttempts?: number;
  lastMessageAttemptAt?: string;
  skipReason?: RenewalMessageSkipReason;
  audit?: RenewalAuditEntry[];
  reconciliationAttempts?: number;
  lastReconciliationAt?: string;
  reconciliationEvidence?: SanitizedRegistrationEvidence[];
  reconciliationAudit?: RegistrationReconciliationAuditEntry[];
  registrationAttempts?: number;
  lastRegistrationAttemptAt?: string;
  registrationRetryAudit?: RegistrationRetryAuditEntry[];
}

export interface ReviewAuditInput { actor: string; at: string; reason: string; evidence?: string }

export interface RenewalMessagePolicyAuditEntry {
  actor: string;
  at: string;
  before: { enabled: boolean; targetCount: number };
  after: { enabled: boolean; targetCount: number };
}
export interface RenewalMessagePolicy {
  enabled: boolean;
  targetCount: number;
  updatedAt: string;
  updatedBy: string;
  audit: RenewalMessagePolicyAuditEntry[];
}
export interface RenewalMessagePolicyDto extends RenewalMessagePolicy {
  sentCount: number;
  reservedCount: number;
  remaining: number;
}
export type MessageReservationResult = { reserved: true; job: RenewalJob } | { reserved: false; reason: RenewalMessageSkipReason; job: RenewalJob };

export interface RenewalJobStore {
  list(): RenewalJob[];
  get(id: string): RenewalJob | undefined;
  getByIdempotencyKey(key: string): RenewalJob | undefined;
  put(job: RenewalJob): RenewalJob;
  claim(job: RenewalJob): RenewalJob | undefined;
  claimRegistration(job: RenewalJob): RenewalJob | undefined;
  claimMessageRetry(id: string, at: string): RenewalJob | undefined;
  reserveMessageSlot(id: string, at: string): MessageReservationResult;
  getMessagePolicy(): RenewalMessagePolicyDto;
  updateMessagePolicy(update: { enabled: boolean; targetCount: number }, audit: { actor: string; at: string }): RenewalMessagePolicyDto;
  claimSafeRegistrationRetry(id: string, actor: string, at: string): RenewalJob | undefined;
  claimRegistrationReconciliation(id: string, actor: string, at: string): RenewalJob | undefined;
  completeRegistrationReconciliation(
    id: string,
    expectedUpdatedAt: string,
    decision: RegistrationReconciliationDecision,
    evidence: SanitizedRegistrationEvidence[],
    input: { actor: string; at: string },
  ): RenewalJob;
  applyReviewAction(id: string, expectedStatus: RenewalCouponStatus, action: RenewalReviewAction, audit: ReviewAuditInput): RenewalJob;
}

export class RenewalStoreCorruptionError extends Error {
  readonly code = 'RENEWAL_STORE_CORRUPT';
  constructor(message: string) { super(`renewal job store corrupt: ${message}`); this.name = 'RenewalStoreCorruptionError'; }
}

const JOB_STATUSES = new Set<RenewalJobStatus>(['preview', 'registering', 'registered', 'messaged', 'message_sending', 'message_error', 'message_unknown', 'message_skipped', 'error', 'verifying', 'registration_failed_safe', 'verification_needed', 'uncertain']);
const COUPON_STATUSES = new Set<RenewalCouponStatus>(['not_started', 'awaiting_review', 'review_confirmed', 'coupon_approved', 'issued', 'rejected', 'failed']);
const REVIEW_ACTIONS = new Set<RenewalReviewAction>(['review_confirm', 'reject', 'coupon_approve', 'mark_issued', 'mark_failed']);
const SAFE_FIELDS: Array<keyof RenewalJob> = [
  'id', 'idempotencyKey', 'dealUsid', 'productUsid', 'chatRoomUuid', 'service', 'category', 'buyer', 'account', 'oldEnd', 'newEnd',
  'status', 'couponStatus', 'createdAt', 'updatedAt', 'extensionProductUsid', 'registeredAt', 'messagedAt',
  'reviewConfirmedAt', 'couponApprovedAt', 'couponIssuedAt', 'reviewRejectedAt', 'couponFailedAt',
  'reviewEvidence', 'reviewReason', 'error', 'messageAttempts', 'lastMessageAttemptAt', 'skipReason', 'audit',
  'reconciliationAttempts', 'lastReconciliationAt', 'reconciliationEvidence', 'reconciliationAudit',
  'registrationAttempts', 'lastRegistrationAttemptAt', 'registrationRetryAudit',
];
const DATE_FIELDS: Array<keyof RenewalJob> = ['createdAt', 'updatedAt', 'registeredAt', 'messagedAt', 'reviewConfirmedAt', 'couponApprovedAt', 'couponIssuedAt', 'reviewRejectedAt', 'couponFailedAt', 'lastMessageAttemptAt', 'lastReconciliationAt', 'lastRegistrationAttemptAt'];
const DEFAULT_MESSAGE_POLICY: RenewalMessagePolicy = { enabled: true, targetCount: 5, updatedAt: '', updatedBy: 'system', audit: [] };
const RESERVED_MESSAGE_STATUSES = new Set<RenewalJobStatus>(['message_sending', 'message_error', 'message_unknown', 'messaged']);

function messagePolicyDto(policy: RenewalMessagePolicy, jobs: RenewalJob[]): RenewalMessagePolicyDto {
  const sentCount = jobs.filter((job) => Boolean(job.messagedAt) || job.status === 'messaged').length;
  const reservedCount = jobs.filter((job) => RESERVED_MESSAGE_STATUSES.has(job.status)).length;
  return { ...structuredClone(policy), sentCount, reservedCount, remaining: Math.max(0, policy.targetCount - sentCount) };
}

function validatePolicy(input: unknown, allowMissing = false): RenewalMessagePolicy {
  if (input === undefined && allowMissing) return structuredClone(DEFAULT_MESSAGE_POLICY);
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new RenewalStoreCorruptionError('messagePolicy must be an object');
  const value = input as any;
  if (typeof value.enabled !== 'boolean' || !Number.isInteger(value.targetCount) || value.targetCount < 0 || value.targetCount > 100) throw new RenewalStoreCorruptionError('messagePolicy values are invalid');
  if (typeof value.updatedAt !== 'string' || (value.updatedAt && !validIso(value.updatedAt))) throw new RenewalStoreCorruptionError('messagePolicy updatedAt is invalid');
  const updatedBy = sanitizeText(value.updatedBy, 80);
  if (!updatedBy || !Array.isArray(value.audit)) throw new RenewalStoreCorruptionError('messagePolicy audit is invalid');
  const audit = value.audit.slice(-100).map((entry: any) => {
    const actor = sanitizeText(entry?.actor, 80);
    const validSnapshot = (snapshot: any) => snapshot && typeof snapshot.enabled === 'boolean' && Number.isInteger(snapshot.targetCount) && snapshot.targetCount >= 0 && snapshot.targetCount <= 100;
    if (!actor || !validIso(entry?.at) || !validSnapshot(entry?.before) || !validSnapshot(entry?.after)) throw new RenewalStoreCorruptionError('messagePolicy audit entry is invalid');
    return { actor, at: entry.at, before: { enabled: entry.before.enabled, targetCount: entry.before.targetCount }, after: { enabled: entry.after.enabled, targetCount: entry.after.targetCount } };
  });
  return { enabled: value.enabled, targetCount: value.targetCount, updatedAt: value.updatedAt, updatedBy, audit };
}

function sanitizeText(value: unknown, max = 500): string | undefined {
  const text = typeof value === 'string' ? value.trim().slice(0, max) : '';
  return text || undefined;
}
function validIso(value: unknown): value is string { return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }
function requiredText(value: unknown, field: string): asserts value is string {
  if (!sanitizeText(value, 1000)) throw new RenewalStoreCorruptionError(`job ${field} is required`);
}

function sanitizeAudit(value: unknown): RenewalAuditEntry[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new RenewalStoreCorruptionError('job audit must be an array');
  return value.slice(-100).map((entry: any) => {
    const actor = sanitizeText(entry?.actor, 80); const at = sanitizeText(entry?.at, 40); const reason = sanitizeText(entry?.reason, 500);
    const evidence = sanitizeText(entry?.evidence, 500);
    if (!actor || !validIso(at) || !reason || !REVIEW_ACTIONS.has(entry?.action) || !COUPON_STATUSES.has(entry?.from) || !COUPON_STATUSES.has(entry?.to)) {
      throw new RenewalStoreCorruptionError('job audit entry is invalid');
    }
    return { action: entry.action, actor, at, reason, evidence, from: entry.from, to: entry.to };
  });
}

const RECONCILIATION_BOOLEAN_FIELDS: Array<Exclude<keyof SanitizedRegistrationEvidence, 'capturedAt'>> = [
  'oldDealAuthoritative', 'oldDealPresent', 'extensionProductExists', 'extensionStatusPresent', 'dealStatusEligible',
  'sellerListingAuthoritative', 'sellerListingPresent', 'priceTypeExtended', 'linkedDeal', 'targetNewEnd',
  'productIdPresent', 'exactMatch', 'contradictory', 'authoritativeNegative', 'error',
];

function sanitizeReconciliationEvidence(value: unknown): SanitizedRegistrationEvidence[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new RenewalStoreCorruptionError('job reconciliationEvidence must be an array');
  return value.slice(-20).map((entry: any) => {
    if (!validIso(entry?.capturedAt) || RECONCILIATION_BOOLEAN_FIELDS.some((field) => typeof entry?.[field] !== 'boolean')) {
      throw new RenewalStoreCorruptionError('job reconciliation evidence is invalid');
    }
    return Object.fromEntries([
      ['capturedAt', entry.capturedAt],
      ...RECONCILIATION_BOOLEAN_FIELDS.map((field) => [field, entry[field]]),
    ]) as unknown as SanitizedRegistrationEvidence;
  });
}

function sanitizeReconciliationAudit(value: unknown): RegistrationReconciliationAuditEntry[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new RenewalStoreCorruptionError('job reconciliationAudit must be an array');
  return value.slice(-100).map((entry: any) => {
    const actor = sanitizeText(entry?.actor, 80);
    if (!actor || !validIso(entry?.at) || !['verification_started', 'verification_completed'].includes(entry?.action)
      || !JOB_STATUSES.has(entry?.from) || !JOB_STATUSES.has(entry?.to)) {
      throw new RenewalStoreCorruptionError('job reconciliation audit entry is invalid');
    }
    return { action: entry.action, actor, at: entry.at, from: entry.from, to: entry.to };
  });
}

function sanitizeRegistrationRetryAudit(value: unknown): RegistrationRetryAuditEntry[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new RenewalStoreCorruptionError('job registrationRetryAudit must be an array');
  return value.slice(-100).map((entry: any) => {
    const actor = sanitizeText(entry?.actor, 80);
    if (!actor || !validIso(entry?.at) || entry?.action !== 'safe_registration_retry_claimed'
      || entry?.from !== 'registration_failed_safe' || entry?.to !== 'registering'
      || !Number.isInteger(entry?.attempt) || entry.attempt < 1) {
      throw new RenewalStoreCorruptionError('job registration retry audit entry is invalid');
    }
    return { action: entry.action, actor, at: entry.at, from: entry.from, to: entry.to, attempt: entry.attempt };
  });
}

function sanitizeJob(input: RenewalJob): RenewalJob {
  const output: Record<string, unknown> = {};
  for (const key of SAFE_FIELDS) {
    const value = input?.[key];
    if (value !== undefined) output[key] = key === 'audit' ? sanitizeAudit(value)
      : key === 'reconciliationEvidence' ? sanitizeReconciliationEvidence(value)
      : key === 'reconciliationAudit' ? sanitizeReconciliationAudit(value)
      : key === 'registrationRetryAudit' ? sanitizeRegistrationRetryAudit(value)
      : typeof value === 'string' ? sanitizeText(value, key === 'error' ? 500 : 1000) : value;
  }
  return output as unknown as RenewalJob;
}

function validateJob(input: unknown, index?: number): RenewalJob {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new RenewalStoreCorruptionError(`job${index === undefined ? '' : ` ${index}`} must be an object`);
  const job = sanitizeJob(input as RenewalJob);
  for (const field of ['id', 'idempotencyKey', 'dealUsid', 'productUsid', 'chatRoomUuid', 'service', 'oldEnd', 'newEnd'] as const) requiredText(job[field], field);
  if (!/^\d{8}T\d{4}$/.test(job.oldEnd) || !/^\d{8}T\d{4}$/.test(job.newEnd)) throw new RenewalStoreCorruptionError('job renewal dates are invalid');
  if (!JOB_STATUSES.has(job.status)) throw new RenewalStoreCorruptionError('job status is invalid');
  if (job.status === 'uncertain') job.status = 'verification_needed';
  if (!COUPON_STATUSES.has(job.couponStatus)) throw new RenewalStoreCorruptionError('job couponStatus is invalid');
  if (!validIso(job.createdAt) || !validIso(job.updatedAt)) throw new RenewalStoreCorruptionError('job timestamps are invalid');
  for (const field of DATE_FIELDS) if (job[field] !== undefined && !validIso(job[field])) throw new RenewalStoreCorruptionError(`job ${field} is invalid`);
  if (job.messageAttempts !== undefined && (!Number.isInteger(job.messageAttempts) || job.messageAttempts < 0)) throw new RenewalStoreCorruptionError('job messageAttempts is invalid');
  if (job.reconciliationAttempts !== undefined && (!Number.isInteger(job.reconciliationAttempts) || job.reconciliationAttempts < 0)) throw new RenewalStoreCorruptionError('job reconciliationAttempts is invalid');
  if (job.registrationAttempts !== undefined && (!Number.isInteger(job.registrationAttempts) || job.registrationAttempts < 0)) throw new RenewalStoreCorruptionError('job registrationAttempts is invalid');
  if (job.skipReason !== undefined && !['policy_disabled', 'target_reached'].includes(job.skipReason)) throw new RenewalStoreCorruptionError('job skipReason is invalid');
  if (job.status === 'message_skipped' && !job.skipReason) throw new RenewalStoreCorruptionError('message_skipped requires skipReason');
  return job;
}

const TRANSITIONS: Record<RenewalReviewAction, Partial<Record<RenewalCouponStatus, RenewalCouponStatus>>> = {
  review_confirm: { awaiting_review: 'review_confirmed' }, reject: { awaiting_review: 'rejected', review_confirmed: 'rejected' },
  coupon_approve: { review_confirmed: 'coupon_approved' }, mark_issued: { coupon_approved: 'issued' }, mark_failed: { coupon_approved: 'failed' },
};

export function applyRenewalReviewAction(job: RenewalJob, action: RenewalReviewAction, input: ReviewAuditInput): RenewalJob {
  const nextStatus = TRANSITIONS[action]?.[job.couponStatus];
  if (!nextStatus) throw new Error(job.couponStatus === 'issued' && action === 'mark_issued' ? 'duplicate issue blocked' : 'invalid coupon transition');
  const actor = sanitizeText(input.actor, 80); const reason = sanitizeText(input.reason, 500); const evidence = sanitizeText(input.evidence, 500);
  if (!actor || !validIso(input.at) || !reason) throw new Error('actor, time and reason are required');
  const next: RenewalJob = {
    ...job, couponStatus: nextStatus, updatedAt: input.at, reviewReason: reason,
    reviewEvidence: evidence ?? job.reviewEvidence,
    audit: [...(job.audit ?? []), { action, actor, at: input.at, reason, evidence, from: job.couponStatus, to: nextStatus }],
  };
  if (action === 'review_confirm') next.reviewConfirmedAt = input.at;
  if (action === 'coupon_approve') next.couponApprovedAt = input.at;
  if (action === 'mark_issued') next.couponIssuedAt = input.at;
  if (action === 'reject') next.reviewRejectedAt = input.at;
  if (action === 'mark_failed') next.couponFailedAt = input.at;
  return validateJob(next);
}

function claimReconciliationJob(job: RenewalJob, actorValue: string, at: string): RenewalJob | undefined {
  if (job.status !== 'verification_needed' && job.status !== 'uncertain') return undefined;
  const actor = sanitizeText(actorValue, 80);
  if (!actor || !validIso(at)) throw new Error('reconciliation actor and time are required');
  return validateJob({
    ...job,
    status: 'verifying',
    updatedAt: at,
    lastReconciliationAt: at,
    reconciliationAttempts: (job.reconciliationAttempts ?? 0) + 1,
    reconciliationAudit: [...(job.reconciliationAudit ?? []), {
      action: 'verification_started', actor, at, from: job.status, to: 'verifying',
    }],
  });
}

function completeReconciliationJob(
  job: RenewalJob,
  expectedUpdatedAt: string,
  decision: RegistrationReconciliationDecision,
  evidence: SanitizedRegistrationEvidence[],
  input: { actor: string; at: string },
): RenewalJob {
  const actor = sanitizeText(input.actor, 80);
  if (job.status !== 'verifying' || job.updatedAt !== expectedUpdatedAt) throw new Error('stale registration reconciliation');
  if (!actor || !validIso(input.at)) throw new Error('reconciliation actor and time are required');
  const next: RenewalJob = {
    ...job,
    status: decision,
    updatedAt: input.at,
    lastReconciliationAt: input.at,
    reconciliationEvidence: evidence,
    reconciliationAudit: [...(job.reconciliationAudit ?? []), {
      action: 'verification_completed', actor, at: input.at, from: 'verifying', to: decision,
    }],
    error: decision === 'verification_needed' ? 'registration verification incomplete' : undefined,
  };
  if (decision === 'registered') next.registeredAt = input.at;
  return validateJob(next);
}

function claimSafeRetryJob(job: RenewalJob, actorValue: string, at: string): RenewalJob | undefined {
  if (job.status !== 'registration_failed_safe') return undefined;
  const actor = sanitizeText(actorValue, 80);
  if (!actor || !validIso(at)) throw new Error('registration retry actor and time are required');
  const attempt = (job.registrationAttempts ?? 0) + 1;
  return validateJob({
    ...job, status: 'registering', updatedAt: at, lastRegistrationAttemptAt: at,
    registrationAttempts: attempt, error: undefined,
    registrationRetryAudit: [...(job.registrationRetryAudit ?? []), {
      action: 'safe_registration_retry_claimed', actor, at,
      from: 'registration_failed_safe', to: 'registering', attempt,
    }],
  });
}

export function createMemoryRenewalJobStore(options: { onPut?: (job: RenewalJob) => void } = {}): RenewalJobStore {
  const jobs: RenewalJob[] = [];
  let policy = structuredClone(DEFAULT_MESSAGE_POLICY);
  const write = (input: RenewalJob, requireAbsent: boolean): RenewalJob | undefined => {
    const safe = validateJob(input);
    const index = jobs.findIndex((job) => job.idempotencyKey === safe.idempotencyKey);
    if (requireAbsent && index >= 0) return undefined;
    if (index >= 0) jobs[index] = validateJob({ ...jobs[index], ...safe, id: jobs[index].id, createdAt: jobs[index].createdAt }); else jobs.push(safe);
    const result = index >= 0 ? jobs[index] : jobs[jobs.length - 1]; options.onPut?.({ ...result }); return structuredClone(result);
  };
  const store: RenewalJobStore = {
    list: () => structuredClone(jobs), get: (id) => structuredClone(jobs.find((job) => job.id === id)),
    getByIdempotencyKey: (key) => structuredClone(jobs.find((job) => job.idempotencyKey === key)),
    put: (input) => write(input, false)!, claim: (input) => write(input, true), claimRegistration: (input) => write(input, true),
    claimMessageRetry: (id, at) => {
      const index = jobs.findIndex((job) => job.id === id && job.status === 'message_error'); if (index < 0) return undefined;
      jobs[index] = validateJob({ ...jobs[index], status: 'message_sending', updatedAt: at, lastMessageAttemptAt: at, messageAttempts: (jobs[index].messageAttempts ?? 0) + 1 });
      options.onPut?.({ ...jobs[index] }); return structuredClone(jobs[index]);
    },
    reserveMessageSlot: (id, at) => {
      const index = jobs.findIndex((job) => job.id === id && job.status === 'registered');
      if (index < 0) throw new Error('renewal job not reservable');
      const reason: RenewalMessageSkipReason | undefined = !policy.enabled ? 'policy_disabled'
        : messagePolicyDto(policy, jobs).reservedCount >= policy.targetCount ? 'target_reached' : undefined;
      jobs[index] = validateJob({ ...jobs[index], status: reason ? 'message_skipped' : 'message_sending', couponStatus: 'not_started', updatedAt: at, lastMessageAttemptAt: reason ? undefined : at, messageAttempts: reason ? jobs[index].messageAttempts : (jobs[index].messageAttempts ?? 0) + 1, skipReason: reason });
      options.onPut?.({ ...jobs[index] });
      return reason ? { reserved: false, reason, job: structuredClone(jobs[index]) } : { reserved: true, job: structuredClone(jobs[index]) };
    },
    getMessagePolicy: () => messagePolicyDto(policy, jobs),
    updateMessagePolicy: (update, audit) => {
      const actor = sanitizeText(audit.actor, 80);
      if (!actor || !validIso(audit.at)) throw new Error('policy actor and time are required');
      const next = validatePolicy({ enabled: update.enabled, targetCount: update.targetCount, updatedAt: audit.at, updatedBy: actor, audit: [...policy.audit, { actor, at: audit.at, before: { enabled: policy.enabled, targetCount: policy.targetCount }, after: update }] });
      policy = next; return messagePolicyDto(policy, jobs);
    },
    claimSafeRegistrationRetry: (id, actor, at) => {
      const index = jobs.findIndex((job) => job.id === id); if (index < 0) return undefined;
      const claimed = claimSafeRetryJob(jobs[index], actor, at); if (!claimed) return undefined;
      jobs[index] = claimed; options.onPut?.({ ...claimed }); return structuredClone(claimed);
    },
    claimRegistrationReconciliation: (id, actor, at) => {
      const index = jobs.findIndex((job) => job.id === id); if (index < 0) return undefined;
      const claimed = claimReconciliationJob(jobs[index], actor, at); if (!claimed) return undefined;
      jobs[index] = claimed; options.onPut?.({ ...claimed }); return structuredClone(claimed);
    },
    completeRegistrationReconciliation: (id, expectedUpdatedAt, decision, evidence, input) => {
      const index = jobs.findIndex((job) => job.id === id); if (index < 0) throw new Error('renewal job not found');
      jobs[index] = completeReconciliationJob(jobs[index], expectedUpdatedAt, decision, evidence, input);
      options.onPut?.({ ...jobs[index] }); return structuredClone(jobs[index]);
    },
    applyReviewAction: (id, expectedStatus, action, audit) => {
      const index = jobs.findIndex((job) => job.id === id); if (index < 0) throw new Error('renewal job not found');
      if (jobs[index].couponStatus !== expectedStatus) throw new Error('stale coupon transition');
      jobs[index] = applyRenewalReviewAction(jobs[index], action, audit); options.onPut?.({ ...jobs[index] }); return structuredClone(jobs[index]);
    },
  };
  return store;
}

interface RenewalStoreState { jobs: RenewalJob[]; messagePolicy: RenewalMessagePolicy }

export class JsonRenewalJobStore implements RenewalJobStore {
  constructor(private readonly path: string) {}
  private read(): RenewalStoreState {
    if (!existsSync(this.path)) return { jobs: [], messagePolicy: structuredClone(DEFAULT_MESSAGE_POLICY) };
    try {
      const raw = readFileSync(this.path, 'utf8'); if (!raw.trim()) return { jobs: [], messagePolicy: structuredClone(DEFAULT_MESSAGE_POLICY) };
      const parsed = JSON.parse(raw); if (!parsed || !Array.isArray(parsed.jobs)) throw new RenewalStoreCorruptionError('invalid shape');
      const jobs: RenewalJob[] = (parsed.jobs as unknown[]).map((job, index) => validateJob(job, index));
      if (new Set(jobs.map((job) => job.id)).size !== jobs.length || new Set(jobs.map((job) => job.idempotencyKey)).size !== jobs.length) throw new RenewalStoreCorruptionError('duplicate identity');
      return { jobs, messagePolicy: validatePolicy(parsed.messagePolicy, true) };
    } catch (error) {
      if (error instanceof RenewalStoreCorruptionError) throw error;
      throw new RenewalStoreCorruptionError(String((error as Error)?.message || error).slice(0, 100));
    }
  }
  private write(state: RenewalStoreState): void {
    mkdirSync(dirname(this.path), { recursive: true }); const tmp = `${this.path}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: 3, jobs: state.jobs, messagePolicy: state.messagePolicy }, null, 2), { encoding: 'utf8', mode: 0o600 }); renameSync(tmp, this.path);
  }
  private locked<T>(mutation: (jobs: RenewalJob[], policy: RenewalMessagePolicy) => T): T {
    mkdirSync(dirname(this.path), { recursive: true });
    let release: (() => void) | undefined;
    try { release = acquireCrashSafeFileLock(`${this.path}.lock`); } catch { throw new Error('renewal job store busy'); }
    try { const state = this.read(); const result = mutation(state.jobs, state.messagePolicy); this.write(state); return result; }
    finally { try { release(); } catch { /* fail closed */ } }
  }
  private mutate(input: RenewalJob, requireAbsent: boolean): RenewalJob | undefined {
    return this.locked((jobs) => {
      const safe = validateJob(input); const index = jobs.findIndex((job) => job.idempotencyKey === safe.idempotencyKey);
      if (requireAbsent && index >= 0) return undefined;
      if (index >= 0) jobs[index] = validateJob({ ...jobs[index], ...safe, id: jobs[index].id, createdAt: jobs[index].createdAt }); else jobs.push(safe);
      return structuredClone(index >= 0 ? jobs[index] : jobs[jobs.length - 1]);
    });
  }
  list(): RenewalJob[] { return this.read().jobs; }
  get(id: string): RenewalJob | undefined { return this.read().jobs.find((job) => job.id === id); }
  getByIdempotencyKey(key: string): RenewalJob | undefined { return this.read().jobs.find((job) => job.idempotencyKey === key); }
  put(input: RenewalJob): RenewalJob { return this.mutate(input, false)!; }
  claim(input: RenewalJob): RenewalJob | undefined { return this.claimRegistration(input); }
  claimRegistration(input: RenewalJob): RenewalJob | undefined { return this.mutate(input, true); }
  claimMessageRetry(id: string, at: string): RenewalJob | undefined {
    return this.locked((jobs) => {
      const index = jobs.findIndex((job) => job.id === id && job.status === 'message_error'); if (index < 0) return undefined;
      jobs[index] = validateJob({ ...jobs[index], status: 'message_sending', updatedAt: at, lastMessageAttemptAt: at, messageAttempts: (jobs[index].messageAttempts ?? 0) + 1 });
      return structuredClone(jobs[index]);
    });
  }
  reserveMessageSlot(id: string, at: string): MessageReservationResult {
    return this.locked((jobs, policy) => {
      const index = jobs.findIndex((job) => job.id === id && job.status === 'registered');
      if (index < 0) throw new Error('renewal job not reservable');
      const reason: RenewalMessageSkipReason | undefined = !policy.enabled ? 'policy_disabled'
        : messagePolicyDto(policy, jobs).reservedCount >= policy.targetCount ? 'target_reached' : undefined;
      jobs[index] = validateJob({ ...jobs[index], status: reason ? 'message_skipped' : 'message_sending', couponStatus: 'not_started', updatedAt: at, lastMessageAttemptAt: reason ? undefined : at, messageAttempts: reason ? jobs[index].messageAttempts : (jobs[index].messageAttempts ?? 0) + 1, skipReason: reason });
      return reason ? { reserved: false, reason, job: structuredClone(jobs[index]) } : { reserved: true, job: structuredClone(jobs[index]) };
    });
  }
  getMessagePolicy(): RenewalMessagePolicyDto {
    const state = this.read(); return messagePolicyDto(state.messagePolicy, state.jobs);
  }
  updateMessagePolicy(update: { enabled: boolean; targetCount: number }, audit: { actor: string; at: string }): RenewalMessagePolicyDto {
    return this.locked((jobs, policy) => {
      const actor = sanitizeText(audit.actor, 80);
      if (!actor || !validIso(audit.at)) throw new Error('policy actor and time are required');
      const next = validatePolicy({ enabled: update.enabled, targetCount: update.targetCount, updatedAt: audit.at, updatedBy: actor, audit: [...policy.audit, { actor, at: audit.at, before: { enabled: policy.enabled, targetCount: policy.targetCount }, after: update }] });
      Object.assign(policy, next);
      return messagePolicyDto(policy, jobs);
    });
  }
  claimSafeRegistrationRetry(id: string, actor: string, at: string): RenewalJob | undefined {
    return this.locked((jobs) => {
      const index = jobs.findIndex((job) => job.id === id); if (index < 0) return undefined;
      const claimed = claimSafeRetryJob(jobs[index], actor, at); if (!claimed) return undefined;
      jobs[index] = claimed; return structuredClone(claimed);
    });
  }
  claimRegistrationReconciliation(id: string, actor: string, at: string): RenewalJob | undefined {
    return this.locked((jobs) => {
      const index = jobs.findIndex((job) => job.id === id); if (index < 0) return undefined;
      const claimed = claimReconciliationJob(jobs[index], actor, at); if (!claimed) return undefined;
      jobs[index] = claimed; return structuredClone(claimed);
    });
  }
  completeRegistrationReconciliation(
    id: string,
    expectedUpdatedAt: string,
    decision: RegistrationReconciliationDecision,
    evidence: SanitizedRegistrationEvidence[],
    input: { actor: string; at: string },
  ): RenewalJob {
    return this.locked((jobs) => {
      const index = jobs.findIndex((job) => job.id === id); if (index < 0) throw new Error('renewal job not found');
      jobs[index] = completeReconciliationJob(jobs[index], expectedUpdatedAt, decision, evidence, input);
      return structuredClone(jobs[index]);
    });
  }
  applyReviewAction(id: string, expectedStatus: RenewalCouponStatus, action: RenewalReviewAction, audit: ReviewAuditInput): RenewalJob {
    return this.locked((jobs) => {
      const index = jobs.findIndex((job) => job.id === id); if (index < 0) throw new Error('renewal job not found');
      if (jobs[index].couponStatus !== expectedStatus) throw new Error('stale coupon transition');
      jobs[index] = applyRenewalReviewAction(jobs[index], action, audit); return structuredClone(jobs[index]);
    });
  }
}
