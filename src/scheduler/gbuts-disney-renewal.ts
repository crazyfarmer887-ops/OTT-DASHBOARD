import { createHash } from 'node:crypto';
import { activeOttOrder, holdsDisneyProfile, koreaToday, ottDate, ottKey, updateGbutsOttOrders, type GbutsOttListing, type GbutsOttOrder, type GbutsOttStore, type GbutsOttRenewal, type GbutsOttManagement } from '../lib/gbuts-ott';
import { readGbutsOttStore, writeGbutsOttStore } from '../lib/gbuts-ott-store';
import { createGbutsOttSellerClient, type GbutsOttPost, type GbutsOttMember } from '../lib/gbuts-ott-client';
import { decodeGbutsSubscriptionCredential } from '../lib/gbuts-subscription-credentials';
import type { GbutsOttCredentials } from '../lib/gbuts-disney-delivery';
import type { GbutsOttRuntimeDependencies } from './gbuts-ott-sync';
export const DISNEY_RENEWAL_INTERVAL = 60 * 60 * 1000;
export const DISNEY_RANK_CHECK_INTERVAL = 60_000;
export const DISNEY_RANK_COOLDOWN = 5 * 60_000;

function accountOrders(store: GbutsOttStore, email: string, now: Date): GbutsOttOrder[] {
  return Object.values(store.orders).filter(order => {
    const listing = store.listings[order.listingId];
    return ottKey(listing.serviceType, listing.accountEmail) === ottKey('디즈니플러스', email)
      && (activeOttOrder(order, now) || holdsDisneyProfile(order, listing, now)
        || (order.status === 'MISSING' && order.cancelStatus !== 'REFUNDED' && order.endDate >= koreaToday(now)));
  });
}
function title(post: GbutsOttPost): string {
  let value = post.title;
  try { value = typeof value === 'string' ? JSON.parse(value).ko : value?.ko; } catch { /* Plain seller title. */ }
  return String(value || '').replace(/^\[디즈니플러스\]\s*/, '').trim();
}
function sameConditions(post: GbutsOttPost, listing: GbutsOttListing): boolean {
  return post.category1.seq === 6 && post.subscriptionType === 'SHARE' && post.priceType === 'DAY'
    && post.memberLimit === listing.capacity && Number(post.price) === listing.dailyPrice && ottDate(post.subscriptionEndsAt) === listing.endDate;
}
function credentialsHash(id: string, password: string): string {
  return createHash('sha256').update(JSON.stringify([id, password])).digest('hex');
}
function completeRoster(post: GbutsOttPost, members: GbutsOttMember[], now: Date): boolean {
  return members.filter(member => activeOttOrder({ ...member, endDate: ottDate(member.subscriptionEndsAt) }, now)).length >= post.memberCount;
}
function assertDedicatedAccount(management: GbutsOttManagement, email: string, capacity: number, endDate: string): void {
  const account = management.services.flatMap(s => s.accounts).find(a => ottKey(a.serviceType, a.email) === ottKey('디즈니플러스', email));
  if (!account || account.archivedAccount || account.totalSlots < capacity || account.generatedAccount?.paymentStatus !== 'paid'
    || ottDate(account.expiryDate) < endDate || account.members.length
    || (management.onSaleByKeepAcct[account.email] || []).length)
    throw new Error('그레이태그 이용자·모집 또는 계정 정원을 확인해야 재등록할 수 있습니다.');
}
async function reconcile(listing: GbutsOttListing, credentials: GbutsOttCredentials, client: ReturnType<typeof createGbutsOttSellerClient>) {
  const possible = listing.postSeq ? [await client.getPost(listing.postSeq)]
    : (await client.listPostsAfter(listing.repostAfterSeq!)).filter(post => sameConditions(post, listing) && title(post) === listing.title);
  const matches: GbutsOttPost[] = [];
  for (const candidate of possible) {
    const post = listing.postSeq ? candidate : await client.getPost(candidate.seq);
    if (sameConditions(post, listing) && title(post) === listing.title
      && (post.seq === listing.postSeq || credentialsHash(decodeGbutsSubscriptionCredential(post.subscriptionPrincipal), decodeGbutsSubscriptionCredential(post.subscriptionCredential)) === listing.repostCredentialsHash
        || (decodeGbutsSubscriptionCredential(post.subscriptionPrincipal) === credentials.id && decodeGbutsSubscriptionCredential(post.subscriptionCredential) === credentials.password))) matches.push(post);
  }
  if (matches.length !== 1 || !['ON_SALE', 'CLOSED'].includes(matches[0].status)) throw new Error('재등록 결과를 하나로 확인하지 못했습니다. 새로 생성하지 않고 확인을 계속합니다.');
  if (decodeGbutsSubscriptionCredential(matches[0].subscriptionPrincipal) !== credentials.id
    || decodeGbutsSubscriptionCredential(matches[0].subscriptionCredential) !== credentials.password)
    await client.syncDisneyCredentials(matches[0], credentials);
  listing.postSeq = matches[0].seq;
  listing.state = matches[0].status === 'ON_SALE' ? 'registered' : 'closed';
  listing.verifiedAt = new Date().toISOString(); delete listing.error;
}

/** Reconcile public sale edits before changing local conditions; closed history stays immutable. */
export async function applyGbutsDisneySaleTerms(store: GbutsOttStore, policy: GbutsOttRenewal,
  client: ReturnType<typeof createGbutsOttSellerClient>, write: (store: GbutsOttStore) => void): Promise<boolean> {
  const listing = store.listings[policy.listingId];
  if (!policy.saleTerms || policy.pendingId) return false;
  if (!listing?.postSeq || listing.deliveryMode !== 'disney-numbered-password') throw new Error('판매 조건을 적용할 계정을 확인해주세요.');
  const post = await client.getPost(listing.postSeq);
  // Price may already be the requested value after a lost PUT response. All
  // other immutable binding fields must still match before this exact edit.
  if (!sameConditions(post, { ...listing, dailyPrice: Number(post.price) }) || !['ON_SALE', 'CLOSED'].includes(post.status))
    throw new Error('판매 조건 수정 전 원본 연결을 확인해주세요.');
  // GButs forbids price changes once anyone has joined. Transfer only the
  // remaining capacity through the existing close/final-roster/create journal.
  if (post.status === 'ON_SALE' && post.memberCount > 0 && Number(post.price) !== policy.saleTerms.dailyPrice) return true;
  if (post.status === 'ON_SALE') {
    await client.updateDisneySaleTerms(post, policy.saleTerms);
  }
  // A successful PUT can be followed by a sell-out before its lost response is
  // recovered. Adopt the verified edit even on CLOSED, without editing history.
  if (post.status === 'ON_SALE' || (Number(post.price) === policy.saleTerms.dailyPrice && title(post) === policy.saleTerms.title)) {
    listing.dailyPrice = policy.saleTerms.dailyPrice; listing.title = policy.saleTerms.title;
  }
  policy.saleTermsAppliedTo = listing.postSeq; delete policy.saleTermsRetryAt; write(store); return false;
}

/** One displaced post per fresh buyer-list snapshot; own posts alone never cause churn. */
async function rankedRenewal(store: GbutsOttStore, client: ReturnType<typeof createGbutsOttSellerClient>,
  now: Date, write: (store: GbutsOttStore) => void): Promise<{ listingId?: string; errors: number }> {
  const due = Object.values(store.renewals || {}).filter(policy => policy.enabled && policy.trigger === 'rank'
    && !policy.pendingId && Date.parse(policy.nextAt) <= now.getTime());
  if (!due.length) return { errors: 0 };
  const nextCheck = new Date(now.getTime() + DISNEY_RANK_CHECK_INTERVAL).toISOString();
  if (Object.values(store.renewals || {}).some(policy => policy.trigger === 'rank' && policy.pendingId)) {
    for (const policy of due) policy.nextAt = nextCheck;
    write(store); return { errors: 0 };
  }
  try {
    const [rows, sellerSeq] = await Promise.all([client.listDisneyPublicRanking(), client.sellerAccountSeq()]);
    const foreignIndex = rows.findIndex(row => row.sellerSeq !== sellerSeq);
    const candidates: Array<{ id: string; rank: number; createdAt: string }> = [];
    for (const policy of due) {
      const listing = store.listings[policy.listingId];
      const index = rows.findIndex(row => row.seq === listing?.postSeq);
      if (index >= 0 && rows[index].sellerSeq !== sellerSeq) throw new Error('판매자와 판매글 연결이 다릅니다.');
      policy.lastRank = index >= 0 ? index + 1 : null; policy.rankCheckedAt = now.toISOString();
      const rank = index >= 0 ? index + 1 : 21;
      if (listing && ['registered', 'closed'].includes(listing.state) && listing.endDate > koreaToday(now)
        && accountOrders(store, policy.accountEmail, now).length < policy.capacity
        && rank >= policy.rankThreshold! && foreignIndex >= 0 && foreignIndex < rank - 1
        && (index >= 0 || rows.length === 20)
        && (!policy.lastRepostedAt || now.getTime() - Date.parse(policy.lastRepostedAt) >= DISNEY_RANK_COOLDOWN))
        candidates.push({ id: policy.listingId, rank, createdAt: listing.createdAt });
    }
    const chosen = candidates.sort((a, b) => b.rank - a.rank || a.createdAt.localeCompare(b.createdAt))[0]?.id;
    for (const policy of due) if (policy.listingId !== chosen) { policy.nextAt = nextCheck; delete policy.lastError; }
    write(store); return { listingId: chosen, errors: 0 };
  } catch (error) {
    for (const policy of due) { policy.lastError = error instanceof Error ? `목록 순위 확인 실패: ${error.message}` : '목록 순위 확인 실패'; policy.nextAt = nextCheck; }
    write(store); return { errors: due.length };
  }
}

/** Called only inside withGbutsOttInventory, shared with sales sync/publication. */
export async function renewDueGbutsDisneyListings(deps: GbutsOttRuntimeDependencies,
  client: ReturnType<typeof createGbutsOttSellerClient>, now = new Date()): Promise<{ renewed: number; checked: number; errors: number }> {
  const read = deps.readStore || readGbutsOttStore; const write = deps.writeStore || writeGbutsOttStore;
  const store = read(); const result = { renewed: 0, checked: 0, errors: 0 };
  const rankCheck = await rankedRenewal(store, client, now, write);
  result.errors += rankCheck.errors;
  for (const policy of Object.values(store.renewals || {})) {
    if (!policy.enabled && !policy.pendingId) continue;
    let due = Date.parse(policy.nextAt) <= now.getTime()
      && (policy.trigger !== 'rank' || Boolean(policy.pendingId) || policy.listingId === rankCheck.listingId);
    const scheduledNextAt = policy.nextAt;
    const source = store.listings[policy.listingId];
    const edit = policy.saleTerms && !policy.pendingId && (due || policy.saleTermsAppliedTo !== source?.postSeq)
      && (!policy.saleTermsRetryAt || Date.parse(policy.saleTermsRetryAt) <= now.getTime());
    if (edit) {
      try {
        if (await applyGbutsDisneySaleTerms(store, policy, client, write)) {
          if (!due) { policy.earlyRenewalNextAt ||= scheduledNextAt; write(store); }
          due = true;
        }
        delete policy.lastError;
      }
      catch (error) {
        result.errors++; policy.lastError = error instanceof Error ? error.message : '판매 조건 수정 확인이 필요합니다.';
        policy.saleTermsRetryAt = new Date(now.getTime() + 60_000).toISOString(); write(store); continue;
      }
    }
    if (!due || (policy.saleTermsRetryAt && Date.parse(policy.saleTermsRetryAt) > now.getTime())) continue;
    result.checked++;
    const complete = (listing?: GbutsOttListing) => {
      if (listing) { policy.listingId = listing.id; policy.lastRepostedAt = now.toISOString(); delete listing.beforePostSeqs; result.renewed++; }
      delete policy.pendingId; delete policy.lastError;
      policy.lastSuccess = now.toISOString();
      policy.nextAt = policy.trigger === 'rank' ? new Date(now.getTime() + DISNEY_RANK_CHECK_INTERVAL).toISOString()
        : policy.earlyRenewalNextAt || new Date(now.getTime() + DISNEY_RENEWAL_INTERVAL).toISOString();
      delete policy.earlyRenewalNextAt;
      if (policy.saleTerms) {
        if (!listing || (listing.dailyPrice === policy.saleTerms.dailyPrice && listing.title === policy.saleTerms.title)) policy.saleTermsAppliedTo = (listing || source).postSeq;
        else delete policy.saleTermsAppliedTo; // Frozen CREATE may still carry the previous terms.
      }
      write(store);
    };
    try {
      if (!source?.postSeq || source.deliveryMode !== 'disney-numbered-password') throw new Error('자동 재등록의 원본 계정을 확인해주세요.');
      if (source.endDate <= koreaToday(now)) { policy.enabled = false; if (!policy.pendingId) { delete policy.lastError; write(store); continue; } }
      let replacement = policy.pendingId ? store.listings[policy.pendingId] : undefined;
      let credentials = await deps.listingCredentials?.(source);
      if (!credentials) throw new Error('최신 디즈니 계정 정보를 확인해주세요.');
      if (replacement?.repostPhase === 'publishing') {
        await reconcile(replacement, credentials, client); complete(replacement); continue;
      }
      if (!policy.enabled) {
        // Disabling stops future CREATEs, while submitted work is still recovered
        // above so real buyers cannot disappear from ordinary delivery polling.
        const [actual, members] = await Promise.all([client.getPost(source.postSeq), client.listOttMembers(source.postSeq)]);
        if (!sameConditions(actual, source) || !['ON_SALE', 'CLOSED'].includes(actual.status) || !completeRoster(actual, members, now)) throw new Error('중단한 재등록의 기존 구매자 확인 중입니다.');
        source.state = actual.status === 'ON_SALE' ? 'registered' : 'closed';
        updateGbutsOttOrders(store, source, members, now.toISOString());
        if (replacement) { replacement.state = 'failed'; replacement.error = '새 글 생성 전 자동 재등록이 중단되었습니다.'; }
        complete(); continue;
      }
      assertDedicatedAccount(await (deps.renewalManagement ? deps.renewalManagement() : deps.management()), policy.accountEmail, policy.capacity, source.endDate);
      const key = ottKey('디즈니플러스', policy.accountEmail);
      if (deps.manualMembers().some(m => ottKey(m.serviceType || '', m.accountEmail || '') === key && m.status === 'active' && m.endDate >= koreaToday(now))
        || Object.values(store.graytagClaims).some(c => ottKey(c.serviceType, c.accountEmail) === key)
        || Object.values(store.listings).some(l => l.id !== source.id && l.id !== replacement?.id && ottKey(l.serviceType, l.accountEmail) === key && !['closed', 'failed'].includes(l.state)))
        throw new Error('다른 판매처 또는 중복 모집 기록이 있어 자동 재등록을 보류합니다.');
      // Refresh current and still occupied old posts. Keep historical buyer IDs/rooms
      // and their delivery journals on the old binding, including missing leases.
      const occupiedIds = new Set(accountOrders(store, policy.accountEmail, now).map(o => o.listingId));
      const relevant = Object.values(store.listings).filter(l => l.id === source.id || occupiedIds.has(l.id));
      let post: GbutsOttPost | undefined;
      for (const listing of relevant) {
        if (!listing.postSeq) throw new Error('기존 구매자의 판매글 연결을 확인해주세요.');
        const [actual, members] = await Promise.all([client.getPost(listing.postSeq), client.listOttMembers(listing.postSeq)]);
        if (!sameConditions(actual, listing) || !['ON_SALE', 'CLOSED'].includes(actual.status) || !completeRoster(actual, members, now))
          throw new Error('기존 판매 조건 또는 구매자 목록이 달라 재등록을 보류합니다.');
        updateGbutsOttOrders(store, listing, members, now.toISOString());
        if (listing.id === source.id) post = actual;
      }
      if (!post) throw new Error('원본 판매글 확인이 필요합니다.');
      let remaining = policy.capacity - accountOrders(store, policy.accountEmail, now).length;
      if (remaining < 0) throw new Error('기존 이용자가 계정 정원보다 많아 재등록을 보류합니다.');
      if (!remaining && !replacement) { complete(); continue; }
      if (!replacement) {
        if (source.replacedBy) throw new Error('이미 교체된 원본입니다. 연결을 확인해주세요.');
        const id = `disney-hourly-${source.postSeq}-${now.getTime()}`;
        if (store.listings[id]) throw new Error('기존 재등록 기록을 확인해주세요.');
        const afterSeq = await client.latestPostSeq(); const newTitle = policy.saleTerms?.title || title(post);
        if (!newTitle || newTitle.length > 30) throw new Error('판매글 제목을 확인해주세요.');
        replacement = { ...source, id, title: newTitle, dailyPrice: policy.saleTerms?.dailyPrice ?? source.dailyPrice, description: typeof post.description === 'string' ? post.description : String(post.description?.ko || ''),
          requestHash: createHash('sha256').update(id).digest('hex'), state: 'submitting', capacity: remaining,
          postSeq: undefined, beforePostSeqs: undefined, repostAfterSeq: afterSeq, repostCredentialsHash: credentialsHash(credentials.id, credentials.password), createdAt: now.toISOString(), verifiedAt: undefined,
          error: undefined, replacedBy: undefined, repostFrom: source.id, repostPhase: 'closing' };
        policy.pendingId = id; store.listings[id] = replacement; write(store);
      }
      if (post.status === 'ON_SALE') {
        try { await client.closePost(source.postSeq); } catch { /* Read actual closure before publication. */ }
      }
      const [closed, finalMembers] = await Promise.all([client.getPost(source.postSeq), client.listOttMembers(source.postSeq)]);
      if (closed.status !== 'CLOSED' || !completeRoster(closed, finalMembers, now)) throw new Error('원본 모집 종료와 최종 구매자 확인 중입니다.');
      source.state = 'closed'; source.verifiedAt = now.toISOString();
      updateGbutsOttOrders(store, source, finalMembers, now.toISOString());
      if (!sameConditions(closed, source)) throw new Error('모집 종료 중 조건이 변경되어 재등록을 보류합니다.');
      remaining = policy.capacity - accountOrders(store, policy.accountEmail, now).length;
      if (remaining < 0) throw new Error('마지막 구매 후 정원을 확인해야 합니다.');
      if (!remaining) {
        replacement.state = 'failed'; replacement.error = '모집 종료 중 만석이 되어 새 글을 생성하지 않았습니다.';
        complete(); continue;
      }
      assertDedicatedAccount(await (deps.renewalManagement ? deps.renewalManagement() : deps.management()), policy.accountEmail, policy.capacity, source.endDate);
      credentials = await deps.listingCredentials?.(source);
      if (!credentials) throw new Error('최신 디즈니 계정 정보를 확인해주세요.');
      const finalTitle = policy.saleTerms?.title || title(closed);
      if (!finalTitle || finalTitle.length > 30) throw new Error('현재 판매글 제목을 확인해주세요.');
      replacement.title = finalTitle;
      replacement.dailyPrice = policy.saleTerms?.dailyPrice ?? source.dailyPrice;
      replacement.description = typeof closed.description === 'string' ? closed.description : String(closed.description?.ko || '');
      replacement.repostCredentialsHash = credentialsHash(credentials.id, credentials.password);
      replacement.capacity = remaining; replacement.repostPhase = 'publishing'; source.replacedBy = replacement.id; write(store);
      // Persisted phase prevents a second CREATE even after an unknown response
      // or process restart. Future attempts only reconcile native account fields.
      replacement.state = 'uncertain'; write(store);
      replacement.postSeq = (await client.createPost(replacement, credentials)) || undefined; write(store);
      await reconcile(replacement, credentials, client); complete(replacement);
    } catch (error) {
      result.errors++; policy.lastError = error instanceof Error ? error.message : '자동 재등록 확인이 필요합니다.';
      policy.nextAt = new Date(now.getTime() + 60_000).toISOString(); write(store);
    }
  }
  return result;
}
