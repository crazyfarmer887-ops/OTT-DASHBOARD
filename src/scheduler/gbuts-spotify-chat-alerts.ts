import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { writeJsonAtomic } from '../lib/graytag-sales-session';
import { gbutsSpotifyOrderKey, type GbutsChatMessage, type GbutsSpotifyMember } from '../lib/gbuts-spotify';
import { redactAlertText, type SellerAlertInput, type SellerAlertResult } from '../alerts/telegram';

const DEFAULT_JOURNAL_PATH = '/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data/gbuts-spotify-chat-alerts.json';

export interface GbutsSpotifyChatAlertJournal {
  version: 1;
  sent: Record<string, string>;
  lastScan?: { at: string; posts: number; sent: number; messages: number; failed: number; errors: number };
}

export function readGbutsSpotifyChatAlertJournal(
  path = process.env.GBUTS_SPOTIFY_CHAT_ALERT_JOURNAL_PATH || DEFAULT_JOURNAL_PATH,
): GbutsSpotifyChatAlertJournal {
  if (!existsSync(path)) return { version: 1, sent: {} };
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<GbutsSpotifyChatAlertJournal>;
  if (parsed.version !== 1 || !parsed.sent || typeof parsed.sent !== 'object' || Array.isArray(parsed.sent))
    throw new Error('GButs Spotify chat alert journal invalid');
  return parsed as GbutsSpotifyChatAlertJournal;
}

export function writeGbutsSpotifyChatAlertJournal(journal: GbutsSpotifyChatAlertJournal,
  path = process.env.GBUTS_SPOTIFY_CHAT_ALERT_JOURNAL_PATH || DEFAULT_JOURNAL_PATH): void {
  writeJsonAtomic(path, journal);
}

export interface GbutsSpotifyChatAlertDependencies {
  listMembers(postSeq: number): Promise<GbutsSpotifyMember[]>;
  openPrivateRoom(postSeq: number, userSeq: number): Promise<string>;
  getChat(roomId: string): Promise<{ messages: GbutsChatMessage[] }>;
  sendAlert(input: SellerAlertInput): Promise<SellerAlertResult>;
  readJournal(): GbutsSpotifyChatAlertJournal;
  writeJournal(journal: GbutsSpotifyChatAlertJournal): void;
  startAt: string;
  accountLabel?: string;
  productLabel?: string;
  buyerName?(member: GbutsSpotifyMember): string;
  now?(): string;
}

function fingerprint(roomId: string, entry: GbutsChatMessage, occurrence: number): string {
  return createHash('sha256').update(JSON.stringify([
    roomId, entry.senderSeq, entry.createdAt, entry.messageType, entry.message, occurrence,
  ])).digest('hex');
}

/** Split before the shared Telegram length limit, retaining per-part receipts on retry. */
export function gbutsTelegramMessageParts(content: string): string[] {
  const parts: string[] = [];
  const redacted = redactAlertText(content.replace(/((?:비밀번호|비번|암호|pwd)\s*[:：=]\s*)[^\s\n]+/gi, '$1[redacted]'));
  let chunk = '';
  for (const character of redacted) {
    if (chunk.length + character.length > 1800) { parts.push(chunk); chunk = ''; }
    chunk += character;
  }
  if (chunk) parts.push(chunk);
  return parts;
}

/** Incoming buyer messages only. Journals retain hashes, never chat contents. */
export async function syncGbutsSpotifyChatAlerts(deps: GbutsSpotifyChatAlertDependencies, postSeq: number): Promise<{
  sent: number; messages: number; failed: number;
}> {
  const startMs = Date.parse(deps.startAt);
  if (!Number.isFinite(startMs)) throw new Error('GButs Spotify chat alert start time invalid');
  const journal = deps.readJournal();
  const members = await deps.listMembers(postSeq);
  let sent = 0;
  let messages = 0;
  let failed = 0;
  for (const member of members) {
    const orderKey = gbutsSpotifyOrderKey(postSeq, member);
    if (members.filter((candidate) => gbutsSpotifyOrderKey(postSeq, candidate) === orderKey).length !== 1) continue;
    let roomId: string; let chat: { messages: GbutsChatMessage[] };
    try { roomId = await deps.openPrivateRoom(postSeq, member.userSeq); chat = await deps.getChat(roomId); }
    catch { failed++; continue; }
    const occurrences = new Map<string, number>();
    const unseen: Array<{ id: string; entry: GbutsChatMessage }> = [];
    for (const entry of chat.messages) {
      if (entry.senderSeq !== member.userSeq || entry.messageType !== 'TEXT' || !entry.message.trim()) continue;
      const base = JSON.stringify([entry.senderSeq, entry.createdAt, entry.messageType, entry.message]);
      const occurrence = occurrences.get(base) || 0;
      occurrences.set(base, occurrence + 1);
      const eventTime = Date.parse(entry.createdAt);
      if (!Number.isFinite(eventTime) || eventTime < startMs) continue;
      const id = fingerprint(roomId, entry, occurrence);
      if (!journal.sent[id]) unseen.push({ id, entry });
    }
    if (!unseen.length) continue;
    const header = [deps.accountLabel ? `판매 계정: ${deps.accountLabel.slice(0, 80)}` : '',
      `상품: ${(deps.productLabel || 'Spotify').slice(0, 100)}`,
      `구매자: ${(deps.buyerName?.(member) || String(member.userSeq)).slice(0, 80)}`, `주문: ${orderKey}`].filter(Boolean).join('\n');
    const footer = '\n\n채팅 보기: https://gbuts.com/seller/chats';
    const parts = unseen.sort((a, b) => Date.parse(a.entry.createdAt) - Date.parse(b.entry.createdAt)).flatMap(({ id, entry }) => {
      const chunks = gbutsTelegramMessageParts(entry.message);
      return chunks.map((text, index) => ({ id, receipt: `${id}:part:${index}`, text: `[${entry.createdAt.slice(0, 40)}${chunks.length > 1 ? ` · ${index + 1}/${chunks.length}` : ''}]\n${text}` }));
    });
    const batches: typeof parts[] = []; let batch: typeof parts = []; let length = 0;
    for (const part of parts.filter(x => !journal.sent[x.receipt])) {
      if (batch.length && length + part.text.length + 2 > 2300) { batches.push(batch); batch = []; length = 0; }
      batch.push(part); length += part.text.length + 2;
    }
    if (batch.length) batches.push(batch);
    for (const batch of batches) {
      const batchKey = createHash('sha256').update(batch.map(x => x.receipt).join(':')).digest('hex').slice(0, 24);
      const result = await deps.sendAlert({
        key: `gbuts-chat-content-${batchKey}`, title: `GButs ${(deps.productLabel || 'Spotify').slice(0, 100)} 구매자 채팅`,
        body: [`새 구매자 메시지 ${new Set(batch.map(x => x.id)).size}개가 도착했습니다.`, header,
          batch.map(x => x.text).join('\n\n')].join('\n\n') + footer,
        category: 'inquiry', throttleMs: 30 * 24 * 60 * 60 * 1000,
      });
      if (result.sent || result.reason === 'throttled') {
        const recordedAt = deps.now?.() ?? new Date().toISOString();
        for (const part of batch) journal.sent[part.receipt] = recordedAt;
        for (const { id } of unseen) if (!journal.sent[id] && parts.filter(p => p.id === id).every(p => journal.sent[p.receipt])) {
          journal.sent[id] = recordedAt; messages++;
        }
        deps.writeJournal(journal); sent++;
      } else { if (result.reason === 'failed') failed++; break; }
    }
  }
  return { sent, messages, failed };
}
