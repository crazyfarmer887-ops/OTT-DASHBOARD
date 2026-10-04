import { describe, expect, it, vi } from 'vitest';
import { createGbutsSpotifyNotionClient, createGbutsSpotifySellerClient, syncGbutsSpotifyCredentials, type SpotifyNotionRow } from '../src/scheduler/gbuts-spotify-sync';

const member = { seq: 91, userSeq: 42, productId: '801', status: 'APPLY', cancelStatus: null };
const credentialMessage = { senderSeq: 42, message: 'Spotify email: buyer@example.com\nPassword: secret123',
  messageType: 'TEXT', createdAt: '2026-10-02T10:00:00Z' };

describe('GButs Spotify Notion sync', () => {
  it('accepts the string product IDs returned by GButs seller members', async () => {
    const liveFormatMember = { ...member, productId: 'SPOT1234' };
    const transport = vi.fn(async () => new Response(JSON.stringify({ response: [liveFormatMember] }), { status: 200 })) as unknown as typeof fetch;
    const client = createGbutsSpotifySellerClient('session-token', transport);

    expect(await client.listMembers(15557)).toEqual([liveFormatMember]);
  });

  it('keeps a partner-selected new login and its Registered checkbox during buyer chat sync', async () => {
    const row: SpotifyNotionRow = { id: 'page-1', orderKey: '15557:91',
      email: 'buyer@jamkkangudok.com', emailHistory: ['buyer@example.com'],
      password: 'secret123', registered: true, invited: false, cancelled: false };
    const replaceCredentials = vi.fn();
    const result = await syncGbutsSpotifyCredentials({
      listMembers: async () => [member], openPrivateRoom: async () => 'ROOM123',
      getChat: async () => ({ roomId: 'ROOM123', members: [], messages: [credentialMessage] }),
      listRows: async () => [row], getRow: async () => row,
      createRow: vi.fn(), replaceCredentials, cancelRow: vi.fn(),
    }, 15557);
    expect(result).toMatchObject({ created: 0, updated: 0, conflicts: 0 });
    expect(replaceCredentials).not.toHaveBeenCalled();
  });

  it('does not restore old buyer credentials after the buyer chooses a new account', async () => {
    const row: SpotifyNotionRow = { id: 'page-1', orderKey: '15557:91',
      email: 'issued@jamkkangudok.com', emailHistory: ['buyer@example.com'],
      password: 'issued123', registered: true, invited: true, cancelled: false };
    const replaceCredentials = vi.fn();
    const result = await syncGbutsSpotifyCredentials({
      listMembers: async () => [member], openPrivateRoom: async () => 'ROOM123',
      getChat: async () => ({ roomId: 'ROOM123', members: [], messages: [
        credentialMessage,
        { ...credentialMessage, message: '새 계정 발급 부탁드립니다', createdAt: '2026-10-03T10:01:00Z' },
      ] }),
      listRows: async () => [row], getRow: async () => row,
      createRow: vi.fn(), replaceCredentials, cancelRow: vi.fn(),
    }, 15557);
    expect(result).toMatchObject({ created: 0, updated: 0, waitingForCredentials: 1 });
    expect(replaceCredentials).not.toHaveBeenCalled();
  });

  it('links a unique manually entered partner login to the buyer order', async () => {
    const manual: SpotifyNotionRow = { id: 'manual-page', orderKey: '',
      email: 'buyer@jamkkangudok.com', emailHistory: ['buyer@example.com'],
      password: 'secret123', registered: true, invited: false, cancelled: false };
    const claimed = { ...manual, orderKey: '15557:91' };
    const claimRow = vi.fn(async () => claimed);
    const result = await syncGbutsSpotifyCredentials({
      listMembers: async () => [member], openPrivateRoom: async () => 'ROOM123',
      getChat: async () => ({ roomId: 'ROOM123', members: [], messages: [credentialMessage] }),
      listRows: async () => [manual], getRow: async () => manual,
      createRow: vi.fn(), claimRow, replaceCredentials: vi.fn(), cancelRow: vi.fn(),
    }, 15557);
    expect(result).toMatchObject({ created: 0, conflicts: 0 });
    expect(claimRow).toHaveBeenCalledWith(manual, '15557:91');
  });

  it('does not overwrite a partner-selected login when the buyer changes only the password', async () => {
    const row: SpotifyNotionRow = { id: 'page-1', orderKey: '15557:91',
      email: 'buyer@jamkkangudok.com', emailHistory: [], password: 'secret123',
      registered: true, invited: false, cancelled: false };
    const replaceCredentials = vi.fn();
    const result = await syncGbutsSpotifyCredentials({
      listMembers: async () => [member], openPrivateRoom: async () => 'ROOM123',
      getChat: async () => ({ roomId: 'ROOM123', members: [], messages: [
        { ...credentialMessage, message: 'Spotify email: buyer@example.com\nPassword: changed123' },
      ] }),
      listRows: async () => [row], getRow: async () => row,
      createRow: vi.fn(), replaceCredentials, cancelRow: vi.fn(),
    }, 15557);
    expect(result.conflicts).toBe(1);
    expect(replaceCredentials).not.toHaveBeenCalled();
  });

  it('uses the seller member and private chat endpoints observed in GButs', async () => {
    const urls: string[] = [];
    const transport = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      urls.push(String(url));
      expect(new Headers(init?.headers).get('api_key')).toBe('Bearer session-token');
      const response = String(url).endsWith('/member') ? [member]
        : String(url).endsWith('/api/room/chat') ? { roomId: 'ROOM123456789' }
          : String(url).endsWith('/chat') ? { members: [], messages: [credentialMessage] }
            : { seq: 7 };
      return new Response(JSON.stringify({ response }), { status: 200 });
    }) as unknown as typeof fetch;
    const client = createGbutsSpotifySellerClient('session-token', transport);
    expect(await client.listMembers(15557)).toEqual([member]);
    expect(await client.openPrivateRoom(15557, 42)).toBe('ROOM123456789');
    expect((await client.getChat('ROOM123456789')).messages).toEqual([credentialMessage]);
    expect(await client.sellerAccountSeq()).toBe(7);
    expect(urls).toEqual([
      'https://api.gbuts.com/api/seller/subscribe/share/15557/member',
      'https://api.gbuts.com/api/room/chat',
      'https://api.gbuts.com/api/rooms/ROOM123456789/chat',
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
      openPrivateRoom: vi.fn(async () => '777'),
      getChat: async () => ({ roomId: '777', members: [], messages: [
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

  it('links a unique manually entered row to its order instead of duplicating it', async () => {
    let row: SpotifyNotionRow = { id: 'manual-page', orderKey: '', email: 'buyer@example.com',
      password: 'secret123', emailHistory: [], invited: false, cancelled: false };
    const claimRow = vi.fn(async (_row: SpotifyNotionRow, orderKey: string) => {
      row = { ...row, orderKey };
      return row;
    });
    const createRow = vi.fn();
    const deps = {
      listMembers: async () => [member],
      openPrivateRoom: async () => '777',
      getChat: async () => ({ roomId: '777', members: [], messages: [credentialMessage] }),
      listRows: async () => [row],
      getRow: async () => row,
      createRow, claimRow, replaceCredentials: vi.fn(), cancelRow: vi.fn(),
    };
    expect(await syncGbutsSpotifyCredentials(deps, 15557)).toMatchObject({ created: 0, updated: 0, conflicts: 0 });
    expect(claimRow).toHaveBeenCalledWith(expect.objectContaining({ id: 'manual-page' }), '15557:91');
    expect(createRow).not.toHaveBeenCalled();
  });

  it('does not claim a manual row when two members sent the same credentials', async () => {
    const manual: SpotifyNotionRow = { id: 'manual-page', orderKey: '', email: 'buyer@example.com',
      password: 'secret123', emailHistory: [], invited: false, cancelled: false };
    const claimRow = vi.fn();
    const createRow = vi.fn();
    const secondMember = { ...member, seq: 92, userSeq: 43 };
    const result = await syncGbutsSpotifyCredentials({
      listMembers: async () => [member, secondMember],
      openPrivateRoom: async (_postSeq, userSeq) => String(userSeq),
      getChat: async (roomId) => ({ roomId, members: [], messages: [
        { ...credentialMessage, senderSeq: Number(roomId) },
      ] }),
      listRows: async () => [manual],
      getRow: vi.fn(), createRow, claimRow, replaceCredentials: vi.fn(), cancelRow: vi.fn(),
    }, 15557);
    expect(result.conflicts).toBe(2);
    expect(claimRow).not.toHaveBeenCalled();
    expect(createRow).not.toHaveBeenCalled();
  });

  it('claims a manual Notion row by setting only its order ID', async () => {
    const row: SpotifyNotionRow = { id: 'manual-page', orderKey: '', email: 'buyer@example.com',
      password: 'secret123', emailHistory: [], invited: true, cancelled: false };
    const transport = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({ properties: {
        'GButs order ID': { rich_text: [{ text: { content: '15557:91' } }] },
      } });
      return new Response(JSON.stringify({ id: row.id, archived: false, in_trash: false, properties: {
        'Spotify account': { title: [{ plain_text: row.email }] },
        Password: { rich_text: [{ plain_text: row.password }] },
        Invited: { checkbox: row.invited },
        'GButs order ID': { rich_text: [{ plain_text: '15557:91' }] },
      } }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await createGbutsSpotifyNotionClient('token', undefined, transport).claimRow(row, '15557:91'))
      .toMatchObject({ orderKey: '15557:91', email: row.email, invited: true });
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
      emailHistory: [], password: 'oldpass', registered: true, invited: true, cancelled: false };
    const result = await createGbutsSpotifyNotionClient('token', undefined, transport).replaceCredentials(row, {
      email: 'new@example.com', password: 'newpass', receivedAt: '2026-10-02T10:00:00Z',
    });
    const title = JSON.parse(String(requests[0].init.body)).properties['Spotify account'].title;
    expect(title).toEqual([
      { text: { content: 'old@example.com' }, annotations: { strikethrough: true } },
      { text: { content: '\n\n↓\n\n' } },
      { text: { content: 'new@example.com' } },
    ]);
    expect(JSON.parse(String(requests[0].init.body)).properties.Registered).toEqual({ checkbox: false });
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
