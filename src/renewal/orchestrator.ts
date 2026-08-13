import { createHash } from 'node:crypto';
import { buildExtensionProductModel, buildRenewalMessage, normalizeRenewalCandidate, type ExtensionProductModel, type RenewalCandidate } from './core';
import type { RenewalJob, RenewalJobStore } from './job-store';
import { decideRegistrationReconciliation, summarizeRegistrationEvidence, type RegistrationEvidenceSnapshot } from './reconciliation';

export interface RenewalAutomationDependencies {
  fetchCandidates(): Promise<unknown[]>;
  registerProduct(model: ExtensionProductModel): Promise<{ succeeded: boolean; data?: any; error?: string; message?: string; status?: number; code?: string }>;
  verifyRegistration?(job: RenewalJob): Promise<RegistrationEvidenceSnapshot>;
  sleep?(ms: number): Promise<void>;
  sendChat(input: { chatRoomUuid: string; dealUsid: string; message: string }): Promise<{ ok: boolean; error?: string }>;
  clock(): Date;
  store: RenewalJobStore;
}

function jobId(key: string): string { return `renewal-${createHash('sha256').update(key).digest('hex').slice(0, 16)}`; }
function baseJob(candidate: RenewalCandidate, now: string): RenewalJob {
  return {
    id: jobId(candidate.idempotencyKey), idempotencyKey: candidate.idempotencyKey,
    dealUsid: candidate.dealUsid, productUsid: candidate.productUsid, chatRoomUuid: candidate.chatRoomUuid,
    service: candidate.productTypeString, category: candidate.category, buyer: candidate.buyer, account: candidate.account,
    oldEnd: candidate.oldEnd, newEnd: candidate.newEnd, status: 'preview', couponStatus: 'not_started', createdAt: now, updatedAt: now,
  };
}

type ExecutionOutcome = 'messaged' | 'message_skipped' | 'message_error' | 'registration_error' | 'registration_uncertain';

function registrationRejectionSummary(registration: Awaited<ReturnType<RenewalAutomationDependencies['registerProduct']>>): string {
  const status = Number.isInteger(registration?.status) && Number(registration.status) >= 100 && Number(registration.status) <= 599
    ? `http_${registration.status}` : 'provider';
  const rawCode = String(registration?.code || '').trim().toLowerCase();
  const code = /^[a-z0-9_-]{1,48}$/.test(rawCode) ? rawCode : 'rejected';
  return `registration rejected [${status}:${code}]`;
}

function unknownEvidence(capturedAt: string): RegistrationEvidenceSnapshot {
  return {
    capturedAt,
    oldDeal: { authoritative: false, present: false, extensionProductExist: null, extensionStatus: null, dealStatus: null },
    extensionListing: { authoritative: false, present: false, priceType: null, linkedDeal: false, targetNewEnd: false, productIdPresent: false },
    error: true,
  };
}

export async function reconcileRenewalRegistration(
  id: string,
  deps: RenewalAutomationDependencies,
  actor: string,
  mode: 'automatic' | 'manual' = 'manual',
): Promise<RenewalJob> {
  if (!deps.verifyRegistration) throw new Error('renewal registration verifier unavailable');
  const claimed = deps.store.claimRegistrationReconciliation(id, actor, deps.clock().toISOString());
  if (!claimed) throw new Error('renewal registration not reconcilable');
  const snapshots: RegistrationEvidenceSnapshot[] = [];
  const checks = mode === 'manual' ? 2 : 3;
  const intervalMs = mode === 'manual' ? 1_000 : 5_000;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let index = 0; index < checks; index += 1) {
    if (index > 0) await sleep(intervalMs);
    try { snapshots.push(await deps.verifyRegistration(claimed)); }
    catch { snapshots.push(unknownEvidence(deps.clock().toISOString())); }
    if (decideRegistrationReconciliation(snapshots) === 'registered') break;
  }
  const decision = decideRegistrationReconciliation(snapshots, mode === 'manual' ? {
    manualAgedJob: { createdAt: claimed.createdAt },
  } : {});
  return deps.store.completeRegistrationReconciliation(
    claimed.id,
    claimed.updatedAt,
    decision,
    snapshots.map(summarizeRegistrationEvidence),
    { actor, at: deps.clock().toISOString() },
  );
}

async function sendRegisteredRenewal(
  registered: RenewalJob,
  candidate: RenewalCandidate,
  message: string,
  deps: RenewalAutomationDependencies,
): Promise<{ outcome: ExecutionOutcome; job: RenewalJob }> {
  const reservation = deps.store.reserveMessageSlot(registered.id, deps.clock().toISOString());
  if (!reservation.reserved) return { outcome: 'message_skipped', job: reservation.job };
  const sending = reservation.job;
  let sent: Awaited<ReturnType<RenewalAutomationDependencies['sendChat']>>;
  try { sent = await deps.sendChat({ chatRoomUuid: candidate.chatRoomUuid, dealUsid: candidate.dealUsid, message }); }
  catch {
    return { outcome: 'message_error', job: deps.store.put({ ...sending, status: 'message_unknown', error: 'message outcome unknown', updatedAt: deps.clock().toISOString() }) };
  }
  if (!sent?.ok) {
    return { outcome: 'message_error', job: deps.store.put({ ...sending, status: 'message_error', error: 'chat send failed', updatedAt: deps.clock().toISOString() }) };
  }
  try {
    return { outcome: 'messaged', job: deps.store.put({ ...sending, status: 'messaged', couponStatus: 'awaiting_review', messagedAt: deps.clock().toISOString(), updatedAt: deps.clock().toISOString(), error: undefined }) };
  } catch {
    return { outcome: 'message_error', job: deps.store.put({ ...sending, status: 'message_unknown', error: 'message sent; durable confirmation failed', updatedAt: deps.clock().toISOString() }) };
  }
}

async function executeClaimed(
  claimed: RenewalJob,
  candidate: RenewalCandidate,
  message: string,
  deps: RenewalAutomationDependencies,
): Promise<{ outcome: ExecutionOutcome; job: RenewalJob }> {
  let registration: Awaited<ReturnType<RenewalAutomationDependencies['registerProduct']>>;
  try { registration = await deps.registerProduct(buildExtensionProductModel(candidate)); }
  catch {
    const verificationNeeded = deps.store.put({ ...claimed, status: 'verification_needed', error: 'registration outcome uncertain', updatedAt: deps.clock().toISOString() });
    if (!deps.verifyRegistration) return { outcome: 'registration_uncertain', job: verificationNeeded };
    const reconciled = await reconcileRenewalRegistration(verificationNeeded.id, deps, 'renewal-automation', 'automatic');
    if (reconciled.status !== 'registered') return { outcome: 'registration_uncertain', job: reconciled };
    return sendRegisteredRenewal(reconciled, candidate, message, deps);
  }
  if (!registration?.succeeded) {
    return { outcome: 'registration_error', job: deps.store.put({
      ...claimed, status: 'error', error: registrationRejectionSummary(registration), updatedAt: deps.clock().toISOString(),
    }) };
  }

  let registered: RenewalJob;
  try {
    registered = deps.store.put({
      ...claimed, status: 'registered', registeredAt: deps.clock().toISOString(), updatedAt: deps.clock().toISOString(),
      extensionProductUsid: String(registration.data?.productUsid || '').trim() || undefined,
    });
  } catch {
    return { outcome: 'registration_uncertain', job: deps.store.put({
      ...claimed, status: 'verification_needed', error: 'registration succeeded; durable confirmation failed', updatedAt: deps.clock().toISOString(),
      extensionProductUsid: String(registration.data?.productUsid || '').trim() || undefined,
    }) };
  }

  return sendRegisteredRenewal(registered, candidate, message, deps);
}

function normalizedCandidates(rows: unknown[]): { candidates: RenewalCandidate[]; duplicateKeys: Set<string> } {
  const normalized = rows.map(normalizeRenewalCandidate).filter((value): value is RenewalCandidate => Boolean(value));
  const counts = new Map<string, number>();
  for (const candidate of normalized) counts.set(candidate.idempotencyKey, (counts.get(candidate.idempotencyKey) ?? 0) + 1);
  const duplicateKeys = new Set([...counts].filter(([, count]) => count > 1).map(([key]) => key));
  return { candidates: normalized.filter((candidate) => !duplicateKeys.has(candidate.idempotencyKey)), duplicateKeys };
}

export async function runRenewalAutomation(
  deps: RenewalAutomationDependencies,
  options: { dryRun?: boolean; maxCandidates?: number } = {},
): Promise<{ dryRun: boolean; previews: Array<{ candidate: any; model: ExtensionProductModel }>; jobs: RenewalJob[]; skipped: number }> {
  const dryRun = options.dryRun !== false;
  const maxCandidates = Math.max(1, Math.min(100, Math.floor(options.maxCandidates ?? 25)));
  const rows = await deps.fetchCandidates();
  const normalized = normalizedCandidates(rows);
  const candidates = normalized.candidates.slice(0, maxCandidates);
  const previews = candidates.map((candidate) => ({ candidate, model: buildExtensionProductModel(candidate) }));
  if (dryRun) return { dryRun: true, previews, jobs: [], skipped: rows.length - candidates.length };

  const jobs: RenewalJob[] = [];
  let skipped = rows.length - candidates.length;
  for (const candidate of candidates) {
    const at = deps.clock().toISOString();
    const claimed = deps.store.claimRegistration({ ...baseJob(candidate, at), status: 'registering' });
    if (!claimed) { skipped += 1; continue; }
    jobs.push((await executeClaimed(claimed, candidate, buildRenewalMessage(), deps)).job);
  }
  return { dryRun: false, previews: [], jobs, skipped };
}

export async function retryRenewalMessage(
  id: string,
  deps: Pick<RenewalAutomationDependencies, 'sendChat' | 'clock' | 'store'>,
): Promise<RenewalJob> {
  const claimed = deps.store.claimMessageRetry(id, deps.clock().toISOString());
  if (!claimed) throw new Error('renewal message not retryable');
  let sent: Awaited<ReturnType<RenewalAutomationDependencies['sendChat']>>;
  try { sent = await deps.sendChat({ chatRoomUuid: claimed.chatRoomUuid, dealUsid: claimed.dealUsid, message: buildRenewalMessage() }); }
  catch {
    deps.store.put({ ...claimed, status: 'message_unknown', error: 'message retry outcome unknown', updatedAt: deps.clock().toISOString() });
    throw new Error('renewal message retry outcome unknown');
  }
  if (!sent?.ok) {
    deps.store.put({ ...claimed, status: 'message_error', error: 'message retry rejected', updatedAt: deps.clock().toISOString() });
    throw new Error('renewal message retry failed');
  }
  try {
    return deps.store.put({ ...claimed, status: 'messaged', couponStatus: 'awaiting_review', messagedAt: deps.clock().toISOString(), updatedAt: deps.clock().toISOString(), error: undefined });
  } catch {
    return deps.store.put({ ...claimed, status: 'message_unknown', error: 'message sent; durable confirmation failed', updatedAt: deps.clock().toISOString() });
  }
}

export async function retryRenewalRegistration(
  id: string,
  deps: RenewalAutomationDependencies,
  actor: string,
): Promise<RenewalJob> {
  const existing = deps.store.get(id);
  if (!existing || existing.status !== 'registration_failed_safe') throw new Error('renewal registration safe retry not available');
  const normalized = normalizedCandidates(await deps.fetchCandidates());
  if (normalized.duplicateKeys.has(existing.idempotencyKey)) throw new Error('fresh candidate is duplicate');
  const candidates = normalized.candidates.filter((candidate) => candidate.idempotencyKey === existing.idempotencyKey);
  if (candidates.length !== 1) throw new Error('fresh candidate is absent or ineligible');
  const claimed = deps.store.claimSafeRegistrationRetry(id, actor, deps.clock().toISOString());
  if (!claimed) throw new Error('renewal registration safe retry not available');
  return (await executeClaimed(claimed, candidates[0], buildRenewalMessage(), deps)).job;
}

export type SelectedRenewalOutcome = 'dry_run' | 'messaged' | 'message_skipped' | 'message_error' | 'registration_error' | 'registration_uncertain' | 'duplicate_selection' | 'ambiguous_candidate' | 'unknown_key' | 'already_processed';
export interface SelectedRenewalResult { idempotencyKey: string; outcome: SelectedRenewalOutcome; job?: RenewalJob; }

export async function runSelectedRenewalBatch(
  deps: RenewalAutomationDependencies,
  options: { idempotencyKeys: string[]; dryRun?: boolean; messageTemplate?: string },
): Promise<{ dryRun: boolean; results: SelectedRenewalResult[] }> {
  const dryRun = options.dryRun !== false;
  const keys = Array.isArray(options.idempotencyKeys) ? options.idempotencyKeys.map((key) => String(key).trim()) : [];
  const message = buildRenewalMessage(options.messageTemplate);
  const normalized = normalizedCandidates(await deps.fetchCandidates());
  const byKey = new Map(normalized.candidates.map((candidate) => [candidate.idempotencyKey, candidate]));
  const seen = new Set<string>();
  const results: SelectedRenewalResult[] = [];

  for (const key of keys) {
    if (seen.has(key)) { results.push({ idempotencyKey: key, outcome: 'duplicate_selection' }); continue; }
    seen.add(key);
    if (normalized.duplicateKeys.has(key)) { results.push({ idempotencyKey: key, outcome: 'ambiguous_candidate' }); continue; }
    const candidate = byKey.get(key);
    if (!candidate) { results.push({ idempotencyKey: key, outcome: 'unknown_key' }); continue; }
    const existing = deps.store.getByIdempotencyKey(key);
    if (existing) { results.push({ idempotencyKey: key, outcome: 'already_processed', job: existing }); continue; }
    if (dryRun) { results.push({ idempotencyKey: key, outcome: 'dry_run' }); continue; }
    const at = deps.clock().toISOString();
    const claimed = deps.store.claimRegistration({ ...baseJob(candidate, at), status: 'registering' });
    if (!claimed) { results.push({ idempotencyKey: key, outcome: 'already_processed', job: deps.store.getByIdempotencyKey(key) }); continue; }
    const executed = await executeClaimed(claimed, candidate, message, deps);
    results.push({ idempotencyKey: key, ...executed });
  }
  return { dryRun, results };
}
