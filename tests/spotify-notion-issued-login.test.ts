import { describe, expect, it, vi } from 'vitest';
import { createGbutsSpotifyNotionClient } from '../src/scheduler/gbuts-spotify-sync';
import { spotifyChatContainsIssuedLogin, spotifyRegisteredAccountInvitedReply, spotifyRegisteredLogin, syncGbutsSpotifyMessages } from '../src/scheduler/gbuts-spotify-messages';

describe('Spotify partner-issued login delivery', () => {
  it('retains the Notion edit timestamp for future unbound-completion monitoring', async () => {
    const client = createGbutsSpotifyNotionClient('test', undefined, vi.fn(async () => Response.json({ results: [{
      id: 'recent', last_edited_time: '2026-10-28T04:00:00Z', properties: {
        'Spotify account': { title: [{ plain_text: 'issued@example.net' }] }, Password: { rich_text: [] }, Invited: { checkbox: true },
      },
    }] })) as typeof fetch);
    expect((await client.listRows())[0].updatedAt).toBe('2026-10-28T04:00:00Z');
  });
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

  it.each([false, true])('adopts an old manually saved issued pair without another SEND (Everyview=%s)', async everyview => {
    const journal = { version: 1 as const, records: {} };
    const sendText = vi.fn();
    const orderKey = `${everyview ? 'everyview:' : ''}15557:91`;
    await syncGbutsSpotifyMessages({
      orderKey: () => orderKey,
      listMembers: async () => [{ seq: 91, userSeq: 42, productId: 'SPOT1', status: 'APPLY', cancelStatus: null }],
      openPrivateRoom: async () => '777', sellerAccountSeq: async () => 7,
      getChat: async () => ({ messages: [{ senderSeq: 42, messageType: 'TEXT', message: '새 계정 발급 부탁합니다', createdAt: '2026-10-27T00:00:00Z' },
        { senderSeq: 7, messageType: 'TEXT', message: 'ID : issued@example.net PW : Issued456! 입니다!', createdAt: '2026-10-27T00:01:00Z' }] }),
      listRows: async () => [{ id: 'p', orderKey, email: 'original@example.com', password: 'Original123!', emailHistory: [],
        registered: true, invited: true, cancelled: false, registeredEmail: 'issued@example.net', registeredPassword: 'Issued456!' }],
      sendText, readJournal: () => journal, writeJournal: vi.fn(),
    }, 15557);
    expect(sendText).not.toHaveBeenCalled();
    expect(Object.values(journal.records)).toEqual([expect.objectContaining({ state: 'confirmed', roomId: '777' })]);
  });
  it('requires the exact email and whole password in one saved seller message', () => {
    const login = { email: 'issued@example.net', password: 'Issued456!' };
    const matches = (text: string, sender = 7) => spotifyChatContainsIssuedLogin([{ senderSeq: sender, messageType: 'TEXT', message: text, createdAt: '2026-10-28T00:00:00Z' }], 7, login);
    expect(matches('issued@example.net PW : Issued456! 입니다!')).toBe(true);
    expect(matches('notissued@example.net PW : Issued456!')).toBe(false);
    expect(matches('issued@example.net PW : XIssued456!')).toBe(false);
    expect(matches('issued@example.net PW : Issued456!X')).toBe(false);
    expect(matches('issued@example.net PW : Issued456!', 42)).toBe(false);
    const special = { email: 'issued@example.net', password: 'A+b.c[9]$!' };
    expect(spotifyChatContainsIssuedLogin([{ senderSeq: 7, messageType: 'TEXT', createdAt: '2026-10-28T00:00:00Z',
      message: 'issued@example.net PW : A+b.c[9]$!' }], 7, special)).toBe(true);
    expect(spotifyChatContainsIssuedLogin([{ senderSeq: 7, messageType: 'TEXT', createdAt: '2026-10-28T00:00:00Z',
      message: 'issued@example.net PW : Abxc9' }], 7, special)).toBe(false);

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
