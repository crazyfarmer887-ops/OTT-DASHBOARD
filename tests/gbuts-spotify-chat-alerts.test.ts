import { describe, expect, it, vi } from 'vitest';
import { gbutsTelegramMessageParts, syncGbutsSpotifyChatAlerts, type GbutsSpotifyChatAlertJournal } from '../src/scheduler/gbuts-spotify-chat-alerts';
import { GbutsSellerRequestError } from '../src/lib/gbuts-spotify';

const member = { seq: 91, userSeq: 42, productId: '801', status: 'APPLY', cancelStatus: null };
const buyerMessage = { senderSeq: 42, message: 'Spotify email: buyer@example.com\nPassword: sensitive-secret',
  messageType: 'TEXT', createdAt: '2026-10-04T10:01:00Z' };

function setup(messages = [buyerMessage]) {
  const journal: GbutsSpotifyChatAlertJournal = { version: 1, sent: {} };
  const sendAlert = vi.fn(async () => ({ sent: true as const, reason: 'sent' as const }));
  const deps = {
    listMembers: async () => [member], openPrivateRoom: async (_post: number, _user: number) => 'ROOM123',
    getChat: async () => ({ messages }), sendAlert,
    readJournal: () => journal, writeJournal: vi.fn(),
    startAt: '2026-10-04T10:00:00Z', now: () => '2026-10-04T10:02:00Z',
  };
  return { deps, journal, sendAlert };
}

describe('GButs Spotify buyer chat alerts', () => {
  it('shows buyer message content and email once while masking labeled credentials', async () => {
    const { deps, journal, sendAlert } = setup();
    expect(await syncGbutsSpotifyChatAlerts(deps, 15557)).toEqual({ sent: 1, messages: 1, failed: 0, unavailable: 0 });
    expect(sendAlert).toHaveBeenCalledWith(expect.objectContaining({
      category: 'inquiry', body: expect.stringContaining('https://gbuts.com/seller/chats'),
    }));
    const alert = sendAlert.mock.calls[0][0];
    expect(alert.body).toContain('buyer@example.com');
    expect(alert.body).toContain('2026-10-04T10:01:00Z');
    expect(alert.body).toContain('주문: 15557:91');
    expect(JSON.stringify(alert)).not.toContain('sensitive-secret');
    expect(JSON.stringify(journal)).not.toContain('sensitive-secret');
    expect(await syncGbutsSpotifyChatAlerts(deps, 15557)).toEqual({ sent: 0, messages: 0, failed: 0, unavailable: 0 });
    expect(sendAlert).toHaveBeenCalledTimes(1);
  });

  it('groups a burst into one alert and ignores seller messages and historical messages', async () => {
    const { deps, sendAlert } = setup([
      { ...buyerMessage, createdAt: '2026-10-03T10:00:00Z' },
      { ...buyerMessage, senderSeq: 7, message: 'Seller reply' },
      buyerMessage,
      { ...buyerMessage, message: '확인 부탁드립니다', createdAt: '2026-10-04T10:01:01Z' },
    ]);
    expect(await syncGbutsSpotifyChatAlerts(deps, 15557)).toEqual({ sent: 1, messages: 2, failed: 0, unavailable: 0 });
    expect(sendAlert.mock.calls[0][0].body).toContain('새 구매자 메시지 2개');
    expect(sendAlert.mock.calls[0][0].body).toContain('확인 부탁드립니다');
    expect(sendAlert.mock.calls[0][0].body).not.toContain('Seller reply');
  });

  it('retries an alert when Telegram delivery fails', async () => {
    const { deps, journal, sendAlert } = setup();
    sendAlert.mockResolvedValueOnce({ sent: false, reason: 'failed' } as any);
    expect(await syncGbutsSpotifyChatAlerts(deps, 15557)).toEqual({ sent: 0, messages: 0, failed: 1, unavailable: 0 });
    expect(Object.keys(journal.sent)).toHaveLength(0);
    expect(await syncGbutsSpotifyChatAlerts(deps, 15557)).toEqual({ sent: 1, messages: 1, failed: 0, unavailable: 0 });
    expect(sendAlert).toHaveBeenCalledTimes(2);
  });

  it('does not send anything for messages before activation', async () => {
    const { deps, sendAlert } = setup([{ ...buyerMessage, createdAt: '2026-10-03T10:01:00Z' }]);
    expect(await syncGbutsSpotifyChatAlerts(deps, 15557)).toEqual({ sent: 0, messages: 0, failed: 0, unavailable: 0 });
    expect(sendAlert).not.toHaveBeenCalled();
  });

  it('splits a long message without losing text or splitting emoji and redacts before splitting', () => {
    const text = '긴문의😊'.repeat(1100);
    const parts = gbutsTelegramMessageParts(text);
    expect(parts.join('')).toBe(text);
    expect(parts.every(x => x.length <= 1800 && !/[\uD800-\uDBFF]$/.test(x))).toBe(true);
    expect(gbutsTelegramMessageParts('비밀번호: 비밀123\n비번=비밀456\npwd=private\npassword=' + 's'.repeat(4000)).join('')).toBe('비밀번호: [redacted]\n비번=[redacted]\npwd=[redacted]\npassword=[redacted]');
  });

  it('resumes a partially delivered long message without repeating successful parts', async () => {
    const { deps, journal, sendAlert } = setup([{ ...buyerMessage, message: '문자열😊'.repeat(900) }]);
    sendAlert.mockResolvedValueOnce({ sent: true, reason: 'sent' });
    sendAlert.mockResolvedValueOnce({ sent: false, reason: 'failed' } as any);
    expect(await syncGbutsSpotifyChatAlerts(deps, 15557)).toEqual({ sent: 1, messages: 0, failed: 1, unavailable: 0 });
    const first = sendAlert.mock.calls[0][0];
    expect(await syncGbutsSpotifyChatAlerts(deps, 15557)).toEqual({ sent: 2, messages: 1, failed: 0, unavailable: 0 });
    expect(sendAlert.mock.calls.slice(1).every(call => call[0].key !== first.key)).toBe(true);
    expect(sendAlert.mock.calls.every(call => call[0].body.length < 3500)).toBe(true);
    expect(JSON.stringify(journal)).not.toContain('문자열');
    expect(await syncGbutsSpotifyChatAlerts(deps, 15557)).toEqual({ sent: 0, messages: 0, failed: 0, unavailable: 0 });
  });

  it('preserves repeated messages and does not acknowledge disabled delivery', async () => {
    const { deps, sendAlert } = setup([buyerMessage, buyerMessage]);
    sendAlert.mockResolvedValueOnce({ sent: false, reason: 'disabled' } as any);
    expect(await syncGbutsSpotifyChatAlerts(deps, 15557)).toEqual({ sent: 0, messages: 0, failed: 0, unavailable: 0 });
    expect(await syncGbutsSpotifyChatAlerts(deps, 15557)).toEqual({ sent: 1, messages: 2, failed: 0, unavailable: 0 });
    expect(sendAlert.mock.calls[1][0].body.match(/buyer@example.com/g)).toHaveLength(2);
  });

  it('continues with another buyer when one chat cannot be read', async () => {
    const { deps, sendAlert } = setup([{ ...buyerMessage, senderSeq: 43 }]);
    deps.listMembers = async () => [member, { ...member, seq: 92, userSeq: 43 }];
    deps.openPrivateRoom = async (_post: number, user: number) => { if (user === 42) throw new Error('unavailable'); return 'ROOM2'; };
    expect(await syncGbutsSpotifyChatAlerts(deps, 15557)).toEqual({ sent: 1, messages: 1, failed: 1, unavailable: 0 });
    expect(sendAlert).toHaveBeenCalledTimes(1);
  });
  it('records deliberately suppressed routine messages and still alerts for an unresolved issue',async()=>{
    const {deps,journal,sendAlert}=setup([
      {...buyerMessage,message:'4자리 로그인 코드',createdAt:'2026-10-04T10:01:00Z'},
      {...buyerMessage,message:'코드가 안 와요',createdAt:'2026-10-04T10:01:01Z'},
    ]);
    const scoped={...deps,suppressBuyerMessage:(_post:number,_member:typeof member,entry:typeof buyerMessage)=>entry.message==='4자리 로그인 코드'};
    const result=await syncGbutsSpotifyChatAlerts(scoped,15557);
    expect(result).toMatchObject({sent:1,messages:1});expect(sendAlert.mock.calls[0][0].body).toContain('코드가 안 와요');
    expect(sendAlert.mock.calls[0][0].body).not.toContain('4자리 로그인 코드');expect(Object.keys(journal.sent).length).toBeGreaterThan(0);
    await syncGbutsSpotifyChatAlerts(scoped,15557);expect(sendAlert).toHaveBeenCalledTimes(1);
  });

  it('only treats an inaccessible completed refund as closed, not ordinary request failures', async () => {
    const { deps } = setup();
    deps.listMembers = async () => [{ ...member, cancelStatus: 'REFUNDED' }];
    deps.openPrivateRoom = async () => { throw new GbutsSellerRequestError(400); };
    expect(await syncGbutsSpotifyChatAlerts(deps, 15557)).toEqual({ sent: 0, messages: 0, failed: 0, unavailable: 1 });
    deps.openPrivateRoom = async () => { throw new GbutsSellerRequestError(500); };
    expect(await syncGbutsSpotifyChatAlerts(deps, 15557)).toEqual({ sent: 0, messages: 0, failed: 1, unavailable: 0 });
    deps.listMembers = async () => [member];
    deps.openPrivateRoom = async () => { throw new GbutsSellerRequestError(400); };
    expect(await syncGbutsSpotifyChatAlerts(deps, 15557)).toEqual({ sent: 0, messages: 0, failed: 1, unavailable: 0 });
  });
});
