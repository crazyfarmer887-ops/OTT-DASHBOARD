import { existsSync, readFileSync } from 'node:fs';
import { validNetflixGuideDelivery } from './gbuts-netflix-guide';
import { writeJsonAtomic } from './graytag-sales-session';
import { GBUTS_OTT_CATEGORIES, emptyGbutsOttStore, gbutsOttRenewalKey, supportsGbutsOttRenewal, type GbutsOttStore } from './gbuts-ott';
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
      || (listing.rankSeedPostSeq!==undefined&&(!Number.isSafeInteger(listing.rankSeedPostSeq)||listing.rankSeedPostSeq<1))
      || (listing.emailCodeProvider !== undefined && (!['aaryan','emailverify'].includes(listing.emailCodeProvider) || listing.serviceType !== '넷플릭스'))
      || (listing.deliveryMode !== undefined && (listing.deliveryMode !== 'disney-numbered-password' || listing.serviceType !== '디즈니플러스' || listing.capacity > 6))
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
        || (order.directDelivery.format !== undefined && !((order.directDelivery.format === 'disney-mailbox-v1' && data.listings[order.listingId].deliveryMode === 'disney-numbered-password')
          || (order.directDelivery.format === 'netflix-mailbox-v1' && data.listings[order.listingId].emailCodeProvider === 'emailverify')))
        || (order.directDelivery.messageHashes !== undefined && (!Array.isArray(order.directDelivery.messageHashes) || !order.directDelivery.messageHashes.length
          || order.directDelivery.messageHashes.some((hash: unknown) => typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash))))
        || (['attempted', 'confirmed'].includes(order.directDelivery.state) && (!order.directDelivery.messageHash
          || !Number.isFinite(Date.parse(order.directDelivery.attemptedAt))))))
      || (order.deliveryMessage !== undefined && (typeof order.deliveryMessage !== 'string' || !order.deliveryMessage.trim() || order.deliveryMessage.length > 2000))
      || (order.guideImage !== undefined && (!validNetflixGuideDelivery(order.guideImage)
        || data.listings[order.listingId].serviceType !== '넷플릭스' || data.listings[order.listingId].emailCodeProvider !== 'emailverify'
        || order.guideImage.roomId !== order.roomId))
      || (order.credentialDeliveryPolicy !== undefined && (order.credentialDeliveryPolicy !== 'netflix-password-v1' || data.listings[order.listingId].serviceType !== '넷플릭스'))
      || (order.profileNumber !== undefined && ((data.listings[order.listingId].serviceType !== '넷플릭스' && data.listings[order.listingId].deliveryMode !== 'disney-numbered-password') || !Number.isInteger(order.profileNumber) || order.profileNumber < 1 || order.profileNumber > (data.listings[order.listingId].deliveryMode === 'disney-numbered-password' ? 6 : 5) || order.profileName !== String(order.profileNumber)))
      || (order.profileReleasedAt !== undefined && (order.profileNumber === undefined || !Number.isFinite(Date.parse(order.profileReleasedAt)) || !['refunded', 'expired'].includes(order.profileReleaseReason)))) throw new Error('벗츠 구매자 기록이 올바르지 않습니다.');
  for (const [id, claim] of Object.entries(data.graytagClaims) as Array<[string, any]>)
    if (claim?.id !== id || !GBUTS_OTT_CATEGORIES[claim.serviceType] || typeof claim.accountEmail !== 'string' || !claim.accountEmail.trim()
      || !['pending', 'registered', 'uncertain'].includes(claim.state)) throw new Error('그레이태그 자리 확보 기록이 올바르지 않습니다.');
  if (data.renewals !== undefined) {
    if (!data.renewals || typeof data.renewals !== 'object' || Array.isArray(data.renewals)) throw new Error('자동 재등록 설정이 올바르지 않습니다.');
    for (const [key, policy] of Object.entries(data.renewals) as Array<[string, any]>) {
      const listing = data.listings[policy?.listingId];
      if (!listing || !supportsGbutsOttRenewal(listing) || typeof policy.accountEmail !== 'string'
        || key !== gbutsOttRenewalKey(listing.serviceType, policy.accountEmail)
        || listing.accountEmail.trim().toLowerCase() !== policy.accountEmail.trim().toLowerCase()
        || (policy.serviceType !== undefined && policy.serviceType !== listing.serviceType) || typeof policy.enabled !== 'boolean'
        || !Number.isInteger(policy.capacity) || policy.capacity < 1 || policy.capacity > (listing.serviceType === '넷플릭스' ? 5 : 6)
        || (listing.serviceType === '넷플릭스' && policy.saleTerms !== undefined)
        || (policy.trigger !== undefined && !['hourly', 'rank'].includes(policy.trigger))
        || (policy.trigger === 'rank' && (!Number.isInteger(policy.rankThreshold) || policy.rankThreshold < 2 || policy.rankThreshold > 20))
        || (policy.lastRank !== undefined && policy.lastRank !== null && (!Number.isInteger(policy.lastRank) || policy.lastRank < 1 || policy.lastRank > 20))
        || [policy.rankCheckedAt, policy.lastRepostedAt].some(value => value !== undefined && !Number.isFinite(Date.parse(value)))
        || (policy.saleTerms !== undefined && (!policy.saleTerms || !Number.isSafeInteger(policy.saleTerms.dailyPrice) || policy.saleTerms.dailyPrice < 1 || policy.saleTerms.dailyPrice > 1000000
          || typeof policy.saleTerms.title !== 'string' || !policy.saleTerms.title.trim() || policy.saleTerms.title.length > 30))
        || (policy.saleTermsAppliedTo !== undefined && (!Number.isSafeInteger(policy.saleTermsAppliedTo) || policy.saleTermsAppliedTo < 1))
        || (policy.saleTermsRetryAt !== undefined && !Number.isFinite(Date.parse(policy.saleTermsRetryAt)))
        || (policy.earlyRenewalNextAt !== undefined && !Number.isFinite(Date.parse(policy.earlyRenewalNextAt)))
        || !Number.isFinite(Date.parse(policy.nextAt)) || (policy.pendingId && (!data.listings[policy.pendingId]
          || data.listings[policy.pendingId].repostFrom !== listing.id
          || data.listings[policy.pendingId].serviceType !== listing.serviceType
          || data.listings[policy.pendingId].accountEmail.trim().toLowerCase() !== listing.accountEmail.trim().toLowerCase())))
        throw new Error('자동 재등록 설정이 올바르지 않습니다.');
    }
  }
  return data;
}
export function writeGbutsOttStore(store: GbutsOttStore, path = process.env.GBUTS_OTT_STORE_PATH || DEFAULT_PATH) { writeJsonAtomic(path, store); }
// The deployed API and polling daemon share one process. Serialize their read/write
// transactions, including external writes, so publication and polls cannot lose claims.
let queue: Promise<unknown> = Promise.resolve();
export function withGbutsOttInventory<T>(work: () => Promise<T>): Promise<T> {
  const operation = queue.then(work, work); queue = operation.catch(() => {}); return operation;
}
