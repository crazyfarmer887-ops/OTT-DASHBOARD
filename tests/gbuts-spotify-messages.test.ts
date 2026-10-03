import { describe, expect, it, vi } from 'vitest';
import { SPOTIFY_BUYER_GUIDE, SPOTIFY_REQUEST_ACK, requestedSpotifyNewAccount,
  syncGbutsSpotifyMessages, type GbutsSpotifyMessageJournal } from '../src/scheduler/gbuts-spotify-messages';
import type { SpotifyNotionRow } from '../src/scheduler/gbuts-spotify-sync';

const member = { seq: 91, userSeq: 42, productId: '801', status: 'APPLY', cancelStatus: null };
const row: SpotifyNotionRow = { id: 'page-1', orderKey: '15557:91', email: 'buyer@example.com',
  emailHistory: [], password: 'secret123', invited: true, cancelled: false };
const buyerMessage = { senderSeq: 42, message: 'Spotify email: buyer@example.com\nPassword: secret123',
  messageType: 'TEXT', createdAt: '2026-10-02T10:00:00Z' };

describe('GButs Spotify buyer messages', () => {
  it('asks an active buyer for credentials once and records an uncertain send', async () => {
    const journal: GbutsSpotifyMessageJournal = { version: 1, records: {} };
    const sendText = vi.fn(async () => { throw new Error('network outcome unknown'); });
    const deps = {
      listMembers: async () => [member], openPrivateRoom: async () => '777',
      getChat: async () => ({ messages: [] }), sellerAccountSeq: async () => 7,
      listRows: async () => [], sendText, readJournal: () => journal,
      writeJournal: vi.fn(), now: () => '2026-10-02T10:01:00Z', requestAckStartAt: '2026-10-03T00:00:00Z',
    };
    expect(await syncGbutsSpotifyMessages(deps, 15557)).toMatchObject({ guidesAttempted: 1 });
    expect(sendText).toHaveBeenCalledWith('777', 7, SPOTIFY_BUYER_GUIDE);
    expect(await syncGbutsSpotifyMessages(deps, 15557)).toMatchObject({ guidesAttempted: 0 });
    expect(sendText).toHaveBeenCalledTimes(1);
  });

  it('confirms the partner check through a private buyer reply only after credentials match', async () => {
    const journal: GbutsSpotifyMessageJournal = { version: 1, records: {} };
    const sendText = vi.fn(async () => undefined);
    const deps = {
      listMembers: async () => [member], openPrivateRoom: async () => '777',
      getChat: async () => ({ messages: [buyerMessage] }), sellerAccountSeq: async () => 7,
      listRows: async () => [row], sendText, readJournal: () => journal,
      writeJournal: vi.fn(), now: () => '2026-10-02T10:01:00Z', requestAckStartAt: '2026-10-03T00:00:00Z',
    };
    expect(await syncGbutsSpotifyMessages(deps, 15557)).toMatchObject({ invitedRepliesAttempted: 1, guidesAttempted: 0 });
    expect(sendText).toHaveBeenCalledWith('777', 7, expect.stringContaining('buyer@example.com'));
    expect(await syncGbutsSpotifyMessages(deps, 15557)).toMatchObject({ invitedRepliesAttempted: 0 });
    expect(sendText).toHaveBeenCalledTimes(1);
  });

  it('does not confirm a stale checkbox after the buyer changes credentials', async () => {
    const sendText = vi.fn();
    const result = await syncGbutsSpotifyMessages({
      listMembers: async () => [member], openPrivateRoom: async () => '777',
      getChat: async () => ({ messages: [{ ...buyerMessage, message: 'Spotify email: new@example.com\nPassword: newsecret' }] }),
      sellerAccountSeq: async () => 7, listRows: async () => [row], sendText,
      readJournal: () => ({ version: 1, records: {} }), writeJournal: vi.fn(),
      requestAckStartAt: '2026-10-03T00:00:00Z',
    }, 15557);
    expect(result.invitedRepliesAttempted).toBe(0);
    expect(sendText).not.toHaveBeenCalled();
  });

  it('acknowledges a new buyer credential submission once, even after a retry or account correction', async () => {
    const journal: GbutsSpotifyMessageJournal = { version: 1, records: {} };
    let messages = [{ ...buyerMessage, createdAt: '2026-10-03T11:00:00Z' }];
    const sendText = vi.fn(async () => undefined);
    const deps = {
      listMembers: async () => [member], openPrivateRoom: async () => '777',
      getChat: async () => ({ messages }), sellerAccountSeq: async () => 7,
      listRows: async () => [], sendText, readJournal: () => journal,
      writeJournal: vi.fn(), requestAckStartAt: '2026-10-03T10:00:00Z',
    };
    expect(await syncGbutsSpotifyMessages(deps, 15557)).toMatchObject({ acknowledgementsAttempted: 1, guidesAttempted: 0 });
    expect(sendText).toHaveBeenCalledWith('777', 7, SPOTIFY_REQUEST_ACK);
    messages = [{ ...buyerMessage, message: 'Spotify email: corrected@example.com\nPassword: newsecret123',
      createdAt: '2026-10-03T12:00:00Z' }];
    expect(await syncGbutsSpotifyMessages(deps, 15557)).toMatchObject({ acknowledgementsAttempted: 0 });
    expect(sendText).toHaveBeenCalledTimes(1);
  });

  it.each(['②', '2번이요', '2번으로 해주세요', '새 계정 발급 부탁드립니다', '신규 계정 만들어주세요'])(
    'acknowledges an explicit new-account choice: %s', async (choice) => {
      const journal: GbutsSpotifyMessageJournal = { version: 1, records: {} };
      const sendText = vi.fn(async () => undefined);
      const messages = [
        { ...buyerMessage, senderSeq: 7, message: SPOTIFY_BUYER_GUIDE, createdAt: '2026-10-03T10:00:00Z' },
        { ...buyerMessage, message: choice, createdAt: '2026-10-03T10:01:00Z' },
      ];
      const result = await syncGbutsSpotifyMessages({
        listMembers: async () => [member], openPrivateRoom: async () => '777',
        getChat: async () => ({ messages }), sellerAccountSeq: async () => 7,
        listRows: async () => [], sendText, readJournal: () => journal,
        writeJournal: vi.fn(), requestAckStartAt: '2026-10-03T10:00:30Z',
      }, 15557);
      expect(result).toMatchObject({ guidesAttempted: 0, acknowledgementsAttempted: 1 });
      expect(sendText).toHaveBeenCalledExactlyOnceWith('777', 7, SPOTIFY_REQUEST_ACK);
    });

  it.each(['새 계정 발급 가능한가요?', '새 계정은 어떻게 만들어요?', '2번 말고 1번으로 할게요', '2번 안 할래요'])(
    'does not treat a question or rejection as a new-account choice: %s', (choice) => {
      expect(requestedSpotifyNewAccount([
        { ...buyerMessage, senderSeq: 7, message: SPOTIFY_BUYER_GUIDE },
        { ...buyerMessage, message: choice },
      ], 42)).toBeNull();
    });

  it('does not send a new acknowledgment for credentials received before activation', async () => {
    const sendText = vi.fn();
    const result = await syncGbutsSpotifyMessages({
      listMembers: async () => [member], openPrivateRoom: async () => '777',
      getChat: async () => ({ messages: [buyerMessage] }), sellerAccountSeq: async () => 7,
      listRows: async () => [], sendText,
      readJournal: () => ({ version: 1, records: {} }), writeJournal: vi.fn(),
      requestAckStartAt: '2026-10-03T10:00:00Z',
    }, 15557);
    expect(result.acknowledgementsAttempted).toBe(0);
    expect(sendText).not.toHaveBeenCalled();
  });
});
