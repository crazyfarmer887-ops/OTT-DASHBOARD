import { Hono } from 'hono';
import { createHash, randomUUID } from 'node:crypto';
import { GBUTS_OTT_CATEGORIES, koreaToday, ottKey, ottDate, sharedOttAccounts, updateGbutsOttOrders, type GbutsOttListing, type GbutsOttStore } from '../lib/gbuts-ott';
import { createGbutsOttSellerClient, type GbutsOttPost } from '../lib/gbuts-ott-client';
import { loadGbutsSession } from '../lib/gbuts-session';
import { readGbutsOttStore, withGbutsOttInventory, writeGbutsOttStore } from '../lib/gbuts-ott-store';
import type { GbutsOttRuntimeDependencies } from '../scheduler/gbuts-ott-sync';
import { buildGbutsSalesOverview } from '../lib/gbuts-sales-overview';
export function gbutsOttClient() {
  const token = loadGbutsSession()?.token || process.env.GBUTS_API_TOKEN?.trim();
  if (!token) throw new Error('벗츠 판매자 계정을 먼저 연결해주세요.');
  return createGbutsOttSellerClient(token);
}
function assertBoundPosts(store: GbutsOttStore, posts: GbutsOttPost[]): void {
  const bound = new Set(Object.values(store.listings).map(x => x.postSeq));
  if (posts.some(x => Object.values(GBUTS_OTT_CATEGORIES).includes(x.category1.seq) && !bound.has(x.seq) && ottDate(x.subscriptionEndsAt) >= koreaToday()))
    throw new Error('기존 벗츠 판매글의 계정 연결을 먼저 확인해야 합니다.');
  for (const listing of Object.values(store.listings).filter(x => x.state === 'registered' || x.state === 'closed')) {
    const post = posts.find(x => x.seq === listing.postSeq);
    if (!post || post.memberLimit !== listing.capacity || ottDate(post.subscriptionEndsAt) !== listing.endDate
      || post.category1.seq !== GBUTS_OTT_CATEGORIES[listing.serviceType] || (listing.state === 'closed' && post.status === 'ON_SALE'))
      throw new Error('벗츠 판매글의 모집 인원·기간·상태가 바뀌어 공동 재고 확인이 필요합니다.');
  }
}
export function matchesGbutsOttListing(post: GbutsOttPost, listing: GbutsOttListing): boolean {
  let title = post.title;
  try { title = typeof title === 'string' ? JSON.parse(title).ko : title?.ko; } catch { /* plain title */ }
  return post.category1.seq === GBUTS_OTT_CATEGORIES[listing.serviceType] && post.memberLimit === listing.capacity
    && ottDate(post.subscriptionEndsAt) === listing.endDate && Number(post.price) === listing.dailyPrice
    && title === `[${listing.serviceType}] ${listing.title}`;
}
async function reconcileListing(listing: GbutsOttListing, client: ReturnType<typeof gbutsOttClient>): Promise<void> {
  const candidates = listing.postSeq ? [await client.getPost(listing.postSeq)]
    : (await client.listPosts()).filter(x => !listing.beforePostSeqs?.includes(x.seq) && matchesGbutsOttListing(x, listing));
  if (candidates.length !== 1 || !matchesGbutsOttListing(candidates[0], listing)) throw new Error('등록된 판매글을 하나로 확인하지 못했습니다.');
  if (!['ON_SALE', 'CLOSED', 'SUSPENDED', 'REFUNDED'].includes(candidates[0].status)) throw new Error('벗츠 판매글 상태 확인이 필요합니다.');
  listing.postSeq = candidates[0].seq; listing.state = candidates[0].status === 'ON_SALE' ? 'registered' : 'closed';
  listing.verifiedAt = new Date().toISOString(); delete listing.error;
}
export function registerGbutsOttRoutes(app: Hono, deps: GbutsOttRuntimeDependencies): void {
  app.get('/gbuts/sales/overview', async c => {
    try {
      const store = readGbutsOttStore();
      const posts = await gbutsOttClient().listPosts();
      return c.json({ ok: true, ...buildGbutsSalesOverview(posts, store), enabled: process.env.GBUTS_OTT_SYNC_ENABLED === 'true' });
    } catch (e) { return c.json({ ok: false, error: e instanceof Error ? e.message : '벗츠 판매 현황 조회 실패' }, 503); }
  });
  app.get('/gbuts/ott/orders', c => {
    try {
      const store = readGbutsOttStore();
      return c.json({ ok: true, enabled: process.env.GBUTS_OTT_SYNC_ENABLED === 'true', accounts: [], unlinked: [],
        listings: Object.values(store.listings), orders: Object.values(store.orders), lastSuccess: store.lastSuccess, lastError: store.lastError });
    } catch (e) { return c.json({ ok: false, error: e instanceof Error ? e.message : '벗츠 주문 기록 조회 실패' }, 503); }
  });
  app.get('/gbuts/ott', async c => {
    try {
      const store = readGbutsOttStore(); const [management, posts] = await Promise.all([deps.management({ forceRefresh: false }), gbutsOttClient().listPosts()]);
      const bound = new Set(Object.values(store.listings).map(x => x.postSeq));
      const unlinked = posts.filter(x => Object.values(GBUTS_OTT_CATEGORIES).includes(x.category1.seq) && !bound.has(x.seq) && ottDate(x.subscriptionEndsAt) >= koreaToday());
      return c.json({ ok: true, enabled: process.env.GBUTS_OTT_SYNC_ENABLED === 'true',
        accounts: sharedOttAccounts(management, deps.manualMembers(), store),
        listings: Object.values(store.listings), orders: Object.values(store.orders), unlinked: unlinked.map(x => ({ seq: x.seq })),
        lastSuccess: store.lastSuccess, lastError: store.lastError, inventory: management.cache || null });
    } catch (e) { return c.json({ ok: false, error: e instanceof Error ? e.message : '벗츠 연결 확인 실패' }, 503); }
  });
  app.post('/gbuts/ott/listings', async c => {
    const body = await c.req.json().catch(() => ({}));
    return withGbutsOttInventory(async () => {
      try {
        if (process.env.GBUTS_OTT_SYNC_ENABLED !== 'true') throw new Error('벗츠 판매 연결이 아직 켜져 있지 않습니다.');
        const serviceType = String(body.serviceType || ''); const accountEmail = String(body.accountEmail || '').trim();
        const endDate = String(body.endDate || ''); const capacity = Number(body.capacity); const dailyPrice = Number(body.dailyPrice);
        const id = String(body.requestId || ''); const title = String(body.title || `${serviceType} 프리미엄 · 계정 자동 안내`).trim();
        const description = String(body.description || '구매 후 1:1 채팅으로 계정 확인 링크를 안내드립니다. 본인에게 배정된 프로필만 이용해주세요.').trim();
        if (!GBUTS_OTT_CATEGORIES[serviceType] || !accountEmail || !/^[A-Za-z0-9_-]{8,100}$/.test(id)
          || !Number.isSafeInteger(capacity) || capacity < 1 || !Number.isSafeInteger(dailyPrice) || dailyPrice < 1 || dailyPrice > 100000
          || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || !Number.isFinite(Date.parse(endDate)) || new Date(endDate).toISOString().slice(0, 10) !== endDate
          || endDate <= koreaToday() || !title || title.length > 80 || !description || description.length > 5000)
          return c.json({ ok: false, error: '계정·기간·하루 요금·모집 인원을 확인해주세요.' }, 400);
        const requestHash = createHash('sha256').update(JSON.stringify([serviceType, accountEmail.toLowerCase(), endDate, capacity, dailyPrice, title, description])).digest('hex');
        const store = readGbutsOttStore(); const previous = store.listings[id];
        if (previous) return c.json({ ok: previous.state === 'registered', listing: previous,
          error: previous.requestHash !== requestHash ? '이미 사용한 등록 요청입니다.' : '기존 등록 결과를 확인해주세요.' }, previous.requestHash !== requestHash ? 409 : 200);
        const client = gbutsOttClient();
        const [management, posts] = await Promise.all([deps.management(), client.listPosts()]);
        assertBoundPosts(store, posts);
        const account = sharedOttAccounts(management, deps.manualMembers(), store).find(x => x.key === ottKey(serviceType, accountEmail));
        if (!account || account.available < capacity || account.endDate < endDate || account.overbooked)
          return c.json({ ok: false, error: '현재 남은 자리 또는 계정 이용 기간을 초과했습니다. 새로고침 후 확인해주세요.' }, 409);
        const rawAccount = management.services.flatMap(x => x.accounts).find(x => ottKey(x.serviceType, x.email) === account.key)!;
        // Resolve the exact delivery account before publishing a sellable listing.
        await deps.access({ key: `preview:${id}`, listingId: id, postSeq: 0, memberSeq: 0, userSeq: 0,
          name: '(미리보기)', status: 'PREVIEW', cancelStatus: null, startDate: koreaToday(), endDate,
          delivery: 'ready', verifiedAt: new Date().toISOString() },
          { id, serviceType, accountEmail: rawAccount.email } as GbutsOttListing, '미리보기');
        const listing: GbutsOttListing = { id, requestHash, serviceType, accountEmail: rawAccount.email, endDate, capacity, dailyPrice,
          title, description, state: 'submitting', createdAt: new Date().toISOString(), beforePostSeqs: posts.map(x => x.seq) };
        store.listings[id] = listing; writeGbutsOttStore(store);
        try {
          listing.postSeq = (await client.createPost(listing)) || undefined;
          listing.state = 'uncertain'; writeGbutsOttStore(store);
          await reconcileListing(listing, client); writeGbutsOttStore(store);
          return c.json({ ok: true, listing, url: `https://gbuts.com/subscriptions/${listing.postSeq}` });
        } catch (e) {
          listing.state = 'uncertain'; listing.error = e instanceof Error ? e.message : '등록 결과 확인 필요'; writeGbutsOttStore(store);
          return c.json({ ok: false, listing, error: '등록 결과를 확인해야 합니다. 자리는 보존되며 같은 요청을 자동 재등록하지 않습니다.' }, 502);
        }
      } catch (e) { return c.json({ ok: false, error: e instanceof Error ? e.message : '판매글 등록 실패' }, 503); }
    });
  });
  app.post('/gbuts/ott/listings/:id/reconcile', c => withGbutsOttInventory(async () => {
    try {
      const store = readGbutsOttStore(); const listing = store.listings[c.req.param('id')];
      if (!listing || !['submitting', 'uncertain'].includes(listing.state)) throw new Error('확인할 등록 요청이 없습니다.');
      await reconcileListing(listing, gbutsOttClient()); writeGbutsOttStore(store); return c.json({ ok: true, listing });
    } catch (e) { return c.json({ ok: false, error: e instanceof Error ? e.message : '판매글 확인 실패' }, 409); }
  }));
  app.post('/gbuts/ott/listings/:id/close', c => withGbutsOttInventory(async () => {
    try {
      const store = readGbutsOttStore(); const listing = store.listings[c.req.param('id')];
      if (!listing?.postSeq || !['registered', 'closed'].includes(listing.state)) throw new Error('등록 결과 확인 후 모집을 종료해주세요.');
      const client = gbutsOttClient(); await client.closePost(listing.postSeq);
      const post = await client.getPost(listing.postSeq);
      if (post.status !== 'CLOSED') throw new Error('벗츠 모집 종료 확인 중입니다.');
      // A buyer can pay while the close request is in flight. Read the final member
      // roster before freeing unpublished capacity for another marketplace.
      const members = await client.listOttMembers(listing.postSeq);
      if (members.length < post.memberCount) throw new Error('벗츠 구매자 목록을 모두 확인하지 못해 자리를 유지합니다.');
      updateGbutsOttOrders(store, listing, members, new Date().toISOString());
      listing.state = 'closed'; listing.verifiedAt = new Date().toISOString(); writeGbutsOttStore(store);
      return c.json({ ok: true, listing });
    } catch (e) { return c.json({ ok: false, error: e instanceof Error ? e.message : '모집 종료 실패' }, 502); }
  }));
}
export async function reserveGraytagOttPlace(serviceType: string, accountEmail: string, deps: GbutsOttRuntimeDependencies, endDate?: string): Promise<string> {
  return withGbutsOttInventory(async () => {
    const store = readGbutsOttStore();
    if (Object.keys(store.listings).length) assertBoundPosts(store, await gbutsOttClient().listPosts());
    const management = await deps.management();
    const account = sharedOttAccounts(management, deps.manualMembers(), store).find(x => x.key === ottKey(serviceType, accountEmail));
    if (!account || account.available < 1 || account.overbooked || (endDate && (endDate > account.endDate || endDate <= koreaToday()))) throw new Error('공동 재고의 남은 자리와 이용 기간을 확인해주세요.');
    const id = randomUUID(); store.graytagClaims[id] = { id, serviceType, accountEmail, state: 'pending', createdAt: new Date().toISOString() };
    writeGbutsOttStore(store); return id;
  });
}
export async function settleGraytagOttPlace(id: string, result: { productUsid?: string; failed?: boolean }) {
  return withGbutsOttInventory(async () => { const store = readGbutsOttStore(); const claim = store.graytagClaims[id]; if (!claim) return;
    if (result.failed) delete store.graytagClaims[id];
    else { claim.productUsid = result.productUsid; claim.state = result.productUsid ? 'registered' : 'uncertain'; }
    writeGbutsOttStore(store);
  });
}
