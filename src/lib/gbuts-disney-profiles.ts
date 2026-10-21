import { activeOttOrder, deliverableOttOrder, holdsDisneyProfile, koreaToday, ottKey, type GbutsOttManagement, type GbutsOttStore } from './gbuts-ott';

/** Numbered Disney listings use a dedicated six-place account. Never renumber a delivered buyer. */
export function allocateDisneyProfilesForSync(store: GbutsOttStore, management: GbutsOttManagement, manual: any[], now = new Date()): Map<string, string> {
  const errors = new Map<string, string>();
  const listings = Object.values(store.listings).filter(x => x.deliveryMode === 'disney-numbered-password');
  for (const key of new Set(listings.map(x => ottKey(x.serviceType, x.accountEmail)))) {
    try {
      const account = management.services.flatMap(x => x.accounts).find(x => ottKey(x.serviceType, x.email) === key);
      if (!account || account.members.length || (management.onSaleByKeepAcct[account.email] || []).length
        || manual.some(x => ottKey(x.serviceType || '', x.accountEmail || '') === key && x.status === 'active' && x.endDate >= koreaToday(now)))
        throw new Error('번호형 디즈니 계정의 다른 판매처·수동 이용자를 확인해주세요.');
      const orders = Object.values(store.orders).filter(x => {
        const listing = store.listings[x.listingId]; return ottKey(listing.serviceType, listing.accountEmail) === key;
      });
      for (const order of orders) if (order.profileNumber !== undefined && !order.profileReleasedAt && (order.cancelStatus === 'REFUNDED' || order.endDate < koreaToday(now))) {
        order.profileReleasedAt = now.toISOString(); order.profileReleaseReason = order.cancelStatus === 'REFUNDED' ? 'refunded' : 'expired';
      }
      const used = new Set<number>();
      for (const order of orders.filter(x => activeOttOrder(x, now) || holdsDisneyProfile(x, store.listings[x.listingId], now))) {
        if (store.listings[order.listingId].deliveryMode !== 'disney-numbered-password' || order.profileReleasedAt)
          throw new Error('다른 방식으로 배정된 디즈니 주문을 확인해주세요.');
        if (order.profileNumber === undefined) {
          if (order.profileName || order.attemptedAt || order.delivery === 'confirmed') throw new Error('기존 디즈니 프로필은 자동으로 변경하지 않습니다.');
          continue;
        }
        if (!Number.isInteger(order.profileNumber) || order.profileNumber < 1 || order.profileNumber > 6 || order.profileName !== String(order.profileNumber) || used.has(order.profileNumber))
          throw new Error('디즈니 프로필 번호가 중복되거나 올바르지 않습니다.');
        used.add(order.profileNumber);
      }
      const pending = orders.filter(x => deliverableOttOrder(x, now) && x.profileNumber === undefined)
        .map(order => ({ order, time: Date.parse((order.purchasedAt || order.startDate).replace(' ', 'T') + (/(?:Z|[+-]\d\d:\d\d)$/.test(order.purchasedAt || order.startDate) ? '' : (order.purchasedAt || order.startDate).length === 10 ? 'T00:00:00+09:00' : '+09:00')) }));
      if (pending.some(x => !Number.isFinite(x.time))) throw new Error('디즈니 구매 순서를 확인하지 못했습니다.');
      if (pending.length + used.size > 6) throw new Error('디즈니의 1~6번 프로필 자리가 부족합니다.');
      pending.sort((a, b) => a.time - b.time || a.order.postSeq - b.order.postSeq || a.order.memberSeq - b.order.memberSeq);
      for (const { order } of pending) {
        const number = [1, 2, 3, 4, 5, 6].find(n => !used.has(n))!;
        order.profileNumber = number; order.profileName = String(number); used.add(number);
      }
    } catch (error) { errors.set(key, error instanceof Error ? error.message : '디즈니 프로필 확인이 필요합니다.'); }
  }
  return errors;
}
