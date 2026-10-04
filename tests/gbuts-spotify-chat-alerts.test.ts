import { describe, expect, it, vi } from 'vitest';
import { syncGbutsSpotifyChatAlerts, type GbutsSpotifyChatAlertJournal } from '../src/scheduler/gbuts-spotify-chat-alerts';

const member = { seq: 91, userSeq: 42, productId: '801', status: 'APPLY', cancelStatus: null };
const buyerMessage = { senderSeq: 42, message: 'Spotify email: buyer@example.com\nPassword: sensitive-secret',
  messageType: 'TEXT', createdAt: '2026-10-04T10:01:00Z' };

function setup(messages = [buyerMessage]) {
  const journal: GbutsSpotifyChatAlertJournal = { version: 1, sent: {} };
  const sendAlert = vi.fn(async () => ({ sent: true as const, reason: 'sent' as const }));
  const deps = {
    listMembers: async () => [member], openPrivateRoom: async () => 'ROOM123',
    getChat: async () => ({ messages }), sendAlert,
    readJournal: () => journal, writeJournal: vi.fn(),
    startAt: '2026-10-04T10:00:00Z', now: () => '2026-10-04T10:02:00Z',
  };
  return { deps, journal, sendAlert };
}

describe('GButs Spotify buyer chat alerts', () => {
  it('notifies Telegram about a new buyer message once without exposing credentials', async () => {
    const { deps, journal, sendAlert } = setup();
    expect(await syncGbutsSpotifyChatAlerts(deps, 15557)).toEqual({ sent: 1, messages: 1, failed: 0 });
    expect(sendAlert).toHaveBeenCalledWith(expect.objectContaining({
      category: 'inquiry', body: expect.stringContaining('https://gbuts.com/seller/chats'),
    }));
    const alert = sendAlert.mock.calls[0][0];
    expect(JSON.stringify(alert)).not.toContain('buyer@example.com');
    expect(JSON.stringify(alert)).not.toContain('sensitive-secret');
    expect(JSON.stringify(journal)).not.toContain('sensitive-secret');
    expect(await syncGbutsSpotifyChatAlerts(deps, 15557)).toEqual({ sent: 0, messages: 0, failed: 0 });
    expect(sendAlert).toHaveBeenCalledTimes(1);
  });

  it('groups a burst into one alert and ignores seller messages and historical messages', async () => {
    const { deps, sendAlert } = setup([
      { ...buyerMessage, createdAt: '2026-10-03T10:00:00Z' },
      { ...buyerMessage, senderSeq: 7, message: 'Seller reply' },
      buyerMessage,
      { ...buyerMessage, message: '확인 부탁드립니다', createdAt: '2026-10-04T10:01:01Z' },
    ]);
    expect(await syncGbutsSpotifyChatAlerts(deps, 15557)).toEqual({ sent: 1, messages: 2, failed: 0 });
    expect(sendAlert.mock.calls[0][0].body).toContain('새 구매자 메시지 2개');
  });

  it('retries an alert when Telegram delivery fails', async () => {
    const { deps, journal, sendAlert } = setup();
    sendAlert.mockResolvedValueOnce({ sent: false, reason: 'failed' } as any);
    expect(await syncGbutsSpotifyChatAlerts(deps, 15557)).toEqual({ sent: 0, messages: 0, failed: 1 });
    expect(Object.keys(journal.sent)).toHaveLength(0);
    expect(await syncGbutsSpotifyChatAlerts(deps, 15557)).toEqual({ sent: 1, messages: 1, failed: 0 });
    expect(sendAlert).toHaveBeenCalledTimes(2);
  });

  it('does not send anything for messages before activation', async () => {
    const { deps, sendAlert } = setup([{ ...buyerMessage, createdAt: '2026-10-03T10:01:00Z' }]);
    expect(await syncGbutsSpotifyChatAlerts(deps, 15557)).toEqual({ sent: 0, messages: 0, failed: 0 });
    expect(sendAlert).not.toHaveBeenCalled();
  });
});
