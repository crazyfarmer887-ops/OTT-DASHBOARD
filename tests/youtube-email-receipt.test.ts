import { describe, expect, test, vi } from 'vitest';
import {
  findYouTubeEmailReceiptCandidate,
  syncYouTubeEmailReceipts,
  YOUTUBE_EMAIL_RECEIPT_REPLY,
  type EmailReceiptJournal,
} from '../src/scheduler/youtube-email-receipt';
import { YOUTUBE_NEW_SALE_GUIDE } from '../src/api/youtube-auto-reply';
import type { GraytagChatMessage } from '../src/api/chat-message-summary';
import type { NotionDeliveryDeal } from '../src/scheduler/notion-invitation-sync';

const NOW = Date.parse('2026-09-26T10:00:00+09:00');
const STARTED = Date.parse('2026-09-26T09:00:00+09:00');
const deal: NotionDeliveryDeal = { dealUsid: 'order-1', chatRoomUuid: 'room-1', dealStatus: 'Delivering',
  productTypeString: '유튜브', productName: '광고X' };
const buyer = (message: string, time = '2026.09.26 09:40'): GraytagChatMessage =>
  ({ message, registeredDateTime: time, owned: false });
const seller = (message: string, time = '2026.09.26 09:41'): GraytagChatMessage =>
  ({ message, registeredDateTime: time, owned: true });

describe('YouTube email receipt', () => {
  test('starts without messaging existing buyers, then thanks a new email once', async () => {
    let journal: EmailReceiptJournal | null = null;
    let deals = [deal];
    let messages: GraytagChatMessage[] = [buyer('old@example.com', '2026.09.26 08:40')];
    const send = vi.fn(async () => true);
    const deps = {
      listDeals: async () => deals, listMessages: async () => messages,
      providerStatus: async () => 'Delivering', send,
      readJournal: () => journal,
      writeJournal: (value: EmailReceiptJournal) => { journal = structuredClone(value); },
      now: () => NOW,
    };
    expect(await syncYouTubeEmailReceipts(deps)).toMatchObject({ sent: 0 });
    expect(send).not.toHaveBeenCalled();
    expect(await syncYouTubeEmailReceipts(deps)).toMatchObject({ sent: 0 });
    deals = [{ ...deal, dealUsid: 'order-2', chatRoomUuid: 'room-2' }];
    messages = [buyer('new&#64;example.com', '2026.09.26 10:10')];
    deps.now = () => Date.parse('2026-09-26T10:20:00+09:00');
    expect(await syncYouTubeEmailReceipts(deps)).toMatchObject({ sent: 1, attempted: 1 });
    expect(send).toHaveBeenCalledExactlyOnceWith(deals[0], YOUTUBE_EMAIL_RECEIPT_REPLY);
    expect(await syncYouTubeEmailReceipts(deps)).toMatchObject({ sent: 0 });
    expect(send).toHaveBeenCalledTimes(1);
    deals = [{ ...deal, dealStatus: 'Delivered' }];
    expect(await syncYouTubeEmailReceipts(deps)).toMatchObject({ sent: 0 });
    expect(YOUTUBE_EMAIL_RECEIPT_REPLY).toContain('시차');
    expect(YOUTUBE_EMAIL_RECEIPT_REPLY).toContain('24시간 이내');
    expect(YOUTUBE_EMAIL_RECEIPT_REPLY).toContain('[계정 전달]');
    expect(YOUTUBE_EMAIL_RECEIPT_REPLY).not.toContain('결제되지');
  });

  test('waits for one settled buyer email and ignores corrections, cancellation, and human replies', () => {
    expect(findYouTubeEmailReceiptCandidate('room-1', [buyer('buyer@example.com', '2026.09.26 09:57')], STARTED, NOW)).toBeNull();
    expect(findYouTubeEmailReceiptCandidate('room-1', [buyer('a@example.com b@example.com')], STARTED, NOW)).toBeNull();
    expect(findYouTubeEmailReceiptCandidate('room-1', [buyer('buyer@example.com', '2026.09.26 08:40')], STARTED, NOW)).toBeNull();
    expect(findYouTubeEmailReceiptCandidate('room-1', [buyer('buyer@example.com'), buyer('취소할게요', '2026.09.26 09:45')], STARTED, NOW)).toBeNull();
    expect(findYouTubeEmailReceiptCandidate('room-1', [buyer('buyer@example.com'), buyer('다른 계정으로 바꿀게요', '2026.09.26 09:45')], STARTED, NOW)).toBeNull();
    expect(findYouTubeEmailReceiptCandidate('room-1', [buyer('buyer@example.com'), seller('이메일 확인했습니다')], STARTED, NOW)).toBeNull();
    expect(findYouTubeEmailReceiptCandidate('room-1', [buyer('buyer@example.com'), seller(YOUTUBE_NEW_SALE_GUIDE)], STARTED, NOW)).toMatchObject({ email: 'buyer@example.com' });
  });

  test('does not send after delivery or retry an uncertain chat send', async () => {
    let journal: EmailReceiptJournal | null = { version: 1, startedAt: new Date(STARTED).toISOString(), records: {} };
    let status = 'Delivered';
    const send = vi.fn(async () => { throw new Error('socket closed'); });
    const deps = {
      listDeals: async () => [deal], listMessages: async () => [buyer('buyer@example.com')],
      providerStatus: async () => status, send,
      readJournal: () => journal,
      writeJournal: (value: EmailReceiptJournal) => { journal = structuredClone(value); },
      now: () => NOW,
    };
    expect(await syncYouTubeEmailReceipts(deps)).toMatchObject({ sent: 0, attempted: 0 });
    status = 'Delivering';
    expect(await syncYouTubeEmailReceipts(deps)).toMatchObject({ sent: 0, attempted: 1 });
    expect(await syncYouTubeEmailReceipts(deps)).toMatchObject({ sent: 0, attempted: 0 });
    expect(send).toHaveBeenCalledTimes(1);
  });
});
