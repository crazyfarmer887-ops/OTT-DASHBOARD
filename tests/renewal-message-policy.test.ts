import { describe, expect, test, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonRenewalJobStore, RenewalStoreCorruptionError, createMemoryRenewalJobStore, type RenewalJob } from '../src/renewal/job-store';
import { retryRenewalMessage, runRenewalAutomation } from '../src/renewal/orchestrator';

const now = () => new Date('2026-08-05T12:00:00.000Z');
const row = (number: number) => ({
  dealStatus: 'UsingNearExpiration', extensionStatus: null, extensionProductExist: false,
  productTypeCode: 'N', productTypeString: '넷플릭스', endDateTime: '26. 08. 05',
  dealDays: 30, purePrice: 12000, productName: `넷플릭스 ${number}`, sellingGuide: '이용 안내',
  chatRoomUuid: `room-${number}`, dealUsid: `deal-${number}`, productUsid: `product-${number}`,
});
const job = (number: number, patch: Partial<RenewalJob> = {}): RenewalJob => ({
  id: `job-${number}`, idempotencyKey: `renewal:deal-${number}:20260805T0000`, dealUsid: `deal-${number}`,
  productUsid: `product-${number}`, chatRoomUuid: `room-${number}`, service: '넷플릭스',
  oldEnd: '20260805T0000', newEnd: '20260904T0000', status: 'messaged', couponStatus: 'awaiting_review',
  createdAt: now().toISOString(), updatedAt: now().toISOString(), messagedAt: now().toISOString(), ...patch,
});

function seededStore() {
  const store = createMemoryRenewalJobStore();
  store.put(job(1)); store.put(job(2));
  return store;
}

describe('renewal review-message policy', () => {
  test('uses the exact approved neutral default message', async () => {
    const { buildRenewalMessage } = await import('../src/renewal/core');
    expect(buildRenewalMessage()).toBe('연장 상품이 등록되었습니다.\n채팅에 표시된 연장 상품을 통해 연장을 신청하실 수 있습니다.\n서비스 이용 경험을 후기로 남겨주시면 감사의 뜻으로 CU 상품권 1,000원권을 드립니다. 별점과 후기 내용은 혜택 제공 여부에 영향을 주지 않으며, 거래당 1회 제공됩니다.\n후기 작성 후 이 채팅으로 알려주세요.');
  });

  test('defaults and safely migrates jobs-only state while counting two existing messages', () => {
    const dir = mkdtempSync(join(tmpdir(), 'renewal-policy-migration-'));
    const path = join(dir, 'jobs.json');
    try {
      const raw = JSON.stringify({ version: 2, jobs: [job(1), job(2)] }, null, 2);
      writeFileSync(path, raw, 'utf8');
      const store = new JsonRenewalJobStore(path);
      expect(store.getMessagePolicy()).toMatchObject({ enabled: true, targetCount: 5, sentCount: 2, reservedCount: 2, remaining: 3 });
      expect(readFileSync(path, 'utf8')).toBe(raw);
      const updated = store.updateMessagePolicy({ enabled: false, targetCount: 4 }, { actor: 'admin:test', at: now().toISOString() });
      expect(updated).toMatchObject({ enabled: false, targetCount: 4, sentCount: 2, reservedCount: 2, remaining: 2, updatedBy: 'admin:test' });
      const persisted = JSON.parse(readFileSync(path, 'utf8'));
      expect(persisted.messagePolicy.audit.at(-1)).toMatchObject({ actor: 'admin:test', at: now().toISOString(), before: { enabled: true, targetCount: 5 }, after: { enabled: false, targetCount: 4 } });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('registers normally but persists message_skipped when policy is disabled', async () => {
    const store = createMemoryRenewalJobStore();
    store.updateMessagePolicy({ enabled: false, targetCount: 5 }, { actor: 'admin:test', at: now().toISOString() });
    const sendChat = vi.fn();
    const result = await runRenewalAutomation({ fetchCandidates: async () => [row(3)], registerProduct: async () => ({ succeeded: true }), sendChat, clock: now, store }, { dryRun: false });
    expect(result.jobs[0]).toMatchObject({ status: 'message_skipped', skipReason: 'policy_disabled', couponStatus: 'not_started' });
    expect(result.jobs[0].registeredAt).toBe(now().toISOString());
    expect(sendChat).not.toHaveBeenCalled();
  });

  test('atomically caps concurrent batches at five reserved slots with two existing messages', async () => {
    const store = seededStore();
    const candidates = [3, 4, 5, 6, 7, 8].map(row);
    const sendChat = vi.fn(async () => ({ ok: true }));
    const deps = { fetchCandidates: async () => candidates, registerProduct: async () => ({ succeeded: true }), sendChat, clock: now, store };
    await Promise.all(candidates.map((candidate) => runRenewalAutomation({ ...deps, fetchCandidates: async () => [candidate] }, { dryRun: false })));
    expect(sendChat).toHaveBeenCalledTimes(3);
    expect(store.getMessagePolicy()).toMatchObject({ sentCount: 5, reservedCount: 5, remaining: 0 });
    expect(store.list().filter((item) => item.status === 'message_skipped')).toHaveLength(3);
    expect(store.list().filter((item) => item.skipReason === 'target_reached')).toHaveLength(3);
  });

  test('send failure keeps its reservation and explicit retry reuses it without double reserve', async () => {
    const store = seededStore();
    const first = await runRenewalAutomation({ fetchCandidates: async () => [row(3)], registerProduct: async () => ({ succeeded: true }), sendChat: async () => ({ ok: false }), clock: now, store }, { dryRun: false });
    expect(first.jobs[0]).toMatchObject({ status: 'message_error', couponStatus: 'not_started' });
    expect(store.getMessagePolicy()).toMatchObject({ sentCount: 2, reservedCount: 3, remaining: 3 });
    const retried = await retryRenewalMessage(first.jobs[0].id, { sendChat: async () => ({ ok: true }), clock: now, store });
    expect(retried).toMatchObject({ status: 'messaged', couponStatus: 'awaiting_review' });
    expect(store.getMessagePolicy()).toMatchObject({ sentCount: 3, reservedCount: 3, remaining: 2 });
  });

  test('fails closed on an invalid persisted policy schema', () => {
    const dir = mkdtempSync(join(tmpdir(), 'renewal-policy-corrupt-'));
    const path = join(dir, 'jobs.json');
    try {
      const raw = JSON.stringify({ version: 3, jobs: [], messagePolicy: { enabled: 'yes', targetCount: 500 } });
      writeFileSync(path, raw, 'utf8');
      const store = new JsonRenewalJobStore(path);
      expect(() => store.getMessagePolicy()).toThrow(RenewalStoreCorruptionError);
      expect(() => store.updateMessagePolicy({ enabled: true, targetCount: 5 }, { actor: 'admin:test', at: now().toISOString() })).toThrow(RenewalStoreCorruptionError);
      expect(readFileSync(path, 'utf8')).toBe(raw);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
