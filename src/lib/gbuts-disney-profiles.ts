import { disneyAccountCapacity, activeOttOrder, deliverableOttOrder, holdsDisneyProfile, koreaToday, ottKey, type GbutsOttManagement, type GbutsOttStore } from './gbuts-ott';
import { disneyEveryviewInventory, requireDisneyEveryviewAvailable } from './gbuts-disney-everyview';

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
      const capacity = disneyAccountCapacity(store, listings.find(l => ottKey(l.serviceType, l.accountEmail) === key)!);
      const used = new Set<number>();
      const secondary = Object.values(store.graytagClaims).filter(c => ottKey(c.serviceType,c.accountEmail) === key && c.accountId === 'secondary'
        && c.profileNumber === 6 && !(c.state === 'registered' && c.endDate && c.endDate < koreaToday(now)));
      if (secondary.length && account.totalSlots < 6) throw Error('공동 계정의 실제 전체 자리 수를 확인해주세요.');
      if (secondary.length > 1) throw Error('그레이태그 2호기 자리 예약이 중복되었습니다.');
      if (secondary.length) used.add(6);
      for (const order of orders.filter(x => activeOttOrder(x, now) || holdsDisneyProfile(x, store.listings[x.listingId], now))) {
        if (store.listings[order.listingId].deliveryMode !== 'disney-numbered-password' || order.profileReleasedAt)
          throw new Error('다른 방식으로 배정된 디즈니 주문을 확인해주세요.');
        if (order.profileNumber === undefined) {
          if (order.profileName || order.attemptedAt || order.delivery === 'confirmed') throw new Error('기존 디즈니 프로필은 자동으로 변경하지 않습니다.');
          continue;
        }
        if (!Number.isInteger(order.profileNumber) || order.profileNumber < 1 || order.profileNumber > capacity || order.profileName !== String(order.profileNumber) || used.has(order.profileNumber))
          throw new Error('디즈니 프로필 번호가 중복되거나 올바르지 않습니다.');
        used.add(order.profileNumber);
      }
      const crossPlatform = disneyEveryviewInventory(store, listings.find(l => ottKey(l.serviceType, l.accountEmail) === key)!, now,
        { ignoreUnassignedNewGbuts: true });
      requireDisneyEveryviewAvailable(crossPlatform);
      if (crossPlatform && (!Number.isInteger(account.totalSlots) || account.totalSlots < crossPlatform.capacity))
        throw new Error('공동 계정의 실제 전체 자리 수를 확인해주세요.');
      // Existing buyers remain assigned; Everyview's verified profile numbers are
      // included before selecting a place for a new GButs buyer.
      for (const number of crossPlatform?.occupiedProfiles || []) used.add(number);
      const pending = orders.filter(x => deliverableOttOrder(x, now) && x.profileNumber === undefined)
        .map(order => ({ order, time: Date.parse((order.purchasedAt || order.startDate).replace(' ', 'T') + (/(?:Z|[+-]\d\d:\d\d)$/.test(order.purchasedAt || order.startDate) ? '' : (order.purchasedAt || order.startDate).length === 10 ? 'T00:00:00+09:00' : '+09:00')) }));
      if (pending.some(x => !Number.isFinite(x.time))) throw new Error('디즈니 구매 순서를 확인하지 못했습니다.');
      // A verified Everyview reservation outside the GButs numbering range
      // consumes account capacity, but does not consume a GButs-numbered slot.
      if (pending.length + [...used].filter(n => n <= capacity).length > capacity) throw new Error('디즈니 계정의 프로필 자리가 부족합니다.');
      pending.sort((a, b) => a.time - b.time || a.order.postSeq - b.order.postSeq || a.order.memberSeq - b.order.memberSeq);
      for (const { order } of pending) {
        const number = Array.from({length:capacity}, (_, i) => i + 1).find(n => !used.has(n))!;
        order.profileNumber = number; order.profileName = String(number); used.add(number);
      }
    } catch (error) { errors.set(key, error instanceof Error ? error.message : '디즈니 프로필 확인이 필요합니다.'); }
  }
  return errors;
}
