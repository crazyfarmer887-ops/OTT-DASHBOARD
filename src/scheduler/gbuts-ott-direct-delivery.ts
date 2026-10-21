import { createHash } from 'node:crypto';
import { GbutsChatDeliveryError, splitGbutsChatText, type GbutsTextMessage } from '../lib/gbuts-chat-delivery';
import { deliverableOttOrder, hasGbutsOttProfileLease, type GbutsOttOrder, type GbutsOttStore } from '../lib/gbuts-ott';
import { isGraytagAccessNoticeCredential } from '../lib/graytag-fill';
import type { createGbutsOttSellerClient } from '../lib/gbuts-ott-client';
import type { GbutsOttRuntimeDependencies } from './gbuts-ott-sync';
import { sendGbutsText } from './gbuts-spotify-messages';
import { buildGbutsDisneyDirectText, DISNEY_DIRECT_FORMAT } from '../lib/gbuts-disney-delivery';

const fingerprint = (text: string) => createHash('sha256').update(text.trim()).digest('hex');
// GButs also returns local Korean timestamps without a UTC offset.
function messageTime(value: string): number {
  const local = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value);
  return Date.parse(local ? `${value.replace(' ', 'T')}+09:00` : value);
}
function savedDirectMessage(messages: Array<GbutsTextMessage & { createdAt: string }>, sellerSeq: number, delivery: NonNullable<GbutsOttOrder['directDelivery']>): boolean {
  const hashes = delivery.messageHashes || [delivery.messageHash];
  return hashes.every(hash => !!hash && messages.some(m => m.senderSeq === sellerSeq && m.messageType === 'TEXT'
    && messageTime(m.createdAt) >= Date.parse(delivery.requestAt) && fingerprint(m.message) === hash));
}

export async function syncGbutsDirectCredentials(store: GbutsOttStore, orders: GbutsOttOrder[], sellerSeq: number,
  deps: GbutsOttRuntimeDependencies, client: ReturnType<typeof createGbutsOttSellerClient>,
  write: (store: GbutsOttStore) => void, send: typeof sendGbutsText = sendGbutsText): Promise<void> {
  if (!deps.credentials) return;
  for (const order of orders) {
    if (!deliverableOttOrder(order) || order.delivery !== 'confirmed' || !order.profileName
      || !hasGbutsOttProfileLease(store, order)
      || (store.listings[order.listingId].serviceType === '넷플릭스' && order.profileNumber === undefined)) continue;
    try {
      const roomId = await client.openPrivateRoom(order.postSeq, order.userSeq);
      if (order.roomId !== roomId) throw new Error('구매자 채팅방 연결을 확인하지 못했습니다.');
      const messages = (await client.getChat(roomId)).messages;
      const previous = order.directDelivery;
      // An uncertain submission must be reconciled before considering another request.
      if (previous?.state === 'attempted') {
        if (savedDirectMessage(messages, sellerSeq, previous)) {
          previous.state = 'confirmed'; delete order.error;
        } else order.error = '직접 계정 전달 발송 결과 확인 중 — 중복 발송을 보류합니다.';
        write(store);
        if (previous.state === 'attempted') continue;
      }
      const requests = messages.filter(m => m.senderSeq === order.userSeq && m.messageType === 'TEXT' && m.message.trim() === '!')
        .map(m => ({ time: messageTime(m.createdAt), key: fingerprint(`${m.senderSeq}:${m.createdAt}:!`) }))
        .filter(m => Number.isFinite(m.time) && m.time >= messageTime(order.purchasedAt || `${order.startDate}T00:00:00+09:00`)
          && m.time <= Date.now() + 60_000).sort((a, b) => b.time - a.time);
      // Numbered Disney purchases receive credentials without a buyer prompt.
      // Reuse the hashed delivery journal so restart/uncertain-send handling is
      // identical to an explicit request, without persisting the password.
      const purchasedAt = messageTime(order.purchasedAt || `${order.startDate}T00:00:00+09:00`);
      const disney = store.listings[order.listingId].deliveryMode === 'disney-numbered-password';
      const initialKey = fingerprint(`${DISNEY_DIRECT_FORMAT}:${order.key}`);
      const upgrade = previous && ['confirmed', 'ready'].includes(previous.state) && previous.format !== DISNEY_DIRECT_FORMAT;
      const initial = (!previous || upgrade || (previous.state === 'ready' && previous.requestKey === initialKey)) && disney
        && Number.isFinite(purchasedAt) && purchasedAt <= Date.now()
        ? { time: previous?.requestKey === initialKey ? Date.parse(previous.requestAt) : previous ? Date.now() : purchasedAt, key: initialKey } : undefined;
      const freshRequest = requests.find(request => !previous || (request.time >= Date.parse(previous.requestAt)
        && (request.key !== previous.requestKey || previous.state === 'ready')));
      // Do not send an automatic migration message after the seller has already
      // agreed to a refund while the buyer's provider request is still pending.
      if (disney && upgrade && !freshRequest && messages.some(m => m.senderSeq === sellerSeq && m.messageType === 'TEXT'
        && /환불\s*(?:진행해드리겠습니다|신청해주세요)/.test(m.message)
        && messageTime(m.createdAt) >= Date.parse(previous.requestAt))) continue;
      const request = freshRequest || initial;
      if (!request) continue;
      if (previous && (request.time < Date.parse(previous.requestAt)
        || (request.key === previous.requestKey && previous.state !== 'ready'))) continue;
      const delivery = order.directDelivery = previous?.requestKey === request.key ? previous
        : { requestAt: new Date(request.time).toISOString(), requestKey: request.key, state: 'ready' };
      const credentials = await deps.credentials(order, store.listings[order.listingId]);
      const { id, password } = credentials;
      if (![id, password].every(value => value.trim() && !/[\r\n]/.test(value) && !isGraytagAccessNoticeCredential(value)))
        throw new Error('최신 ID·비밀번호가 올바르지 않습니다.');
      const text = disney ? buildGbutsDisneyDirectText(credentials, order.profileNumber!) : `ID : ${id}\nPW : ${password}`;
      if (!disney && Buffer.byteLength(text) > 500) throw new Error('직접 계정 전달 문구가 채팅 전송 한도를 초과했습니다.');
      if (disney) { delivery.format = DISNEY_DIRECT_FORMAT; delivery.messageHashes = splitGbutsChatText(text).map(fingerprint); }
      delivery.messageHash = fingerprint(text); delivery.state = 'attempted'; delivery.attemptedAt = new Date().toISOString();
      delete order.error; write(store);
      try {
        await send(roomId, sellerSeq, text);
        const saved = savedDirectMessage((await client.getChat(roomId)).messages, sellerSeq, delivery);
        if (saved) delivery.state = 'confirmed';
        else order.error = '직접 계정 전달 발송 결과 확인 중';
      } catch (error) {
        if (error instanceof GbutsChatDeliveryError && !error.submitted) {
          delivery.state = error.retryable ? 'ready' : 'blocked'; delete delivery.attemptedAt;
          order.error = error.retryable ? '직접 계정 전달 연결 실패 — 다음 확인 때 자동 재시도합니다.' : '직접 계정 전달 전송 제한을 확인해주세요.';
        } else order.error = '직접 계정 전달 발송 결과 확인 중';
      }
      write(store);
    } catch {
      // Provider errors can contain account data. Only this generic error reaches the journal/UI.
      order.error = '직접 계정 전달에 필요한 구매자·계정·채팅 연결을 확인하지 못했습니다.'; write(store);
    }
  }
}
