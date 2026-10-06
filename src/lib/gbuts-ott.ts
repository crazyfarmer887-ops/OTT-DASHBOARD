import { isGraytagAccessNoticeCredential } from './graytag-fill';
import { calculateAccountVacancy, getPartyMax } from '../web/lib/account-slots';

export const GBUTS_OTT_CATEGORIES: Record<string, number> = { 넷플릭스: 5, 디즈니플러스: 6, 티빙: 8, 웨이브: 10 };
export type GbutsOttListingState = 'submitting' | 'registered' | 'uncertain' | 'failed' | 'closed';
export interface GbutsOttListing {
  id: string; requestHash: string; serviceType: string; accountEmail: string; capacity: number;
  dailyPrice: number; endDate: string; title: string; description: string;
  state: GbutsOttListingState; postSeq?: number; createdAt: string; verifiedAt?: string; error?: string;
  beforePostSeqs?: number[];
}
export interface GbutsOttOrder {
  key: string; listingId: string; postSeq: number; memberSeq: number; userSeq: number;
  name: string; status: string; cancelStatus: string | null; startDate: string; endDate: string;
  profileName?: string; accessUrl?: string; roomId?: string;
  delivery: 'ready' | 'attempted' | 'confirmed' | 'blocked'; verifiedAt: string; error?: string;
  attemptedAt?: string;
  purchasedAt?: string;
  profileNumber?: number;
  profileReleasedAt?: string;
  profileReleaseReason?: 'refunded' | 'expired';
}
export interface GraytagOttClaim {
  id: string; serviceType: string; accountEmail: string; productUsid?: string;
  state: 'pending' | 'registered' | 'uncertain'; createdAt: string;
}
export interface GbutsOttStore {
  version: 1; listings: Record<string, GbutsOttListing>; orders: Record<string, GbutsOttOrder>;
  graytagClaims: Record<string, GraytagOttClaim>; lastSuccess: string | null; lastError: string | null;
}
export const emptyGbutsOttStore = (): GbutsOttStore => ({ version: 1, listings: {}, orders: {}, graytagClaims: {}, lastSuccess: null, lastError: null });
export interface GbutsOttAccount {
  email: string; serviceType: string; members: any[]; totalSlots: number; expiryDate?: string | null;
  keepPasswd?: string; generatedAccount?: { paymentStatus?: string }; archivedAccount?: boolean;
  gbutsInventory?: { currentUsers: number; recruiting: number; members: GbutsOttOrder[]; claims: number };
  [key: string]: any;
}
export interface GbutsOttManagement {
  services: Array<{ serviceType: string; accounts: GbutsOttAccount[]; [key: string]: any }>;
  onSaleByKeepAcct: Record<string, any[]>; summary?: Record<string, number>; [key: string]: any;
}
export function ottDate(value: unknown): string {
  const raw = String(value ?? '').trim();
  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  const iso = raw.match(/^(\d{4})[-./\s]+(\d{1,2})[-./\s]+(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  const short = raw.replace(/\s/g, '').match(/^(\d{2})\.(\d{1,2})\.(\d{1,2})/);
  return short ? `20${short[1]}-${short[2].padStart(2, '0')}-${short[3].padStart(2, '0')}` : '';
}
export function koreaToday(now = new Date()): string { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now); }
export function ottKey(serviceType: string, email: string): string { return `${serviceType}:${email.trim().toLowerCase()}`; }
export function activeOttOrder(order: Pick<GbutsOttOrder, 'status' | 'cancelStatus' | 'endDate'>, now = new Date()): boolean {
  return order.status === 'APPLY' && order.cancelStatus !== 'REFUNDED' && Boolean(order.endDate) && order.endDate >= koreaToday(now);
}
export function deliverableOttOrder(order: Pick<GbutsOttOrder, 'status' | 'cancelStatus' | 'endDate'>, now = new Date()): boolean {
  return activeOttOrder(order, now) && (order.cancelStatus === null || order.cancelStatus === 'REFUND_REJECTED');
}
export function holdsNetflixProfile(order: GbutsOttOrder, listing: GbutsOttListing, now = new Date()): boolean {
  return listing.serviceType === '넷플릭스' && order.profileNumber !== undefined && !order.profileReleasedAt
    && order.cancelStatus !== 'REFUNDED' && !!order.endDate && order.endDate >= koreaToday(now);
}
export function updateGbutsOttOrders(store: GbutsOttStore, listing: GbutsOttListing,
  members: Array<{ seq: number; userSeq: number; nickname: string; status: string; cancelStatus: string | null; createdAt: string; subscriptionEndsAt: string }>, now: string): void {
  const seen = new Set<string>();
  for (const member of members) {
    const key = `${listing.postSeq}:${member.seq}`;
    if (seen.has(key)) throw new Error('벗츠 주문이 중복되어 자동 전달을 멈췄습니다.');
    seen.add(key); const prev = store.orders[key];
    if (prev && (prev.userSeq !== member.userSeq || prev.listingId !== listing.id)) throw new Error('벗츠 구매자 연결이 변경되었습니다.');
    const endDate = ottDate(member.subscriptionEndsAt); const startDate = ottDate(member.createdAt);
    if (!endDate || !startDate || endDate > listing.endDate || endDate < startDate) throw new Error('벗츠 주문 이용 기간이 판매글과 다릅니다.');
    store.orders[key] = { ...prev, key, listingId: listing.id, postSeq: listing.postSeq!,
      memberSeq: member.seq, userSeq: member.userSeq, name: member.nickname, status: member.status,
      cancelStatus: member.cancelStatus, startDate, endDate, purchasedAt: prev?.purchasedAt || member.createdAt,
      delivery: prev?.delivery || 'ready', verifiedAt: now };
  }
  for (const order of Object.values(store.orders).filter(x => x.listingId === listing.id && !seen.has(x.key))) {
    order.status = 'MISSING'; if (order.delivery === 'ready') order.delivery = 'blocked'; order.verifiedAt = now; order.error = '판매자 주문 목록에서 확인되지 않습니다.';
  }
}
export function hasGbutsOttProfileLease(store: GbutsOttStore, order: GbutsOttOrder, expectedProfileName?: string, now = new Date()): boolean {
  const listing = store.listings[order.listingId];
  if (!listing || order.profileReleasedAt) return false;
  if (listing.serviceType !== '넷플릭스' || order.profileNumber === undefined) return true;
  if (!holdsNetflixProfile(order, listing, now) || order.profileName !== String(order.profileNumber)
    || (expectedProfileName !== undefined && expectedProfileName !== order.profileName)) return false;
  return !Object.values(store.orders).some(other => other.key !== order.key && other.profileNumber === order.profileNumber
    && ottKey(store.listings[other.listingId].serviceType, store.listings[other.listingId].accountEmail) === ottKey(listing.serviceType, listing.accountEmail)
    && holdsNetflixProfile(other, store.listings[other.listingId], now));
}
export function isGbutsOttBuyerMatch(store: GbutsOttStore, record: { serviceType: string; accountEmail: string; profileName?: string; member: { memberId: string } },
  member: { seq: number; userSeq: number; subscriptionEndsAt: string } | undefined): boolean {
  const order = store.orders[record.member.memberId]; const listing = order && store.listings[order.listingId];
  return Boolean(order && listing && member && order.memberSeq === member.seq && order.userSeq === member.userSeq
    && hasGbutsOttProfileLease(store, order, record.profileName)
    && `${listing.postSeq}:${member.seq}` === record.member.memberId
    && ottKey(listing.serviceType, listing.accountEmail) === ottKey(record.serviceType, record.accountEmail)
    && ottDate(member.subscriptionEndsAt) <= listing.endDate);
}
export function accountGbutsInventory(store: GbutsOttStore, serviceType: string, email: string, now = new Date()) {
  const key = ottKey(serviceType, email);
  const listings = Object.values(store.listings).filter(x => ottKey(x.serviceType, x.accountEmail) === key);
  const ids = new Set(listings.map(x => x.id));
  const members = Object.values(store.orders).filter(x => ids.has(x.listingId)
    && (activeOttOrder(x, now) || holdsNetflixProfile(x, store.listings[x.listingId], now)));
  const currentUsers = members.length;
  let reserved = 0;
  for (const listing of listings) {
    const active = members.filter(x => x.listingId === listing.id).length;
    reserved += listing.state === 'failed' || listing.state === 'closed' || listing.endDate < koreaToday(now)
      ? active : Math.max(listing.capacity, active);
  }
  return { currentUsers, recruiting: Math.max(0, reserved - currentUsers), members, claims: 0 };
}
export function pendingGraytagClaims(store: GbutsOttStore, account: GbutsOttAccount, management: GbutsOttManagement): number {
  const productIds = new Set([
    ...(account.members || []).map(x => String(x.productUsid || '')),
    ...(management.onSaleByKeepAcct[account.email] || []).map(x => String(x.productUsid || '')),
  ].filter(Boolean));
  return Object.values(store.graytagClaims).filter(x => ottKey(x.serviceType, x.accountEmail) === ottKey(account.serviceType, account.email)
    && (!x.productUsid || !productIds.has(x.productUsid))).length;
}
export function sharedOttAccounts(management: GbutsOttManagement, manualMembers: any[], store: GbutsOttStore, now = new Date()) {
  if (!Array.isArray(management.services) || !management.onSaleByKeepAcct) throw new Error('그레이태그 재고를 확인하지 못했습니다.');
  return management.services.flatMap(service => service.accounts).filter(account => GBUTS_OTT_CATEGORIES[account.serviceType]).map(account => {
    const manualCount = manualMembers.filter(x => x.serviceType === account.serviceType && x.accountEmail?.toLowerCase() === account.email.toLowerCase()
      && x.status === 'active' && x.endDate >= koreaToday(now)).length;
    const vacancy = calculateAccountVacancy({ serviceType: account.serviceType, maxSlots: account.totalSlots,
      members: account.members, recruitingProducts: management.onSaleByKeepAcct[account.email] || [], manualCount, now });
    const gbuts = accountGbutsInventory(store, account.serviceType, account.email, now);
    const claims = pendingGraytagClaims(store, account, management);
    const total = getPartyMax(account.serviceType, account.totalSlots);
    const occupied = vacancy.currentUsers + vacancy.manualCount + vacancy.recruiting + gbuts.currentUsers + gbuts.recruiting + claims;
    const endDate = ottDate(account.expiryDate);
    const references = [...(management.onSaleByKeepAcct[account.email] || []), ...(account.members || [])];
    const dailyPrices = references.flatMap(x => {
      const start = ottDate(x.startDateTime) || koreaToday(now); const end = ottDate(x.endDateTime);
      const days = (Date.parse(end) - Date.parse(start)) / 86400000;
      return days > 0 && Number(x.purePrice) > 0 ? [Math.ceil(Number(x.purePrice) / days)] : [];
    });
    const accountId = String(account.email || '').trim();
    const hasAccountId = !!accountId && accountId.replace(/\s+/g, '') !== '(직접전달)' && !isGraytagAccessNoticeCredential(accountId);
    const eligible = hasAccountId && !account.archivedAccount && endDate > koreaToday(now)
      && (account.generatedAccount ? account.generatedAccount.paymentStatus === 'paid' : vacancy.currentUsers + manualCount > 0);
    return { key: ottKey(account.serviceType, account.email), serviceType: account.serviceType, accountEmail: account.email,
      total, graytag: vacancy.currentUsers + vacancy.recruiting, manual: manualCount,
      gbuts: gbuts.currentUsers + gbuts.recruiting, claims, occupied, available: eligible ? Math.max(0, total - occupied) : 0,
      overbooked: occupied > total, endDate, suggestedDailyPrice: dailyPrices.length ? Math.min(...dailyPrices) : null, eligible };
  });
}
export function mergeGbutsOttManagement<T extends GbutsOttManagement>(management: T, store: GbutsOttStore): T {
  const services = management.services.map(service => {
    let count = 0; let pending = 0;
    const accounts = service.accounts.map(account => {
      const gbutsInventory = accountGbutsInventory(store, account.serviceType, account.email);
      gbutsInventory.claims = pendingGraytagClaims(store, account, management);
      count += gbutsInventory.currentUsers; pending += gbutsInventory.recruiting + gbutsInventory.claims;
      return { ...account, gbutsInventory, usingCount: account.usingCount + gbutsInventory.currentUsers,
        activeCount: account.activeCount + gbutsInventory.currentUsers + gbutsInventory.recruiting + gbutsInventory.claims };
    });
    return { ...service, accounts, totalUsingMembers: service.totalUsingMembers + count, totalActiveMembers: service.totalActiveMembers + count + pending };
  });
  return { ...management, services, summary: { ...management.summary,
    totalUsingMembers: services.reduce((n, x) => n + (x.totalUsingMembers || 0), 0),
    totalActiveMembers: services.reduce((n, x) => n + (x.totalActiveMembers || 0), 0) } };
}
