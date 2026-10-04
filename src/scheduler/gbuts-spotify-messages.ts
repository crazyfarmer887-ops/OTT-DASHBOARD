import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { writeJsonAtomic } from '../lib/graytag-sales-session';
import { extractGbutsSpotifyCredentials, gbutsSpotifyOrderKey, isActiveGbutsSpotifyMember, isSpotifyAccountForBuyer,
  type GbutsChatMessage, type GbutsSpotifyMember } from '../lib/gbuts-spotify';
import type { SpotifyNotionRow } from './gbuts-spotify-sync';

const DEFAULT_JOURNAL_PATH = '/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data/gbuts-spotify-messages.json';
export const SPOTIFY_BUYER_GUIDE = '안녕하세요~ 아래 2가지 중 하나를 선택해서 이 1:1 채팅에 남겨주세요!\n\n① 내 계정 등록\n사용 중인 Spotify 계정으로 이용하실 수 있습니다. 계정 ID(이메일)와 비밀번호를 이 채팅에 남겨주세요. 안전하게 처리하겠습니다. 기존 계정으로 초대가 어려우면 ②처럼 새 계정을 발급해드리고, 본인 이메일로 변경하실 수 있도록 안내해드리겠습니다.\n\n② 새 계정 발급\n새 계정을 원하시면 “새 계정 발급”이라고 말씀해주세요. 발급 후 이메일·비밀번호 변경이 가능하며, 기존 플레이리스트와 좋아요 이전도 지원합니다.';
export const SPOTIFY_REQUEST_ACK = '넵, 24시간 이내로 초대해드릴게요. 초대가 지연되면 지연된 기간만큼 더 이용하실 수 있게 조치해드리겠습니다~ 초대가 완료되면 이 채팅으로 연락드리겠습니다!';

export const SPOTIFY_INVITED_REPLY = '초대 완료했습니다. 확인해주세요!';

export function spotifyRegisteredAccountInvitedReply(email: string, password: string): string {
  return `ID : ${email}\n비밀번호 : ${password}\n접속하신 뒤 이메일, 비밀번호 바꾸시고 사용하시면 됩니다!`;
}

type MessageState = 'attempted' | 'confirmed';
interface MessageRecord { state: MessageState; text?: string; textHash?: string; roomId: string; updatedAt: string }
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
  requestAckStartAt?: string;
}

/** A question about new accounts is not a request to issue one. */
export function requestedSpotifyNewAccount(messages: readonly GbutsChatMessage[], buyerUserSeq: number): string | null {
  const hasOptions = messages.some((message) => message.senderSeq !== buyerUserSeq && message.messageType === 'TEXT'
    && /②\s*새\s*계정/.test(message.message));
  const buyerMessages = messages.filter((message) => message.senderSeq === buyerUserSeq && message.messageType === 'TEXT')
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  let selectedAt: string | null = null;
  for (const entry of buyerMessages) {
    const content = entry.message.trim();
    if (/(?:말고|아니|취소|안\s*(?:할|받|원)|필요\s*없)/.test(content)) { selectedAt = null; continue; }
    if (/[?？]/.test(content) || /(?:가능한가요|되나요|어떻게|뭔가요|무엇인가요|있나요)/.test(content)) continue;
    const numberedChoice = hasOptions && /^(?:②|2\s*번)(?:\s*(?:으로|을|를))?(?:\s*(?:요|이요|선택|부탁|해주세요|해줘|할게요|원해요))?[.!~\s]*$/.test(content);
    const namedChoice = /(?:새|신규)\s*(?:계정|아이디)/.test(content)
      && /(?:발급|만들|생성|원해|원합|부탁|해주세요|해줘|할게|할래|선택)/.test(content);
    if (numberedChoice || namedChoice) selectedAt = entry.createdAt;
  }
  return selectedAt;
}

export async function syncGbutsSpotifyMessages(deps: GbutsSpotifyMessageDependencies, postSeq: number): Promise<{
  guidesAttempted: number; acknowledgementsAttempted: number; invitedRepliesAttempted: number; confirmed: number;
}> {
  const ackStart = deps.requestAckStartAt == null ? null : Date.parse(deps.requestAckStartAt);
  if (ackStart !== null && !Number.isFinite(ackStart)) throw new Error('GButs Spotify acknowledgment start time invalid');
  const [members, rows] = await Promise.all([deps.listMembers(postSeq), deps.listRows()]);
  const active = members.filter(isActiveGbutsSpotifyMember);
  const journal = deps.readJournal();
  const sellerSeq = active.length ? await deps.sellerAccountSeq() : 0;
  let guidesAttempted = 0;
  let acknowledgementsAttempted = 0;
  let invitedRepliesAttempted = 0;
  let confirmed = 0;
  for (const member of active) {
    const orderKey = gbutsSpotifyOrderKey(postSeq, member);
    if (active.filter((candidate) => gbutsSpotifyOrderKey(postSeq, candidate) === orderKey).length !== 1) continue;
    const roomId = await deps.openPrivateRoom(postSeq, member.userSeq);
    const chat = await deps.getChat(roomId);
    const buyerCredentials = extractGbutsSpotifyCredentials(chat.messages, member.userSeq);
    const newAccountRequestedAt = requestedSpotifyNewAccount(chat.messages, member.userSeq);
    const buyerChoiceAt = [buyerCredentials?.receivedAt, newAccountRequestedAt]
      .filter((value): value is string => Boolean(value)).sort().at(-1);
    const matches = rows.filter((row) => row.orderKey === orderKey);
    if (matches.length > 1) continue;
    const row = matches.length === 1 ? matches[0] : null;
    const desired: Array<{ suffix: string; text: string }> = [];
    if (!buyerCredentials && !newAccountRequestedAt) desired.push({ suffix: 'guide', text: SPOTIFY_BUYER_GUIDE });
    const matchesBuyerCredentials = Boolean(row && buyerCredentials
      && isSpotifyAccountForBuyer(row.email, buyerCredentials.email)
      && row.password === buyerCredentials.password
      && (!newAccountRequestedAt || newAccountRequestedAt <= buyerCredentials.receivedAt));
    const manuallyIssuedLogin = Boolean(row?.registered && newAccountRequestedAt
      && (!buyerCredentials || newAccountRequestedAt > buyerCredentials.receivedAt)
      && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email) && row.password.length >= 6);
    const invitedMatches = Boolean(row?.invited && !row.cancelled
      && (row.registered ? matchesBuyerCredentials || manuallyIssuedLogin
        : matchesBuyerCredentials && row.email === buyerCredentials?.email));
    if (!invitedMatches && buyerChoiceAt && Number.isFinite(Date.parse(buyerChoiceAt))
      && (ackStart === null || Date.parse(buyerChoiceAt) >= ackStart))
      desired.push({ suffix: 'request-received', text: SPOTIFY_REQUEST_ACK });
    if (invitedMatches && row) {
      const fingerprint = createHash('sha256').update(`${row.email}\0${row.password}`).digest('hex').slice(0, 16);
      desired.push({ suffix: row.registered ? `registered-invited:${fingerprint}` : `invited:${fingerprint}`,
        text: row.registered ? spotifyRegisteredAccountInvitedReply(row.email, row.password) : SPOTIFY_INVITED_REPLY });
    }
    for (const item of desired) {
      const key = `${orderKey}:${item.suffix}`;
      const existing = journal.records[key];
      const textHash = createHash('sha256').update(item.text).digest('hex');
      if (existing && (existing.roomId !== roomId || (existing.textHash || (existing.text
        ? createHash('sha256').update(existing.text).digest('hex') : '')) !== textHash)) continue;
      if (chat.messages.some((message) => message.senderSeq === sellerSeq && message.messageType === 'TEXT'
        && message.message.trim() === item.text)) {
        if (!existing || existing.state !== 'confirmed') {
          journal.records[key] = { state: 'confirmed', textHash, roomId,
            updatedAt: deps.now?.() ?? new Date().toISOString() };
          deps.writeJournal(journal);
          confirmed += 1;
        }
        continue;
      }
      if (existing) continue; // An uncertain send is reconciled only; it is never repeated automatically.
      journal.records[key] = { state: 'attempted', textHash, roomId,
        updatedAt: deps.now?.() ?? new Date().toISOString() };
      deps.writeJournal(journal);
      if (item.suffix === 'guide') guidesAttempted += 1;
      else if (item.suffix === 'request-received') acknowledgementsAttempted += 1;
      else invitedRepliesAttempted += 1;
      try { await deps.sendText(roomId, sellerSeq, item.text); } catch { /* Delivery outcome unknown. */ }
    }
  }
  return { guidesAttempted, acknowledgementsAttempted, invitedRepliesAttempted, confirmed };
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
