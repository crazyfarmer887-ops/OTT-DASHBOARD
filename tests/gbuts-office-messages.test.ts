import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSafeModeConfig } from '../src/api/safe-mode';
import { createGbutsOttSellerClient } from '../src/lib/gbuts-ott-client';
vi.mock('../src/api/safe-mode', () => ({ loadSafeModeConfig: vi.fn(() => ({ enabled: false })) }));
vi.mock('../src/lib/gbuts-session', () => ({ loadGbutsSession: () => ({ token: 'fixture-token' }) }));
vi.mock('../src/lib/gbuts-ott-client', () => ({ createGbutsOttSellerClient: vi.fn() }));
import { afterEach, describe, expect, it, vi } from 'vitest';
import { syncGbutsOfficeMessages, OFFICE_BUYER_GUIDE, startGbutsOfficeMessages, readOfficeGuideJournal, writeOfficeGuideJournal } from '../src/scheduler/gbuts-office-messages';
import { GbutsChatDeliveryError } from '../src/lib/gbuts-chat-delivery';

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.clearAllMocks(); vi.mocked(loadSafeModeConfig).mockReturnValue({ enabled: false } as any); });

describe('Office paid-buyer private guide', () => {
  function fixture() {
    let journal: any = { version: 1, records: {} }; let messages: any[] = [];
    const members = [{ seq: 1, userSeq: 42, nickname: 'buyer', productId: 'order', status: 'APPLY', cancelStatus: null as string | null, createdAt: '2098-01-01', subscriptionEndsAt: '2099-01-01' }];
    const client = { getPost: vi.fn(async () => ({ seq: 16285, category1: { seq: 530 }, status: 'ON_SALE', memberCount: members.length })),
      listOttMembers: vi.fn(async () => members), sellerAccountSeq: vi.fn(async () => 7),
      openPrivateRoom: vi.fn(async () => 'room-42'), getChat: vi.fn(async () => ({ messages })) };
    const deps = { client, postSeq: 16285, read: () => structuredClone(journal),
      write: (next: any) => { journal = structuredClone(next); }, send: vi.fn(async (_room: string, _seller: number, text: string) => { messages.push({ senderSeq: 7, messageType: 'TEXT', message: text }); }) };
    return { deps, members, get journal() { return journal; }, set messages(value: any[]) { messages = value; } };
  }
  it('asks for the invitation email and promises 24 hours and delay extension once across polls', async () => {
    const f = fixture(); await syncGbutsOfficeMessages(f.deps); await syncGbutsOfficeMessages(f.deps);
    expect(f.deps.send).toHaveBeenCalledExactlyOnceWith('room-42', 7, OFFICE_BUYER_GUIDE);
    expect(OFFICE_BUYER_GUIDE).toContain('이메일'); expect(OFFICE_BUYER_GUIDE).toContain('24시간'); expect(OFFICE_BUYER_GUIDE).toContain('무료로 연장');
    expect(f.journal.records['16285:1'].state).toBe('confirmed');
  });
  it.each(['REFUNDED', 'REFUND_REQUESTED'])('does not send for cancellation %s', async cancelStatus => {
    const f = fixture(); f.members[0].cancelStatus = cancelStatus; await syncGbutsOfficeMessages(f.deps); expect(f.deps.send).not.toHaveBeenCalled();
  });
  it('does not send for expired members or non-office listings or incomplete rosters', async () => {
    const f = fixture(); f.members[0].subscriptionEndsAt = '2000-01-01'; await syncGbutsOfficeMessages(f.deps); expect(f.deps.send).not.toHaveBeenCalled();
    f.deps.client.getPost.mockResolvedValue({ seq: 16285, category1: { seq: 5 }, status: 'ON_SALE', memberCount: 1 });
    await expect(syncGbutsOfficeMessages(f.deps)).rejects.toThrow();
    f.deps.client.getPost.mockResolvedValue({ seq: 16285, category1: { seq: 530 }, status: 'ON_SALE', memberCount: 2 });
    await expect(syncGbutsOfficeMessages(f.deps)).rejects.toThrow(); expect(f.deps.send).not.toHaveBeenCalled();
  });
  it('keeps an uncertain SEND pending until seller history confirms it', async () => {
    const f = fixture(); f.deps.send.mockRejectedValue(new Error('unknown'));
    await syncGbutsOfficeMessages(f.deps); await syncGbutsOfficeMessages(f.deps); expect(f.deps.send).toHaveBeenCalledOnce();
    f.messages = [{ senderSeq: 42, messageType: 'TEXT', message: OFFICE_BUYER_GUIDE }];
    await syncGbutsOfficeMessages(f.deps); expect(f.journal.records['16285:1'].state).toBe('attempted');
    f.messages = [{ senderSeq: 7, messageType: 'TEXT', message: OFFICE_BUYER_GUIDE }];
    await syncGbutsOfficeMessages(f.deps); expect(f.journal.records['16285:1'].state).toBe('confirmed'); expect(f.deps.send).toHaveBeenCalledOnce();
  });
  it('records a permanent pre-send rejection as blocked and keeps the failure visible', async () => {
    const f = fixture(); f.deps.send.mockRejectedValue(new GbutsChatDeliveryError('too large', false, false));
    await syncGbutsOfficeMessages(f.deps); await syncGbutsOfficeMessages(f.deps);
    expect(f.deps.send).toHaveBeenCalledOnce(); expect(f.journal.records['16285:1'].state).toBe('blocked');
    expect(f.journal.lastError).toContain('차단');
  });
  it('round-trips the durable journal and refuses corrupt buyer identities', () => {
    const dir = mkdtempSync(join(tmpdir(), 'office-journal-')); const path = join(dir, 'messages.json');
    try {
      const journal = { version: 1 as const, records: { '16285:1': { userSeq: 42, roomId: 'room-42', textHash: 'a'.repeat(64), state: 'attempted' as const, updatedAt: new Date().toISOString() } } };
      writeOfficeGuideJournal(journal, path); expect(readOfficeGuideJournal(path)).toEqual(journal);
      journal.records['16285:1'].userSeq = 0; writeFileSync(path, JSON.stringify(journal)); expect(() => readOfficeGuideJournal(path)).toThrow();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('honors disabled/safe mode and runs only one poll at a time', async () => {
    vi.useFakeTimers(); vi.stubEnv('GBUTS_OFFICE_AUTO_MESSAGE_ENABLED', 'false'); expect(startGbutsOfficeMessages()).toBeUndefined();
    const dir = mkdtempSync(join(tmpdir(), 'office-poller-')); vi.stubEnv('GBUTS_OFFICE_MESSAGE_JOURNAL_PATH', join(dir, 'messages.json'));
    vi.stubEnv('GBUTS_OFFICE_AUTO_MESSAGE_ENABLED', 'true'); vi.mocked(loadSafeModeConfig).mockReturnValue({ enabled: true } as any);
    const stopSafe = startGbutsOfficeMessages()!; await vi.advanceTimersByTimeAsync(1000); expect(createGbutsOttSellerClient).not.toHaveBeenCalled(); stopSafe();
    vi.mocked(loadSafeModeConfig).mockReturnValue({ enabled: false } as any);
    let resolve!: (members: never[]) => void; const waiting = new Promise<never[]>(done => { resolve = done; });
    const f = fixture(); f.deps.client.getPost.mockResolvedValue({ seq: 16285, category1: { seq: 530 }, status: 'ON_SALE', memberCount: 0 });
    f.deps.client.listOttMembers.mockImplementation(async () => waiting);
    vi.mocked(createGbutsOttSellerClient).mockReturnValue(f.deps.client as any);
    const stop = startGbutsOfficeMessages()!;
    try {
      await vi.advanceTimersByTimeAsync(16000); expect(createGbutsOttSellerClient).toHaveBeenCalledOnce();
      resolve([]); await vi.advanceTimersByTimeAsync(0); expect(readOfficeGuideJournal().lastSuccess).toBeTruthy();
    } finally { stop(); rmSync(dir, { recursive: true, force: true }); }
  });
  it('retries a definite pre-SEND connection failure and rejects changed buyer ownership', async () => {
    const f = fixture(); f.deps.send.mockRejectedValueOnce(new GbutsChatDeliveryError('offline', false));
    await syncGbutsOfficeMessages(f.deps); await syncGbutsOfficeMessages(f.deps); expect(f.deps.send).toHaveBeenCalledTimes(2);
    f.members[0].userSeq = 43; await expect(syncGbutsOfficeMessages(f.deps)).rejects.toThrow(); expect(f.deps.send).toHaveBeenCalledTimes(2);
  });
});
