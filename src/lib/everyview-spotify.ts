import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';
import WebSocket from 'ws';
import { everyviewFetch, fetchEveryviewHostParties } from './everyview-api';
import { GbutsChatDeliveryError } from './gbuts-chat-delivery';
import type { GbutsChatMessage, GbutsSpotifyMember } from './gbuts-spotify';

export class EveryviewSpotifyReadError extends Error {
  constructor(readonly code: 'SESSION_REQUIRED' | 'CHAT_SCHEMA_CHANGED' | 'CHAT_IDENTITY_MISMATCH' | 'OWNED_PARTY_UNAVAILABLE' | 'PROVIDER_READ_FAILED', message: string) { super(message); }
}
function assertEveryviewRead(response: Response, area: 'party' | 'chat'): void {
  if ([401,403].includes(response.status) || (response.redirected && /\/(?:login|signin)(?:[/?#]|$)/i.test(response.url)))
    throw new EveryviewSpotifyReadError('SESSION_REQUIRED', 'Everyview login session required');
  if (!response.ok || response.redirected) throw new EveryviewSpotifyReadError('PROVIDER_READ_FAILED', `Everyview ${area} read failed`);
}

type Node = DefaultTreeAdapterMap['node'];
const children = (n: Node): Node[] => 'childNodes' in n ? n.childNodes : [];
const attr = (n: Node, name: string): string => 'attrs' in n ? n.attrs.find(a => a.name === name)?.value || '' : '';
const cls = (n: Node, name: string): boolean => attr(n, 'class').split(/\s+/).includes(name);
const all = (n: Node): Node[] => [n, ...children(n).flatMap(all)];
const text = (n: Node): string => n.nodeName === '#text' ? (n as DefaultTreeAdapterMap['textNode']).value
  : n.nodeName === 'br' ? '\n' : children(n).map(text).join('');

export function everyviewSpotifyOrderKey(partyId: number, member: Pick<GbutsSpotifyMember, 'seq'>): string {
  if (![partyId, member.seq].every(x => Number.isSafeInteger(x) && x > 0)) throw new Error('Everyview order identity invalid');
  return `everyview:${partyId}:${member.seq}`;
}

export function parseEveryviewSpotifyMembers(html: string, partyId: number, today: string): GbutsSpotifyMember[] {
  const nodes = all(parseFragment(html));
  const stat = nodes.find(n => cls(n, 'fpd-stat-item') && all(n).some(x => cls(x, 'fpd-stat-label') && text(x).trim() === '파티 종료일'));
  const end = stat && all(stat).find(n => cls(n, 'fpd-stat-val'));
  const date = end && text(end).match(/~?(\d{2})\.(\d{2})\.(\d{2})/);
  if (!html.includes('pld-slot-name-host') || !date || !nodes.some(n => attr(n, 'data-share-type') === 'INVITE'))
    throw new Error('Everyview owned invitation party unavailable');
  const endDate = `20${date[1]}-${date[2]}-${date[3]}`;
  const parsedEnd = new Date(`${endDate}T00:00:00Z`);
  if (!Number.isFinite(parsedEnd.getTime()) || parsedEnd.toISOString().slice(0, 10) !== endDate)
    throw new Error('Everyview party expiry invalid');
  if (endDate < today) return [];
  const members: GbutsSpotifyMember[] = [];
  for (const slot of nodes.filter(n => cls(n, 'pld-slot') && attr(n, 'data-user-id'))) {
    const match = attr(slot, 'onclick').match(/^openGeneralPartyChat\((\d+),\s*(\d+)\)$/);
    const userSeq = Number(attr(slot, 'data-user-id'));
    if (!match || Number(match[1]) !== partyId || !Number.isSafeInteger(userSeq) || userSeq < 1)
      throw new Error('Everyview member identity invalid');
    members.push({ seq: Number(match[2]), userSeq, productId: `EVERYVIEW${partyId}`, status: 'APPLY', cancelStatus: null });
  }
  if (new Set(members.map(m => m.seq)).size !== members.length || new Set(members.map(m => m.userSeq)).size !== members.length)
    throw new Error('Everyview member identity ambiguous');
  return members;
}

function chatTime(label: string, now: Date): string {
  const m = label.trim().match(/^(\d{1,2})\/(\d{1,2})\s+(오전|오후)\s+(\d{1,2}):(\d{2})$/);
  if (!m) throw new Error('Everyview chat timestamp unavailable');
  if (Number(m[1]) < 1 || Number(m[1]) > 12 || Number(m[2]) < 1 || Number(m[2]) > 31
    || Number(m[4]) < 1 || Number(m[4]) > 12 || Number(m[5]) > 59) throw new Error('Everyview chat timestamp invalid');
  const hour = Number(m[4]) % 12 + (m[3] === '오후' ? 12 : 0);
  let year = Number(new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: 'Asia/Seoul' }).format(now));
  const make = () => new Date(`${year}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}T${String(hour).padStart(2, '0')}:${m[5]}:00+09:00`);
  if (make().getTime() > now.getTime() + 86_400_000) year--;
  return make().toISOString();
}

export interface EveryviewSpotifyChat {
  roomId: string; sellerSeq: number; buyerSeq: number; socketUrl: string; messages: GbutsChatMessage[];
}
export function parseEveryviewSpotifyChat(html: string, buyerSeq: number, expectedSeller: number, now = new Date(),
  expected?: { partyId: number; memberSeq: number }): EveryviewSpotifyChat {
  const root = parseFragment(html), nodes = all(root);
  const scripts = nodes.filter(n => n.nodeName === 'script').map(text).join('\n');
  const seller = Number(scripts.match(/var my_user_id\s*=\s*"(\d+)"/)?.[1]);
  const room = scripts.match(/let talkMsg\s*=\s*\{"room_id":\s*(\d+),\s*"user_idx":\s*my_user_id,\s*"content":\s*content(?:,\s*"client_msg_id":\s*cmid)?\}/)?.[1];
  const socket = attr(nodes.find(n => attr(n, 'id') === 'websock_url') || root, 'value');
  if (expected && (Number(scripts.match(/var party_id\s*=\s*"(\d+)"/)?.[1]) !== expected.partyId
    || Number(scripts.match(/enterMsg=\{"type"\s*:\s*"ENTER","roomId":\d+,"userId":(\d+),/)?.[1]) !== expected.memberSeq))
    throw new EveryviewSpotifyReadError('CHAT_IDENTITY_MISMATCH', 'Everyview chat counterparty identity changed');
  if (!seller || !room || !socket || !nodes.some(n => cls(n, 'chat-content')))
    throw new EveryviewSpotifyReadError('CHAT_SCHEMA_CHANGED', 'Everyview chat schema changed');
  if (seller !== expectedSeller || socket !== 'wss://everyview.kr/ws')
    throw new EveryviewSpotifyReadError('CHAT_IDENTITY_MISMATCH', 'Everyview chat identity invalid');
  const rows = nodes.filter(n => cls(n, 'bubble-row') && (cls(n, 'me') || cls(n, 'other')));
  const messages = rows.map(row => {
    const entries = all(row), bubbles = entries.filter(n => cls(n, 'chat-bubble')), bubble = bubbles[0], stamp = entries.find(n => cls(n, 'time'));
    if (!bubble || !stamp || bubbles.length !== 1 || cls(row, 'me') === cls(row, 'other')
      || !cls(bubble, cls(row, 'me') ? 'right' : 'left')) throw new EveryviewSpotifyReadError('CHAT_SCHEMA_CHANGED', 'Everyview chat history incomplete');
    return { senderSeq: cls(row, 'me') ? seller : buyerSeq,
      messageType: all(bubble).some(n => n.nodeName === 'img') ? 'IMAGE' : 'TEXT',
      message: text(bubble).trim(), createdAt: chatTime(text(stamp), now) };
  });
  if (nodes.filter(n => cls(n, 'chat-bubble')).length !== messages.length) throw new EveryviewSpotifyReadError('CHAT_SCHEMA_CHANGED', 'Everyview chat history incomplete');
  return { roomId: room, sellerSeq: seller, buyerSeq, socketUrl: `${socket}/${room}/${seller}`, messages };
}

/** One SEND, no reconnect/retry. A timeout after SEND is reconciled using saved history only. */
export async function sendEveryviewSpotifyText(cookie: string, chat: EveryviewSpotifyChat, content: string,
  Socket: typeof WebSocket = WebSocket): Promise<void> {
  if (chat.socketUrl !== `wss://everyview.kr/ws/${chat.roomId}/${chat.sellerSeq}` || content.length > 5000)
    throw new GbutsChatDeliveryError('Everyview chat send identity invalid', false, false);
  await new Promise<void>((resolve, reject) => {
    let submitted = false, settled = false;
    const ws = new Socket(chat.socketUrl, { headers: { Cookie: cookie, Origin: 'https://everyview.kr' }, handshakeTimeout: 10_000 });
    const finish = (error?: Error) => {
      if (settled) return; settled = true; clearTimeout(timer); ws.close();
      if (error) reject(error); else resolve();
    };
    const timer = setTimeout(() => finish(new GbutsChatDeliveryError('Everyview chat confirmation unavailable', submitted)), 15_000);
    ws.on('open', () => {
      submitted = true;
      ws.send(JSON.stringify({ room_id: Number(chat.roomId), user_idx: String(chat.sellerSeq), content }));
    });
    ws.on('message', data => {
      try {
        const saved = JSON.parse(String(data));
        if (String(saved.room_id) === chat.roomId && Number(saved.user_idx) === chat.sellerSeq
          && saved.content === content) finish();
      } catch { /* Ignore unrelated heartbeat frames. */ }
    });
    ws.on('error', () => finish(new GbutsChatDeliveryError('Everyview chat connection failed', submitted)));
    ws.on('close', () => finish(new GbutsChatDeliveryError('Everyview chat confirmation unavailable', submitted)));
  });
}

export function createEveryviewSpotifyClient(cookie: string, expectedSeller: number, assertSendingAllowed: () => void,
  now: () => Date = () => new Date()) {
  const rooms = new Map<string, { partyId: number; member: GbutsSpotifyMember }>();
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now());
  const listMembers = async (partyId: number): Promise<GbutsSpotifyMember[]> => {
    const owned = (await fetchEveryviewHostParties(cookie)).filter(p => p.partyId === partyId && p.partyType === 'free'
      && /스포티파이|spotify/i.test(p.serviceName || p.title));
    if (owned.length !== 1) throw new EveryviewSpotifyReadError('OWNED_PARTY_UNAVAILABLE', 'Everyview Spotify owned listing unavailable');
    const r = await everyviewFetch(`https://everyview.kr/partyLeader_free_detail_type1?id=${partyId}`, { cookieStr: cookie });
    assertEveryviewRead(r, 'party');
    return parseEveryviewSpotifyMembers(await r.text(), partyId, today());
  };
  const fetchChat = async (partyId: number, member: GbutsSpotifyMember) => {
    const r = await everyviewFetch('https://everyview.kr/api/generalParty/general_party_chat', {
      cookieStr: cookie, method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ partyId: String(partyId), targetId: String(member.seq) }),
    });
    assertEveryviewRead(r, 'chat');
    return parseEveryviewSpotifyChat(await r.text(), member.userSeq, expectedSeller, now(), { partyId, memberSeq: member.seq });
  };
  const getChat = async (roomId: string) => {
    const binding = rooms.get(roomId); if (!binding) throw new Error('Everyview room binding unavailable');
    const current = (await listMembers(binding.partyId)).filter(m => m.seq === binding.member.seq && m.userSeq === binding.member.userSeq);
    if (current.length !== 1) throw new Error('Everyview buyer no longer active');
    const chat = await fetchChat(binding.partyId, current[0]);
    if (chat.roomId !== roomId) throw new Error('Everyview room identity changed');
    return chat;
  };
  return {
    orderKey: everyviewSpotifyOrderKey, listMembers, getChat,
    sellerAccountSeq: async () => expectedSeller,
    async openPrivateRoom(partyId: number, userSeq: number): Promise<string> {
      const found = (await listMembers(partyId)).filter(m => m.userSeq === userSeq);
      if (found.length !== 1) throw new Error('Everyview buyer identity ambiguous');
      const chat = await fetchChat(partyId, found[0]), previous = rooms.get(chat.roomId);
      if (previous && (previous.partyId !== partyId || previous.member.seq !== found[0].seq || previous.member.userSeq !== userSeq))
        throw new Error('Everyview room identity ambiguous');
      rooms.set(chat.roomId, { partyId, member: found[0] });
      return chat.roomId;
    },
    async sendText(roomId: string, accountSeq: number, content: string) {
      let chat: EveryviewSpotifyChat;
      try {
        assertSendingAllowed();
        if (accountSeq !== expectedSeller) throw new Error('seller changed');
        chat = await getChat(roomId); assertSendingAllowed();
      } catch { throw new GbutsChatDeliveryError('Everyview pre-send validation unavailable', false); }
      await sendEveryviewSpotifyText(cookie, chat, content);
      const saved = await getChat(roomId);
      if (!saved.messages.some(m => m.senderSeq === expectedSeller && m.message === content))
        throw new GbutsChatDeliveryError('Everyview saved message unavailable', true);
    },
  };
}
