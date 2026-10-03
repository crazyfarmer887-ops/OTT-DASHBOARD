import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { writeJsonAtomic } from '../lib/graytag-sales-session';
import { extractGbutsSpotifyCredentials, gbutsSpotifyOrderKey, isActiveGbutsSpotifyMember,
  type GbutsChatMessage, type GbutsSpotifyMember } from '../lib/gbuts-spotify';
import type { SpotifyNotionRow } from './gbuts-spotify-sync';

const DEFAULT_JOURNAL_PATH = '/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data/gbuts-spotify-messages.json';
export const SPOTIFY_BUYER_GUIDE = '구매 감사합니다. Spotify Family 초대를 받을 Spotify 계정 아이디(이메일)와 비밀번호를 이 1:1 채팅에 남겨주세요.\nSpotify 이메일: example@gmail.com\n비밀번호: 입력하실 비밀번호\n공개 댓글에는 비밀번호를 남기지 마세요. 해외 현지 담당자가 직접 초대하며 최대 24시간 소요될 수 있습니다.';

export function spotifyInvitedReply(email: string): string {
  return `요청하신 Spotify Family 초대를 ${email} 계정으로 보냈습니다. Spotify에서 초대 알림을 확인해 주세요.`;
}

type MessageState = 'attempted' | 'confirmed';
interface MessageRecord { state: MessageState; text: string; roomId: string; updatedAt: string }
export interface GbutsSpotifyMessageJournal { version: 1; records: Record<string, MessageRecord> }

export function readGbutsSpotifyMessageJournal(path = process.env.GBUTS_SPOTIFY_MESSAGE_JOURNAL_PATH || DEFAULT_JOURNAL_PATH): GbutsSpotifyMessageJournal {
  if (!existsSync(path)) return { version: 1, records: {} };
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<GbutsSpotifyMessageJournal>;
  if (parsed.version !== 1 || !parsed.records || typeof parsed.records !== 'object' || Array.isArray(parsed.records))
    throw new Error('GButs Spotify message journal invalid');
  return parsed as GbutsSpotifyMessageJournal;
}

export function writeGbutsSpotifyMessageJournal(journal: GbutsSpotifyMessageJournal,
  path = process.env.GBUTS_SPOTIFY_MESSAGE_JOURNAL_PATH || DEFAULT_JOURNAL_PATH): void {
  writeJsonAtomic(path, journal);
}

export interface GbutsSpotifyMessageDependencies {
  listMembers(postSeq: number): Promise<GbutsSpotifyMember[]>;
  openPrivateRoom(postSeq: number, userSeq: number): Promise<string>;
  getChat(roomId: string): Promise<{ messages: GbutsChatMessage[] }>;
  sellerAccountSeq(): Promise<number>;
  listRows(): Promise<SpotifyNotionRow[]>;
  sendText(roomId: string, accountSeq: number, text: string): Promise<void>;
  readJournal(): GbutsSpotifyMessageJournal;
  writeJournal(journal: GbutsSpotifyMessageJournal): void;
  now?(): string;
}

export async function syncGbutsSpotifyMessages(deps: GbutsSpotifyMessageDependencies, postSeq: number): Promise<{
  guidesAttempted: number; invitedRepliesAttempted: number; confirmed: number;
}> {
  const [members, rows] = await Promise.all([deps.listMembers(postSeq), deps.listRows()]);
  const active = members.filter(isActiveGbutsSpotifyMember);
  const journal = deps.readJournal();
  const sellerSeq = active.length ? await deps.sellerAccountSeq() : 0;
  let guidesAttempted = 0;
  let invitedRepliesAttempted = 0;
  let confirmed = 0;
  for (const member of active) {
    const orderKey = gbutsSpotifyOrderKey(postSeq, member);
    if (active.filter((candidate) => gbutsSpotifyOrderKey(postSeq, candidate) === orderKey).length !== 1) continue;
    const roomId = await deps.openPrivateRoom(postSeq, member.userSeq);
    const chat = await deps.getChat(roomId);
    const buyerCredentials = extractGbutsSpotifyCredentials(chat.messages, member.userSeq);
    const matches = rows.filter((row) => row.orderKey === orderKey);
    if (matches.length > 1) continue;
    const row = matches.length === 1 ? matches[0] : null;
    const desired: Array<{ suffix: string; text: string }> = [];
    if (!buyerCredentials) desired.push({ suffix: 'guide', text: SPOTIFY_BUYER_GUIDE });
    if (row?.invited && !row.cancelled && buyerCredentials && row.email === buyerCredentials.email
      && row.password === buyerCredentials.password) {
      const fingerprint = createHash('sha256').update(`${row.email}\0${row.password}`).digest('hex').slice(0, 16);
      desired.push({ suffix: `invited:${fingerprint}`, text: spotifyInvitedReply(row.email) });
    }
    for (const item of desired) {
      const key = `${orderKey}:${item.suffix}`;
      const existing = journal.records[key];
      if (existing && (existing.roomId !== roomId || existing.text !== item.text)) continue;
      if (chat.messages.some((message) => message.senderSeq === sellerSeq && message.messageType === 'TEXT'
        && message.message.trim() === item.text)) {
        if (!existing || existing.state !== 'confirmed') {
          journal.records[key] = { state: 'confirmed', text: item.text, roomId,
            updatedAt: deps.now?.() ?? new Date().toISOString() };
          deps.writeJournal(journal);
          confirmed += 1;
        }
        continue;
      }
      if (existing) continue; // An uncertain send is reconciled only; it is never repeated automatically.
      journal.records[key] = { state: 'attempted', text: item.text, roomId,
        updatedAt: deps.now?.() ?? new Date().toISOString() };
      deps.writeJournal(journal);
      if (item.suffix === 'guide') guidesAttempted += 1;
      else invitedRepliesAttempted += 1;
      try { await deps.sendText(roomId, sellerSeq, item.text); } catch { /* Delivery outcome unknown. */ }
    }
  }
  return { guidesAttempted, invitedRepliesAttempted, confirmed };
}

/** GButs' web client sends the same text payload to the STOMP destination below. */
export async function sendGbutsText(roomId: string, accountSeq: number, text: string): Promise<void> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(roomId) || !Number.isSafeInteger(accountSeq) || accountSeq <= 0
    || !text.trim() || text.length > 2000) throw new Error('GButs chat message invalid');
  const payload = JSON.stringify({ accountSeq, payload: text.trim(), roomId, type: 'TEXT' });
  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket('wss://socket.gbuts.com/ws/websocket');
    let settled = false;
    const timer = setTimeout(() => finish(new Error('GButs chat connection timed out')), 12_000);
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.close(); } catch {}
      if (error) reject(error); else resolve();
    };
    socket.onopen = () => socket.send('CONNECT\naccept-version:1.2\nheart-beat:0,0\n\n\0');
    socket.onerror = () => finish(new Error('GButs chat socket error'));
    socket.onclose = () => { if (!settled) finish(new Error('GButs chat socket closed')); };
    socket.onmessage = (event) => {
      const frame = String(event.data);
      if (frame.startsWith('ERROR')) { finish(new Error('GButs chat rejected message')); return; }
      if (!frame.startsWith('CONNECTED')) return;
      socket.send(`SEND\ndestination:/pub/chat/text\ncontent-type:application/json\ncontent-length:${Buffer.byteLength(payload)}\n\n${payload}\0`);
      // The site does not request a broker receipt. Re-read chat history on the next poll to confirm.
      setTimeout(() => finish(), 300);
    };
  });
}
