import { describe, expect, it, vi } from 'vitest';
import { LinkidClient, LinkidError, decodeLinkidMessage, linkidNotice, parseLinkidCredentials } from '../src/lib/linkid-client';
const profile = { index: 2, uid: 22, name: '프로필 둘', money: 0, newAlarm: false };
function provider(options: { wrongProfile?: boolean; rate?: boolean; badParty?: boolean; notices?: boolean; rooms?: boolean; notFoundPath?: string } = {}) {
  let activeUid = 11; const browserUid = 11;
  const transport = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname; const body = JSON.parse(String(init?.body));
    expect(new Headers(init?.headers).get('version-service')).toBe('3.0.1');
    if (options.rate) return new Response('{}', { status: 429 });
    if (path === options.notFoundPath) return new Response('{}', { status: 404 });
    let value: unknown;
    if (path === '/api/users/change_subaccount') { expect(body.sid).toBe('server-session'); activeUid = 22; value = { result: 0 }; }
    else if (path === '/api/users/auth') value = { result: 0, uid: options.wrongProfile ? 99 : body.sid === 'browser-session' ? browserUid : activeUid, acc_idx: body.sid === 'browser-session' ? 1 : 2, nickname: '둘' };
    else if (path === '/api/login') value = { result: 0, sid: 'server-session' };
    else if (path === '/api/users/list_subaccount') value = { result: 0, userlist: [ { acc_idx: 1, uid: 11, nickname: '하나', money: 0 }, { acc_idx: 2, uid: 22, nickname: '둘', money: 0 } ] };
    else if (path === '/api/party/tri_my') value = { result: 0, party: [{ partyid: 77 }], partyreq: [] };
    else if (path === '/api/party/tri_partyinfo') value = { result: 0, party: { partyid: options.badParty ? 999 : 77, serv: 1100, ownerid: 22, members: 2, maxmemb: 6, state: 1, startdate: '2026-10-12', enddate: '2027-10-12', servpw: 'NEVER EXPOSE' }, member: [{ uid: 22, nickname: '둘', jointime: '2026-10-12 09:00:00', state: 1 }, { uid: 33, nickname: '구매자', state: 1 }] };
    else if (path === '/chat/room/list') value = options.rooms ? [{ id: 5, ownerid: 22, memberid: 33 }] : [];
    else if (path === '/chat/room/reload') value = { items: [{ id: body.mindex === 0 ? 100 : 99, writer: 33, date: body.mindex === 0 ? '2026-10-12 12:02:00' : '2026-10-12 11:00:00', message: '' }], totalPage: 2 };
    else if (path === '/api/users/alarmlist') value = { result: 0, totalcnt: options.notices ? 2 : 0, list: !options.notices ? [] : [{ id: body.lastidx === 0 ? 100 : 99, type: 10001, date: '2026-10-12 12:00:00', partyid: 77 }] };
    else throw new Error(`Unexpected ${path}`);
    return new Response(JSON.stringify(value));
  });
  return { client: new LinkidClient(transport as typeof fetch, 0), transport };
}
describe('Linkid verified provider contract', () => {
  it('creates an independent server session and isolates profile switching from the browser', async () => {
    const { client } = provider(); const sid = await client.login('google', 'provider-id');
    expect(sid).not.toBe('browser-session'); await client.select(sid, profile);
    expect((await client.auth('browser-session')).uid).toBe(11); expect((await client.auth(sid)).uid).toBe(22);
  });
  it('fails closed before reading parties when the selected uid is wrong', async () => {
    const { client, transport } = provider({ wrongProfile: true });
    await expect(client.snapshot('server-session', profile, 0)).rejects.toMatchObject({ kind: 'auth' });
    expect(transport.mock.calls.some(x => String(x[0]).endsWith('/tri_my'))).toBe(false);
  });
  it('normalizes only safe party data and paginates read/unread bells and recent chat history', async () => {
    const { client, transport } = provider({ notices: true, rooms: true });
    const result = await client.snapshot('server-session', profile, Date.parse('2026-10-12T12:00:00+09:00'));
    expect(result.parties[0].service).toBe('마이크로소프트 365');
    expect(JSON.stringify(result)).not.toContain('NEVER EXPOSE');
    expect(result.notices.map(x => x.id)).toEqual([100, 99]);
    expect(result.rooms[0].messages.map(x => x.id)).toEqual([100, 99]);
    const alarmBodies = transport.mock.calls.filter(x => String(x[0]).endsWith('/alarmlist')).map(x => JSON.parse(String(x[1]?.body)));
    expect(alarmBodies.map(x => [x.read, x.lastidx])).toEqual([[0, 0], [0, 100], [1, 0], [1, 100]]);
    expect(transport.mock.calls.every(x => !String(x[0]).includes('alarmread') && !String(x[0]).includes('/message/read'))).toBe(true);
  });
  it('distinguishes throttling and schema errors without exposing response text', async () => {
    await expect(provider({ rate: true }).client.auth('server-session')).rejects.toMatchObject({ kind: 'rate' });
    await expect(provider({ badParty: true }).client.snapshot('server-session', profile, 0)).rejects.toBeInstanceOf(LinkidError);
    expect(linkidNotice({ id: 1, type: 9999999, date: '2026-10-12', msg: { password: 'private' } }).title).toBe('링키드 새 알림');
  });
  it('identifies the safe endpoint when a provider read returns 404', async () => {
    await expect(provider({ notFoundPath: '/api/party/tri_my' }).client.snapshot('server-session', profile, 0))
      .rejects.toThrow('/api/party/tri_my 조회 실패 (404)');
  });
  it('imports only Linkid credentials and rejects another domain or conflicting cookies', () => {
    const cookies = ['token', 'provider', 'providerId'].map(name => ({ name, value: 'value', domain: '.linkid.pw' }));
    expect(parseLinkidCredentials([...cookies, { name: 'tracking', value: 'irrelevant', domain: '.linkid.pw' }])).toEqual({ token: 'value', provider: 'value', providerId: 'value' });
    expect(() => parseLinkidCredentials(cookies.map(x => ({ ...x, domain: 'other.com' })))).toThrow();
    expect(() => parseLinkidCredentials([...cookies, cookies[0]])).toThrow();
    expect(() => parseLinkidCredentials({ token: '\n', provider: 'google', providerId: 'id' })).toThrow();
  });
  it('decodes the OpenSSL/CryptoJS format used by the official client', () => {
    // Generated independently by openssl enc -aes-256-cbc -md md5 using the provider's public client format.
    expect(decodeLinkidMessage('U2FsdGVkX1/A1YUGoAQN7z9dcZlo7/cMd/J220RBCQCa2NggqdMiobPtD3Zv5WyWvuPMjrQ+mztOXHW59G50mg==')).toBe('안녕하세요. 초대 부탁드려요');
  });
  it('does not display arbitrary unencrypted provider text as a message', () => {
    expect(decodeLinkidMessage('password=raw')).toContain('확인 필요');
  });
});
