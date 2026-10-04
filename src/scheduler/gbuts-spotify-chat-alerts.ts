import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { writeJsonAtomic } from '../lib/graytag-sales-session';
import { gbutsSpotifyOrderKey, type GbutsChatMessage, type GbutsSpotifyMember } from '../lib/gbuts-spotify';
import type { SellerAlertInput, SellerAlertResult } from '../alerts/telegram';

const DEFAULT_JOURNAL_PATH = '/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data/gbuts-spotify-chat-alerts.json';

export interface GbutsSpotifyChatAlertJournal {
  version: 1;
  sent: Record<string, string>;
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
  now?(): string;
}

function fingerprint(roomId: string, entry: GbutsChatMessage, occurrence: number): string {
  return createHash('sha256').update(JSON.stringify([
    roomId, entry.senderSeq, entry.createdAt, entry.messageType, entry.message, occurrence,
  ])).digest('hex');
}

/** Alert once per room and poll, without forwarding credentials or other chat contents to Telegram. */
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
    const roomId = await deps.openPrivateRoom(postSeq, member.userSeq);
    const chat = await deps.getChat(roomId);
    const occurrences = new Map<string, number>();
    const unseen: string[] = [];
    for (const entry of chat.messages) {
      if (entry.senderSeq !== member.userSeq || entry.messageType !== 'TEXT' || !entry.message.trim()) continue;
      const base = JSON.stringify([entry.senderSeq, entry.createdAt, entry.messageType, entry.message]);
      const occurrence = occurrences.get(base) || 0;
      occurrences.set(base, occurrence + 1);
      const eventTime = Date.parse(entry.createdAt);
      if (!Number.isFinite(eventTime) || eventTime < startMs) continue;
      const id = fingerprint(roomId, entry, occurrence);
      if (!journal.sent[id]) unseen.push(id);
    }
    if (!unseen.length) continue;
    const batchKey = createHash('sha256').update(unseen.join(':')).digest('hex').slice(0, 24);
    const result = await deps.sendAlert({
      key: `gbuts-spotify-chat-${batchKey}`,
      title: 'GButs Spotify 구매자 채팅',
      body: [
        `새 구매자 메시지 ${unseen.length}개가 도착했습니다.`,
        `주문: ${orderKey}`,
        '비밀번호 보호를 위해 메시지 내용은 텔레그램에 표시하지 않습니다.',
        '채팅 보기: https://gbuts.com/seller/chats',
      ].join('\n'),
      category: 'inquiry',
      throttleMs: 30 * 24 * 60 * 60 * 1000,
    });
    if (result.sent || result.reason === 'throttled') {
      const recordedAt = deps.now?.() ?? new Date().toISOString();
      for (const id of unseen) journal.sent[id] = recordedAt;
      deps.writeJournal(journal);
      sent += 1;
      messages += unseen.length;
    } else if (result.reason === 'failed') {
      failed += 1;
    }
  }
  return { sent, messages, failed };
}
