import { describe, expect, it, vi } from 'vitest';
import { SPOTIFY_BUYER_GUIDE, SPOTIFY_INVITED_REPLY, SPOTIFY_REQUEST_ACK, spotifyRegisteredAccountInvitedReply, requestedSpotifyNewAccount,
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
    expect(sendText).toHaveBeenCalledWith('777', 7, SPOTIFY_INVITED_REPLY);
    expect(JSON.stringify(journal)).not.toContain('secret123');
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

  it('uses the latest explicit new-account choice and respects a later cancellation', () => {
    const first = { ...buyerMessage, message: '새 계정 발급 부탁드립니다', createdAt: '2026-10-03T10:00:00Z' };
    const cancelled = { ...buyerMessage, message: '2번 말고 1번으로 할게요', createdAt: '2026-10-03T10:01:00Z' };
    const selectedAgain = { ...first, createdAt: '2026-10-03T10:02:00Z' };
    expect(requestedSpotifyNewAccount([first, cancelled], 42)).toBeNull();
    expect(requestedSpotifyNewAccount([first, cancelled, selectedAgain], 42)).toBe(selectedAgain.createdAt);
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

  it('replies for a partner-created login only after Registered and Invited are both checked', async () => {
    const rowWithNewLogin: SpotifyNotionRow = { ...row, email: 'buyer@jamkkangudok.com',
      registered: false };
    const sendText = vi.fn(async () => undefined);
    const journal: GbutsSpotifyMessageJournal = { version: 1, records: {} };
    const deps = {
      listMembers: async () => [member], openPrivateRoom: async () => '777',
      getChat: async () => ({ messages: [buyerMessage] }), sellerAccountSeq: async () => 7,
      listRows: async () => [rowWithNewLogin], sendText, readJournal: () => journal,
      writeJournal: vi.fn(), requestAckStartAt: '2026-10-03T00:00:00Z',
    };
    expect((await syncGbutsSpotifyMessages(deps, 15557)).invitedRepliesAttempted).toBe(0);
    rowWithNewLogin.registered = true;
    expect((await syncGbutsSpotifyMessages(deps, 15557)).invitedRepliesAttempted).toBe(1);
    expect(sendText).toHaveBeenCalledWith('777', 7,
      spotifyRegisteredAccountInvitedReply('buyer@jamkkangudok.com', 'secret123'));
    expect(JSON.stringify(journal)).not.toContain('secret123');
  });

  it.each([false, true])('uses Registered as confirmation of the derived new login: %s', async (newAccountRequest) => {
    const sendText = vi.fn();
    const result = await syncGbutsSpotifyMessages({
      listMembers: async () => [member], openPrivateRoom: async () => '777',
      getChat: async () => ({ messages: [buyerMessage, ...(newAccountRequest ? [{ ...buyerMessage, message: '새 계정 발급 부탁드립니다', createdAt: '2026-10-03T10:01:00Z' }] : [])] }), sellerAccountSeq: async () => 7,
      listRows: async () => [{ ...row, registered: true }], sendText,
      readJournal: () => ({ version: 1, records: {} }), writeJournal: vi.fn(),
      requestAckStartAt: '2026-10-03T00:00:00Z',
    }, 15557);
    expect(result.invitedRepliesAttempted).toBe(1);
    expect(sendText).toHaveBeenCalledExactlyOnceWith('777', 7,
      spotifyRegisteredAccountInvitedReply('buyer@jamkkangudok.com', 'secret123'));
  });

  it('keeps one delivery journal identity when the original Notion address is later changed to the issued address', async () => {
    let current = { ...row, registered: true };
    const journal: GbutsSpotifyMessageJournal = { version: 1, records: {} };
    const sendText = vi.fn(async () => undefined);
    const deps = {
      listMembers: async () => [member], openPrivateRoom: async () => '777',
      getChat: async () => ({ messages: [buyerMessage] }), sellerAccountSeq: async () => 7,
      listRows: async () => [current], sendText, readJournal: () => journal, writeJournal: vi.fn(),
      requestAckStartAt: '2026-10-03T00:00:00Z',
    };
    expect((await syncGbutsSpotifyMessages(deps, 15557)).invitedRepliesAttempted).toBe(1);
    current = { ...current, email: 'buyer@jamkkangudok.com' };
    expect((await syncGbutsSpotifyMessages(deps, 15557)).invitedRepliesAttempted).toBe(0);
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(journal)).not.toContain('secret123');
  });

  it('does not send completion while Registered is checked without Invited', async () => {
    const sendText = vi.fn();
    const result = await syncGbutsSpotifyMessages({
      listMembers: async () => [member], openPrivateRoom: async () => '777',
      getChat: async () => ({ messages: [buyerMessage] }), sellerAccountSeq: async () => 7,
      listRows: async () => [{ ...row, registered: true, invited: false }], sendText,
      readJournal: () => ({ version: 1, records: {} }), writeJournal: vi.fn(),
      requestAckStartAt: '2026-10-03T00:00:00Z',
    }, 15557);
    expect(result.invitedRepliesAttempted).toBe(0);
    expect(sendText).not.toHaveBeenCalled();
  });

  it('rechecks the Notion login before sending and pauses if the partner edits it mid-poll', async () => {
    const sendText = vi.fn();
    const listRows = vi.fn().mockResolvedValueOnce([{ ...row, email: 'buyer@jamkkangudok.com', registered: true }]).mockResolvedValue([{ ...row, registered: true }]);
    const result = await syncGbutsSpotifyMessages({
      listMembers: async () => [member], openPrivateRoom: async () => '777',
      getChat: async () => ({ messages: [buyerMessage] }), sellerAccountSeq: async () => 7,
      listRows, sendText, readJournal: () => ({ version: 1, records: {} }), writeJournal: vi.fn(),
      requestAckStartAt: '2026-10-03T00:00:00Z',
    }, 15557);
    expect(result.invitedRepliesAttempted).toBe(0); expect(sendText).not.toHaveBeenCalled();
  });

  it('sends the issued login when the buyer chose a new account and the partner checked both boxes', async () => {
    const issuedRow: SpotifyNotionRow = { ...row, email: 'issued@jamkkangudok.com', password: 'issued123',
      registered: true };
    const sendText = vi.fn(async () => undefined);
    const result = await syncGbutsSpotifyMessages({
      listMembers: async () => [member], openPrivateRoom: async () => '777',
      getChat: async () => ({ messages: [
        { ...buyerMessage, senderSeq: 7, message: SPOTIFY_BUYER_GUIDE, createdAt: '2026-10-03T10:00:00Z' },
        { ...buyerMessage, message: '②', createdAt: '2026-10-03T10:01:00Z' },
      ] }), sellerAccountSeq: async () => 7, listRows: async () => [issuedRow], sendText,
      readJournal: () => ({ version: 1, records: {} }), writeJournal: vi.fn(),
      requestAckStartAt: '2026-10-03T10:00:30Z',
    }, 15557);
    expect(result.invitedRepliesAttempted).toBe(1);
    expect(sendText).toHaveBeenCalledWith('777', 7,
      spotifyRegisteredAccountInvitedReply('issued@jamkkangudok.com', 'issued123'));
  });

  it('sends the issued login when the buyer switches from an existing account to a new account', async () => {
    const sendText = vi.fn(async () => undefined);
    const result = await syncGbutsSpotifyMessages({
      listMembers: async () => [member], openPrivateRoom: async () => '777',
      getChat: async () => ({ messages: [
        buyerMessage,
        { ...buyerMessage, message: '새 계정 발급 부탁드립니다', createdAt: '2026-10-03T10:01:00Z' },
      ] }), sellerAccountSeq: async () => 7,
      listRows: async () => [{ ...row, email: 'issued@jamkkangudok.com', password: 'issued123', registered: true }],
      sendText, readJournal: () => ({ version: 1, records: {} }), writeJournal: vi.fn(),
      requestAckStartAt: '2026-10-03T10:00:30Z',
    }, 15557);
    expect(result.invitedRepliesAttempted).toBe(1);
    expect(sendText).toHaveBeenCalledWith('777', 7,
      spotifyRegisteredAccountInvitedReply('issued@jamkkangudok.com', 'issued123'));
  });

  it('never sends login details with only Invited checked for a newly issued account', async () => {
    const sendText = vi.fn();
    const result = await syncGbutsSpotifyMessages({
      listMembers: async () => [member], openPrivateRoom: async () => '777',
      getChat: async () => ({ messages: [buyerMessage] }), sellerAccountSeq: async () => 7,
      listRows: async () => [{ ...row, email: 'buyer@jamkkangudok.com', registered: false }], sendText,
      readJournal: () => ({ version: 1, records: {} }), writeJournal: vi.fn(),
      requestAckStartAt: '2026-10-03T00:00:00Z',
    }, 15557);
    expect(result.invitedRepliesAttempted).toBe(0);
    expect(sendText).not.toHaveBeenCalled();
  });
});
