import { describe, expect, it, vi } from 'vitest';
import { sendChatContentAlert } from '../src/alerts/chat-content';
import { buildNewChatAlertCandidate, reserveAndSendChatAlert } from '../src/scheduler/poll-daemon';
import { buyerInquiryMessages } from '../src/api/chat-message-summary';

describe('all-provider Telegram chat contents', () => {
  it('splits long Unicode messages and retries with stable part keys and the official action URL', async () => {
    const sender = vi.fn(async () => ({ sent: true as const, reason: 'sent' as const }));
    const input = { key: 'chat-provider-message', title: '서비스 구매자 문의', body: '상품: MS365',
      message: '문의😊'.repeat(1600) + '\n비번: hidden\nhttps://example.com/customer-link', actionUrl: 'https://email-verify.one/dashboard/chat' };
    sender.mockResolvedValueOnce({ sent: true, reason: 'sent' });
    sender.mockResolvedValueOnce({ sent: false, reason: 'failed' } as any);
    expect((await sendChatContentAlert(input, sender)).reason).toBe('failed');
    const firstKeys = sender.mock.calls.map(x => x[0].key); sender.mockClear();
    await sendChatContentAlert(input, sender);
    expect(sender.mock.calls.slice(0, 2).map(x => x[0].key)).toEqual(firstKeys);
    const bodies = sender.mock.calls.map(x => x[0].body);
    expect(bodies.every(x => x.length < 3500)).toBe(true); expect(bodies.join('')).not.toContain('hidden');
    expect(bodies.join('').match(/문의😊/g)).toHaveLength(1600);
    expect(sender.mock.calls.every(x => x[0].actionUrl === input.actionUrl)).toBe(true);
  });
  it('acknowledges already-delivered parts and preserves disabled sends for retry', async () => {
    const input = { key: 'chat', title: '채팅', body: '구매자', message: '안녕하세요', actionUrl: 'https://gbuts.com/seller/chats' };
    expect(await sendChatContentAlert(input, async () => ({ sent: false, reason: 'throttled' }))).toEqual({ sent: false, reason: 'throttled' });
    expect(await sendChatContentAlert(input, async () => ({ sent: false, reason: 'disabled' }))).toEqual({ sent: false, reason: 'disabled' });
  });
  it('retains GrayTag text beyond 800 characters and retries a reserved message after the freshness window', async () => {
    const now = Date.parse('2026-10-14T03:00:00Z'); const text = '문의 내용 '.repeat(500);
    const message = { message: text, createdAt: new Date(now).toISOString() };
    const deal = { chatRoomUuid: 'room', dealUsid: 'deal', borrowerName: '구매자', productTypeString: '유튜브' };
    const known: Record<string, string> = {}; const alert = buildNewChatAlertCandidate(deal, message, known, { nowMs: now })!;
    expect(alert.text.length).toBeGreaterThan(800);
    await reserveAndSendChatAlert(alert, known, () => true, async () => ({ sent: false, reason: 'failed' }));
    expect(known[alert.fingerprint]).toMatch(/^pending:/);
    expect(buildNewChatAlertCandidate(deal, message, known, { nowMs: now + 3600000 })).not.toBeNull();
    await reserveAndSendChatAlert(alert, known, () => true, async () => ({ sent: false, reason: 'throttled' }));
    expect(buildNewChatAlertCandidate(deal, message, known, { nowMs: now })).toBeNull();
  });
  it('selects all buyer messages from a burst and excludes seller/system messages', () => {
    const entries = [{ message: '첫 문장' }, { message: '이어서 보낸 말' }, { message: '판매자', owned: true }, { message: '알림', isInfo: true }];
    expect(buyerInquiryMessages(entries).map(x => x.message)).toEqual(['첫 문장', '이어서 보낸 말']);
  });
});
