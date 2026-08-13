import { describe, expect, test, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonRenewalJobStore, RenewalStoreCorruptionError, applyRenewalReviewAction, createMemoryRenewalJobStore } from '../src/renewal/job-store';
import { summarizeRegistrationEvidence, type RegistrationEvidenceSnapshot } from '../src/renewal/reconciliation';
import { reconcileRenewalRegistration, retryRenewalMessage, retryRenewalRegistration, runRenewalAutomation, runSelectedRenewalBatch } from '../src/renewal/orchestrator';

const row = (patch: Record<string, unknown> = {}) => ({
  dealStatus: 'UsingNearExpiration', extensionStatus: null, extensionProductExist: false,
  productTypeCode: 'N', productTypeString: '넷플릭스', endDateTime: '26. 07. 28',
  dealDays: 30, purePrice: 12000, productName: '넷플릭스 30일', sellingGuide: '이용 안내',
  chatRoomUuid: 'room-1', dealUsid: 'deal-1', productUsid: 'product-1', ...patch,
});
const now = () => new Date('2026-07-24T12:00:00.000Z');

function registrationSnapshot(seconds: number, kind: 'positive' | 'negative' | 'unknown' = 'negative'): RegistrationEvidenceSnapshot {
  return {
    capturedAt: new Date(now().getTime() + seconds * 1000).toISOString(),
    oldDeal: {
      authoritative: kind !== 'unknown', present: true,
      extensionProductExist: false, extensionStatus: null, dealStatus: 'UsingNearExpiration',
    },
    extensionListing: {
      authoritative: kind !== 'unknown', present: kind === 'positive', priceType: kind === 'positive' ? 'Extended' : null,
      linkedDeal: kind === 'positive', targetNewEnd: kind === 'positive', productIdPresent: kind === 'positive',
    },
    error: kind === 'unknown',
  };
}

function reviewJobFixture(patch: Record<string, unknown> = {}) {
  return {
    id: 'job-1', idempotencyKey: 'key-1', dealUsid: 'deal-1', productUsid: 'p-1', chatRoomUuid: 'room-1',
    service: '넷플릭스', category: 'Netflix', buyer: '홍*동', account: 'ow***@example.com', oldEnd: '20260728T0000', newEnd: '20260827T0000',
    status: 'messaged', couponStatus: 'awaiting_review', createdAt: now().toISOString(), updatedAt: now().toISOString(), messagedAt: now().toISOString(), audit: [],
    ...patch,
  } as any;
}

describe('persistent renewal job store', () => {
  test('writes atomically, detects duplicate idempotency keys, and never persists secrets', () => {
    const dir = mkdtempSync(join(tmpdir(), 'renewal-store-'));
    const path = join(dir, 'jobs.json');
    try {
      const store = new JsonRenewalJobStore(path);
      const first = store.put({
        id: 'job-1', idempotencyKey: 'renewal:deal-1:20260728T0000', dealUsid: 'deal-1',
        productUsid: 'product-1', chatRoomUuid: 'room-1', service: '넷플릭스', oldEnd: '20260728T0000',
        newEnd: '20260827T0000', status: 'registered', couponStatus: 'not_started',
        createdAt: now().toISOString(), updatedAt: now().toISOString(),
        credentials: { password: 'never' }, cookies: 'never',
      } as any);
      const duplicate = store.put({ ...first, id: 'job-2', status: 'messaged' });
      expect(duplicate.id).toBe('job-1');
      expect(store.list()).toHaveLength(1);
      const raw = readFileSync(path, 'utf8');
      expect(raw).not.toContain('credentials');
      expect(raw).not.toContain('cookies');
      expect(raw).not.toContain('never');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('fails closed instead of replacing corrupt live state', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'renewal-corrupt-'));
    const path = join(dir, 'jobs.json');
    try {
      writeFileSync(path, '{broken', 'utf8');
      const store = new JsonRenewalJobStore(path);
      expect(() => store.put({ id: 'x', idempotencyKey: 'k' } as any)).toThrow(/corrupt/i);
      expect(readFileSync(path, 'utf8')).toBe('{broken');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('rejects semantic corruption and leaves the live file untouched on mutation', () => {
    const dir = mkdtempSync(join(tmpdir(), 'renewal-semantic-corrupt-'));
    const path = join(dir, 'jobs.json');
    try {
      const raw = JSON.stringify({ version: 1, jobs: [{}] });
      writeFileSync(path, raw, 'utf8');
      const store = new JsonRenewalJobStore(path);
      expect(() => store.list()).toThrow(RenewalStoreCorruptionError);
      expect(() => store.put({ id: 'x', idempotencyKey: 'k' } as any)).toThrow(RenewalStoreCorruptionError);
      expect(readFileSync(path, 'utf8')).toBe(raw);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('atomically applies one review transition with append-only evidence under contention', async () => {
    const store = createMemoryRenewalJobStore();
    const base = reviewJobFixture({ couponStatus: 'coupon_approved', audit: [{
      action: 'coupon_approve', actor: 'admin', at: now().toISOString(), reason: 'approved', evidence: 'old-proof', from: 'review_confirmed', to: 'coupon_approved',
    }] });
    store.put(base);
    const action = () => Promise.resolve().then(() => store.applyReviewAction(base.id, 'coupon_approved', 'mark_issued', {
      actor: 'admin', at: now().toISOString(), reason: 'manual issue', evidence: 'new-proof',
    }));
    const results = await Promise.allSettled([action(), action()]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(store.get(base.id)?.audit?.map((entry) => entry.evidence)).toEqual(['old-proof', 'new-proof']);
  });

  test('reads legacy uncertain as verification_needed without rewriting or wiping the persisted file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'renewal-legacy-'));
    const path = join(dir, 'jobs.json');
    try {
      const legacy = reviewJobFixture({ status: 'uncertain', couponStatus: 'not_started' });
      const raw = JSON.stringify({ version: 1, jobs: [legacy] }, null, 2);
      writeFileSync(path, raw, 'utf8');
      const store = new JsonRenewalJobStore(path);
      expect(store.list()[0].status).toBe('verification_needed');
      expect(readFileSync(path, 'utf8')).toBe(raw);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('claims verification atomically so concurrent reconciliation has one worker', async () => {
    const store = createMemoryRenewalJobStore();
    const base = store.put(reviewJobFixture({ status: 'verification_needed', couponStatus: 'not_started' }));
    const claims = await Promise.all([
      Promise.resolve().then(() => store.claimRegistrationReconciliation(base.id, 'operator-a', now().toISOString())),
      Promise.resolve().then(() => store.claimRegistrationReconciliation(base.id, 'operator-b', now().toISOString())),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(store.get(base.id)).toMatchObject({ status: 'verifying', reconciliationAttempts: 1, lastReconciliationAt: now().toISOString() });
  });

  test('completes a claimed verification with sanitized boolean evidence and actor audit', () => {
    const store = createMemoryRenewalJobStore();
    const base = store.put(reviewJobFixture({ status: 'verification_needed', couponStatus: 'not_started' }));
    const claimed = store.claimRegistrationReconciliation(base.id, 'operator-a', now().toISOString())!;
    const snapshot: RegistrationEvidenceSnapshot = {
      capturedAt: now().toISOString(),
      oldDeal: { authoritative: true, present: true, extensionProductExist: false, extensionStatus: null, dealStatus: 'UsingNearExpiration' },
      extensionListing: { authoritative: true, present: false, priceType: null, linkedDeal: false, targetNewEnd: false, productIdPresent: false },
    };
    const completed = store.completeRegistrationReconciliation(base.id, claimed.updatedAt, 'registration_failed_safe', [summarizeRegistrationEvidence(snapshot)], {
      actor: 'operator-a', at: now().toISOString(),
    });
    expect(completed).toMatchObject({ status: 'registration_failed_safe', reconciliationAttempts: 1 });
    expect(JSON.stringify(completed.reconciliationEvidence)).not.toMatch(/deal-1|product-1|UsingNearExpiration/);
    expect(completed.reconciliationAudit?.at(-1)).toMatchObject({ actor: 'operator-a', from: 'verifying', to: 'registration_failed_safe' });
  });
});

describe('renewal orchestrator safety', () => {
  test('defaults to dry-run previews and performs no POST, chat, or store mutation', async () => {
    const store = createMemoryRenewalJobStore();
    const registerProduct = vi.fn();
    const sendChat = vi.fn();
    const put = vi.spyOn(store, 'put');
    const result = await runRenewalAutomation({ fetchCandidates: async () => [row()], registerProduct, sendChat, clock: now, store });
    expect(result.dryRun).toBe(true);
    expect(result.previews).toHaveLength(1);
    expect(result.previews[0].model.priceType).toBe('Extended');
    expect(registerProduct).not.toHaveBeenCalled();
    expect(sendChat).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  test('live persists registration before chat then marks awaiting review only after message success', async () => {
    const events: string[] = [];
    const store = createMemoryRenewalJobStore({ onPut: job => events.push(`store:${job.status}`) });
    const result = await runRenewalAutomation({
      fetchCandidates: async () => [row()],
      registerProduct: async () => { events.push('register'); return { succeeded: true, data: { productUsid: 'extension-1' } }; },
      sendChat: async () => { events.push('chat'); return { ok: true }; },
      clock: now, store,
    }, { dryRun: false });
    expect(events).toEqual(['store:registering', 'register', 'store:registered', 'store:message_sending', 'chat', 'store:messaged']);
    expect(result.jobs[0].status).toBe('messaged');
    expect(result.jobs[0].couponStatus).toBe('awaiting_review');
    expect(result.jobs[0]).not.toHaveProperty('couponIssued');
  });

  test('provider rejection stores only sanitized admin status/code and never chats', async () => {
    const store = createMemoryRenewalJobStore();
    const sendChat = vi.fn();
    const first = await runRenewalAutomation({
      fetchCandidates: async () => [row()],
      registerProduct: async () => ({ succeeded: false, status: 422, code: 'VALIDATION_FAILED', message: 'deal-1 Cookie=secret provider details' }),
      sendChat, clock: now, store,
    }, { dryRun: false });
    expect(first.jobs[0]).toMatchObject({ status: 'error', error: 'registration rejected [http_422:validation_failed]' });
    expect(JSON.stringify(first.jobs[0])).not.toMatch(/secret|Cookie|provider details/);
    expect(sendChat).not.toHaveBeenCalled();
  });

  test('succeeded false becomes error and never chats', async () => {
    const store = createMemoryRenewalJobStore();
    const sendChat = vi.fn();
    const first = await runRenewalAutomation({
      fetchCandidates: async () => [row()], registerProduct: async () => ({ succeeded: false, error: 'rejected JSESSIONID=secret' }),
      sendChat, clock: now, store,
    }, { dryRun: false });
    expect(first.jobs[0].status).toBe('error');
    expect(first.jobs[0].error).not.toContain('secret');
    expect(sendChat).not.toHaveBeenCalled();
    const registerAgain = vi.fn();
    await runRenewalAutomation({ fetchCandidates: async () => [row()], registerProduct: registerAgain, sendChat, clock: now, store }, { dryRun: false });
    expect(registerAgain).not.toHaveBeenCalled();
  });

  test('ambiguous registration exception becomes verification_needed and is never re-registered', async () => {
    const store = createMemoryRenewalJobStore();
    const registerProduct = vi.fn(async () => { throw new Error('socket timeout Cookie: secret'); });
    const sendChat = vi.fn();
    const first = await runRenewalAutomation({ fetchCandidates: async () => [row()], registerProduct, sendChat, clock: now, store }, { dryRun: false });
    expect(first.jobs[0].status).toBe('verification_needed');
    expect(first.jobs[0].error).toBe('registration outcome uncertain');
    await runRenewalAutomation({ fetchCandidates: async () => [row()], registerProduct, sendChat, clock: now, store }, { dryRun: false });
    expect(registerProduct).toHaveBeenCalledTimes(1);
    expect(sendChat).not.toHaveBeenCalled();
  });

  test('ambiguous provider 429 is journaled verification_needed after one POST and only read reconciliation follows', async () => {
    const journal: string[] = [];
    const store = createMemoryRenewalJobStore({ onPut: job => journal.push(job.status) });
    const registerProduct = vi.fn(async () => { throw new Error('Graytag renewal registration HTTP 429'); });
    const verifyRegistration = vi.fn(async () => registrationSnapshot(0, 'unknown'));
    const sendChat = vi.fn();
    const first = await runRenewalAutomation({
      fetchCandidates: async () => [row()], registerProduct, verifyRegistration,
      sleep: vi.fn(async () => undefined), sendChat, clock: now, store,
    }, { dryRun: false });
    expect(journal).toContain('verification_needed');
    expect(first.jobs[0]).toMatchObject({ status: 'verification_needed' });
    expect(registerProduct).toHaveBeenCalledTimes(1);
    expect(verifyRegistration).toHaveBeenCalledTimes(3);
    await runRenewalAutomation({
      fetchCandidates: async () => [row()], registerProduct, verifyRegistration,
      sleep: vi.fn(async () => undefined), sendChat, clock: now, store,
    }, { dryRun: false });
    expect(registerProduct).toHaveBeenCalledTimes(1);
    expect(sendChat).not.toHaveBeenCalled();
  });

  test('transport exception is reconciled positive, persisted registered before chat, then messaged without real sleep', async () => {
    const events: string[] = [];
    const store = createMemoryRenewalJobStore({ onPut: job => events.push(`store:${job.status}`) });
    const snapshots = [registrationSnapshot(0), registrationSnapshot(5, 'positive')];
    const result = await runRenewalAutomation({
      fetchCandidates: async () => [row()],
      registerProduct: async () => { throw new Error('timeout'); },
      verifyRegistration: async () => snapshots.shift()!,
      sleep: vi.fn(async () => undefined),
      sendChat: async () => { events.push('chat'); return { ok: true }; },
      clock: now,
      store,
    }, { dryRun: false });
    expect(result.jobs[0]).toMatchObject({ status: 'messaged', couponStatus: 'awaiting_review' });
    expect(events).toEqual([
      'store:registering', 'store:verification_needed', 'store:verifying',
      'store:registered', 'store:message_sending', 'chat', 'store:messaged',
    ]);
  });

  test('transport exception with three authoritative negatives over ten seconds becomes registration_failed_safe and never chats', async () => {
    const store = createMemoryRenewalJobStore();
    const snapshots = [registrationSnapshot(0), registrationSnapshot(5), registrationSnapshot(10)];
    const sendChat = vi.fn();
    const result = await runRenewalAutomation({
      fetchCandidates: async () => [row()], registerProduct: async () => { throw new Error('timeout'); },
      verifyRegistration: async () => snapshots.shift()!, sleep: vi.fn(async () => undefined),
      sendChat, clock: now, store,
    }, { dryRun: false });
    expect(result.jobs[0].status).toBe('registration_failed_safe');
    expect(sendChat).not.toHaveBeenCalled();
  });

  test('transport exception with unknown verification stays verification_needed and never chats', async () => {
    const store = createMemoryRenewalJobStore();
    const sendChat = vi.fn();
    const result = await runRenewalAutomation({
      fetchCandidates: async () => [row()], registerProduct: async () => { throw new Error('timeout'); },
      verifyRegistration: async () => registrationSnapshot(0, 'unknown'), sleep: vi.fn(async () => undefined),
      sendChat, clock: now, store,
    }, { dryRun: false });
    expect(result.jobs[0].status).toBe('verification_needed');
    expect(sendChat).not.toHaveBeenCalled();
  });

  test('manual reconciliation atomically allows one worker and an aged job may use two fresh authoritative negatives', async () => {
    const store = createMemoryRenewalJobStore();
    const base = store.put(reviewJobFixture({
      status: 'verification_needed', couponStatus: 'not_started',
      createdAt: new Date(now().getTime() - 120_000).toISOString(),
    }));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const verifyRegistration = vi.fn()
      .mockImplementationOnce(async () => { await gate; return registrationSnapshot(0); })
      .mockResolvedValueOnce(registrationSnapshot(1));
    const deps = { fetchCandidates: async () => [], registerProduct: vi.fn(), verifyRegistration, sleep: vi.fn(async () => undefined), sendChat: vi.fn(), clock: now, store };
    const first = reconcileRenewalRegistration(base.id, deps, 'operator-a', 'manual');
    const second = reconcileRenewalRegistration(base.id, deps, 'operator-b', 'manual');
    await vi.waitFor(() => expect(store.get(base.id)?.status).toBe('verifying'));
    release();
    const results = await Promise.allSettled([first, second]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(store.get(base.id)).toMatchObject({ status: 'registration_failed_safe', reconciliationAttempts: 1 });
    expect(verifyRegistration).toHaveBeenCalledTimes(2);
  });

  test('message errors do not re-register or auto-resend on later ticks', async () => {
    const store = createMemoryRenewalJobStore();
    const registerProduct = vi.fn(async () => ({ succeeded: true }));
    const sendChat = vi.fn(async () => { throw new Error('chat timeout'); });
    const first = await runRenewalAutomation({ fetchCandidates: async () => [row()], registerProduct, sendChat, clock: now, store }, { dryRun: false });
    expect(first.jobs[0].status).toBe('message_unknown');
    await runRenewalAutomation({ fetchCandidates: async () => [row()], registerProduct, sendChat, clock: now, store }, { dryRun: false });
    expect(registerProduct).toHaveBeenCalledTimes(1);
    expect(sendChat).toHaveBeenCalledTimes(1);
  });

  test('explicit admin message retry sends once and marks awaiting_review without registration', async () => {
    const store = createMemoryRenewalJobStore();
    await runRenewalAutomation({
      fetchCandidates: async () => [row()], registerProduct: async () => ({ succeeded: true }),
      sendChat: async () => ({ ok: false, error: 'not sent' }), clock: now, store,
    }, { dryRun: false });
    const sendChat = vi.fn(async () => ({ ok: true }));
    const job = store.list()[0];
    const retried = await retryRenewalMessage(job.id, { sendChat, clock: now, store });
    expect(retried.status).toBe('messaged');
    expect(retried.couponStatus).toBe('awaiting_review');
    await expect(retryRenewalMessage(job.id, { sendChat, clock: now, store })).rejects.toThrow('not retryable');
    expect(sendChat).toHaveBeenCalledTimes(1);
  });

  test('concurrent legacy live ticks claim before the provider and register exactly once', async () => {
    const store = createMemoryRenewalJobStore();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const registerProduct = vi.fn(async () => { await gate; return { succeeded: true }; });
    const deps = { fetchCandidates: async () => [row()], registerProduct, sendChat: async () => ({ ok: true }), clock: now, store };
    const first = runRenewalAutomation(deps, { dryRun: false });
    const second = runRenewalAutomation(deps, { dryRun: false });
    await vi.waitFor(() => expect(registerProduct).toHaveBeenCalledTimes(1));
    release();
    await Promise.all([first, second]);
    expect(registerProduct).toHaveBeenCalledTimes(1);
  });

  test('concurrent message retries atomically claim and send exactly once', async () => {
    const store = createMemoryRenewalJobStore();
    const failed = store.put(reviewJobFixture({ status: 'message_error', couponStatus: 'not_started', registeredAt: now().toISOString() }));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const sendChat = vi.fn(async () => { await gate; return { ok: true }; });
    const first = retryRenewalMessage(failed.id, { sendChat, clock: now, store });
    const second = retryRenewalMessage(failed.id, { sendChat, clock: now, store });
    await vi.waitFor(() => expect(sendChat).toHaveBeenCalledTimes(1));
    release();
    const results = await Promise.allSettled([first, second]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(sendChat).toHaveBeenCalledTimes(1);
  });

  test('definite retry rejection returns to message_error with attempt metadata', async () => {
    const store = createMemoryRenewalJobStore();
    const failed = store.put(reviewJobFixture({ status: 'message_error', couponStatus: 'not_started', registeredAt: now().toISOString() }));
    await expect(retryRenewalMessage(failed.id, { sendChat: async () => ({ ok: false, error: 'rejected' }), clock: now, store })).rejects.toThrow(/retry failed/);
    expect(store.get(failed.id)).toMatchObject({ status: 'message_error', messageAttempts: 1, lastMessageAttemptAt: now().toISOString() });
  });

  test('ambiguous retry failure becomes message_unknown and is not retryable', async () => {
    const store = createMemoryRenewalJobStore();
    const failed = store.put(reviewJobFixture({ status: 'message_error', couponStatus: 'not_started', registeredAt: now().toISOString() }));
    await expect(retryRenewalMessage(failed.id, { sendChat: async () => { throw new Error('timeout secret=abc'); }, clock: now, store })).rejects.toThrow(/outcome unknown/);
    expect(store.get(failed.id)?.status).toBe('message_unknown');
    await expect(retryRenewalMessage(failed.id, { sendChat: vi.fn(), clock: now, store })).rejects.toThrow(/not retryable/);
  });

  test('provider success followed by save failure records verification_needed and never re-registers', async () => {
    const backing = createMemoryRenewalJobStore();
    let failRegistered = true;
    const store = { ...backing, put: vi.fn((job: any) => {
      if (job.status === 'registered' && failRegistered) { failRegistered = false; throw new Error('disk full'); }
      return backing.put(job);
    }) };
    const registerProduct = vi.fn(async () => ({ succeeded: true, data: { productUsid: 'ext-1' } }));
    const deps = { fetchCandidates: async () => [row()], registerProduct, sendChat: vi.fn(), clock: now, store };
    await runRenewalAutomation(deps, { dryRun: false });
    expect(backing.list()[0].status).toBe('verification_needed');
    await runRenewalAutomation(deps, { dryRun: false });
    expect(registerProduct).toHaveBeenCalledTimes(1);
  });

  test('chat success followed by save failure records message_unknown and never resends', async () => {
    const backing = createMemoryRenewalJobStore();
    let failMessaged = true;
    const store = { ...backing, put: vi.fn((job: any) => {
      if (job.status === 'messaged' && failMessaged) { failMessaged = false; throw new Error('disk full'); }
      return backing.put(job);
    }) };
    const sendChat = vi.fn(async () => ({ ok: true }));
    const deps = { fetchCandidates: async () => [row()], registerProduct: async () => ({ succeeded: true }), sendChat, clock: now, store };
    await runRenewalAutomation(deps, { dryRun: false });
    expect(backing.list()[0].status).toBe('message_unknown');
    await runRenewalAutomation(deps, { dryRun: false });
    expect(sendChat).toHaveBeenCalledTimes(1);
  });

  test('base jobs persist only sanitized review identity fields', async () => {
    const store = createMemoryRenewalJobStore();
    await runRenewalAutomation({
      fetchCandidates: async () => [row({ borrowerName: '홍길동', accountEmail: 'owner@example.com' })],
      registerProduct: async () => ({ succeeded: false }), sendChat: vi.fn(), clock: now, store,
    }, { dryRun: false });
    expect(store.list()[0]).toMatchObject({ category: 'Netflix', buyer: '홍*동', account: 'ow***@example.com', oldEnd: '20260728T0000', newEnd: '20260827T0000' });
  });
});

describe('safe registration retry', () => {
  function failedSafeStore() {
    const store = createMemoryRenewalJobStore();
    const job = store.put(reviewJobFixture({
      status: 'registration_failed_safe', couponStatus: 'not_started',
      idempotencyKey: 'renewal:deal-1:20260728T0000',
    }));
    return { store, job };
  }

  test('atomically claims only registration_failed_safe and records actor attempt metadata', () => {
    const { store, job } = failedSafeStore();
    const claimed = store.claimSafeRegistrationRetry(job.id, 'operator-a', now().toISOString());
    expect(claimed).toMatchObject({
      status: 'registering', registrationAttempts: 1, lastRegistrationAttemptAt: now().toISOString(),
    });
    expect(claimed?.registrationRetryAudit?.at(-1)).toMatchObject({ actor: 'operator-a', from: 'registration_failed_safe', to: 'registering' });
    expect(store.claimSafeRegistrationRetry(job.id, 'operator-b', now().toISOString())).toBeUndefined();
  });

  test('rejects fresh candidate absence or duplicate before registration and claim', async () => {
    for (const candidates of [[], [row(), row({ productUsid: 'duplicate-product' })]]) {
      const { store, job } = failedSafeStore();
      const registerProduct = vi.fn();
      await expect(retryRenewalRegistration(job.id, {
        fetchCandidates: async () => candidates, registerProduct, sendChat: vi.fn(), clock: now, store,
      }, 'operator-a')).rejects.toThrow(/fresh candidate/i);
      expect(registerProduct).not.toHaveBeenCalled();
      expect(store.get(job.id)?.status).toBe('registration_failed_safe');
    }
  });

  test('concurrent retries register exactly once, persist success before one chat, and audit actor', async () => {
    const events: string[] = [];
    const store = createMemoryRenewalJobStore({ onPut: (saved) => events.push(`store:${saved.status}`) });
    const job = store.put(reviewJobFixture({ status: 'registration_failed_safe', couponStatus: 'not_started', idempotencyKey: 'renewal:deal-1:20260728T0000' }));
    events.length = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const registerProduct = vi.fn(async () => { events.push('register'); await gate; return { succeeded: true, data: { productUsid: 'extension-1' } }; });
    const sendChat = vi.fn(async () => { events.push('chat'); return { ok: true }; });
    const deps = { fetchCandidates: async () => [row()], registerProduct, sendChat, clock: now, store };
    const first = retryRenewalRegistration(job.id, deps, 'operator-a');
    const second = retryRenewalRegistration(job.id, deps, 'operator-b');
    const settled = Promise.allSettled([first, second]);
    await vi.waitFor(() => expect(registerProduct).toHaveBeenCalledTimes(1));
    release();
    const results = await settled;
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(registerProduct).toHaveBeenCalledTimes(1);
    expect(sendChat).toHaveBeenCalledTimes(1);
    expect(events).toEqual(['store:registering', 'register', 'store:registered', 'store:message_sending', 'chat', 'store:messaged']);
    expect(store.get(job.id)).toMatchObject({ status: 'messaged', registrationAttempts: 1 });
  });

  test('definite provider rejection stores safe code and sends no chat', async () => {
    const { store, job } = failedSafeStore();
    const sendChat = vi.fn();
    const retried = await retryRenewalRegistration(job.id, {
      fetchCandidates: async () => [row()],
      registerProduct: async () => ({ succeeded: false, status: 409, code: 'ALREADY_INVALID', message: 'private-id' }),
      sendChat, clock: now, store,
    }, 'operator-a');
    expect(retried).toMatchObject({ status: 'error', error: 'registration rejected [http_409:already_invalid]' });
    expect(sendChat).not.toHaveBeenCalled();
  });
});

describe('selected renewal batch', () => {
  test('revalidates fresh candidates and returns duplicate, unknown, and successful per-item results', async () => {
    const store = createMemoryRenewalJobStore();
    const key = 'renewal:deal-1:20260728T0000';
    const registerProduct = vi.fn(async () => ({ succeeded: true }));
    const result = await runSelectedRenewalBatch({
      fetchCandidates: async () => [row()], registerProduct, sendChat: async () => ({ ok: true }), clock: now, store,
    }, { dryRun: false, idempotencyKeys: [key, key, 'unknown'] });
    expect(result.results.map((item) => item.outcome)).toEqual(['messaged', 'duplicate_selection', 'unknown_key']);
    expect(registerProduct).toHaveBeenCalledTimes(1);
  });

  test('selected dry-run has zero register, send, and write side effects', async () => {
    const store = createMemoryRenewalJobStore();
    const registerProduct = vi.fn(); const sendChat = vi.fn(); const put = vi.spyOn(store, 'put');
    const result = await runSelectedRenewalBatch({ fetchCandidates: async () => [row()], registerProduct, sendChat, clock: now, store }, {
      dryRun: true, idempotencyKeys: ['renewal:deal-1:20260728T0000'],
    });
    expect(result.results[0].outcome).toBe('dry_run');
    expect(registerProduct).not.toHaveBeenCalled(); expect(sendChat).not.toHaveBeenCalled(); expect(put).not.toHaveBeenCalled();
  });

  test('concurrent admin batches atomically claim a key and register only once', async () => {
    const store = createMemoryRenewalJobStore();
    const registerProduct = vi.fn(async () => ({ succeeded: true }));
    const deps = { fetchCandidates: async () => [row()], registerProduct, sendChat: async () => ({ ok: true }), clock: now, store };
    const options = { dryRun: false, idempotencyKeys: ['renewal:deal-1:20260728T0000'] };
    const [a, b] = await Promise.all([runSelectedRenewalBatch(deps, options), runSelectedRenewalBatch(deps, options)]);
    expect(registerProduct).toHaveBeenCalledTimes(1);
    expect([a.results[0].outcome, b.results[0].outcome]).toContain('already_processed');
  });

  test('fails closed when fresh upstream candidates duplicate a selected or legacy key', async () => {
    const store = createMemoryRenewalJobStore();
    const registerProduct = vi.fn();
    const deps = {
      fetchCandidates: async () => [row(), row({ productUsid: 'conflicting-product', chatRoomUuid: 'conflicting-room' })],
      registerProduct, sendChat: vi.fn(), clock: now, store,
    };
    const selected = await runSelectedRenewalBatch(deps, { dryRun: false, idempotencyKeys: ['renewal:deal-1:20260728T0000'] });
    expect(selected.results[0].outcome).toBe('ambiguous_candidate');
    await runRenewalAutomation(deps, { dryRun: false });
    expect(registerProduct).not.toHaveBeenCalled();
  });
});

describe('review and coupon state machine', () => {
  const reviewJob = () => reviewJobFixture();

  test('enforces review-confirm then coupon-approve then manual-issued and records every audit', () => {
    const confirmed = applyRenewalReviewAction(reviewJob(), 'review_confirm', { actor: 'admin', at: now().toISOString(), reason: '후기 증빙 확인' });
    const approved = applyRenewalReviewAction(confirmed, 'coupon_approve', { actor: 'admin', at: now().toISOString(), reason: '거래당 1회 확인' });
    const issued = applyRenewalReviewAction(approved, 'mark_issued', { actor: 'admin', at: now().toISOString(), reason: '수동 지급 확인' });
    expect(issued.couponStatus).toBe('issued');
    expect(issued.audit?.map((entry: any) => entry.action)).toEqual(['review_confirm', 'coupon_approve', 'mark_issued']);
    expect(() => applyRenewalReviewAction(issued, 'mark_issued', { actor: 'admin', at: now().toISOString(), reason: 'duplicate' })).toThrow(/transition|duplicate/i);
  });

  test('rejects coupon approval before review and supports rejection', () => {
    expect(() => applyRenewalReviewAction(reviewJob(), 'coupon_approve', { actor: 'admin', at: now().toISOString(), reason: 'too early' })).toThrow(/transition/i);
    expect(applyRenewalReviewAction(reviewJob(), 'reject', { actor: 'admin', at: now().toISOString(), reason: '증빙 없음' }).couponStatus).toBe('rejected');
  });
});
