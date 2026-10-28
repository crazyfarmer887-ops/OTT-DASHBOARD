import { GbutsChatDeliveryError } from '../lib/gbuts-chat-delivery';
import { deliverableOttOrder, hasGbutsOttProfileLease, type GbutsOttOrder, type GbutsOttStore } from '../lib/gbuts-ott';
import { NETFLIX_GUIDE_ASSET, readNetflixGuideConfig, type NetflixGuideConfig } from '../lib/gbuts-netflix-guide';
import type { GbutsChatMessage } from '../lib/gbuts-spotify';
import { sendGbutsImage } from './gbuts-spotify-messages';

export interface NetflixGuideRuntime {
  config(): NetflixGuideConfig | null;
  send: typeof sendGbutsImage;
}
export const netflixGuideRuntime: NetflixGuideRuntime = { config: readNetflixGuideConfig, send: sendGbutsImage };
const pendingError = '계정 안내는 전달됐으나 사용법 이미지 발송 결과 확인 중 — 중복 발송을 보류합니다.';
export function prepareNetflixGuide(store: GbutsOttStore, order: GbutsOttOrder, config: NetflixGuideConfig | null): void {
  const listing = store.listings[order.listingId];
  // Never migrate historical recipients or attach a guide to an explicit repeat request.
  if (order.guideImage || order.directDelivery || !order.roomId || !config?.enabled
    || listing.serviceType !== '넷플릭스' || listing.emailCodeProvider !== 'emailverify'
    || !config.allowedAccountEmails.some(email => email.toLowerCase() === listing.accountEmail.toLowerCase())
    || !order.purchasedAt || !Number.isFinite(Date.parse(order.purchasedAt))
    || Date.parse(order.purchasedAt) < Date.parse(config.activatedAt)) return;
  order.guideImage = { version: NETFLIX_GUIDE_ASSET.version, url: NETFLIX_GUIDE_ASSET.url, assetHash: NETFLIX_GUIDE_ASSET.sha256,
    roomId: order.roomId, state: 'ready', createdAt: new Date().toISOString() };
}
export async function syncNetflixGuide(store: GbutsOttStore, order: GbutsOttOrder, seller: number,
  getChat: () => Promise<{ messages: GbutsChatMessage[] }>, write: (store: GbutsOttStore) => void,
  runtime: NetflixGuideRuntime = netflixGuideRuntime): Promise<void> {
  const d = order.guideImage, listing = store.listings[order.listingId];
  if (!d || d.state === 'confirmed' || d.state === 'blocked' || !deliverableOttOrder(order)
    || order.delivery !== 'confirmed' || order.directDelivery?.state !== 'confirmed'
    || listing.serviceType !== '넷플릭스' || listing.emailCodeProvider !== 'emailverify'
    || !hasGbutsOttProfileLease(store, order) || !order.roomId || d.roomId !== order.roomId) return;
  const saved = async () => (await getChat()).messages.some(m => m.senderSeq === seller
    && m.messageType === 'IMAGE' && m.images?.includes(d.url));
  const confirm = () => { d.state = 'confirmed'; d.attemptedAt ||= d.createdAt;
    d.confirmedAt = new Date().toISOString(); if (order.error?.startsWith('계정 안내는 전달됐으나')) delete order.error; write(store); };
  try {
    if (await saved()) { confirm(); return; }
    if (d.state === 'attempted') { order.error = pendingError; write(store); return; }
    const c = runtime.config();
    if (!c?.enabled || !c.allowedAccountEmails.some(x => x.toLowerCase() === listing.accountEmail.toLowerCase())) return;
    d.state = 'attempted'; d.attemptedAt = new Date().toISOString(); write(store);
    await runtime.send(order.roomId, seller, d.url);
    if (await saved()) confirm(); else { order.error = pendingError; write(store); }
  } catch (error) {
    if (error instanceof GbutsChatDeliveryError && !error.submitted) {
      d.state = error.retryable ? 'ready' : 'blocked'; delete d.attemptedAt;
      order.error = '계정 안내는 전달됐으나 사용법 이미지 연결을 확인해야 합니다.';
    } else order.error = pendingError;
    write(store);
  }
}
