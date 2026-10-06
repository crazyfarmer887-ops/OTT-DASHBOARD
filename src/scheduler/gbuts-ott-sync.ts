import { GBUTS_OTT_CATEGORIES, activeOttOrder, deliverableOttOrder, ottDate, ottKey, sharedOttAccounts, updateGbutsOttOrders, type GbutsOttListing, type GbutsOttManagement, type GbutsOttOrder, type GbutsOttStore } from '../lib/gbuts-ott';
import { createGbutsOttSellerClient } from '../lib/gbuts-ott-client';
import { readGbutsOttStore, withGbutsOttInventory, writeGbutsOttStore } from '../lib/gbuts-ott-store';
import { loadGbutsSession } from '../lib/gbuts-session';
import { loadSafeModeConfig } from '../api/safe-mode';
import { generateUniqueProfileNicknames, stableRandomFromSeed } from '../lib/profile-nickname';
import { buildPartyAccessDeliveryTemplate } from '../lib/party-access-template';
import { allocateNetflixProfilesForSync } from '../lib/gbuts-netflix-profiles';
import { buildGbutsNetflixDeliveryText } from '../lib/gbuts-ott-templates';
import { sendGbutsText } from './gbuts-spotify-messages';

export interface GbutsOttRuntimeDependencies {
  management(options?: { forceRefresh: boolean }): Promise<GbutsOttManagement>;
  manualMembers(): any[];
  access(order: GbutsOttOrder, listing: GbutsOttListing, profileName: string): Promise<string>;
  refreshAccess(orders: GbutsOttOrder[]): Promise<void>;
  readStore?(): GbutsOttStore;
  writeStore?(store: GbutsOttStore): void;
}
export async function syncGbutsOtt(deps: GbutsOttRuntimeDependencies,
  client: ReturnType<typeof createGbutsOttSellerClient>, sendText = sendGbutsText): Promise<{ orders: number; attempted: number; confirmed: number }> {
  const read = deps.readStore || readGbutsOttStore; const write = deps.writeStore || writeGbutsOttStore;
  const store = read(); const now = new Date().toISOString();
  const listings = Object.values(store.listings).filter(x => x.state === 'registered' || x.state === 'closed');
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
    listing.verifiedAt = now;
    listing.state = post.status === 'ON_SALE' ? 'registered' : 'closed';
    updateGbutsOttOrders(store, listing, members, now);
  }
  write(store);
  await deps.refreshAccess(Object.values(store.orders));
  if (!listings.length) return { orders: 0, attempted, confirmed };
  const management = await deps.management();
  const manualMembers = deps.manualMembers();
  const profileErrors = allocateNetflixProfilesForSync(store, management, manualMembers);
  write(store);
  const inventory = sharedOttAccounts(management, manualMembers, store);
  const sellerSeq = await client.sellerAccountSeq();
  for (const order of Object.values(store.orders)) {
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
    const text = listing.serviceType === '넷플릭스' ? buildGbutsNetflixDeliveryText(order.accessUrl, order.profileNumber!) : buildPartyAccessDeliveryTemplate(order.accessUrl);
    const contains = (messages: any[]) => messages.some(x => x.senderSeq === sellerSeq && x.messageType === 'TEXT' && x.message.trim() === text.trim());
    if (contains((await client.getChat(roomId)).messages)) {
      if (order.delivery !== 'confirmed') confirmed++;
      order.delivery = 'confirmed'; delete order.error; write(store); continue;
    }
    if (order.attemptedAt || order.delivery === 'attempted' || order.delivery === 'confirmed') continue;
    // Persist before SEND. A connection failure is an unknown outcome; only history
    // reconciliation can confirm it, and the next poll must not send it again.
    order.delivery = 'attempted'; order.attemptedAt = new Date().toISOString(); delete order.error; write(store); attempted++;
    try {
      await sendText(roomId, sellerSeq, text);
      if (contains((await client.getChat(roomId)).messages)) { order.delivery = 'confirmed'; write(store); confirmed++; }
    } catch { order.error = '채팅 발송 결과 확인 중'; write(store); }
  }
  store.lastSuccess = new Date().toISOString(); store.lastError = null; write(store);
  return { orders: Object.values(store.orders).filter(x => activeOttOrder(x)).length, attempted, confirmed };
}
export function startGbutsOttSync(deps: GbutsOttRuntimeDependencies): void {
  if (process.env.GBUTS_OTT_SYNC_ENABLED !== 'true') return;
  const run = () => withGbutsOttInventory(async () => {
    if (loadSafeModeConfig().enabled) return;
    const token = loadGbutsSession()?.token || process.env.GBUTS_API_TOKEN?.trim();
    if (!token) return;
    try {
      const result = await syncGbutsOtt(deps, createGbutsOttSellerClient(token));
      if (result.attempted || result.confirmed) console.log('[GbutsOttSync]', result);
    } catch (e) {
      const store = readGbutsOttStore(); store.lastError = e instanceof Error ? e.message : '벗츠 주문 확인 실패'; writeGbutsOttStore(store);
      console.error('[GbutsOttSync]', store.lastError);
    }
  }).catch(e => console.error('[GbutsOttSync] inventory unavailable', e instanceof Error ? e.message : 'unknown'));
  setTimeout(() => { void run(); setInterval(() => { void run(); }, 30_000); }, 15_000);
}
