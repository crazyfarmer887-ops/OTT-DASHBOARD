import { createHash } from 'node:crypto';
import { evaluateDisneyInventory, type DisneySeatClaim, type DisneyInventoryResult } from './disney-cross-platform-inventory';
import { activeOttOrder, deliverableOttOrder, disneyAccountCapacity, holdsDisneyProfile, koreaToday, ottKey, type GbutsOttListing, type GbutsOttStore } from './gbuts-ott';

export const DISNEY_EVERYVIEW_MAX_AGE_MS = 120_000;
export const disneyEveryviewAccountKey = (email: string) => createHash('sha256').update(email.trim().toLowerCase()).digest('hex');

/** Until a coordinated publisher can atomically reserve its advertised quota,
 * hold manual/new publication for explicitly mapped cross-platform accounts.
 * Existing submissions are reconciled separately, never replayed. */
export function assertDisneyPublicationCoordinated(store: GbutsOttStore, serviceType: string, accountEmail: string): void {
  if (serviceType === '디즈니플러스' && store.disneyEveryview
    && Object.prototype.hasOwnProperty.call(store.disneyEveryview, disneyEveryviewAccountKey(accountEmail)))
    throw Error('에브리뷰와 공유하는 디즈니 계정은 공동 자리 예약 확인 전 새 판매를 보류합니다.');
}

/**
 * A configured mapping cannot silently fall back to GButs-only inventory.
 * Snapshot writers must independently verify each party and its buyer/profile mapping.
 */
export function disneyEveryviewInventory(store: GbutsOttStore, listing: GbutsOttListing, now = new Date(),
  options: { ignoreUnassignedNewGbuts?: boolean } = {}): DisneyInventoryResult | null {
  if (listing.serviceType !== '디즈니플러스' || listing.deliveryMode !== 'disney-numbered-password') return null;
  const accountKey = disneyEveryviewAccountKey(listing.accountEmail);
  if (!store.disneyEveryview || !Object.prototype.hasOwnProperty.call(store.disneyEveryview, accountKey)) return null;
  const mapping = store.disneyEveryview[accountKey];
  const ids = mapping && Array.isArray(mapping.partyIds) ? mapping.partyIds : [];
  const valid = ids.length > 0 && ids.every(id => Number.isSafeInteger(id) && id > 0) && new Set(ids).size === ids.length;
  const requiredSources = ['gbuts', ...(valid ? ids.map(id => `everyview:${id}`) : ['everyview:invalid'])];
  const claims: DisneySeatClaim[] = [];
  for (const order of Object.values(store.orders)) {
    const original = store.listings[order.listingId];
    if (!original || ottKey(original.serviceType, original.accountEmail) !== ottKey(listing.serviceType, listing.accountEmail)) continue;
    const holds = activeOttOrder(order, now) || holdsDisneyProfile(order, original, now)
      || (order.status === 'MISSING' && order.cancelStatus !== 'REFUNDED' && order.endDate >= koreaToday(now));
    if (!holds) continue;
    if (options.ignoreUnassignedNewGbuts && order.profileNumber === undefined && deliverableOttOrder(order, now)
      && !order.profileName && !order.attemptedAt && order.delivery === 'ready') continue;
    claims.push({ id: order.key, state: order.status === 'MISSING' ? 'unknown' : 'active', profileNumber: order.profileNumber });
  }
  const snapshots = [{ source: 'gbuts', complete: true, verifiedAt: now.toISOString(), claims }];
  if (valid && mapping?.snapshots && typeof mapping.snapshots === 'object') {
    for (const id of ids) {
      const source = `everyview:${id}`;
      const snapshot = mapping.snapshots[String(id)];
      if (snapshot && snapshot.source === source && Number.isSafeInteger(snapshot.advertisedVacancies)
        && snapshot.advertisedVacancies! >= 0 && Array.isArray(snapshot.claims)
        && snapshot.claims.filter(claim => claim?.kind === 'advertised' && claim.state !== 'released').length === snapshot.advertisedVacancies)
        snapshots.push(snapshot);
    }
  }
  const gbutsCapacity = disneyAccountCapacity(store, listing);
  // The account can have six real profiles while GButs is intentionally limited
  // to five. An explicit mapped account capacity does not expand that policy.
  const accountCapacity = mapping?.accountCapacity === undefined ? gbutsCapacity
    : Number.isInteger(mapping.accountCapacity) && mapping.accountCapacity >= gbutsCapacity && mapping.accountCapacity <= 6
      ? mapping.accountCapacity : 0;
  return evaluateDisneyInventory({ capacity: accountCapacity, requiredSources, snapshots, now, maxAgeMs: DISNEY_EVERYVIEW_MAX_AGE_MS });
}

export function requireDisneyEveryviewAvailable(result: DisneyInventoryResult | null): number | null {
  if (!result) return null;
  if (!result.ok || result.unnumberedClaims > 0) throw Error('에브리뷰 자리·구매자 확인이 필요해 디즈니 판매를 보류합니다.');
  return result.available;
}
