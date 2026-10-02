import { describe, expect, it, vi } from 'vitest';
import { createGbutsSpotifyNotionClient, createGbutsSpotifySellerClient, syncGbutsSpotifyCredentials, type SpotifyNotionRow } from '../src/scheduler/gbuts-spotify-sync';

const member = { seq: 91, userSeq: 42, productId: 801, status: 'APPLY', cancelStatus: null };
const credentialMessage = { senderSeq: 42, message: 'Spotify email: buyer@example.com\nPassword: secret123',
  messageType: 'TEXT', createdAt: '2026-10-02T10:00:00Z' };

describe('GButs Spotify Notion sync', () => {
  it('uses the seller member and private chat endpoints observed in GButs', async () => {
    const urls: string[] = [];
    const transport = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      urls.push(String(url));
      expect(new Headers(init?.headers).get('api_key')).toBe('Bearer session-token');
      const response = String(url).endsWith('/member') ? [member]
        : String(url).endsWith('/api/room/chat') ? { roomId: 777 }
          : String(url).endsWith('/chat') ? { members: [], messages: [credentialMessage] }
            : { seq: 7 };
      return new Response(JSON.stringify({ response }), { status: 200 });
    }) as unknown as typeof fetch;
    const client = createGbutsSpotifySellerClient('session-token', transport);
    expect(await client.listMembers(15557)).toEqual([member]);
    expect(await client.openPrivateRoom(15557, 42)).toBe(777);
    expect((await client.getChat(777)).messages).toEqual([credentialMessage]);
    expect(await client.sellerAccountSeq()).toBe(7);
    expect(urls).toEqual([
      'https://api.gbuts.com/api/seller/subscribe/share/15557/member',
      'https://api.gbuts.com/api/room/chat',
      'https://api.gbuts.com/api/rooms/777/chat',
      'https://api.gbuts.com/api/account/me',
    ]);
  });
  it('creates one row from the buyer private chat and never copies a seller message', async () => {
    let rows: SpotifyNotionRow[] = [];
    const createRow = vi.fn(async (orderKey, credentials) => {
      const row = { id: 'page-1', orderKey, email: credentials.email, password: credentials.password,
        emailHistory: [], invited: false, cancelled: false };
      rows.push(row);
      return row;
    });
    const deps = {
      listMembers: async () => [member],
      openPrivateRoom: vi.fn(async () => 777),
      getChat: async () => ({ roomId: 777, members: [], messages: [
        { ...credentialMessage, senderSeq: 7, message: 'Spotify email: wrong@example.com\nPassword: wrong123' },
        credentialMessage,
      ] }),
      listRows: async () => [...rows],
      getRow: async (id: string) => rows.find((row) => row.id === id) ?? null,
      createRow,
      replaceCredentials: vi.fn(),
      cancelRow: vi.fn(),
    };
    expect(await syncGbutsSpotifyCredentials(deps, 15557)).toMatchObject({ created: 1, conflicts: 0 });
    expect(createRow).toHaveBeenCalledWith('15557:91', {
      email: 'buyer@example.com', password: 'secret123', receivedAt: '2026-10-02T10:00:00Z',
    });
    expect(await syncGbutsSpotifyCredentials(deps, 15557)).toMatchObject({ created: 0, updated: 0 });
  });

  it('does not import a cancelled member', async () => {
    const openPrivateRoom = vi.fn();
    const result = await syncGbutsSpotifyCredentials({
      listMembers: async () => [{ ...member, cancelStatus: 'REFUND_REQUESTED' }],
      openPrivateRoom, getChat: vi.fn(), listRows: async () => [], getRow: vi.fn(),
      createRow: vi.fn(), replaceCredentials: vi.fn(),
      cancelRow: vi.fn(),
    }, 15557);
    expect(result.members).toBe(0);
    expect(openPrivateRoom).not.toHaveBeenCalled();
  });

  it('formats a corrected account with the previous address struck above a down arrow', async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const transport = vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
      requests.push({ url: String(url), init });
      const body = JSON.parse(String(init.body));
      const title = body.properties['Spotify account'].title;
      return new Response(JSON.stringify({ id: 'page-1', archived: false, in_trash: false, properties: {
        'Spotify account': { title: title.map((part: any) => ({ ...part, plain_text: part.text.content })) },
        Password: { rich_text: [{ plain_text: body.properties.Password.rich_text[0].text.content }] },
        Invited: { checkbox: false },
        'GButs order ID': { rich_text: [{ plain_text: '15557:91' }] },
      } }), { status: 200 });
    }) as unknown as typeof fetch;
    const row: SpotifyNotionRow = { id: 'page-1', orderKey: '15557:91', email: 'old@example.com',
      emailHistory: [], password: 'oldpass', invited: true, cancelled: false };
    const result = await createGbutsSpotifyNotionClient('token', undefined, transport).replaceCredentials(row, {
      email: 'new@example.com', password: 'newpass', receivedAt: '2026-10-02T10:00:00Z',
    });
    const title = JSON.parse(String(requests[0].init.body)).properties['Spotify account'].title;
    expect(title).toEqual([
      { text: { content: 'old@example.com' }, annotations: { strikethrough: true } },
      { text: { content: '\n\n↓\n\n' } },
      { text: { content: 'new@example.com' } },
    ]);
    expect(result).toMatchObject({ email: 'new@example.com', emailHistory: ['old@example.com'], invited: false });
  });

  it('strikes a refunded buyer account and clears its password', async () => {
    const row: SpotifyNotionRow = { id: 'page-1', orderKey: '15557:91', email: 'buyer@example.com',
      emailHistory: [], password: 'secret123', invited: true, cancelled: false };
    const cancelRow = vi.fn(async () => ({ ...row, email: '', emailHistory: ['buyer@example.com'],
      password: '', invited: false, cancelled: true }));
    const result = await syncGbutsSpotifyCredentials({
      listMembers: async () => [{ ...member, cancelStatus: 'REFUNDED' }],
      openPrivateRoom: vi.fn(), getChat: vi.fn(), listRows: async () => [row],
      getRow: async () => row, createRow: vi.fn(), replaceCredentials: vi.fn(), cancelRow,
    }, 15557);
    expect(result).toMatchObject({ cancelled: 1, members: 0 });
    expect(cancelRow).toHaveBeenCalledWith(row);
  });
});
