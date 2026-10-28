import { describe, expect, it, vi } from 'vitest';
import { createGbutsSpotifyNotionClient } from '../src/scheduler/gbuts-spotify-sync';
import { spotifyRegisteredAccountInvitedReply, spotifyRegisteredLogin, syncGbutsSpotifyMessages } from '../src/scheduler/gbuts-spotify-messages';

describe('Spotify partner-issued login delivery', () => {
  it.each(['Issued456!', ''])('delivers explicit Notion login fields with password override %j', async (issuedPassword) => {
    const page = { id: 'page-1', properties: {
      'Spotify account': { title: [{ plain_text: 'buyer@example.com' }] },
      'GButs order ID': { rich_text: [{ plain_text: '15557:91' }] },
      Password: { rich_text: [{ plain_text: 'Original123!' }] },
      Registered: { checkbox: true }, Invited: { checkbox: true },
      'registered email': { type: 'email', email: 'issued@example.net' },
      'registered password': { rich_text: [{ plain_text: issuedPassword }] },
    } };
    const notion = createGbutsSpotifyNotionClient('test', undefined,
      vi.fn(async () => Response.json({ results: [page] })) as typeof fetch);
    const sendText = vi.fn(async () => undefined);
    const journal = { version: 1 as const, records: {} };
    const deps = {
      listMembers: async () => [{ seq: 91, userSeq: 42, productId: 'SPOT1', status: 'APPLY', cancelStatus: null }],
      openPrivateRoom: async () => '777', sellerAccountSeq: async () => 7,
      getChat: async () => ({ messages: [{ senderSeq: 42, messageType: 'TEXT',
        message: 'Spotify email: buyer@example.com\nPassword: Original123!', createdAt: '2026-10-27T00:00:00Z' }] }),
      listRows: notion.listRows, sendText,
      readJournal: () => journal, writeJournal: vi.fn(),
    };
    await syncGbutsSpotifyMessages(deps, 15557);
    expect(sendText).toHaveBeenCalledWith('777', 7,
      spotifyRegisteredAccountInvitedReply('issued@example.net', issuedPassword || 'Original123!'));
    await syncGbutsSpotifyMessages(deps, 15557);
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(journal)).not.toContain(issuedPassword || 'Original123!');
  });

  it('does not fall back from a malformed explicit issued login', () => {
    expect(spotifyRegisteredLogin({ id: 'p', orderKey: '15557:91', email: 'buyer@example.com',
      password: 'Original123!', emailHistory: [], registered: true, invited: true, cancelled: false,
      registeredEmail: 'invalid address' })).toBeNull();
  });

  it('blocks sending if the issued fields change during the fresh Notion read', async () => {
    const row = { id: 'p', orderKey: '15557:91', email: 'buyer@example.com',
      password: 'Original123!', emailHistory: [], registered: true, invited: true, cancelled: false,
      registeredEmail: 'issued@example.net' };
    const sendText = vi.fn();
    await syncGbutsSpotifyMessages({
      listMembers: async () => [{ seq: 91, userSeq: 42, productId: 'SPOT1', status: 'APPLY', cancelStatus: null }],
      openPrivateRoom: async () => '777', sellerAccountSeq: async () => 7,
      getChat: async () => ({ messages: [{ senderSeq: 42, messageType: 'TEXT',
        message: 'Spotify email: buyer@example.com\nPassword: Original123!', createdAt: '2026-10-27T00:00:00Z' }] }),
      listRows: vi.fn().mockResolvedValueOnce([row]).mockResolvedValue([{ ...row, registeredEmail: 'other@example.net' }]),
      sendText, readJournal: () => ({ version: 1, records: {} }), writeJournal: vi.fn(),
    }, 15557);
    expect(sendText).not.toHaveBeenCalled();
  });

  it('clears stale issued fields when buyer credentials are replaced', async () => {
    const transport = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ id: 'p', properties: {
      'Spotify account': { title: [{ plain_text: 'replacement@example.com' }] },
      'GButs order ID': { rich_text: [{ plain_text: '15557:91' }] },
      Password: { rich_text: [{ plain_text: 'Replacement123!' }] }, Invited: { checkbox: false },
    } }));
    const client = createGbutsSpotifyNotionClient('test', undefined, transport as typeof fetch);
    await client.replaceCredentials({ id: 'p', orderKey: '15557:91', email: 'buyer@example.com',
      password: 'Original123!', emailHistory: [], registered: true, invited: false, cancelled: false,
      registeredEmail: 'issued@example.net', registeredPassword: 'Issued456!' },
    { email: 'replacement@example.com', password: 'Replacement123!', receivedAt: '2026-10-28T00:00:00Z' });
    expect(JSON.parse(transport.mock.calls[0][1]!.body as string).properties).toMatchObject({
      'registered email': { email: null }, 'registered password': { rich_text: [] },
      Registered: { checkbox: false }, Invited: { checkbox: false },
    });
  });
});
