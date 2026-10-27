import {futureSubscriptionRankApplies,readSubscriptionRankDefaults,writeSubscriptionRankDefaults} from '../lib/gbuts-rank-defaults';
import {bindSubscriptionRenewal} from '../scheduler/gbuts-youtube-renewal';
import {subscriptionManagedRenewalViews} from '../scheduler/gbuts-rank-adoption';
import { readAaryanTelegramConfig } from '../lib/aaryan-telegram';
import { applyGbutsDisneySaleTerms, renewDueGbutsOttListings, DISNEY_RENEWAL_INTERVAL } from '../scheduler/gbuts-ott-renewal';
import { loadSafeModeConfig } from './safe-mode';
import { makeGbutsOttDescription, GBUTS_NETFLIX_CODE_DESCRIPTION } from '../lib/gbuts-ott-templates';
import { Hono } from 'hono';
import { createHash, randomUUID } from 'node:crypto';
import { GBUTS_OTT_CATEGORIES, gbutsOttRenewalKey, supportsGbutsOttRenewal, enableNewNetflixRenewal, activeOttOrder, holdsDisneyProfile, koreaToday, ottKey, ottDate, sharedOttAccounts, updateGbutsOttOrders, type GbutsOttListing, type GbutsOttManagement, type GbutsOttStore } from '../lib/gbuts-ott';
import { createGbutsOttSellerClient, type GbutsOttPost } from '../lib/gbuts-ott-client';
import { loadGbutsSession } from '../lib/gbuts-session';
import { readGbutsOttStore, withGbutsOttInventory, writeGbutsOttStore } from '../lib/gbuts-ott-store';
import type { GbutsOttRuntimeDependencies } from '../scheduler/gbuts-ott-sync';
import { buildGbutsSalesOverview } from '../lib/gbuts-sales-overview';
import { availableNetflixProfiles } from '../lib/gbuts-netflix-profiles';
import { deletedSpotifyPostSeqs } from '../lib/gbuts-spotify-listings';
export function gbutsOttClient() {
  const token = loadGbutsSession()?.token || process.env.GBUTS_API_TOKEN?.trim();
  if (!token) throw new Error('벗츠 판매자 계정을 먼저 연결해주세요.');
  return createGbutsOttSellerClient(token);
}
function needsOttAccountBinding(post: GbutsOttPost, boundPostSeqs: ReadonlySet<number | undefined>): boolean {
  return Object.values(GBUTS_OTT_CATEGORIES).includes(post.category1.seq) && !boundPostSeqs.has(post.seq)
    && (post.status === 'ON_SALE' || post.memberCount > 0);
}
function assertBoundPosts(store: GbutsOttStore, posts: GbutsOttPost[]): void {
  const bound = new Set(Object.values(store.listings).map(x => x.postSeq));
  if (posts.some(x => needsOttAccountBinding(x, bound)))
    throw new Error('기존 벗츠 판매글의 계정 연결을 먼저 확인해야 합니다.');
  for (const listing of Object.values(store.listings).filter(x => x.state === 'registered' || x.state === 'closed')) {
    const post = posts.find(x => x.seq === listing.postSeq);
    if (!post || post.memberLimit !== listing.capacity || ottDate(post.subscriptionEndsAt) !== listing.endDate
      || post.category1.seq !== GBUTS_OTT_CATEGORIES[listing.serviceType] || (listing.state === 'closed' && post.status === 'ON_SALE'))
      throw new Error('벗츠 판매글의 모집 인원·기간·상태가 바뀌어 공동 재고 확인이 필요합니다.');
  }
}
async function publicationManagement(deps: GbutsOttRuntimeDependencies): Promise<GbutsOttManagement> {
  const snapshot = await deps.management({ forceRefresh: false });
  const verifiedAt = Date.parse(String(snapshot.cache?.updatedAt || ''));
  const age = Date.now() - verifiedAt;
  // A complete provider snapshot was already verified for the form. Local sales
  // remain serialized below; older or unverified snapshots require a fresh read.
  if (Number.isFinite(verifiedAt) && age >= 0 && age <= 60_000) return snapshot;
  return deps.management();
}
function gbutsPostTitle(post: GbutsOttPost): string {
  let title = post.title;
  try { title = typeof title === 'string' ? JSON.parse(title).ko : title?.ko; } catch { /* plain title */ }
  return String(title || '').trim();
}
function legacyPostTitle(post: GbutsOttPost, serviceType: string): string {
  const normalized = gbutsPostTitle(post);
  return normalized.startsWith(`[${serviceType}] `) ? normalized.slice(serviceType.length + 3).trim() : normalized || '기존 벗츠 판매글';
}
function legacyPostDescription(post: GbutsOttPost): string {
  const value = post.description;
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') return String(value.ko || value.kr || Object.values(value)[0] || '');
  return '';
}
export function matchesGbutsOttListing(post: GbutsOttPost, listing: GbutsOttListing): boolean {
  return post.category1.seq === GBUTS_OTT_CATEGORIES[listing.serviceType] && post.memberLimit === listing.capacity
    && ottDate(post.subscriptionEndsAt) === listing.endDate && Number(post.price) === listing.dailyPrice
    && gbutsPostTitle(post) === `[${listing.serviceType}] ${listing.title}`;
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
  const registrationJobs = new Map<string, { fingerprint: string; promise: Promise<Response>; response?: Response }>();
  app.get('/gbuts/sales/overview', async c => {
    try {
      const store = readGbutsOttStore();
      const posts = await gbutsOttClient().listPosts();
      const deleted = new Set(deletedSpotifyPostSeqs());
      return c.json({ ok: true, ...buildGbutsSalesOverview(posts.filter(post => !deleted.has(post.seq)), store), enabled: process.env.GBUTS_OTT_SYNC_ENABLED === 'true' });
    } catch (e) { return c.json({ ok: false, error: e instanceof Error ? e.message : '벗츠 판매 현황 조회 실패' }, 503); }
  });
  app.get('/gbuts/ott/orders', async c => {
    try {
      const store = readGbutsOttStore(); let unlinked: Array<{ seq: number; serviceType: string; status: string; memberCount: number; memberLimit: number; endDate: string }> = [];
      let unlinkedCheckError: string | null = null;
      try {
        const posts = await gbutsOttClient().listPosts();
        const bound = new Set(Object.values(store.listings).map(x => x.postSeq));
        unlinked = posts.filter(x => needsOttAccountBinding(x, bound)).map(x => ({
          seq: x.seq, serviceType: Object.entries(GBUTS_OTT_CATEGORIES).find(([, category]) => category === x.category1.seq)?.[0] || '',
          status: x.status, memberCount: x.memberCount, memberLimit: x.memberLimit, endDate: ottDate(x.subscriptionEndsAt),
        }));
      } catch { unlinkedCheckError = '벗츠 판매글 연결 상태를 확인하지 못했습니다. 기존 주문은 표시하지만 미연결 글 자동 감시 상태는 확인이 필요합니다.'; }
      return c.json({ ok: true, enabled: process.env.GBUTS_OTT_SYNC_ENABLED === 'true', accounts: [], unlinked,
        unlinkedCheckError, listings: Object.values(store.listings), orders: Object.values(store.orders), renewals: [...Object.values(store.renewals || {}),...subscriptionManagedRenewalViews(store)], lastSuccess: store.lastSuccess, lastError: store.lastError });
    } catch (e) { return c.json({ ok: false, error: e instanceof Error ? e.message : '벗츠 주문 기록 조회 실패' }, 503); }
  });
  app.get('/gbuts/ott', async c => {
    try {
      const store = readGbutsOttStore(); const [management, posts] = await Promise.all([deps.management({ forceRefresh: false }), gbutsOttClient().listPosts()]);
      const bound = new Set(Object.values(store.listings).map(x => x.postSeq));
      const unlinked = posts.filter(x => needsOttAccountBinding(x, bound));
      return c.json({ ok: true, enabled: process.env.GBUTS_OTT_SYNC_ENABLED === 'true',
        accounts: sharedOttAccounts(management, deps.manualMembers(), store),
        listings: Object.values(store.listings), orders: Object.values(store.orders), unlinked: unlinked.map(x => ({
          seq: x.seq, serviceType: Object.entries(GBUTS_OTT_CATEGORIES).find(([, category]) => category === x.category1.seq)?.[0] || '',
          status: x.status, memberCount: x.memberCount, memberLimit: x.memberLimit,
          endDate: ottDate(x.subscriptionEndsAt),
        })),
        lastSuccess: store.lastSuccess, lastError: store.lastError, inventory: management.cache || null });
    } catch (e) { return c.json({ ok: false, error: e instanceof Error ? e.message : '벗츠 연결 확인 실패' }, 503); }
  });
  app.post('/gbuts/ott/listings/link', c => withGbutsOttInventory(async () => {
    try {
      if (process.env.GBUTS_OTT_SYNC_ENABLED !== 'true') throw new Error('벗츠 자동 전달 연결이 꺼져 있습니다.');
      const body = await c.req.json().catch(() => ({})) as any;
      const postSeq = Number(body.postSeq); const accountEmail = String(body.accountEmail || '').trim();
      if (!Number.isSafeInteger(postSeq) || postSeq < 1 || !accountEmail) throw new Error('판매글과 연결할 계정을 선택해주세요.');
      const store = readGbutsOttStore();
      const existing = Object.values(store.listings).find(x => x.postSeq === postSeq);
      if (existing) {
        if (ottKey(existing.serviceType, existing.accountEmail) !== ottKey(String(body.serviceType || existing.serviceType), accountEmail))
          throw new Error('이 판매글은 이미 다른 계정에 연결되어 있습니다.');
        return c.json({ ok: true, listing: existing, alreadyLinked: true });
      }
      const client = gbutsOttClient(); const post = await client.getPost(postSeq);
      const serviceType = Object.entries(GBUTS_OTT_CATEGORIES).find(([, category]) => category === post.category1.seq)?.[0];
      if (!serviceType) throw new Error('지원하지 않는 서비스 판매글입니다.');
      if (!['ON_SALE', 'CLOSED', 'SUSPENDED', 'REFUNDED'].includes(post.status)) throw new Error('현재 상태의 판매글은 연결할 수 없습니다.');
      if (post.priceType !== 'DAY' || !Number.isSafeInteger(Number(post.price)) || Number(post.price) < 1)
        throw new Error('하루 요금으로 등록된 판매글만 연결할 수 있습니다.');
      const members = await client.listOttMembers(postSeq);
      if (members.length < post.memberCount) throw new Error('벗츠 구매자 목록을 모두 확인하지 못했습니다.');
      const management = await deps.management(); const manualMembers = deps.manualMembers();
      const account = sharedOttAccounts(management, manualMembers, store).find(x => x.key === ottKey(serviceType, accountEmail));
      if (!account || !account.eligible || account.endDate < ottDate(post.subscriptionEndsAt)) throw new Error('선택한 계정의 서비스·결제 기간을 판매글과 대조할 수 없습니다.');
      const activeMembers = members.filter(member => member.status === 'APPLY' && member.cancelStatus !== 'REFUNDED'
        && ottDate(member.subscriptionEndsAt) >= koreaToday());
      const reservedPlaces = post.status === 'ON_SALE' ? post.memberLimit : activeMembers.length;
      if (account.overbooked || account.available < reservedPlaces) throw new Error('이 계정의 남은 공동 재고가 부족해 기존 판매글을 연결할 수 없습니다.');
      if (serviceType === '넷플릭스' && availableNetflixProfiles(store, management, manualMembers, accountEmail).length < activeMembers.length)
        throw new Error('구매자 수만큼 확인된 빈 넷플릭스 프로필이 없습니다.');
      const id = `legacy-${postSeq}`;
      const title = legacyPostTitle(post, serviceType);
      const listing: GbutsOttListing = { id, requestHash: createHash('sha256').update(`legacy:${postSeq}:${ottKey(serviceType, accountEmail)}`).digest('hex'),
        serviceType, accountEmail, endDate: ottDate(post.subscriptionEndsAt), capacity: post.memberLimit,
        dailyPrice: Number(post.price), title, description: legacyPostDescription(post),
        state: post.status === 'ON_SALE' ? 'registered' : 'closed', postSeq, createdAt: new Date().toISOString(), verifiedAt: new Date().toISOString() };
      await deps.access({ key: `preview:${id}`, listingId: id, postSeq, memberSeq: 0, userSeq: 0,
        name: '(기존 판매글 연결 확인)', status: 'PREVIEW', cancelStatus: null, startDate: koreaToday(), endDate: listing.endDate,
        delivery: 'ready', verifiedAt: new Date().toISOString() }, listing, '미리보기');
      store.listings[id] = listing;
      updateGbutsOttOrders(store, listing, members, new Date().toISOString());
      writeGbutsOttStore(store);
      return c.json({ ok: true, listing, linkedOrders: members.length });
    } catch (e) { return c.json({ ok: false, error: e instanceof Error ? e.message : '기존 판매글 연결 실패' }, 409); }
  }));
  app.post('/gbuts/ott/listings', async c => {
    const body = await c.req.json().catch(() => ({}));
    const requestId = String(body.requestId || '');
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(requestId))
      return c.json({ ok: false, error: '등록 요청 식별자를 확인해주세요.' }, 400);
    const fingerprint = createHash('sha256').update(JSON.stringify(body)).digest('hex');
    let job = registrationJobs.get(requestId);
    if (job && job.fingerprint !== fingerprint) return c.json({ ok: false, error: '이미 사용한 등록 요청입니다.' }, 409);
    if (!job) {
      job = { fingerprint, promise: undefined! };
      const currentJob = job;
      registrationJobs.set(requestId, currentJob);
      currentJob.promise = withGbutsOttInventory(async () => {
      try {
        if (process.env.GBUTS_OTT_SYNC_ENABLED !== 'true') throw new Error('벗츠 판매 연결이 아직 켜져 있지 않습니다.');
        const serviceType = String(body.serviceType || ''); const accountEmail = String(body.accountEmail || '').trim();
        const endDate = String(body.endDate || ''); const capacity = Number(body.capacity); const dailyPrice = Number(body.dailyPrice);
        const id = String(body.requestId || ''); const title = String(body.title || `${serviceType} 프리미엄 · 계정 자동 안내`).trim();
        const description = String(body.description || (body.emailCodeProvider === 'aaryan' ? GBUTS_NETFLIX_CODE_DESCRIPTION : makeGbutsOttDescription(serviceType))).trim();
        const deliveryMode = serviceType === '디즈니플러스' ? 'disney-numbered-password' as const : undefined;
        const emailCodeProvider = body.emailCodeProvider;
        if (emailCodeProvider !== undefined) {
          if (emailCodeProvider !== 'aaryan' || serviceType !== '넷플릭스') throw new Error('코드 전달 서비스 연결을 확인해주세요.');
          const provider = readAaryanTelegramConfig();
          if (!provider.allowedEmails.includes(accountEmail.toLowerCase()) || provider.expiresAt.slice(0,10) < endDate || Date.parse(provider.expiresAt) <= Date.now()) throw new Error('인증 코드 조회 권한 또는 기간을 확인해주세요.');
        }
        if (!GBUTS_OTT_CATEGORIES[serviceType] || !accountEmail || !/^[A-Za-z0-9_-]{8,100}$/.test(id)
          || !Number.isSafeInteger(capacity) || capacity < 1 || !Number.isSafeInteger(dailyPrice) || dailyPrice < 1 || dailyPrice > 100000
          || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || !Number.isFinite(Date.parse(endDate)) || new Date(endDate).toISOString().slice(0, 10) !== endDate
          || endDate <= koreaToday() || !title || title.length > 80 || !description || description.length > 5000)
          return c.json({ ok: false, error: '계정·기간·하루 요금·모집 인원을 확인해주세요.' }, 400);
        const requestHash = createHash('sha256').update(JSON.stringify([serviceType, accountEmail.toLowerCase(), endDate, capacity, dailyPrice, title, description, ...(emailCodeProvider ? [emailCodeProvider] : [])])).digest('hex');
        const store = readGbutsOttStore(); const previous = store.listings[id];
        if (previous) return c.json({ ok: previous.state === 'registered', listing: previous,
          error: previous.requestHash !== requestHash ? '이미 사용한 등록 요청입니다.' : '기존 등록 결과를 확인해주세요.' }, previous.requestHash !== requestHash ? 409 : 200);
        if (Object.values(store.listings).some(x => x.requestHash === requestHash && ['submitting', 'uncertain', 'registered'].includes(x.state)))
          return c.json({ ok: false, error: '같은 내용의 판매글 등록 요청이 이미 있습니다. 연결된 판매글을 확인해주세요.' }, 409);
        const client = gbutsOttClient();
        const [management, posts] = await Promise.all([publicationManagement(deps), client.listPosts()]);
        assertBoundPosts(store, posts);
        const account = sharedOttAccounts(management, deps.manualMembers(), store).find(x => x.key === ottKey(serviceType, accountEmail));
        if (!account || account.available < capacity || account.endDate < endDate || account.overbooked)
          return c.json({ ok: false, error: '현재 남은 자리 또는 계정 이용 기간을 초과했습니다. 새로고침 후 확인해주세요.' }, 409);
        if (deliveryMode && (capacity > 6 || account.occupied > 0))
          return c.json({ ok: false, error: '번호형 디즈니 판매는 기존 이용자·모집이 없는 계정에서 최대 6명까지 등록해주세요.' }, 409);
        if (serviceType === '넷플릭스' && availableNetflixProfiles(store, management, deps.manualMembers(), accountEmail).length < capacity)
          throw new Error('확인된 빈 프로필 번호가 모집 인원보다 적습니다. 기존 번호 배정을 확인해주세요.');
        const rawAccount = management.services.flatMap(x => x.accounts).find(x => ottKey(x.serviceType, x.email) === account.key)!;
        // Resolve the exact delivery account before publishing a sellable listing.
        await deps.access({ key: `preview:${id}`, listingId: id, postSeq: 0, memberSeq: 0, userSeq: 0,
          name: '(미리보기)', status: 'PREVIEW', cancelStatus: null, startDate: koreaToday(), endDate,
          delivery: 'ready', verifiedAt: new Date().toISOString() },
          { id, serviceType, accountEmail: rawAccount.email } as GbutsOttListing, '미리보기', management);
        const listing: GbutsOttListing = { id, requestHash, serviceType, accountEmail: rawAccount.email, endDate, capacity, dailyPrice,
          title, description, deliveryMode, ...(emailCodeProvider ? { emailCodeProvider } : {}), state: 'submitting', createdAt: new Date().toISOString(), beforePostSeqs: posts.map(x => x.seq) };
        const credentials = deliveryMode ? await deps.listingCredentials?.(listing) : undefined;
        if (deliveryMode && !credentials) throw new Error('디즈니 판매글 계정 정보를 확인해주세요.');
        store.listings[id] = listing; writeGbutsOttStore(store);
        try {
          listing.postSeq = (await client.createPost(listing, credentials)) || undefined;
          listing.state = 'uncertain'; writeGbutsOttStore(store);
          await reconcileListing(listing, client); enableNewNetflixRenewal(store, listing); writeGbutsOttStore(store);
          return c.json({ ok: true, listing, url: `https://gbuts.com/subscriptions/${listing.postSeq}` });
        } catch (e) {
          listing.state = 'uncertain'; listing.error = e instanceof Error ? e.message : '등록 결과 확인 필요'; writeGbutsOttStore(store);
          return c.json({ ok: false, listing, error: '등록 결과를 확인해야 합니다. 자리는 보존되며 같은 요청을 자동 재등록하지 않습니다.' }, 502);
        }
      } catch (e) { return c.json({ ok: false, error: e instanceof Error ? e.message : '판매글 등록 실패' }, 503); }
      }).catch(e => c.json({ ok: false, error: e instanceof Error ? e.message : '판매글 등록 실패' }, 503))
        .then(response => { currentJob.response = response; const timer = setTimeout(() => {
          if (registrationJobs.get(requestId) === currentJob) registrationJobs.delete(requestId);
        }, 10 * 60_000); (timer as any).unref?.(); return response; });
    }
    if (job.response) return job.response.clone();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const response = await Promise.race([job.promise, new Promise<undefined>(resolve => {
      timer = setTimeout(() => resolve(undefined), 1200);
    })]);
    if (timer) clearTimeout(timer);
    return response ? response.clone() : c.json({ ok: true, pending: true, requestId }, 202);
  });
  app.get('/gbuts/ott/listings/requests/:id', c => {
    const id = c.req.param('id'); const job = registrationJobs.get(id);
    if (job?.response) return job.response.clone();
    if (job) return c.json({ ok: true, pending: true, requestId: id }, 202);
    const listing = readGbutsOttStore().listings[id];
    if (!listing) return c.json({ ok: false, error: '등록 요청을 찾지 못했습니다. 판매글 목록을 새로고침해 확인해주세요.' }, 404);
    if (listing.state === 'registered') return c.json({ ok: true, listing });
    return c.json({ ok: false, listing, error: '등록 결과를 확인해야 합니다. 연결된 판매글을 확인해주세요.' }, 409);
  });
  app.get('/gbuts/ott/renewals', c => {
    const store = readGbutsOttStore();
    return c.json({ ok: true, enabled: process.env.GBUTS_OTT_SYNC_ENABLED === 'true', safeMode: loadSafeModeConfig().enabled,
      renewals: [...Object.values(store.renewals || {}),...subscriptionManagedRenewalViews(store)], lastSuccess: store.lastSuccess, lastError: store.lastError });
  });
  app.post('/gbuts/ott/renewals', c => withGbutsOttInventory(async () => {
    try {
      const body = await c.req.json() as { enabled: boolean; listingIds: string[]; startNow?: boolean; trigger?: 'hourly' | 'rank' };
      if (typeof body.enabled !== 'boolean' || !Array.isArray(body.listingIds) || !body.listingIds.length) throw new Error('자동 재등록할 판매글을 선택해주세요.');
      const store = readGbutsOttStore(); store.renewals ||= {};
      if (body.enabled && (process.env.GBUTS_OTT_SYNC_ENABLED !== 'true' || loadSafeModeConfig().enabled)) throw new Error('판매 자동화가 일시정지 상태입니다.');
      if (body.trigger !== undefined && !['hourly', 'rank'].includes(body.trigger)) throw new Error('재등록 기준을 확인해주세요.');
      const selected = body.listingIds.map(id => store.listings[id]);
      if (selected.some(l => !l || (!supportsGbutsOttRenewal(l)&&!futureSubscriptionRankApplies(l.postSeq!)) || !l.postSeq || !['registered', 'closed'].includes(l.state) || l.endDate <= koreaToday())) throw new Error('현재 재등록할 판매글을 확인해주세요.');
      for (const listing of selected) {
        if(futureSubscriptionRankApplies(listing.postSeq!)){
          const defaults=readSubscriptionRankDefaults();let policy=Object.values(defaults.policies).find(p=>p.posts.some(row=>row.seq===listing.postSeq));
          if(policy&&policy.currentPostSeq!==listing.postSeq)throw Error('최근 재등록된 판매글을 선택해주세요.');
          if(!policy)policy=bindSubscriptionRenewal(defaults,await gbutsOttClient().getPost(listing.postSeq!),body.enabled);
          policy.enabled=body.enabled;writeSubscriptionRankDefaults(defaults);continue;
        }
        const key = gbutsOttRenewalKey(listing.serviceType, listing.accountEmail); const previous = store.renewals[key];
        if (previous && previous.listingId !== listing.id) throw new Error('최근 재등록된 판매글을 선택해주세요.');
        const rank = body.trigger === 'rank' || listing.serviceType === '넷플릭스';
        store.renewals[key] = previous ? { ...previous, enabled: body.enabled } : {
          serviceType: listing.serviceType, accountEmail: listing.accountEmail, capacity: listing.capacity, listingId: listing.id, enabled: body.enabled,
          ...(rank ? { trigger: 'rank' as const, rankThreshold: 5, lastRepostedAt: listing.createdAt } : {}),
          nextAt: new Date(Date.now() + (rank || body.startNow === true ? 0 : DISNEY_RENEWAL_INTERVAL)).toISOString(),
        };
      }
      writeGbutsOttStore(store); return c.json({ ok: true, renewals: [...Object.values(store.renewals),...subscriptionManagedRenewalViews(store)] });
    } catch (e) { return c.json({ ok: false, error: e instanceof Error ? e.message : '자동 재등록 설정 실패' }, 409); }
  }));
  app.post('/gbuts/ott/renewals/ranking', c => withGbutsOttInventory(async () => {
    try {
      if (process.env.GBUTS_OTT_SYNC_ENABLED !== 'true' || loadSafeModeConfig().enabled) throw new Error('판매 자동화가 일시정지 상태입니다.');
      const body = await c.req.json() as { accountEmails: string[]; threshold: number; serviceType?: string };
      if (!Array.isArray(body.accountEmails) || !body.accountEmails.length || body.accountEmails.some(email => typeof email !== 'string')
        || !Number.isInteger(body.threshold) || body.threshold < 2 || body.threshold > 20) throw new Error('대상 계정과 순위 기준을 확인해주세요.');
      const store = readGbutsOttStore();
      const serviceType = body.serviceType || '디즈니플러스';
      if (!['디즈니플러스', '넷플릭스'].includes(serviceType)) throw new Error('순위 감시 서비스 종류를 확인해주세요.');
      const selected = [...new Set(body.accountEmails.map(email => email.trim().toLowerCase()))].map(email => store.renewals?.[gbutsOttRenewalKey(serviceType, email)]);
      if (selected.some(policy => !policy || !policy.enabled || !store.listings[policy.listingId]?.postSeq)) throw new Error('활성화된 자동 재등록 계정을 선택해주세요.');
      for (const policy of selected) {
        policy!.trigger = 'rank'; policy!.rankThreshold = body.threshold;
        policy!.lastRepostedAt ||= store.listings[policy!.listingId].createdAt;
        policy!.nextAt = new Date().toISOString();
      }
      writeGbutsOttStore(store); return c.json({ ok: true, renewals: selected });
    } catch (error) { return c.json({ ok: false, error: error instanceof Error ? error.message : '순위 감시 설정 실패' }, 409); }
  }));
  app.post('/gbuts/ott/renewals/terms', c => withGbutsOttInventory(async () => {
    try {
      if (loadSafeModeConfig().enabled) throw new Error('판매 자동화가 일시정지 상태입니다.');
      const body = await c.req.json() as { accountEmails: string[]; dailyPrice: number; title: string };
      if (!Array.isArray(body.accountEmails) || !body.accountEmails.length || body.accountEmails.some(email => typeof email !== 'string')
        || !Number.isSafeInteger(body.dailyPrice) || body.dailyPrice < 1 || body.dailyPrice > 1000000
        || typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 30) throw new Error('가격·제목과 대상 계정을 확인해주세요.');
      const store = readGbutsOttStore();
      const selected = [...new Set(body.accountEmails.map(email => email.trim().toLowerCase()))].map(email => store.renewals?.[email]);
      if (selected.some(policy => !policy || !policy.enabled || !store.listings[policy.listingId]?.postSeq)) throw new Error('활성화된 자동 재등록 계정을 선택해주세요.');
      // Persist the entire intent first. Partial provider failures resume from
      // these settings under the same inventory lock as the normal poller.
      for (const policy of selected) {
        policy!.saleTerms = { dailyPrice: body.dailyPrice, title: body.title.trim() };
        delete policy!.saleTermsAppliedTo; delete policy!.saleTermsRetryAt;
      }
      writeGbutsOttStore(store);
      const client = gbutsOttClient(); let errors = 0; let needsRenewal = false;
      for (const policy of selected) {
        try { needsRenewal = await applyGbutsDisneySaleTerms(store, policy!, client, writeGbutsOttStore) || needsRenewal; delete policy!.lastError; }
        catch (error) {
          errors++; policy!.lastError = error instanceof Error ? error.message : '판매 조건 수정 확인이 필요합니다.';
          policy!.saleTermsRetryAt = new Date(Date.now() + 60_000).toISOString();
        }
        writeGbutsOttStore(store);
      }
      if (needsRenewal) errors += (await renewDueGbutsOttListings(deps, client)).errors;
      const saved = readGbutsOttStore();
      return c.json({ ok: errors === 0, errors, renewals: selected.map(policy => saved.renewals![policy!.accountEmail.trim().toLowerCase()]) }, errors ? 409 : 200);
    } catch (error) { return c.json({ ok: false, error: error instanceof Error ? error.message : '판매 조건 설정 실패' }, 409); }
  }));
  app.post('/gbuts/ott/renewals/run', c => withGbutsOttInventory(async () => {
    if (process.env.GBUTS_OTT_SYNC_ENABLED !== 'true' || loadSafeModeConfig().enabled) return c.json({ ok: false, error: '판매 자동화가 일시정지 상태입니다.' }, 409);
    const result = await renewDueGbutsOttListings(deps, gbutsOttClient());
    return c.json({ ok: result.errors === 0, ...result, renewals: Object.values(readGbutsOttStore().renewals || {}) });
  }));
  app.post('/gbuts/ott/listings/:id/reconcile', c => withGbutsOttInventory(async () => {
    try {
      const store = readGbutsOttStore(); const listing = store.listings[c.req.param('id')];
      if (!listing || !['submitting', 'uncertain'].includes(listing.state)) throw new Error('확인할 등록 요청이 없습니다.');
      await reconcileListing(listing, gbutsOttClient()); enableNewNetflixRenewal(store, listing); writeGbutsOttStore(store); return c.json({ ok: true, listing });
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
  // Transfer an existing dedicated Disney reservation. No additional capacity,
  // account or paid period is introduced, so a full remote inventory refresh is
  // unnecessary. Serialize closure, the final roster and publication together.
  app.post('/gbuts/ott/listings/:id/repost', c => withGbutsOttInventory(async () => {
    let replacement: GbutsOttListing | undefined;
    try {
      if (process.env.GBUTS_OTT_SYNC_ENABLED !== 'true') throw new Error('벗츠 판매 연결을 확인해주세요.');
      const body = await c.req.json().catch(() => ({})) as any;
      const id = String(body.requestId || ''); const title = String(body.title || '').trim();
      if (!/^[A-Za-z0-9_-]{8,100}$/.test(id) || !title || title.length > 30 || id === c.req.param('id'))
        return c.json({ ok: false, error: '새 등록 요청과 제목(30자 이내)을 확인해주세요.' }, 400);
      const store = readGbutsOttStore(); const source = store.listings[c.req.param('id')];
      if (!source?.postSeq || source.deliveryMode !== 'disney-numbered-password' || source.endDate <= koreaToday())
        throw new Error('이용 기간이 남은 번호형 디즈니 판매글만 재등록할 수 있습니다.');
      const previous = store.listings[id]; const client = gbutsOttClient();
      if (previous) {
        if (previous.repostFrom !== source.id || previous.title !== title) throw new Error('이미 사용한 재등록 요청입니다.');
        if (previous.state === 'failed') throw new Error('중단된 재등록 요청입니다. 구매 이력과 원본 조건을 확인해주세요.');
        replacement = previous;
        if (previous.state === 'registered') return c.json({ ok: true, listing: previous, alreadyRegistered: true });
        if (previous.repostPhase !== 'closing') {
          await reconcileListing(previous, client); writeGbutsOttStore(store);
          return c.json({ ok: true, listing: previous });
        }
      } else if (source.state !== 'registered') throw new Error('현재 모집 중인 미판매 글을 선택해주세요.');
      const [post, members] = await Promise.all([client.getPost(source.postSeq), client.listOttMembers(source.postSeq)]);
      if (post.category1.seq !== 6 || post.subscriptionType !== 'SHARE' || post.memberLimit !== source.capacity
        || ottDate(post.subscriptionEndsAt) !== source.endDate || Number(post.price) !== source.dailyPrice || post.priceType !== 'DAY'
        || !['ON_SALE', ...(previous ? ['CLOSED'] : [])].includes(post.status)) throw new Error('원본 판매글의 계정·조건·모집 상태를 확인해주세요.');
      if (post.memberCount !== 0 || members.length !== 0) throw new Error('구매 이력이 있는 글은 자동 재등록하지 않습니다.');
      const key = ottKey(source.serviceType, source.accountEmail);
      if (Object.values(store.orders).some(o => ottKey(store.listings[o.listingId].serviceType, store.listings[o.listingId].accountEmail) === key && (activeOttOrder(o) || holdsDisneyProfile(o, store.listings[o.listingId])))
        || deps.manualMembers().some(m => ottKey(m.serviceType || '', m.accountEmail || '') === key && m.status === 'active' && m.endDate >= koreaToday())
        || Object.values(store.graytagClaims).some(claim => ottKey(claim.serviceType, claim.accountEmail) === key)
        || Object.values(store.listings).some(l => l.id !== source.id && l.id !== id && ottKey(l.serviceType, l.accountEmail) === key
          && !['closed', 'failed'].includes(l.state))) throw new Error('이 계정의 다른 이용자·모집·자리 확보 기록을 확인해주세요.');
      const credentials = await deps.listingCredentials?.(source);
      if (!credentials) throw new Error('재등록할 계정 정보를 확인해주세요.');
      if (!replacement) {
        const posts = await client.listPosts();
        replacement = { ...source, id, title, description: legacyPostDescription(post),
          requestHash: createHash('sha256').update(JSON.stringify([source.id, id, title])).digest('hex'),
          state: 'submitting', postSeq: undefined, beforePostSeqs: posts.map(p => p.seq),
          createdAt: new Date().toISOString(), verifiedAt: undefined, error: undefined,
          repostFrom: source.id, repostPhase: 'closing' };
        store.listings[id] = replacement; writeGbutsOttStore(store);
      }
      if (post.status === 'ON_SALE') {
        try { await client.closePost(source.postSeq); } catch { /* Always verify the actual close result. */ }
      }
      const [closed, finalMembers] = await Promise.all([client.getPost(source.postSeq), client.listOttMembers(source.postSeq)]);
      if (closed.status !== 'CLOSED') throw new Error('원본 글 모집 종료를 확인하지 못했습니다.');
      source.state = 'closed'; source.verifiedAt = new Date().toISOString();
      if (closed.memberCount !== 0 || finalMembers.length !== 0) {
        updateGbutsOttOrders(store, source, finalMembers, source.verifiedAt);
        replacement.state = 'failed'; replacement.error = '모집 종료 직전 구매가 발생해 재등록을 중단했습니다.';
        writeGbutsOttStore(store); throw new Error(replacement.error);
      }
      if (closed.category1.seq !== 6 || closed.subscriptionType !== 'SHARE' || closed.memberLimit !== source.capacity
        || ottDate(closed.subscriptionEndsAt) !== source.endDate || Number(closed.price) !== source.dailyPrice || closed.priceType !== 'DAY') {
        replacement.state = 'failed'; replacement.error = '모집 종료 중 원본 조건이 변경되어 재등록을 중단했습니다.';
        writeGbutsOttStore(store); throw new Error(replacement.error);
      }
      replacement.repostPhase = 'publishing'; writeGbutsOttStore(store);
      try {
        replacement.postSeq = (await client.createPost(replacement, credentials)) || undefined;
        replacement.state = 'uncertain'; writeGbutsOttStore(store);
        await reconcileListing(replacement, client); writeGbutsOttStore(store);
        return c.json({ ok: true, listing: replacement, oldPostSeq: source.postSeq, url: `https://gbuts.com/subscriptions/${replacement.postSeq}` });
      } catch {
        replacement.state = 'uncertain'; replacement.error = '재등록 결과 확인이 필요합니다. 같은 요청은 조회만 진행합니다.';
        writeGbutsOttStore(store); return c.json({ ok: false, listing: replacement, error: replacement.error }, 502);
      }
    } catch (e) { return c.json({ ok: false, error: e instanceof Error ? e.message : '미판매 글 재등록 실패' }, 409); }
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
