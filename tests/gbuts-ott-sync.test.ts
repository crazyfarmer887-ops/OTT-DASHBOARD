import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateUniqueProfileNicknames, stableRandomFromSeed } from '../src/lib/profile-nickname';
import { emptyGbutsOttStore } from '../src/lib/gbuts-ott';
import { syncGbutsOtt } from '../src/scheduler/gbuts-ott-sync';
import { fixtureListing, fixtureManagement, fixtureOrder } from './fixtures/gbuts-ott';
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-05T06:00:00Z')); }); afterEach(() => vi.useRealTimers());
function fixture() {
  let store = emptyGbutsOttStore(); store.listings['request-1'] = fixtureListing(); let messages: any[] = [];
  let members = [{ seq: 1, userSeq: 10, productId: 'BUY1', nickname: '구매자', status: 'APPLY', cancelStatus: null as string | null, createdAt: '2026-10-05 10:00:00', subscriptionEndsAt: '2026-12-01 23:59:59' }];
  const client = { getPost: vi.fn(async () => ({ seq: 100, category1: { seq: 5 }, memberLimit: 2, memberCount: members.length, status: 'ON_SALE', subscriptionEndsAt: '2026-12-01 23:59:59' })),
    listOttMembers: vi.fn(async () => members), sellerAccountSeq: async () => 99, openPrivateRoom: async (_p: number, user: number) => `room-${user}`, getChat: async () => ({ messages }) };
  const deps = { management: async () => fixtureManagement(), manualMembers: () => [] as any[], readStore: () => structuredClone(store), writeStore: (next: typeof store) => { store = structuredClone(next); },
    access: vi.fn(async (order: any) => `https://email-verify.one/dashboard/access/token-${order.key}`), refreshAccess: vi.fn(async () => {}) };
  const send = vi.fn(async (_r: string, _s: number, text: string) => { messages.push({ senderSeq: 99, messageType: 'TEXT', message: text }); });
  return { client, deps, send, get store() { return store; }, set members(value: typeof members) { members = value; }, get members() { return members; }, set messages(value: any[]) { messages = value; } };
}
describe('GButs OTT order delivery', () => {
  it('sends a separate private access link and confirms it without duplicate polling replies', async () => {
    const f = fixture(); const result = await syncGbutsOtt(f.deps, f.client as any, f.send); await syncGbutsOtt(f.deps, f.client as any, f.send);
    expect(result).toMatchObject({ attempted: 1, confirmed: 1 }); expect(f.send).toHaveBeenCalledTimes(1);
    expect(f.send.mock.calls[0]).toEqual(['room-10', 99, expect.stringContaining('token-100:1')]); expect(f.store.orders['100:1'].delivery).toBe('confirmed');
  });
  it('keeps unknown SEND outcomes attempted and never sends again', async () => {
    const f = fixture(); f.send.mockImplementation(async () => { throw new Error('socket disconnected'); });
    await syncGbutsOtt(f.deps, f.client as any, f.send); await syncGbutsOtt(f.deps, f.client as any, f.send);
    expect(f.send).toHaveBeenCalledTimes(1); expect(f.store.orders['100:1'].delivery).toBe('attempted');
  });
  it('keeps distinct orders separate even when buyer names are identical', async () => {
    const f = fixture(); f.members = [...f.members, { ...f.members[0], seq: 2, userSeq: 20 }];
    await syncGbutsOtt(f.deps, f.client as any, f.send); expect(f.send).toHaveBeenCalledTimes(2);
    expect(f.store.orders['100:1'].accessUrl).not.toBe(f.store.orders['100:2'].accessUrl);
    expect(f.store.orders['100:1'].profileName).not.toBe(f.store.orders['100:2'].profileName);
  });
  it('avoids the existing manual member profile when assigning a new buyer', async () => {
    const f = fixture(); const manualProfile = generateUniqueProfileNicknames(1, '', stableRandomFromSeed('100:1'), [])[0];
    f.deps.writeStore({ ...f.store, listings: { 'request-1': fixtureListing({ capacity: 1 }) } });
    f.client.getPost.mockResolvedValue({ seq: 100, category1: { seq: 5 }, memberLimit: 1, memberCount: 1, status: 'ON_SALE', subscriptionEndsAt: '2026-12-01 23:59:59' });
    f.deps.manualMembers = () => [{ serviceType: '넷플릭스', accountEmail: 'account@example.com', status: 'active', endDate: '2026-12-01', profileName: manualProfile }];
    await syncGbutsOtt(f.deps, f.client as any, f.send);
    expect(f.send).toHaveBeenCalledOnce(); expect(f.store.orders['100:1'].profileName).not.toBe(manualProfile);
  });
  it('refreshes cancellation status and sends nothing for refunded orders', async () => {
    const f = fixture(); f.members = [{ ...f.members[0], cancelStatus: 'REFUNDED' }];
    await syncGbutsOtt(f.deps, f.client as any, f.send); expect(f.send).not.toHaveBeenCalled(); expect(f.deps.access).not.toHaveBeenCalled();
    expect(f.deps.refreshAccess).toHaveBeenCalledWith([expect.objectContaining({ cancelStatus: 'REFUNDED' })]);
  });
  it('pauses new delivery when GrayTag inventory cannot be verified or is overbooked', async () => {
    const f = fixture(); f.deps.management = async () => { throw new Error('403'); };
    await expect(syncGbutsOtt(f.deps, f.client as any, f.send)).rejects.toThrow('403'); expect(f.send).not.toHaveBeenCalled();
    f.deps.management = async () => { const m = fixtureManagement(); m.onSaleByKeepAcct['account@example.com'].push({ ...m.onSaleByKeepAcct['account@example.com'][0], productUsid: 'extra' }); return m; };
    await syncGbutsOtt(f.deps, f.client as any, f.send); expect(f.send).not.toHaveBeenCalled();
  });
  it('does not expose a link if a paid member ID changes owner or listing settings change', async () => {
    const f = fixture(); f.deps.writeStore({ ...f.store, orders: { '100:1': fixtureOrder({ userSeq: 11 }) } });
    await expect(syncGbutsOtt(f.deps, f.client as any, f.send)).rejects.toThrow('구매자 연결'); expect(f.send).not.toHaveBeenCalled();
  });
  it('preserves the journal and sends nothing when a member roster is incomplete', async () => {
    const f = fixture(); f.members = []; f.client.getPost.mockResolvedValue({ seq: 100, category1: { seq: 5 }, memberLimit: 2, memberCount: 1, status: 'CLOSED', subscriptionEndsAt: '2026-12-01 23:59:59' });
    await expect(syncGbutsOtt(f.deps, f.client as any, f.send)).rejects.toThrow('모두 확인');
    expect(f.store.listings['request-1'].state).toBe('registered'); expect(f.send).not.toHaveBeenCalled();
  });
  it('does not re-send an uncertain message when an order disappears and reappears', async () => {
    const f = fixture(); f.send.mockImplementation(async () => { throw new Error('uncertain'); });
    await syncGbutsOtt(f.deps, f.client as any, f.send); const members = f.members; f.members = [];
    await syncGbutsOtt(f.deps, f.client as any, f.send); f.members = members; await syncGbutsOtt(f.deps, f.client as any, f.send);
    expect(f.send).toHaveBeenCalledTimes(1);
  });
});
