import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildGbutsNetflixDeliveryText, buildGbutsNetflixLegacyDeliveryText } from '../src/lib/gbuts-ott-templates';
import { emptyGbutsOttStore } from '../src/lib/gbuts-ott';
import { GbutsChatDeliveryError, splitGbutsChatText } from '../src/lib/gbuts-chat-delivery';
import { syncGbutsOtt } from '../src/scheduler/gbuts-ott-sync';
import { fixtureListing, fixtureManagement, fixtureOrder } from './fixtures/gbuts-ott';
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-05T06:00:00Z')); }); afterEach(() => vi.useRealTimers());
function fixture() {
  let store = emptyGbutsOttStore(); store.listings['request-1'] = fixtureListing(); let messages: any[] = [];
  let members = [{ seq: 1, userSeq: 10, productId: 'BUY1', nickname: '구매자', status: 'APPLY', cancelStatus: null as string | null, createdAt: '2026-10-05 10:00:00', subscriptionEndsAt: '2026-12-01 23:59:59' }];
  const client = { getPost: vi.fn(async () => ({ seq: 100, category1: { seq: 5 }, memberLimit: 2, memberCount: members.length, status: 'ON_SALE', subscriptionEndsAt: '2026-12-01 23:59:59' })),
    listOttMembers: vi.fn(async () => members), sellerAccountSeq: async () => 99, openPrivateRoom: async (_p: number, user: number) => `room-${user}`, getChat: async () => ({ messages }) };
  const deps = { management: async () => fixtureManagement(), manualMembers: () => [] as any[], readStore: () => structuredClone(store), writeStore: (next: typeof store) => { store = structuredClone(next); },
    access: vi.fn(async (order: any) => `https://email-verify.one/dashboard/access/token-${order.key}`), refreshAccess: vi.fn(async () => {}), credentials: vi.fn(async () => ({ id: 'current@example.com', password: 'latest-private-password' })) };
  const send = vi.fn(async (_r: string, _s: number, text: string) => { messages.push({ senderSeq: 99, messageType: 'TEXT', message: text, createdAt: '2026-10-05T06:00:00Z' }); });
  return { client, deps, send, get store() { return store; }, set members(value: typeof members) { members = value; }, get members() { return members; }, set messages(value: any[]) { messages = value; } };
}
describe('GButs OTT order delivery', () => {
  it('checks an empty seller roster without loading unrelated GrayTag inventory', async () => {
    const f = fixture(); f.members = []; f.client.getPost.mockResolvedValue({ seq: 100, category1: { seq: 5 }, memberLimit: 2, memberCount: 0, status: 'CLOSED', subscriptionEndsAt: '2026-12-01 23:59:59' });
    f.deps.management = vi.fn(async () => { throw new Error('unnecessary inventory read'); });
    await expect(syncGbutsOtt(f.deps, f.client as any, f.send)).resolves.toMatchObject({ orders: 0, attempted: 0 });
    expect(f.deps.management).not.toHaveBeenCalled(); expect(f.store.lastError).toBeNull(); expect(f.store.lastSuccess).toBeTruthy();
  });
  it('sends a separate private access link and confirms it without duplicate polling replies', async () => {
    const f = fixture(); const result = await syncGbutsOtt(f.deps, f.client as any, f.send); await syncGbutsOtt(f.deps, f.client as any, f.send);
    expect(result).toMatchObject({ attempted: 1, confirmed: 1 }); expect(f.send).toHaveBeenCalledTimes(1);
    expect(f.send.mock.calls[0]).toEqual(['room-10', 99, expect.stringContaining('token-100:1')]); expect(f.store.orders['100:1'].delivery).toBe('confirmed');
    expect(f.store.orders['100:1'].profileNumber).toBe(4);
    expect(f.send.mock.calls[0][2]).toContain('4번');
    expect(f.send.mock.calls[0][2]).toContain('이름·PIN 변경');
    expect(f.send.mock.calls[0][2]).not.toContain('private-password');
  });
  it('offers direct delivery and answers a buyer bang once with current credentials', async () => {
    const f = fixture(); await syncGbutsOtt(f.deps, f.client as any, f.send);
    expect(f.send.mock.calls[0][2]).toContain('"!"라고 남겨주시면 직접 전송해드립니다.');
    f.messages = [{ senderSeq: 10, messageType: 'TEXT', message: ' ! ', createdAt: '2026-10-05T05:59:00Z' }];
    await syncGbutsOtt(f.deps, f.client as any, f.send);
    await syncGbutsOtt(f.deps, f.client as any, f.send);
    expect(f.send).toHaveBeenCalledTimes(2);
    expect(f.send.mock.calls[1]).toEqual(['room-10', 99, 'ID : current@example.com\nPW : latest-private-password']);
    expect(f.store.orders['100:1'].directDelivery?.state).toBe('confirmed');
    expect(JSON.stringify(f.store)).not.toContain('latest-private-password');
  });
  it('ignores seller/other-user bangs and sentences containing punctuation', async () => {
    const f = fixture(); await syncGbutsOtt(f.deps, f.client as any, f.send);
    f.messages = [99, 20, 10].map(senderSeq => ({ senderSeq, messageType: 'TEXT', message: senderSeq === 10 ? '감사합니다!' : '!', createdAt: '2026-10-05T05:59:00Z' }));
    await syncGbutsOtt(f.deps, f.client as any, f.send);
    expect(f.send).toHaveBeenCalledOnce(); expect(f.deps.credentials).not.toHaveBeenCalled();
  });
  it('does not disclose direct credentials for a refunded buyer', async () => {
    const f = fixture(); await syncGbutsOtt(f.deps, f.client as any, f.send);
    f.messages = [{ senderSeq: 10, messageType: 'TEXT', message: '!', createdAt: '2026-10-05T05:59:00Z' }];
    f.members = [{ ...f.members[0], cancelStatus: 'REFUNDED' }];
    await syncGbutsOtt(f.deps, f.client as any, f.send);
    expect(f.send).toHaveBeenCalledOnce(); expect(f.deps.credentials).not.toHaveBeenCalled();
  });
  it('reconciles an uncertain direct send after restart without repeating the secret', async () => {
    const f = fixture(); await syncGbutsOtt(f.deps, f.client as any, f.send);
    const request = { senderSeq: 10, messageType: 'TEXT', message: '!', createdAt: '2026-10-05T05:59:00Z' };
    f.messages = [request]; f.send.mockImplementationOnce(async () => { throw new Error('uncertain'); });
    await syncGbutsOtt(f.deps, f.client as any, f.send);
    expect(f.store.orders['100:1'].directDelivery?.state).toBe('attempted');
    await syncGbutsOtt(f.deps, f.client as any, f.send);
    expect(f.send).toHaveBeenCalledTimes(2);
    f.messages = [request, { senderSeq: 99, messageType: 'TEXT', message: 'ID : current@example.com\nPW : latest-private-password', createdAt: '2026-10-05T06:00:00Z' }];
    await syncGbutsOtt(f.deps, f.client as any, f.send);
    expect(f.store.orders['100:1'].directDelivery?.state).toBe('confirmed'); expect(f.send).toHaveBeenCalledTimes(2);
  });
  it('retries only a definite pre-send failure and reads updated credentials for a later request', async () => {
    const f = fixture(); await syncGbutsOtt(f.deps, f.client as any, f.send);
    f.messages = [{ senderSeq: 10, messageType: 'TEXT', message: '!', createdAt: '2026-10-05 14:59:00' }];
    f.send.mockImplementationOnce(async () => { throw new GbutsChatDeliveryError('offline', false); });
    await syncGbutsOtt(f.deps, f.client as any, f.send);
    expect(f.store.orders['100:1'].directDelivery?.state).toBe('ready');
    await syncGbutsOtt(f.deps, f.client as any, f.send);
    expect(f.store.orders['100:1'].directDelivery?.state).toBe('confirmed');
    vi.setSystemTime(new Date('2026-10-05T06:01:00Z'));
    f.messages = [{ senderSeq: 10, messageType: 'TEXT', message: '!', createdAt: '2026-10-05T06:00:30Z' }];
    f.deps.credentials.mockResolvedValue({ id: 'changed@example.com', password: 'new-password' });
    await syncGbutsOtt(f.deps, f.client as any, f.send);
    expect(f.send.mock.calls.at(-1)?.[2]).toBe('ID : changed@example.com\nPW : new-password');
  });
  it('does not disclose credentials for ended or unverifiable orders', async () => {
    const f = fixture(); await syncGbutsOtt(f.deps, f.client as any, f.send);
    f.messages = [{ senderSeq: 10, messageType: 'TEXT', message: '!', createdAt: '2026-10-05T05:59:00Z' }];
    f.members = [{ ...f.members[0], subscriptionEndsAt: '2026-10-04 23:59:59', createdAt: '2026-10-01 10:00:00' }];
    await syncGbutsOtt(f.deps, f.client as any, f.send);
    expect(f.deps.credentials).not.toHaveBeenCalled(); expect(f.send).toHaveBeenCalledOnce();
  });
  it('pauses direct credentials when the resolver cannot validate the account without logging provider secrets', async () => {
    const f = fixture(); await syncGbutsOtt(f.deps, f.client as any, f.send);
    f.messages = [{ senderSeq: 10, messageType: 'TEXT', message: '!', createdAt: '2026-10-05T05:59:00Z' }];
    f.deps.credentials.mockRejectedValue(new Error('sensitive-provider-response'));
    await syncGbutsOtt(f.deps, f.client as any, f.send);
    expect(f.send).toHaveBeenCalledOnce(); expect(JSON.stringify(f.store)).not.toContain('sensitive-provider-response');
    expect(f.store.orders['100:1'].error).toContain('직접 계정 전달');
  });
  it('keeps unknown SEND outcomes attempted and never sends again', async () => {
    const f = fixture(); f.send.mockImplementation(async () => { throw new Error('socket disconnected'); });
    await syncGbutsOtt(f.deps, f.client as any, f.send); await syncGbutsOtt(f.deps, f.client as any, f.send);
    expect(f.send).toHaveBeenCalledTimes(1); expect(f.store.orders['100:1'].delivery).toBe('attempted');
  });
  it('confirms an existing split delivery even while fresh GrayTag inventory is unavailable', async () => {
    const f = fixture(); f.send.mockImplementation(async () => { throw new Error('uncertain'); });
    await syncGbutsOtt(f.deps, f.client as any, f.send);
    const text = f.send.mock.calls[0][2];
    f.messages = splitGbutsChatText(text).map(message => ({ senderSeq: 99, messageType: 'TEXT', message }));
    f.deps.management = vi.fn(async () => { throw new Error('403'); });
    await expect(syncGbutsOtt(f.deps, f.client as any, f.send)).resolves.toMatchObject({ confirmed: 1 });
    expect(f.store.orders['100:1'].delivery).toBe('confirmed');
    expect(f.deps.management).not.toHaveBeenCalled(); expect(f.send).toHaveBeenCalledTimes(1);
  });
  it('retries a definite pre-SEND connection failure, while uncertain sends remain protected', async () => {
    const f = fixture(); const send = f.send.getMockImplementation()!;
    f.send.mockImplementationOnce(async () => { throw new GbutsChatDeliveryError('connection refused', false); }).mockImplementation(send);
    await syncGbutsOtt(f.deps, f.client as any, f.send);
    expect(f.store.orders['100:1'].attemptedAt).toBeUndefined();
    await syncGbutsOtt(f.deps, f.client as any, f.send);
    expect(f.send).toHaveBeenCalledTimes(2); expect(f.store.orders['100:1'].delivery).toBe('confirmed');
  });
  it('does not confirm incomplete chunks or buyer copies during a GrayTag outage', async () => {
    const f = fixture(); f.send.mockImplementation(async () => { throw new Error('uncertain'); });
    await syncGbutsOtt(f.deps, f.client as any, f.send);
    const parts = splitGbutsChatText(f.send.mock.calls[0][2]);
    f.messages = parts.map((message, i) => ({ senderSeq: i === 0 ? 10 : 99, messageType: 'TEXT', message }));
    f.deps.management = vi.fn(async () => { throw new Error('403'); });
    await syncGbutsOtt(f.deps, f.client as any, f.send);
    expect(f.store.orders['100:1'].delivery).toBe('attempted'); expect(f.send).toHaveBeenCalledTimes(1);
    expect(f.store.orders['100:1'].error).toContain('확인');
  });
  it('reconciles legacy attempted guides after the new compact template is enabled', async () => {
    const f = fixture(); const url = 'https://email-verify.one/dashboard/access/legacy';
    f.deps.writeStore({ ...f.store, orders: { '100:1': fixtureOrder({ delivery: 'attempted', attemptedAt: '2026-10-05T05:00:00Z',
      profileNumber: 4, profileName: '4', accessUrl: url, roomId: 'room-10' }) } });
    f.messages = splitGbutsChatText(buildGbutsNetflixLegacyDeliveryText(url, 4)).map(message => ({ senderSeq: 99, messageType: 'TEXT', message }));
    f.deps.management = vi.fn(async () => { throw new Error('403'); });
    await syncGbutsOtt(f.deps, f.client as any, f.send);
    expect(f.store.orders['100:1'].delivery).toBe('confirmed'); expect(f.send).not.toHaveBeenCalled();
  });
  it('confirms an operationally recovered short guide without re-sending the failed pinned guide', async () => {
    const f = fixture(); const url = 'https://email-verify.one/dashboard/access/recovered';
    f.deps.writeStore({ ...f.store, orders: { '100:1': fixtureOrder({ delivery: 'attempted', attemptedAt: '2026-10-05T05:00:00Z',
      deliveryMessage: 'previous failed guide', profileNumber: 4, profileName: '4', accessUrl: url, roomId: 'room-10' }) } });
    const recovered = `구매 감사합니다! 넷플릭스 4번 프로필을 이용해 주세요.
${url}
동의 후 ID·비밀번호·이메일 PIN, 가구 인증·로그인 코드를 확인하세요.
프로필 생성·삭제/이름·PIN 변경, 계정 이메일·비밀번호·결제 설정 변경 금지.
여러 기기 동시 시청 금지.`;
    f.messages = [{ senderSeq: 99, messageType: 'TEXT', message: recovered }];
    f.deps.management = vi.fn(async () => { throw new Error('403'); });
    await syncGbutsOtt(f.deps, f.client as any, f.send);
    expect(f.store.orders['100:1'].delivery).toBe('confirmed');
    expect(f.store.orders['100:1'].deliveryMessage).toBe(recovered);
    expect(f.send).not.toHaveBeenCalled(); expect(f.deps.management).not.toHaveBeenCalled();
  });
  it('uses the real default structured-message transport for a newly paid Netflix buyer', async () => {
    const f = fixture(); const frames: string[] = []; const saved: any[] = [];
    class Socket {
      onopen?: () => void; onmessage?: (event: { data: string }) => void; onerror?: () => void; onclose?: () => void;
      constructor() { queueMicrotask(() => this.onopen?.()); }
      send(frame: string) {
        if (frame.startsWith('CONNECT\n')) queueMicrotask(() => this.onmessage?.({ data: 'CONNECTED\n\n\0' }));
        if (!frame.startsWith('SEND\n')) return;
        frames.push(frame); const payload = JSON.parse(frame.split('\n\n')[1].replace(/\0$/, ''));
        saved.push({ senderSeq: payload.accountSeq, messageType: 'TEXT', message: payload.payload }); f.messages = [...saved];
        queueMicrotask(() => this.onmessage?.({ data: `MESSAGE\ndestination:/sub/chat/room/room-10\n\n${JSON.stringify({ id: 1, ...payload })}\0` }));
      }
      close() {}
    }
    vi.stubGlobal('WebSocket', Socket);
    try {
      await syncGbutsOtt(f.deps, f.client as any);
      await syncGbutsOtt(f.deps, f.client as any);
      expect(frames).toHaveLength(4); expect(frames.every(frame => Buffer.byteLength(frame) <= 1000)).toBe(true);
      expect(saved[1].message).toBe('접근 링크: https://email-verify.one/dashboard/access/token-100:1');
      expect(f.store.orders['100:1'].delivery).toBe('confirmed');
      expect(f.store.orders['100:1'].deliveryMessage).toContain('token-100:1');
    } finally { vi.unstubAllGlobals(); }
  });
  it('does not repeat permanent preflight failures or label them connection errors', async () => {
    const f = fixture();
    f.send.mockImplementation(async () => { throw new GbutsChatDeliveryError('단일 안내문 크기 초과', false, false); });
    await syncGbutsOtt(f.deps, f.client as any, f.send);
    await syncGbutsOtt(f.deps, f.client as any, f.send);
    expect(f.send).toHaveBeenCalledOnce(); expect(f.store.orders['100:1'].delivery).toBe('blocked');
    expect(f.store.orders['100:1'].error).toBe('단일 안내문 크기 초과');
    expect(f.store.orders['100:1'].attemptedAt).toBeUndefined();
  });
  it('resumes a never-sent buyer when a temporarily missing roster entry returns', async () => {
    const f = fixture(); const saved = f.members;
    f.deps.writeStore({ ...f.store, orders: { '100:1': fixtureOrder() } });
    f.members = []; await syncGbutsOtt(f.deps, f.client as any, f.send);
    f.members = saved; await syncGbutsOtt(f.deps, f.client as any, f.send);
    expect(f.send).toHaveBeenCalledOnce(); expect(f.store.orders['100:1'].delivery).toBe('confirmed');
  });
  it('keeps distinct orders separate even when buyer names are identical', async () => {
    const f = fixture(); f.members = [...f.members, { ...f.members[0], seq: 2, userSeq: 20 }];
    await syncGbutsOtt(f.deps, f.client as any, f.send); expect(f.send).toHaveBeenCalledTimes(2);
    expect(f.store.orders['100:1'].accessUrl).not.toBe(f.store.orders['100:2'].accessUrl);
    expect(f.store.orders['100:1'].profileName).not.toBe(f.store.orders['100:2'].profileName);
  });
  it('avoids the existing manual member profile when assigning a new buyer', async () => {
    const f = fixture(); const manualProfile = '4';
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
    expect(f.store.orders['100:1'].error).toContain('중복 배정');
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
