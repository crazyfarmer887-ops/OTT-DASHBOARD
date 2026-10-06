import { deliverableOttOrder, holdsNetflixProfile, koreaToday, ottDate, ottKey, type GbutsOttManagement, type GbutsOttOrder, type GbutsOttStore } from './gbuts-ott';
import { isActiveRecruitingSlot, isCurrentAccountMember } from '../web/lib/account-slots';

function profileNumber(value: unknown): number | null {
  const match = String(value || '').trim().match(/^(?:프로필\s*)?([1-5])(?:번(?:\s*프로필)?)?$/);
  return match ? Number(match[1]) : null;
}
function occupy(used: Map<number, string>, number: number | null, owner: string) {
  if (number === null || !Number.isInteger(number) || number < 1 || number > 5) throw new Error('공동 계정의 기존 프로필 번호를 확인해주세요. 1~5번을 확인할 때까지 벗츠 배정을 보류합니다.');
  const previous = used.get(number);
  if (previous && previous !== owner) throw new Error(`${number}번 프로필이 중복 배정되어 확인이 필요합니다.`);
  used.set(number, owner);
}
export function availableNetflixProfiles(store: GbutsOttStore, management: GbutsOttManagement, manualMembers: any[], accountEmail: string, now = new Date()): number[] {
  const key = ottKey('넷플릭스', accountEmail);
  const raw = management.services.flatMap(service => service.accounts).find(account => ottKey(account.serviceType, account.email) === key);
  if (!raw) throw new Error('넷플릭스 계정의 기존 프로필을 확인하지 못했습니다.');
  const used = new Map<number, string>();
  for (const [index, member] of (raw.members || []).entries()) {
    if (!isCurrentAccountMember(member, now) && !isActiveRecruitingSlot(member, now)) continue;
    const owner = `graytag:${member.productUsid || member.dealUsid || `unknown-${index}`}`;
    occupy(used, profileNumber(member.profileName), owner);
  }
  for (const [index, product] of (management.onSaleByKeepAcct[raw.email] || []).entries()) {
    if ((product.productType && product.productType !== '넷플릭스') || !isActiveRecruitingSlot(product, now)) continue;
    const owner = `graytag:${product.productUsid || `unknown-product-${index}`}`;
    if (Array.from(used.values()).includes(owner)) continue;
    occupy(used, profileNumber(product.profileName), owner);
  }
  for (const [index, member] of manualMembers.entries()) {
    if (ottKey(member.serviceType || '', member.accountEmail || '') !== key || member.status !== 'active' || ottDate(member.endDate) < koreaToday(now)) continue;
    occupy(used, profileNumber(member.profileName || member.memberName), `manual:${member.id || `unknown-${index}`}`);
  }
  for (const order of Object.values(store.orders)) {
    const listing = store.listings[order.listingId];
    if (ottKey(listing.serviceType, listing.accountEmail) !== key || !holdsNetflixProfile(order, listing, now)) continue;
    occupy(used, order.profileNumber!, `gbuts:${order.key}`);
  }
  return [1, 2, 3, 4, 5].filter(number => !used.has(number));
}
function purchaseTime(order: GbutsOttOrder): number {
  const value = order.purchasedAt || order.startDate;
  const timestamp = Date.parse(/(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : value.replace(' ', 'T') + (value.length === 10 ? 'T00:00:00' : '') + '+09:00');
  if (!Number.isFinite(timestamp)) throw new Error('구매 순서를 확인하지 못해 프로필 배정을 보류합니다.');
  return timestamp;
}
/** Refund/expiry release needs only the freshly verified GButs order state. */
export function releaseCompletedNetflixProfiles(store: GbutsOttStore, now = new Date()): void {
  for (const order of Object.values(store.orders)) {
    if (store.listings[order.listingId]?.serviceType === '넷플릭스' && order.profileNumber !== undefined && !order.profileReleasedAt && (order.cancelStatus === 'REFUNDED' || order.endDate < koreaToday(now))) {
      order.profileReleasedAt = now.toISOString(); order.profileReleaseReason = order.cancelStatus === 'REFUNDED' ? 'refunded' : 'expired';
    }
  }
}
export function allocateNetflixProfiles(store: GbutsOttStore, management: GbutsOttManagement, manualMembers: any[], now = new Date()): void {
  const orders = Object.values(store.orders).filter(order => store.listings[order.listingId].serviceType === '넷플릭스');
  releaseCompletedNetflixProfiles(store, now);
  const eligible = orders.filter(order => deliverableOttOrder(order, now)).sort((a, b) => purchaseTime(a) - purchaseTime(b) || a.postSeq - b.postSeq || a.memberSeq - b.memberSeq);
  for (const order of eligible) {
    if (order.profileReleasedAt) throw new Error('이미 반환된 프로필의 주문이 다시 활성화되어 확인이 필요합니다.');
    if (order.profileNumber !== undefined) continue;
    if (order.profileName || order.attemptedAt || order.delivery === 'confirmed') throw new Error('기존 안내된 프로필은 자동으로 번호를 변경하지 않습니다. 먼저 프로필 번호를 확인해주세요.');
    const number = availableNetflixProfiles(store, management, manualMembers, store.listings[order.listingId].accountEmail, now)[0];
    if (!number) throw new Error('사용 가능한 1~5번 프로필이 없습니다. 중복 배정을 보류합니다.');
    order.profileNumber = number; order.profileName = String(number);
  }
  for (const email of new Set(eligible.map(order => store.listings[order.listingId].accountEmail.toLowerCase()))) availableNetflixProfiles(store, management, manualMembers, email, now);
}

export function assertUnclaimedGbutsNetflixProfile(store: GbutsOttStore, serviceType: string, accountEmail: string, name: string, now = new Date()): void {
  if (serviceType !== '넷플릭스') return;
  const key = ottKey(serviceType, accountEmail);
  const held = Object.values(store.orders).filter(order => {
    const listing = store.listings[order.listingId];
    return ottKey(listing.serviceType, listing.accountEmail) === key && holdsNetflixProfile(order, listing, now);
  });
  if (!held.length) return;
  const number = profileNumber(name);
  if (number === null) throw new Error('벗츠와 함께 사용하는 넷플릭스 계정은 1~5번 프로필 번호를 지정해주세요.');
  if (held.some(order => order.profileNumber === number)) throw new Error(`${number}번 프로필은 벗츠 구매자가 이용 중입니다.`);
}

export function allocateNetflixProfilesForSync(store: GbutsOttStore, management: GbutsOttManagement, manualMembers: any[], now = new Date()): Map<string, string> {
  const errors = new Map<string, string>();
  const accounts = new Set(Object.values(store.orders).map(order => store.listings[order.listingId])
    .filter(listing => listing.serviceType === '넷플릭스').map(listing => ottKey(listing.serviceType, listing.accountEmail)));
  for (const account of accounts) {
    const candidate = structuredClone(store);
    candidate.orders = Object.fromEntries(Object.entries(candidate.orders).filter(([, order]) => {
      const listing = candidate.listings[order.listingId]; return ottKey(listing.serviceType, listing.accountEmail) === account;
    }));
    try {
      allocateNetflixProfiles(candidate, management, manualMembers, now);
      Object.assign(store.orders, candidate.orders);
    } catch (error) {
      errors.set(account, error instanceof Error ? error.message : '프로필 번호 확인이 필요합니다.');
    }
  }
  return errors;
}
