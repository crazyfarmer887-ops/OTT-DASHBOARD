import { describe, expect, it, vi } from 'vitest';
import { SPOTIFY_BUYER_GUIDE, syncGbutsSpotifyMessages, type GbutsSpotifyMessageJournal } from '../src/scheduler/gbuts-spotify-messages';
import type { SpotifyNotionRow } from '../src/scheduler/gbuts-spotify-sync';

const member = { seq: 91, userSeq: 42, productId: 801, status: 'APPLY', cancelStatus: null };
const row: SpotifyNotionRow = { id: 'page-1', orderKey: '15557:91', email: 'buyer@example.com',
  emailHistory: [], password: 'secret123', invited: true, cancelled: false };
const buyerMessage = { senderSeq: 42, message: 'Spotify email: buyer@example.com\nPassword: secret123',
  messageType: 'TEXT', createdAt: '2026-10-02T10:00:00Z' };

describe('GButs Spotify buyer messages', () => {
  it('asks an active buyer for credentials once and records an uncertain send', async () => {
    const journal: GbutsSpotifyMessageJournal = { version: 1, records: {} };
    const sendText = vi.fn(async () => { throw new Error('network outcome unknown'); });
    const deps = {
      listMembers: async () => [member], openPrivateRoom: async () => 777,
      getChat: async () => ({ messages: [] }), sellerAccountSeq: async () => 7,
      listRows: async () => [], sendText, readJournal: () => journal,
      writeJournal: vi.fn(), now: () => '2026-10-02T10:01:00Z',
    };
    expect(await syncGbutsSpotifyMessages(deps, 15557)).toMatchObject({ guidesAttempted: 1 });
    expect(sendText).toHaveBeenCalledWith(777, 7, SPOTIFY_BUYER_GUIDE);
    expect(await syncGbutsSpotifyMessages(deps, 15557)).toMatchObject({ guidesAttempted: 0 });
    expect(sendText).toHaveBeenCalledTimes(1);
  });

  it('confirms the partner check through a private buyer reply only after credentials match', async () => {
    const journal: GbutsSpotifyMessageJournal = { version: 1, records: {} };
    const sendText = vi.fn(async () => undefined);
    const deps = {
      listMembers: async () => [member], openPrivateRoom: async () => 777,
      getChat: async () => ({ messages: [buyerMessage] }), sellerAccountSeq: async () => 7,
      listRows: async () => [row], sendText, readJournal: () => journal,
      writeJournal: vi.fn(), now: () => '2026-10-02T10:01:00Z',
    };
    expect(await syncGbutsSpotifyMessages(deps, 15557)).toMatchObject({ invitedRepliesAttempted: 1, guidesAttempted: 0 });
    expect(sendText).toHaveBeenCalledWith(777, 7, expect.stringContaining('buyer@example.com'));
    expect(await syncGbutsSpotifyMessages(deps, 15557)).toMatchObject({ invitedRepliesAttempted: 0 });
    expect(sendText).toHaveBeenCalledTimes(1);
  });

  it('does not confirm a stale checkbox after the buyer changes credentials', async () => {
    const sendText = vi.fn();
    const result = await syncGbutsSpotifyMessages({
      listMembers: async () => [member], openPrivateRoom: async () => 777,
      getChat: async () => ({ messages: [{ ...buyerMessage, message: 'Spotify email: new@example.com\nPassword: newsecret' }] }),
      sellerAccountSeq: async () => 7, listRows: async () => [row], sendText,
      readJournal: () => ({ version: 1, records: {} }), writeJournal: vi.fn(),
    }, 15557);
    expect(result.invitedRepliesAttempted).toBe(0);
    expect(sendText).not.toHaveBeenCalled();
  });
});
