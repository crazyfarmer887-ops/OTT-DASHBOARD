import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { everyviewSpotifyOrderKey, parseEveryviewSpotifyChat, parseEveryviewSpotifyMembers, sendEveryviewSpotifyText } from '../src/lib/everyview-spotify';
import { everyviewOrderEligibility, guardEveryviewNotionCreation, type EveryviewSpotifyConfig } from '../src/scheduler/everyview-spotify-sync';
import { createGbutsSpotifyNotionClient, syncGbutsSpotifyCredentials } from '../src/scheduler/gbuts-spotify-sync';
import { spotifyRegisteredLogin, syncGbutsSpotifyMessages } from '../src/scheduler/gbuts-spotify-messages';
import type WebSocket from 'ws';

const party = `<div class="pld-slot-name pld-slot-name-host">owner</div><div data-share-type="INVITE"></div>
<div class="fpd-stat-item"><div class="fpd-stat-label">파티 종료일</div><div class="fpd-stat-val">~27.10.11</div></div>
<div class="pld-slot" data-user-id="30227" onclick="openGeneralPartyChat(554,2070)"><span>buyer</span></div>`;
const html = `<input id="websock_url" value="wss://everyview.kr/ws">
<div class="chat-content"><div class="message other"><div class="other-wrapper"><div class="bubble-row other">
<div class="chat-bubble left">새계정으로 부탁합니다</div><div class="time">10/27 오후 4:05</div></div></div></div>
<div class="bubble-row me"><div class="time">10/27 오후 4:08</div><div class="chat-bubble right">확인했습니다</div></div></div>
<script>var my_user_id = "32322"; let talkMsg = {"room_id": 4204, "user_idx": my_user_id, "content": content};</script>`;
const now = new Date('2026-10-28T00:00:00Z');
const config: EveryviewSpotifyConfig = { version: 1, enabled: true, sellerUserSeq: 32322, partyIds: [554],
  heldOrders: ['everyview:554:2070'], historicalBuyerAt: {} };

describe('Everyview Spotify provider boundary', () => {
  it('imports a legacy recovery request without inventing another account or repeating its acknowledgement', async () => {
    let row = { id: 'recovery', orderKey: 'everyview:554:2070', email: '', password: '',
      emailHistory: [], invited: false, registered: false, cancelled: false };
    const sendText = vi.fn(), createNewAccountRequestRow = vi.fn(), journal = { version: 1 as const, records: {} };
    const deps = { orderKey: everyviewSpotifyOrderKey, listRows: async () => [row], getRow: async () => row,
      listMembers: async () => [{ seq: 2070, userSeq: 30227, productId: 'EVERYVIEW554', status: 'APPLY', cancelStatus: null }],
      openPrivateRoom: async () => '4204', getChat: async () => parseEveryviewSpotifyChat(html, 30227, 32322, now),
      extractCredentials: async () => null, createNewAccountRequestRow, createRow: vi.fn(), replaceCredentials: vi.fn(), cancelRow: vi.fn(),
      sellerAccountSeq: async () => 32322, sendText, readJournal: () => journal, writeJournal: vi.fn(), requestAckStartAt: now.toISOString() };
    expect(await syncGbutsSpotifyCredentials(deps, 554)).toMatchObject({ created: 0, waitingForCredentials: 1 });
    await syncGbutsSpotifyMessages(deps, 554);
    expect(createNewAccountRequestRow).not.toHaveBeenCalled(); expect(sendText).not.toHaveBeenCalled();
    row = { ...row, email: 'issued@jamkkangudok.com', password: 'Issued123!', registered: true, invited: true };
    await syncGbutsSpotifyMessages(deps, 554); await syncGbutsSpotifyMessages(deps, 554);
    expect(sendText).toHaveBeenCalledTimes(1);
  });
  it('recovers an uncertain Notion creation by query without a second POST', async () => {
    const journal = { version: 1 as const, orders: {} };
    const row = { id: 'p', orderKey: 'everyview:554:2070', email: 'issued@example.com', password: 'Issued123!',
      emailHistory: [], invited: false, registered: false, cancelled: false };
    let rows: typeof row[] = [];
    const create = vi.fn(async (): Promise<typeof row> => { throw new Error('response lost'); });
    const deps = { listRows: async () => rows, read: () => journal, write: vi.fn() };
    await expect(guardEveryviewNotionCreation(row.orderKey, create, deps)).rejects.toThrow('response lost');
    await expect(guardEveryviewNotionCreation(row.orderKey, create, deps)).rejects.toThrow('uncertain');
    rows = [row];
    expect(await guardEveryviewNotionCreation(row.orderKey, create, deps)).toEqual(row);
    expect(create).toHaveBeenCalledTimes(1);
  });
  it('keeps member record and actual user IDs distinct', () => {
    const [m] = parseEveryviewSpotifyMembers(party, 554, '2026-10-28');
    expect(m).toMatchObject({ seq: 2070, userSeq: 30227 });
    expect(everyviewSpotifyOrderKey(554, m)).toBe('everyview:554:2070');
  });
  it('rejects another party and duplicate membership identities', () => {
    expect(() => parseEveryviewSpotifyMembers(party, 555, '2026-10-28')).toThrow('identity');
    expect(() => parseEveryviewSpotifyMembers(party + party, 554, '2026-10-28')).toThrow('ambiguous');
    expect(parseEveryviewSpotifyMembers(party, 554, '2028-01-01')).toEqual([]);
  });
  it('parses the official room and seller, never using member record ID as buyer user ID', () => {
    const c = parseEveryviewSpotifyChat(html, 30227, 32322, now);
    expect(c).toMatchObject({ roomId: '4204', buyerSeq: 30227, sellerSeq: 32322, socketUrl: 'wss://everyview.kr/ws/4204/32322' });
    expect(c.messages.map(m => m.senderSeq)).toEqual([30227, 32322]);
    expect(c.messages[0].createdAt).toBe('2026-10-27T07:05:00.000Z');
  });
  it('blocks a changed seller, socket host, or truncated history', () => {
    expect(() => parseEveryviewSpotifyChat(html, 30227, 99, now)).toThrow('identity');
    expect(() => parseEveryviewSpotifyChat(html.replace('wss://everyview.kr/ws', 'wss://other.example/ws'), 30227, 32322, now)).toThrow('identity');
    expect(() => parseEveryviewSpotifyChat(html.replace('10/27 오후 4:05', 'unknown'), 30227, 32322, now)).toThrow('timestamp');
    expect(() => parseEveryviewSpotifyChat(html, 30227, 32322, now, { partyId: 554, memberSeq: 2070 })).toThrow('counterparty');
  });
  it('keeps a legacy unassigned request held until an explicit platform binding exists', () => {
    const c = parseEveryviewSpotifyChat(html, 30227, 32322, now);
    expect(everyviewOrderEligibility(config, 'everyview:554:2070', 30227, c.messages, [])).toBe('held');
    const r = { id: 'p', orderKey: 'everyview:554:2070', email: 'issued@example.com', password: 'Issued123!',
      emailHistory: [], invited: true, registered: true, cancelled: false };
    expect(everyviewOrderEligibility(config, r.orderKey, 30227, c.messages, [r])).toBe('active');
    expect(everyviewOrderEligibility(config, r.orderKey, 30227, c.messages, [{ ...r, cancelled: true }])).toBe('held');
  });
  it('leaves historical completed conversations quiet but handles a later buyer request', () => {
    const c = { ...config, heldOrders: [], historicalBuyerAt: { 'everyview:554:2070': '2026-10-27T07:05:00Z' } };
    const chat = parseEveryviewSpotifyChat(html, 30227, 32322, now);
    expect(everyviewOrderEligibility(c, 'everyview:554:2070', 30227, chat.messages, [])).toBe('historical');
    expect(everyviewOrderEligibility(c, 'everyview:554:2070', 30227,
      [...chat.messages, { ...chat.messages[0], createdAt: '2026-10-28T01:00:00Z' }], [])).toBe('active');
  });
  it('accepts an explicit issued local part under the existing partner domain contract', () => {
    expect(spotifyRegisteredLogin({ id: 'p', orderKey: 'everyview:554:2070', email: 'original@example.com', password: 'Issued123!',
      emailHistory: [], invited: true, registered: true, cancelled: false, registeredEmail: 'issued-alias' }))
      .toEqual({ email: 'issued-alias@jamkkangudok.com', password: 'Issued123!' });
  });
  it('never treats a bound Everyview row as an unassigned GButs row', async () => {
    const p = { id: 'p', properties: { 'Spotify account': { title: [{ plain_text: 'issued@example.com' }] },
      'Everyview order ID': { rich_text: [{ plain_text: 'everyview:554:2070' }] } } };
    const fetcher = vi.fn(async () => Response.json({ results: [p] }));
    expect((await createGbutsSpotifyNotionClient('test', undefined, fetcher as typeof fetch).listRows())[0].orderKey).toBe('everyview:554:2070');
    p.properties['GButs order ID' as keyof typeof p.properties] = { rich_text: [{ plain_text: '15557:91' }] } as never;
    await expect(createGbutsSpotifyNotionClient('test', undefined, fetcher as typeof fetch).listRows()).rejects.toThrow('ambiguous');
  });
  it('writes new Everyview bindings to the dedicated property', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ id: 'p', properties: {
      'Spotify account': { title: [{ plain_text: 'buyer@example.com' }] },
      'Everyview order ID': { rich_text: [{ plain_text: 'everyview:554:2070' }] },
    } }));
    const client = createGbutsSpotifyNotionClient('test', undefined, fetcher as typeof fetch, undefined, 'Everyview order ID');
    await client.createRow('everyview:554:2070', { email: 'buyer@example.com', password: 'secret123', receivedAt: now.toISOString() });
    const props = JSON.parse(fetcher.mock.calls[0][1]!.body as string).properties;
    expect(props['Everyview order ID']).toBeDefined(); expect(props['GButs order ID']).toBeUndefined();
  });
  it('uses the namespaced key throughout the existing receipt/delivery worker', async () => {
    const send = vi.fn(async () => undefined), journal = { version: 1 as const, records: {} };
    const row = { id: 'p', orderKey: 'everyview:554:2070', email: 'issued@jamkkangudok.com', password: 'Issued123!',
      emailHistory: [], registered: true, invited: true, cancelled: false };
    const deps = { orderKey: everyviewSpotifyOrderKey, listRows: async () => [row],
      listMembers: async () => [{ seq: 2070, userSeq: 30227, productId: 'EVERYVIEW554', status: 'APPLY', cancelStatus: null }],
      openPrivateRoom: async () => '4204', getChat: async () => parseEveryviewSpotifyChat(html, 30227, 32322, now),
      sellerAccountSeq: async () => 32322, sendText: send, readJournal: () => journal, writeJournal: vi.fn() };
    await syncGbutsSpotifyMessages(deps, 554); await syncGbutsSpotifyMessages(deps, 554);
    expect(send).toHaveBeenCalledTimes(1);expect(Object.keys(journal.records)[0]).toMatch(/^everyview:554:2070:registered-invited:/);
  });
  it('sends once and accepts only the correct saved-message echo', async () => {
    let sends = 0;
    class Fake extends EventEmitter {
      constructor() { super(); queueMicrotask(() => this.emit('open')); }
      send(frame: string) { sends++; const v = JSON.parse(frame); queueMicrotask(() => this.emit('message', JSON.stringify({ ...v, server_time: 'now' }))); }
      close() {}
    }
    await sendEveryviewSpotifyText('test-session', parseEveryviewSpotifyChat(html, 30227, 32322, now), 'test reply', Fake as unknown as typeof WebSocket);
    expect(sends).toBe(1);
  });
  it('marks a close after SEND uncertain and a pre-SEND failure retryable', async () => {
    class AfterSend extends EventEmitter {
      constructor() { super(); queueMicrotask(() => this.emit('open')); }
      send() { queueMicrotask(() => this.emit('close')); } close() {}
    }
    class BeforeSend extends EventEmitter {
      constructor() { super(); queueMicrotask(() => this.emit('error', new Error('connect'))); } close() {}
    }
    const c = parseEveryviewSpotifyChat(html, 30227, 32322, now);
    await expect(sendEveryviewSpotifyText('test', c, 'reply', AfterSend as unknown as typeof WebSocket)).rejects.toMatchObject({ submitted: true, retryable: false });
    await expect(sendEveryviewSpotifyText('test', c, 'reply', BeforeSend as unknown as typeof WebSocket)).rejects.toMatchObject({ submitted: false, retryable: true });
  });
});
