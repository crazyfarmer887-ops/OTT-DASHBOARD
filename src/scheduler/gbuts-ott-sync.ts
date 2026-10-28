import {verifyManagedSubscriptionRank} from './gbuts-rank-adoption';
import {syncFutureSubscriptionRank} from './gbuts-future-rank';
import { renewYouTubeInvites } from './gbuts-youtube-renewal';
import { renewDueGbutsOttListings } from './gbuts-ott-renewal';
import { GbutsChatDeliveryError, gbutsChatContainsText } from '../lib/gbuts-chat-delivery';
import { disneyAccountCapacity, holdsNetflixProfile, holdsDisneyProfile, hasGbutsOttProfileLease, koreaToday, GBUTS_OTT_CATEGORIES, activeOttOrder, deliverableOttOrder, ottDate, ottKey, sharedOttAccounts, updateGbutsOttOrders, type GbutsOttListing, type GbutsOttManagement, type GbutsOttOrder, type GbutsOttStore } from '../lib/gbuts-ott';
import { createGbutsOttSellerClient } from '../lib/gbuts-ott-client';
import { readGbutsOttStore, withGbutsOttInventory, writeGbutsOttStore } from '../lib/gbuts-ott-store';
import { loadGbutsSession } from '../lib/gbuts-session';
import { loadSafeModeConfig } from '../api/safe-mode';
import { generateUniqueProfileNicknames, stableRandomFromSeed } from '../lib/profile-nickname';
import { releaseCompletedNetflixProfiles, allocateNetflixProfilesForSync } from '../lib/gbuts-netflix-profiles';
import { buildGbutsOttDeliveryText, buildGbutsNetflixAccessText, buildGbutsNetflixDeliveryText, buildGbutsNetflixLegacyDeliveryText, buildGbutsNetflixUnformattedDeliveryText } from '../lib/gbuts-ott-templates';
import { buildPartyAccessDeliveryTemplate } from '../lib/party-access-template';
import { syncGbutsDirectCredentials } from './gbuts-ott-direct-delivery';
import { sendGbutsText } from './gbuts-spotify-messages';
import { allocateDisneyProfilesForSync } from '../lib/gbuts-disney-profiles';
import { buildGbutsDisneyDeliveryText } from '../lib/gbuts-ott-templates';
import type { GbutsOttCredentials } from '../lib/gbuts-disney-delivery';

export interface GbutsOttRuntimeDependencies {
  management(options?: { forceRefresh: boolean }): Promise<GbutsOttManagement>;
  manualMembers(): any[];
  renewalManagement?(serviceType?: string): Promise<GbutsOttManagement>;
  access(order: GbutsOttOrder, listing: GbutsOttListing, profileName: string, managementSnapshot?: GbutsOttManagement): Promise<string>;
  credentials?(order: GbutsOttOrder, listing: GbutsOttListing): Promise<GbutsOttCredentials>;
  listingCredentials?(listing: GbutsOttListing): Promise<GbutsOttCredentials>;
  refreshAccess(orders: GbutsOttOrder[]): Promise<void>;
  readStore?(): GbutsOttStore;
  writeStore?(store: GbutsOttStore): void;
}
export async function syncGbutsOtt(deps: GbutsOttRuntimeDependencies,
  client: ReturnType<typeof createGbutsOttSellerClient>, sendText?: typeof sendGbutsText): Promise<{ orders: number; attempted: number; confirmed: number }> {
  const read = deps.readStore || readGbutsOttStore; const write = deps.writeStore || writeGbutsOttStore;
  const store = read(); const now = new Date().toISOString();
  const listings = Object.values(store.listings).filter(listing => {
    if (listing.state === 'registered') return true;
    if (listing.state !== 'closed') return false;
    if (!listing.replacedBy) return true;
    return Object.values(store.orders).some(order => order.listingId === listing.id
      && (activeOttOrder(order) || holdsNetflixProfile(order, listing) || holdsDisneyProfile(order, listing) || (order.status === 'MISSING' && order.cancelStatus !== 'REFUNDED' && order.endDate >= koreaToday())));
  });
  let attempted = 0; let confirmed = 0;
  // Read all bound listings before issuing any chat or opening buyer access.
  for (const listing of listings) {
    if (!listing.postSeq) throw new Error('벗츠 판매글 연결이 올바르지 않습니다.');
    const [post, members] = await Promise.all([client.getPost(listing.postSeq), client.listOttMembers(listing.postSeq)]);
    if (post.category1.seq !== GBUTS_OTT_CATEGORIES[listing.serviceType]
      || ottDate(post.subscriptionEndsAt) !== listing.endDate || post.memberLimit !== listing.capacity)
      throw new Error('벗츠 판매글의 서비스·기간·인원이 연결 설정과 달라 자동 전달을 멈췄습니다.');
    if (!['ON_SALE', 'CLOSED', 'SUSPENDED', 'REFUNDED'].includes(post.status)) throw new Error('벗츠 판매글 상태 확인이 필요합니다.');
    if (members.length < post.memberCount) throw new Error('벗츠 구매자 목록을 모두 확인하지 못했습니다.');
    if (listing.deliveryMode === 'disney-numbered-password' && deps.listingCredentials)
      await client.syncDisneyCredentials(post, await deps.listingCredentials(listing));
    if (listing.serviceType === '넷플릭스' && listing.repostFrom && listing.endDate >= koreaToday() && deps.listingCredentials)
      await client.syncNetflixCredentials(post, await deps.listingCredentials(listing));
    listing.verifiedAt = now;
    listing.state = post.status === 'ON_SALE' ? 'registered' : 'closed';
    updateGbutsOttOrders(store, listing, members, now);
  }
  releaseCompletedNetflixProfiles(store);
  write(store);
  await deps.refreshAccess(Object.values(store.orders));
  if (!listings.length || !Object.keys(store.orders).length) {
    store.lastSuccess = new Date().toISOString(); store.lastError = null; write(store);
    return { orders: 0, attempted, confirmed };
  }
  const eligible = Object.values(store.orders).filter(order => deliverableOttOrder(order) && order.verifiedAt === now);
  const sellerSeq = eligible.length ? await client.sellerAccountSeq() : 0;
  const deliveryText = (order: GbutsOttOrder) => {
    const listing = store.listings[order.listingId];
    if (listing.serviceType === '넷플릭스') {
      // Submitted history is confirmation evidence only. A never-submitted retry
      // must use the current password-only policy, even if it pinned an older guide.
      const submitted = order.attemptedAt || order.delivery === 'attempted' || order.delivery === 'confirmed';
      return submitted ? order.deliveryMessage || buildGbutsNetflixLegacyDeliveryText(order.accessUrl!, order.profileNumber!)
        : buildGbutsNetflixDeliveryText(order.accessUrl!, order.profileNumber!, listing.emailCodeProvider === 'aaryan', listing.emailCodeProvider === 'emailverify');
    }
    return order.deliveryMessage || (listing.deliveryMode === 'disney-numbered-password'
      ? buildGbutsDisneyDeliveryText(order.accessUrl!, order.profileNumber!, disneyAccountCapacity(store, listing))
      : buildGbutsOttDeliveryText(order.accessUrl!));
  };
  // Confirmation discloses nothing new: use the persisted link and profile lease,
  // after checking the paid buyer above. A GrayTag outage cannot hide a saved chat.
  for (const order of eligible) {
    if (!order.attemptedAt && order.delivery !== 'attempted') continue;
    if (order.delivery === 'confirmed') continue;
    const listing = store.listings[order.listingId];
    if (!order.accessUrl || !order.profileName || !hasGbutsOttProfileLease(store, order)
      || (listing.serviceType === '넷플릭스' && order.profileNumber === undefined)) continue;
    const roomId = await client.openPrivateRoom(order.postSeq, order.userSeq);
    if (order.roomId && order.roomId !== roomId) throw new Error('벗츠 구매자 채팅방이 변경되었습니다.');
    order.roomId = roomId;
    const messages = (await client.getChat(roomId)).messages;
    const candidates = [deliveryText(order)];
    if (listing.serviceType !== '넷플릭스') candidates.push(buildPartyAccessDeliveryTemplate(order.accessUrl));
    if (listing.serviceType === '넷플릭스') candidates.push(
      buildGbutsNetflixDeliveryText(order.accessUrl, order.profileNumber!),
      buildGbutsNetflixAccessText(order.accessUrl, order.profileNumber!),
      buildGbutsNetflixUnformattedDeliveryText(order.accessUrl, order.profileNumber!),
    );
    const savedText = candidates.find(text => gbutsChatContainsText(messages, sellerSeq, text));
    if (savedText) {
      order.deliveryMessage = savedText; order.delivery = 'confirmed'; delete order.error; confirmed++;
    } else order.error = '채팅 발송 결과 확인 중 — 안내문이 모두 저장되지 않았습니다.';
    write(store);
  }
  const pendingOrders = eligible.filter(order => !order.attemptedAt && order.delivery !== 'attempted' && order.delivery !== 'confirmed' && order.delivery !== 'blocked');
  const directDelivery = () => syncGbutsDirectCredentials(store, eligible, sellerSeq, deps, client, write, sendText);
  if (!pendingOrders.length) {
    await directDelivery();
    store.lastSuccess = new Date().toISOString(); store.lastError = null; write(store);
    return { orders: Object.values(store.orders).filter(x => activeOttOrder(x)).length, attempted, confirmed };
  }
  const management = await deps.management();
  const manualMembers = deps.manualMembers();
  const profileErrors = allocateNetflixProfilesForSync(store, management, manualMembers);
  for (const [key, error] of allocateDisneyProfilesForSync(store, management, manualMembers)) profileErrors.set(key, error);
  write(store);
  const inventory = sharedOttAccounts(management, manualMembers, store);
  for (const pending of pendingOrders) {
    const order = store.orders[pending.key];
    if (!deliverableOttOrder(order) || order.verifiedAt !== now) continue;
    const listing = store.listings[order.listingId];
    const profileError = profileErrors.get(ottKey(listing.serviceType, listing.accountEmail));
    if (profileError) { order.error = profileError; write(store); continue; }
    const account = inventory.find(x => x.serviceType === listing.serviceType && x.accountEmail.toLowerCase() === listing.accountEmail.toLowerCase());
    if (!account || account.overbooked || order.endDate > account.endDate) {
      order.error = '계정의 자리 또는 이용 기간을 확인해야 합니다.'; write(store); continue;
    }
    const rawAccount = management.services.flatMap(x => x.accounts).find(x => x.serviceType === listing.serviceType && x.email.toLowerCase() === listing.accountEmail.toLowerCase());
    const excluded = [...(rawAccount?.members || []).map(x => x.profileName || x.name || ''),
      ...(management.onSaleByKeepAcct[listing.accountEmail] || []).map(x => x.profileName || ''),
      ...manualMembers.filter(x => x.serviceType === listing.serviceType && String(x.accountEmail || '').toLowerCase() === listing.accountEmail.toLowerCase()
        && x.status === 'active').map(x => x.profileName || x.memberName || x.name || ''),
      ...Object.values(store.orders).filter(x => x.key !== order.key && activeOttOrder(x)
        && store.listings[x.listingId]?.accountEmail === listing.accountEmail).map(x => x.profileName || '')];
    if (listing.serviceType !== '넷플릭스') order.profileName ||= generateUniqueProfileNicknames(1, '', stableRandomFromSeed(order.key), excluded)[0];
    order.accessUrl = await deps.access(order, listing, order.profileName!);
    write(store);
    const roomId = await client.openPrivateRoom(order.postSeq, order.userSeq);
    if (order.roomId && order.roomId !== roomId) throw new Error('벗츠 구매자 채팅방이 변경되었습니다.');
    order.roomId = roomId;
    const text = deliveryText(order);
    if (listing.serviceType === '넷플릭스') order.credentialDeliveryPolicy = 'netflix-password-v1';
    const contains = (messages: any[]) => gbutsChatContainsText(messages, sellerSeq, text);
    if (contains((await client.getChat(roomId)).messages)) {
      if (order.delivery !== 'confirmed') confirmed++;
      order.delivery = 'confirmed'; delete order.error; write(store); continue;
    }
    if (order.attemptedAt || order.delivery === 'attempted' || order.delivery === 'confirmed') continue;
    // Persist before SEND. Submitted but uncertain messages are reconciled only;
    // a typed failure before any SEND clears the attempt for the next poll.
    order.deliveryMessage = text;
    order.delivery = 'attempted'; order.attemptedAt = new Date().toISOString(); delete order.error; write(store); attempted++;
    try {
      await (sendText || sendGbutsText)(roomId, sellerSeq, text);
      if (contains((await client.getChat(roomId)).messages)) { order.delivery = 'confirmed'; write(store); confirmed++; }
    } catch (error) {
      if (error instanceof GbutsChatDeliveryError && !error.submitted) {
        delete order.attemptedAt;
        order.delivery = error.retryable ? 'ready' : 'blocked';
        order.error = error.retryable ? '채팅 연결 실패 — 다음 확인 때 자동 재시도합니다.' : error.message;
      } else order.error = '채팅 발송 결과 확인 중';
      write(store);
    }
  }
  await directDelivery();
  store.lastSuccess = new Date().toISOString(); store.lastError = null; write(store);
  return { orders: Object.values(store.orders).filter(x => activeOttOrder(x)).length, attempted, confirmed };
}
export function startGbutsOttSync(deps: GbutsOttRuntimeDependencies): (() => void) | undefined {
  if (process.env.GBUTS_OTT_SYNC_ENABLED !== 'true') return;
  let pending = false;
  const run = () => {
    if (pending) return;
    pending = true;
    void withGbutsOttInventory(async () => {
      if (loadSafeModeConfig().enabled) return;
      const token = loadGbutsSession()?.token || process.env.GBUTS_API_TOKEN?.trim();
      if (!token) return;
      try {
        const result = await syncGbutsOtt(deps, createGbutsOttSellerClient(token));
        const renewals = await renewDueGbutsOttListings(deps, createGbutsOttSellerClient(token));
        if (renewals.renewed || renewals.errors) console.log('[GbutsOttRenewal]', renewals);
        if (result.attempted || result.confirmed) console.log('[GbutsOttSync]', result);
      } catch (e) {
        const store = readGbutsOttStore(); store.lastError = e instanceof Error ? e.message : '벗츠 주문 확인 실패'; writeGbutsOttStore(store);
        console.error('[GbutsOttSync]', store.lastError);
      }
      try { const youtube = await renewYouTubeInvites(createGbutsOttSellerClient(token),{allowed:()=>process.env.GBUTS_OTT_SYNC_ENABLED==='true'&&!loadSafeModeConfig().enabled}); if (youtube.renewed || youtube.errors) console.log('[GbutsYouTubeRenewal]', youtube); }
      catch { console.error('[GbutsYouTubeRenewal] 재등록 기록 확인 필요'); }
      try{const future=await syncFutureSubscriptionRank(createGbutsOttSellerClient(token),{verify:p=>verifyManagedSubscriptionRank(p,deps),allowed:()=>process.env.GBUTS_OTT_SYNC_ENABLED==='true'&&!loadSafeModeConfig().enabled});if(future.discovered||future.renewed||future.errors)console.log('[GbutsSubscriptionRank]',future);}
      catch{console.error('[GbutsSubscriptionRank] 재등록 기본 설정 확인 필요');}
    }).catch(e => console.error('[GbutsOttSync] inventory unavailable', e instanceof Error ? e.message : 'unknown'))
      .finally(() => { pending = false; });
  };
  let interval: ReturnType<typeof setInterval> | undefined;
  const initial = setTimeout(() => { run(); interval = setInterval(run, 5_000); }, 1_000);
  return () => { clearTimeout(initial); if (interval) clearInterval(interval); };
}
