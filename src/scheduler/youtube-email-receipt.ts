import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { isBuyerTextMessage, messageTimestamp, normalizeBuyerMessage } from '../api/auto-reply-message';
import type { GraytagChatMessage } from '../api/chat-message-summary';
import { loadSafeModeConfig } from '../api/safe-mode';
import { resolveYouTubeBuyerEmailFromChat } from '../api/youtube-chat-email';
import { isYouTubeInvitationSellerDeal, YOUTUBE_NEW_SALE_GUIDE } from '../api/youtube-auto-reply';
import { parseYouTubeInviteEmailCandidates } from '../lib/youtube-invite-email';
import { writeJsonAtomic } from '../lib/graytag-sales-session';
import type { NotionDeliveryDeal } from './notion-invitation-sync';
import { createSingleFlightRunner, runWithExclusivePollLock } from './poll-daemon';

const DEFAULT_JOURNAL = '/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data/youtube-email-receipt.json';
const DEFAULT_LOCK = '/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data/youtube-email-receipt.lock';
const EMAIL_SETTLE_MS = 5 * 60_000;

export const YOUTUBE_EMAIL_RECEIPT_REPLY = '이메일 남겨주셔서 감사합니다. 초대는 주문이 들어온 순서대로 해외 현지 담당자와 직접 진행하고 있어 시차로 인해 다소 지연될 수 있습니다. 24시간 이내에 초대장을 보내고 제가 [계정 전달] 버튼을 누르겠습니다. 결제는 이미 완료된 상태이지만, 계정 전달 후 구매자님이 확인하시기 전까지는 이용이 시작되지 않아 대기 시간만큼 이용료가 차감되지 않습니다. 조금만 기다려 주세요.';

type ReceiptState = 'attempted' | 'sent';
export interface EmailReceiptJournal {
  version: 1;
  startedAt: string;
  records: Record<string, { state: ReceiptState; fingerprint: string; updatedAt: string }>;
}
export interface EmailReceiptDependencies {
  listDeals(): Promise<NotionDeliveryDeal[] | null>;
  listMessages(room: string): Promise<GraytagChatMessage[] | null>;
  providerStatus(dealUsid: string): Promise<string | null>;
  send(deal: NotionDeliveryDeal, message: string): Promise<boolean>;
  readJournal(): EmailReceiptJournal | null;
  writeJournal(journal: EmailReceiptJournal): void;
  now?(): number;
}

type ChatEntry = { text: string; time: number; buyer: boolean; seller: boolean; index: number };

function chatTime(value: string): number {
  const dotted = /^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\s+(\d{1,2}):(\d{1,2})/.exec(value);
  if (dotted) return Date.UTC(+dotted[1], +dotted[2] - 1, +dotted[3], +dotted[4] - 9, +dotted[5]);
  return Date.parse(value);
}

function orderedChat(room: string, messages: readonly GraytagChatMessage[]): ChatEntry[] {
  return messages.map((message, index) => ({
    text: normalizeBuyerMessage(message.message || ''),
    time: chatTime(messageTimestamp(message)),
    buyer: isBuyerTextMessage({ chatRoomUuid: room, ...message, message: message.message || '' }),
    seller: (message.owned || message.isOwned) === true,
    index,
  })).filter((entry) => entry.text && Number.isFinite(entry.time) && entry.time > 0)
    .sort((a, b) => a.time - b.time || a.index - b.index);
}

export function findYouTubeEmailReceiptCandidate(
  room: string, messages: readonly GraytagChatMessage[], startedAt: number, now = Date.now(),
): { email: string; fingerprint: string } | null {
  if (!Number.isFinite(startedAt)) return null;
  const selected = resolveYouTubeBuyerEmailFromChat(room, messages, false, EMAIL_SETTLE_MS, now);
  if (selected?.length !== 1) return null;
  const ordered = orderedChat(room, messages);
  const emailEntry = ordered.findLast((entry) => {
    if (!entry.buyer || entry.time < startedAt - 60_000) return false;
    const parsed = parseYouTubeInviteEmailCandidates(entry.text);
    return parsed.kind === 'single_candidate' && parsed.candidate === selected[0];
  });
  if (!emailEntry) return null;
  const later = ordered.slice(ordered.indexOf(emailEntry) + 1);
  if (later.some((entry) => entry.buyer && /취소|환불|다른\s*(?:계정|이메일|메일|주소)|바꿔|변경|정정|수정/.test(entry.text))) return null;
  if (ordered.some((entry) => entry.seller && entry.time >= emailEntry.time
    && entry.text !== normalizeBuyerMessage(YOUTUBE_NEW_SALE_GUIDE))) return null;
  const fingerprint = createHash('sha256').update(`${room}\0${emailEntry.time}\0${selected[0]}`).digest('hex');
  return { email: selected[0], fingerprint };
}

export async function syncYouTubeEmailReceipts(deps: EmailReceiptDependencies): Promise<{ sent: number; attempted: number }> {
  const deals = await deps.listDeals();
  if (!deals) throw new Error('YouTube seller deals unavailable');
  const now = deps.now?.() ?? Date.now();
  let journal = deps.readJournal();
  if (!journal) {
    journal = { version: 1, startedAt: new Date(now).toISOString(), records: {} };
    deps.writeJournal(journal);
    return { sent: 0, attempted: 0 };
  }
  const startedAt = Date.parse(journal.startedAt);
  if (!Number.isFinite(startedAt)) throw new Error('YouTube email receipt start time invalid');
  let sent = 0; let attempted = 0;
  for (const deal of deals.filter((item) => item.dealStatus === 'Delivering' && item.dealUsid
    && item.chatRoomUuid && isYouTubeInvitationSellerDeal(item))) {
    if (journal.records[deal.dealUsid]) continue;
    const messages = await deps.listMessages(deal.chatRoomUuid);
    if (!messages) continue;
    const candidate = findYouTubeEmailReceiptCandidate(deal.chatRoomUuid, messages, startedAt, now);
    if (!candidate) continue;
    if (await deps.providerStatus(deal.dealUsid) !== 'Delivering') continue;
    const freshMessages = await deps.listMessages(deal.chatRoomUuid);
    const fresh = freshMessages && findYouTubeEmailReceiptCandidate(deal.chatRoomUuid, freshMessages, startedAt, now);
    if (!fresh || fresh.fingerprint !== candidate.fingerprint) continue;
    const mark = (state: ReceiptState) => {
      journal!.records[deal.dealUsid] = { state, fingerprint: candidate.fingerprint, updatedAt: new Date(now).toISOString() };
      deps.writeJournal(journal!);
    };
    mark('attempted'); attempted += 1;
    try {
      if (await deps.send(deal, YOUTUBE_EMAIL_RECEIPT_REPLY)) { mark('sent'); sent += 1; }
    } catch { /* A transport error can follow a successful send; never retry it. */ }
  }
  return { sent, attempted };
}

function readJournal(path: string): EmailReceiptJournal | null {
  if (!existsSync(path)) return null;
  const value = JSON.parse(readFileSync(path, 'utf8')) as EmailReceiptJournal;
  if (value?.version !== 1 || !value.startedAt || !value.records || typeof value.records !== 'object'
    || Array.isArray(value.records)) throw new Error('YouTube email receipt journal invalid');
  return value;
}

export function startYouTubeEmailReceipts(dependencies: Pick<EmailReceiptDependencies,
  'listDeals' | 'listMessages' | 'providerStatus' | 'send'>): void {
  if (process.env.YOUTUBE_EMAIL_RECEIPT_ENABLED !== 'true') return;
  const journalPath = process.env.YOUTUBE_EMAIL_RECEIPT_JOURNAL_PATH || DEFAULT_JOURNAL;
  const lockPath = process.env.YOUTUBE_EMAIL_RECEIPT_LOCK_PATH || DEFAULT_LOCK;
  const intervalMs = Math.max(30_000, Number(process.env.YOUTUBE_EMAIL_RECEIPT_INTERVAL_MS) || 60_000);
  const run = createSingleFlightRunner(async () => {
    if (process.env.AUTO_REPLY_ENABLE_SEND !== 'true' || loadSafeModeConfig().enabled) return;
    await runWithExclusivePollLock(lockPath, async () => {
      try {
        const result = await syncYouTubeEmailReceipts({ ...dependencies,
          readJournal: () => readJournal(journalPath),
          writeJournal: (journal) => writeJsonAtomic(journalPath, journal),
        });
        if (result.sent || result.attempted) console.log('[YouTubeEmailReceipt] sync', result);
      } catch (error) {
        console.error('[YouTubeEmailReceipt] sync failed', error instanceof Error ? error.message : 'unknown error');
      }
    });
  });
  setTimeout(() => { void run(); setInterval(() => { void run(); }, intervalMs); }, 12_000);
}
