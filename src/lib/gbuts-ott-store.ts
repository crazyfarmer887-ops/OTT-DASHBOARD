import { existsSync, readFileSync } from 'node:fs';
import { writeJsonAtomic } from './graytag-sales-session';
import { GBUTS_OTT_CATEGORIES, emptyGbutsOttStore, type GbutsOttStore } from './gbuts-ott';
const DEFAULT_PATH = '/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data/gbuts-ott-sales.json';
export function readGbutsOttStore(path = process.env.GBUTS_OTT_STORE_PATH || DEFAULT_PATH): GbutsOttStore {
  if (!existsSync(path)) return emptyGbutsOttStore();
  const data = JSON.parse(readFileSync(path, 'utf8'));
  if (data.version !== 1 || !data.listings || !data.orders || !data.graytagClaims
    || [data.listings, data.orders, data.graytagClaims].some(x => typeof x !== 'object' || Array.isArray(x)))
    throw new Error('벗츠 공동 재고 기록을 확인하지 못했습니다.');
  for (const [id, listing] of Object.entries(data.listings) as Array<[string, any]>) {
    if (listing?.id !== id || !Number.isSafeInteger(listing.capacity) || listing.capacity < 1
      || !GBUTS_OTT_CATEGORIES[listing.serviceType] || typeof listing.accountEmail !== 'string' || !listing.accountEmail.trim()
      || !['submitting', 'registered', 'uncertain', 'failed', 'closed'].includes(listing.state)
      || !/^\d{4}-\d{2}-\d{2}$/.test(listing.endDate)) throw new Error('벗츠 판매 재고 기록이 올바르지 않습니다.');
  }
  for (const [key, order] of Object.entries(data.orders) as Array<[string, any]>)
    if (order?.key !== key || !data.listings[order.listingId] || !Number.isSafeInteger(order.memberSeq)
      || order.memberSeq < 1 || !Number.isSafeInteger(order.userSeq) || order.userSeq < 1
      || key !== `${order.postSeq}:${order.memberSeq}` || order.postSeq !== data.listings[order.listingId].postSeq
      || !['ready', 'attempted', 'confirmed', 'blocked'].includes(order.delivery) || typeof order.endDate !== 'string'
      || (order.directDelivery !== undefined && (!order.directDelivery || typeof order.directDelivery !== 'object'
        || !['ready', 'attempted', 'confirmed', 'blocked'].includes(order.directDelivery.state)
        || !Number.isFinite(Date.parse(order.directDelivery.requestAt)) || !/^[a-f0-9]{64}$/.test(order.directDelivery.requestKey)
        || (order.directDelivery.messageHash !== undefined && !/^[a-f0-9]{64}$/.test(order.directDelivery.messageHash))
        || (['attempted', 'confirmed'].includes(order.directDelivery.state) && (!order.directDelivery.messageHash
          || !Number.isFinite(Date.parse(order.directDelivery.attemptedAt))))))
      || (order.deliveryMessage !== undefined && (typeof order.deliveryMessage !== 'string' || !order.deliveryMessage.trim() || order.deliveryMessage.length > 2000))
      || (order.profileNumber !== undefined && (data.listings[order.listingId].serviceType !== '넷플릭스' || !Number.isInteger(order.profileNumber) || order.profileNumber < 1 || order.profileNumber > 5 || order.profileName !== String(order.profileNumber)))
      || (order.profileReleasedAt !== undefined && (order.profileNumber === undefined || !Number.isFinite(Date.parse(order.profileReleasedAt)) || !['refunded', 'expired'].includes(order.profileReleaseReason)))) throw new Error('벗츠 구매자 기록이 올바르지 않습니다.');
  for (const [id, claim] of Object.entries(data.graytagClaims) as Array<[string, any]>)
    if (claim?.id !== id || !GBUTS_OTT_CATEGORIES[claim.serviceType] || typeof claim.accountEmail !== 'string' || !claim.accountEmail.trim()
      || !['pending', 'registered', 'uncertain'].includes(claim.state)) throw new Error('그레이태그 자리 확보 기록이 올바르지 않습니다.');
  return data;
}
export function writeGbutsOttStore(store: GbutsOttStore, path = process.env.GBUTS_OTT_STORE_PATH || DEFAULT_PATH) { writeJsonAtomic(path, store); }
// The deployed API and polling daemon share one process. Serialize their read/write
// transactions, including external writes, so publication and polls cannot lose claims.
let queue: Promise<unknown> = Promise.resolve();
export function withGbutsOttInventory<T>(work: () => Promise<T>): Promise<T> {
  const operation = queue.then(work, work); queue = operation.catch(() => {}); return operation;
}
