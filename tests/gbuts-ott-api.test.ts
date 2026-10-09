import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerGbutsOttRoutes, reserveGraytagOttPlace } from '../src/api/gbuts-ott';
import { readGbutsOttStore } from '../src/lib/gbuts-ott-store';
import { fixtureManagement } from './fixtures/gbuts-ott';
let directory = ''; const env = { ...process.env };
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-05T06:00:00Z'));
  directory = mkdtempSync(join(tmpdir(), 'gbuts-ott-'));
  process.env.GBUTS_OTT_STORE_PATH = join(directory, 'store.json'); process.env.GBUTS_SESSION_PATH = join(directory, 'session.json');
  process.env.GBUTS_API_TOKEN = 'test-token'; process.env.GBUTS_OTT_SYNC_ENABLED = 'true';
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); rmSync(directory, { recursive: true, force: true });
  for (const key of ['GBUTS_OTT_STORE_PATH', 'GBUTS_SESSION_PATH', 'GBUTS_API_TOKEN', 'GBUTS_OTT_SYNC_ENABLED']) {
    if (env[key] === undefined) delete process.env[key]; else process.env[key] = env[key];
  }
});
function fixture() {
  const posts: any[] = []; let closed = false; let members: any[] = []; let creationResponse: any = 100;
  const transport = vi.fn(async (url: any, options?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    let response: any;
    if (path === '/api/seller/subscribe/share/list') response = String(url).includes('page=1') ? posts : [];
    else if (path === '/api/subscribe/share' && options?.method === 'POST') {
      const body = JSON.parse(String(options.body)); posts.push({ ...body, seq: 100, category1: { seq: body.category }, title: JSON.stringify({ ko: body.title }), status: 'ON_SALE', memberCount: 0 }); response = creationResponse;
    } else if (path.endsWith('/closed')) { closed = true; response = true; }
    else if (path.endsWith('/member')) response = members;
    else if (path.endsWith('/view')) {
      const seq = Number(path.split('/').at(-2));
      response = { ...posts.find((post: any) => post.seq === seq), status: closed && seq === 100 ? 'CLOSED' : 'ON_SALE' };
    }
    else throw new Error(`unexpected ${path}`);
    return new Response(JSON.stringify({ success: true, error: null, response }), { headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', transport);
  const deps = { management: vi.fn(async () => fixtureManagement()), manualMembers: () => [], access: vi.fn(async () => 'validated'), refreshAccess: async () => {} };
  const app = new Hono(); registerGbutsOttRoutes(app, deps);
  const body = { requestId: 'request-123', serviceType: '넷플릭스', accountEmail: 'account@example.com', endDate: '2026-12-01', dailyPrice: 200, capacity: 1, title: '프리미엄', description: '본인 프로필을 이용해주세요.' };
  const publish = (patch = {}) => app.request('/gbuts/ott/listings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, ...patch }) });
  return { app, deps, transport, posts, body, publish, set members(value: any[]) { members = value; }, set creationResponse(value: any) { creationResponse = value; } };
}
describe('shared inventory publication', () => {
  it('loads the GButs service overview and orders without waiting for GrayTag inventory', async () => {
    const f = fixture();
    f.posts.push({ seq: 15557, category1: { seq: 20 }, memberLimit: 5, memberCount: 5, status: 'CLOSED', subscriptionEndsAt: '2027-10-01', price: 140, priceType: 'DAY' });
    f.deps.management.mockRejectedValue(new Error('GrayTag inventory unavailable'));
    const response = await f.app.request('/gbuts/sales/overview');
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.services.find((s: any) => s.serviceType === '스포티파이')).toMatchObject({ members: 5, recruiting: 0, invitationFlow: true });
    expect((await f.app.request('/gbuts/ott/orders')).status).toBe(200);
    expect(f.deps.management).not.toHaveBeenCalled();
    expect(f.transport.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
  });
  it('keeps the order journal visible when the live seller listing check is unavailable', async () => {
    const f = fixture(); f.transport.mockRejectedValue(new Error('seller offline'));
    const response = await f.app.request('/gbuts/ott/orders');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, unlinkedCheckError: expect.stringContaining('확인하지 못했습니다') });
  });
  it('uses display snapshots for browsing but requires fresh inventory for publication', async () => {
    const f = fixture();
    f.deps.management.mockResolvedValue({ ...fixtureManagement(), cache: { status: 'stale', updatedAt: '2026-10-05T05:00:00Z' } } as any);
    const response = await f.app.request('/gbuts/ott');
    expect(response.status).toBe(200);
    expect((await response.json()).inventory.status).toBe('stale');
    expect(f.deps.management).toHaveBeenLastCalledWith({ forceRefresh: false });
    f.deps.management.mockRejectedValueOnce(new Error('fresh inventory unavailable'));
    expect((await f.publish()).status).toBe(503);
    expect(f.deps.management).toHaveBeenLastCalledWith();
    expect(f.posts).toHaveLength(0);
    expect(f.transport.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
  });
  it('serializes concurrent registration against the last place and writes externally once', async () => {
    const f = fixture(); const replies = await Promise.all([f.publish({ capacity: 2 }), f.publish({ requestId: 'request-456', capacity: 1 })]);
    expect(replies.map(x => x.status)).toEqual([200, 409]); expect(f.posts).toHaveLength(1);
    expect(readGbutsOttStore().listings['request-123'].state).toBe('registered');
  });
  it('replays the same publication without another external POST and rejects a changed request', async () => {
    const f = fixture(); await f.publish(); expect((await f.publish()).status).toBe(200); expect(f.posts).toHaveLength(1);
    expect((await f.publish({ dailyPrice: 210 })).status).toBe(409);
  });
  it('retains unknown POST outcomes, capacity and request identity without retry', async () => {
    const f = fixture(); f.transport.mockImplementation(async (url, options) => {
      if (options?.method === 'POST') throw new Error('connection lost');
      return new Response(JSON.stringify({ success: true, response: [] }));
    });
    expect((await f.publish()).status).toBe(502); expect(readGbutsOttStore().listings['request-123'].state).toBe('uncertain');
    await f.publish(); expect(f.transport.mock.calls.filter(x => x[1]?.method === 'POST')).toHaveLength(1);
  });
  it('verifies a new listing by seller inventory when the successful create response has no ID', async () => {
    const f = fixture(); f.creationResponse = null; expect((await f.publish()).status).toBe(200);
    expect(readGbutsOttStore().listings['request-123'].postSeq).toBe(100);
  });
  it('does not publish without authoritative inventory or delivery credentials', async () => {
    const f = fixture(); f.deps.management.mockRejectedValue(new Error('inventory unavailable'));
    expect((await f.publish()).status).toBe(503); expect(f.posts).toHaveLength(0);
    f.deps.management.mockResolvedValue(fixtureManagement()); f.deps.access.mockRejectedValue(new Error('password missing'));
    expect((await f.publish()).status).toBe(503); expect(f.posts).toHaveLength(0);
  });
  it('refuses unlinked vendor listings rather than guessing their account', async () => {
    const f = fixture(); f.posts.push({ seq: 777, category1: { seq: 5 }, memberLimit: 2, memberCount: 0, status: 'ON_SALE', subscriptionEndsAt: '2026-12-01 23:59:59' });
    expect((await f.publish()).status).toBe(503); expect(f.posts).toHaveLength(1);
  });
  it('allows registration when an unlinked legacy listing is closed with no members', async () => {
    const f = fixture(); f.posts.push({ seq: 777, category1: { seq: 5 }, memberLimit: 2, memberCount: 0, status: 'CLOSED', subscriptionEndsAt: '2026-12-01 23:59:59' });
    const inventory = await (await f.app.request('/gbuts/ott')).json();
    expect(inventory.unlinked).toEqual([]);
    expect((await f.publish()).status).toBe(200);
  });
  it('continues to block an unlinked closed legacy listing while members remain', async () => {
    const f = fixture(); f.posts.push({ seq: 777, category1: { seq: 5 }, memberLimit: 2, memberCount: 1, status: 'CLOSED', subscriptionEndsAt: '2026-10-04 23:59:59' });
    const inventory = await (await f.app.request('/gbuts/ott')).json();
    expect(inventory.unlinked).toMatchObject([{ seq: 777, memberCount: 1, status: 'CLOSED' }]);
    expect((await f.publish()).status).toBe(503); expect(f.posts).toHaveLength(1);
  });
  it('binds a paid legacy post to an explicitly selected account so the delivery poller can deliver it', async () => {
    const f = fixture();
    f.posts.push({ seq: 777, category1: { seq: 5 }, memberLimit: 2, memberCount: 1, status: 'ON_SALE',
      subscriptionEndsAt: '2026-12-01 23:59:59', price: 199, priceType: 'DAY',
      title: JSON.stringify({ ko: '[넷플릭스] 기존 판매글' }), description: '이용 안내' });
    f.members = [{ seq: 71, userSeq: 107, productId: 'paid-71', nickname: '구매자', status: 'APPLY', cancelStatus: null,
      createdAt: '2026-10-05 10:00:00', subscriptionEndsAt: '2026-12-01 23:59:59' }];
    const response = await f.app.request('/gbuts/ott/listings/link', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ postSeq: 777, accountEmail: 'account@example.com' }) });
    expect(response.status).toBe(200);
    const linked = await response.json() as any;
    expect(linked).toMatchObject({ ok: true, listing: { postSeq: 777, serviceType: '넷플릭스', accountEmail: 'account@example.com', state: 'registered' } });
    expect(readGbutsOttStore().orders['777:71']).toMatchObject({ userSeq: 107, status: 'APPLY', delivery: 'ready' });
    expect(f.deps.access).toHaveBeenCalledOnce();
  });
  it('refuses to bind a legacy post when its reserved places would oversell the selected account', async () => {
    const f = fixture();
    f.posts.push({ seq: 778, category1: { seq: 5 }, memberLimit: 3, memberCount: 0, status: 'ON_SALE',
      subscriptionEndsAt: '2026-12-01 23:59:59', price: 199, priceType: 'DAY', title: '[넷플릭스] 기존 판매글', description: '이용 안내' });
    const response = await f.app.request('/gbuts/ott/listings/link', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ postSeq: 778, accountEmail: 'account@example.com' }) });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ ok: false, error: expect.stringContaining('재고가 부족') });
    expect(Object.values(readGbutsOttStore().listings)).toHaveLength(0);
  });
  it('reserves GrayTag publication before GButs publication and validates end date', async () => {
    const f = fixture(); await reserveGraytagOttPlace('넷플릭스', 'account@example.com', f.deps, '2026-12-01');
    expect((await f.publish({ capacity: 2 })).status).toBe(409);
    await expect(reserveGraytagOttPlace('넷플릭스', 'account@example.com', f.deps, '2027-01-01')).rejects.toThrow('이용 기간');
  });
  it('counts a last-minute purchase before closing releases unsold places', async () => {
    const f = fixture(); await f.publish({ capacity: 2 });
    f.members = [{ seq: 1, userSeq: 10, productId: 'PAID', nickname: '구매자', status: 'APPLY', cancelStatus: null, createdAt: '2026-10-05 15:00:00', subscriptionEndsAt: '2026-12-01 23:59:59' }];
    expect((await f.app.request('/gbuts/ott/listings/request-123/close', { method: 'POST' })).status).toBe(200);
    const store = readGbutsOttStore(); expect(store.listings['request-123'].state).toBe('closed'); expect(store.orders['100:1'].delivery).toBe('ready');
  });
  it('rejects malformed calendar dates before publishing or reserving places', async () => {
    const f = fixture(); expect((await f.publish({ endDate: '2026-99-99' })).status).toBe(400);
    expect(f.posts).toHaveLength(0); expect(Object.values(readGbutsOttStore().listings)).toHaveLength(0);
  });
  it('fails closed when durable capacity data is malformed', async () => {
    writeFileSync(process.env.GBUTS_OTT_STORE_PATH!, JSON.stringify({ version: 1, listings: { broken: { id: 'broken', capacity: -2 } }, orders: {}, graytagClaims: {} }));
    expect(() => readGbutsOttStore()).toThrow('재고 기록');
    writeFileSync(process.env.GBUTS_OTT_STORE_PATH!, JSON.stringify({ version: 1, listings: {}, orders: {}, graytagClaims: { claim: { id: 'different' } } }));
    expect(() => readGbutsOttStore()).toThrow('자리 확보 기록');
  });
});
