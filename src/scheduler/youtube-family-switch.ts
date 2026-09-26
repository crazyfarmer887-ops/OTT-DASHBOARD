import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { isBuyerTextMessage, messageTimestamp, normalizeBuyerMessage } from '../api/auto-reply-message';
import type { GraytagChatMessage } from '../api/chat-message-summary';
import { loadSafeModeConfig } from '../api/safe-mode';
import { isYouTubeInvitationSellerDeal } from '../api/youtube-auto-reply';
import { parseYouTubeInviteEmailCandidates } from '../lib/youtube-invite-email';
import { normalizeYouTubeInvitationEmail } from '../lib/youtube-invitations';
import { writeJsonAtomic } from '../lib/graytag-sales-session';
import { createNotionInvitationClient, isPendingNewInviteRow, type NotionDeliveryDeal, type NotionInvitationRow } from './notion-invitation-sync';
import { createSingleFlightRunner, runWithExclusivePollLock } from './poll-daemon';
import { buyerTurnEndingAt } from './buyer-message-turn';

const DEFAULT_JOURNAL = '/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data/youtube-family-switch.json';
const DEFAULT_LOCK = '/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data/youtube-family-switch.lock';
const DEFAULT_DATA_SOURCE_ID = '52e0fe4e-5f56-4fa1-8547-f2e89142b0db';
const MIN_CONFIDENCE = 0.9;
const MAX_ISSUE_AGE_MS = 48 * 60 * 60_000;
const SETTLE_MS = 3 * 60_000;

export const YOUTUBE_FAMILY_SWITCH_EMAIL_REQUEST = '가족 그룹 변경 제한으로 초대 수락이 어렵다면, 새로 초대받을 Google 이메일 주소를 이 대화창에 남겨주세요. 주소를 확인한 뒤 해외 현지 담당자와 수작업으로 진행해 24시간 내 재초대하겠습니다. 조금만 기다려 주세요.';
export const YOUTUBE_FAMILY_SWITCH_REINVITE_REPLY = '알겠습니다. 새로 남겨주신 이메일로 재초대를 진행하겠습니다. 해외 현지 담당자와 수작업 중이므로 24시간 내로 재초대해드리겠습니다. 조금만 기다려 주세요.';

type SwitchIntent = 'family_switch_limit' | 'resolved' | 'other';
type JournalState = 'attempted' | 'notion_updated' | 'reply_attempted' | 'done';
export interface FamilySwitchJournal { version: 1; records: Record<string, { state: JournalState; updatedAt: string }> }
export interface FamilySwitchDependencies {
  listDeals(): Promise<NotionDeliveryDeal[] | null>;
  listRows(): Promise<NotionInvitationRow[]>;
  getRow(id: string): Promise<NotionInvitationRow | null>;
  updateRowEmail(row: NotionInvitationRow, email: string): Promise<NotionInvitationRow>;
  listMessages(room: string): Promise<GraytagChatMessage[] | null>;
  classify(message: string): Promise<SwitchIntent>;
  send(deal: NotionDeliveryDeal, message: string): Promise<boolean>;
  readJournal(): FamilySwitchJournal;
  writeJournal(journal: FamilySwitchJournal): void;
  now?(): number;
}

type ChatEntry = { text: string; time: number; buyer: boolean; seller: boolean; index: number };
export interface FamilySwitchEvent {
  issueText: string;
  issueTime: number;
  fingerprint: string;
  newEmail: string | null;
  resolved: boolean;
  sellerReplied: boolean;
  ambiguousEmail: boolean;
  lastBuyerTime: number;
}

function chatTime(value: string): number {
  const dotted = /^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\s+(\d{1,2}):(\d{1,2})/.exec(value);
  if (dotted) return Date.UTC(+dotted[1], +dotted[2] - 1, +dotted[3], +dotted[4] - 9, +dotted[5]);
  return Date.parse(value);
}

function orderedChat(room: string, messages: readonly GraytagChatMessage[]): ChatEntry[] {
  return messages.map((message, index) => {
    const text = normalizeBuyerMessage(message.message || '');
    const time = chatTime(messageTimestamp(message));
    const seller = (message.owned || message.isOwned) === true;
    const buyer = isBuyerTextMessage({ chatRoomUuid: room, ...message, message: message.message || '' })
      && !/계정 정보가 전달되었습니다|구매를 확정했습니다|결제하셨습니다/.test(text);
    return { text, time, seller, buyer, index };
  }).filter((entry) => entry.text && Number.isFinite(entry.time) && entry.time > 0)
    .sort((a, b) => a.time - b.time || a.index - b.index);
}

export function findFamilySwitchEvent(room: string, messages: readonly GraytagChatMessage[], oldEmail: string, now = Date.now()): FamilySwitchEvent | null {
  const ordered = orderedChat(room, messages);
  let issueIndex = -1;
  let issueText = '';
  let issueTime = 0;
  for (let index = 0; index < ordered.length; index++) {
    const entry = ordered[index];
    if (!entry.buyer || !/가족|family|변경|바꾸|이동|전환|가입|참여|12개월|1년|switch|join|안\s*되|안\s*돼|못|걸려/i.test(entry.text)) continue;
    const turn = buyerTurnEndingAt(ordered, index);
    const text = turn.filter((message) => !normalizeYouTubeInvitationEmail(message.text))
      .map((message) => message.text).join('\n');
    if (!/가족|family/i.test(text)
      || !/변경|바꾸|이동|전환|가입|참여|12개월|1년|switch|join/i.test(text)) continue;
    issueIndex = ordered.indexOf(turn.find((message) => /가족|family/i.test(message.text)) || entry);
    issueText = text;
    issueTime = entry.time;
  }
  if (issueIndex < 0) return null;
  if (issueTime > now + 60_000 || now - issueTime > MAX_ISSUE_AGE_MS) return null;
  const after = ordered.slice(issueIndex);
  const buyerAfter = after.filter((entry) => entry.buyer);
  const buyerResolved = buyerAfter.slice(1).some(({ text }) => /(?:지금\s*)?가입(?:했어요|했습니다|됐어요|되었습니다|완료)|쓰고\s*있|사용\s*중|이용\s*중|사용하고\s*있|이용하고\s*있|잘\s*되|해결됐|해결했/.test(text));
  const declined = buyerAfter.some(({ text }) => /취소|환불|더\s*이상\s*필요\s*없/.test(text));
  if (buyerResolved || declined) return { issueText, issueTime, fingerprint: '',
    newEmail: null, resolved: true, sellerReplied: false, ambiguousEmail: false, lastBuyerTime: 0 };
  const candidateEmails = new Set<string>();
  let ambiguousEmail = false;
  for (const entry of buyerAfter) {
    const parsed = parseYouTubeInviteEmailCandidates(entry.text);
    if (parsed.kind === 'ambiguous') ambiguousEmail = true;
    if (parsed.kind === 'single_candidate' && parsed.candidate !== normalizeYouTubeInvitationEmail(oldEmail))
      candidateEmails.add(parsed.candidate);
  }
  if (candidateEmails.size > 1) ambiguousEmail = true;
  const newEmail = !ambiguousEmail && candidateEmails.size === 1 ? [...candidateEmails][0] : null;
  const lastBuyer = buyerAfter.at(-1) || ordered[issueIndex];
  const lastBuyerIndex = ordered.indexOf(lastBuyer);
  const sellerAfterLatestBuyer = ordered.slice(lastBuyerIndex + 1).filter((entry) => entry.seller);
  if (sellerAfterLatestBuyer.some(({ text }) => /초대(?:장)?.{0,30}(?:완료|보냈|발송했|전달했)/.test(text)))
    return { issueText, issueTime, fingerprint: '', newEmail: null,
      resolved: true, sellerReplied: true, ambiguousEmail: false, lastBuyerTime: lastBuyer.time };
  const sellerReplied = sellerAfterLatestBuyer.length > 0;
  const issueStart = ordered[issueIndex];
  const fingerprint = createHash('sha256')
    .update(`${room}\0${issueStart.time}\0${issueStart.text}\0${newEmail || 'pending'}`).digest('hex');
  return { issueText, issueTime, fingerprint, newEmail,
    resolved: false, sellerReplied, ambiguousEmail, lastBuyerTime: lastBuyer.time };
}

export async function classifyFamilySwitchIssue(message: string, apiKey = process.env.TYPESAFE_API_KEY || ''): Promise<SwitchIntent> {
  if (!apiKey) throw new Error('TYPESAFE_API_KEY is not configured');
  const response = await fetch('https://api.typesafe.ai/v1/systemone', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ state: normalizeBuyerMessage(message).slice(0, 3000),
      model: process.env.TYPESAFE_MODEL || 'jev-1.13.0',
      questions: { intent: {
        type: 'choice',
        instructions: 'This is a buyer message in a YouTube Premium invitation chat. Identify whether the buyer is currently blocked from joining because Google does not allow switching to another family group yet, including the 12-month/one-year family-group change limit. Do not confuse this with subscription expiry, country mismatch, a missing invite, or successful joining. A buyer may say simply 가족 변경이 안된다고 하네요 after an invite.',
        criteria: {
          family_switch_limit: 'Buyer reports that changing or joining a different Google/YouTube family group is blocked, often due to switching within 12 months or one year, or because they previously belonged to another family group.',
          resolved: 'Buyer says they have now joined successfully, Premium works, or the issue is fixed.',
          other: 'Country/region mismatch, no invitation, subscription expiry/12-month purchase duration, generic joining failure without family-switch context, hypothetical question, or unclear text.',
        },
      } },
    }), signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Jev HTTP ${response.status}`);
  const result = await response.json() as { answers?: { intent?: { choice?: string; confidence?: number; probabilities?: Record<string, number> } } };
  const answer = result.answers?.intent;
  if (answer?.choice !== 'family_switch_limit' || !answer.probabilities) return 'other';
  const probability = answer.probabilities.family_switch_limit;
  const next = Math.max(answer.probabilities.other || 0, answer.probabilities.resolved || 0);
  return Number.isFinite(answer.confidence) && (answer.confidence || 0) >= MIN_CONFIDENCE
    && Number.isFinite(probability) && probability >= MIN_CONFIDENCE && probability - next >= 0.15
    ? 'family_switch_limit' : 'other';
}

const ELIGIBLE_STATUS = new Set(['Delivered', 'Using', 'UsingNearExpiration', 'DeliveredAndCheckPrepaid']);

export async function syncYouTubeFamilySwitches(deps: FamilySwitchDependencies): Promise<{ updated: number; asked: number; replied: number; skipped: number }> {
  const [rows, deals] = await Promise.all([deps.listRows(), deps.listDeals()]);
  if (!deals) throw new Error('YouTube seller deals unavailable');
  const journal = deps.readJournal();
  const now = deps.now?.() ?? Date.now();
  const dealById = new Map(deals.filter((deal) => ELIGIBLE_STATUS.has(deal.dealStatus)
    && isYouTubeInvitationSellerDeal(deal)).map((deal) => [deal.dealUsid, deal]));
  let updated = 0; let asked = 0; let replied = 0; let skipped = 0;
  for (const row of rows.filter((entry) => entry.dealUsid
    && ((entry.invited && !entry.cancelled && entry.email) || isPendingNewInviteRow(entry)))) {
    if (rows.filter((entry) => entry.dealUsid === row.dealUsid).length !== 1) continue;
    const deal = dealById.get(row.dealUsid);
    if (!deal) continue;
    const oldEmail = normalizeYouTubeInvitationEmail(row.email)
      || normalizeYouTubeInvitationEmail(row.emailHistory?.at(-1));
    if (!oldEmail) continue;
    const messages = await deps.listMessages(deal.chatRoomUuid);
    if (!messages) continue;
    const event = findFamilySwitchEvent(deal.chatRoomUuid, messages, oldEmail, now);
    if (!event || event.resolved || event.ambiguousEmail || now - event.lastBuyerTime < SETTLE_MS) continue;
    const key = `${deal.dealUsid}:${event.fingerprint}`;
    if (journal.records[key]) continue;
    let intent: SwitchIntent;
    try { intent = await deps.classify(event.issueText); } catch { continue; }
    if (intent !== 'family_switch_limit') { skipped += 1; continue; }
    const freshMessages = await deps.listMessages(deal.chatRoomUuid);
    const fresh = freshMessages && findFamilySwitchEvent(deal.chatRoomUuid, freshMessages, oldEmail, now);
    if (!fresh || fresh.resolved || fresh.ambiguousEmail || fresh.fingerprint !== event.fingerprint) continue;
    const freshDeals = await deps.listDeals();
    if (!freshDeals?.some((item) => item.dealUsid === deal.dealUsid && ELIGIBLE_STATUS.has(item.dealStatus))) continue;
    const liveRow = await deps.getRow(row.id);
    if (!liveRow || liveRow.dealUsid !== deal.dealUsid || liveRow.cancelWaitlist) continue;
    const mark = (state: JournalState) => {
      journal.records[key] = { state, updatedAt: new Date(now).toISOString() };
      deps.writeJournal(journal);
    };
    if (!event.newEmail) {
      if (isPendingNewInviteRow(row) || fresh.sellerReplied || !liveRow.invited
        || liveRow.cancelled || liveRow.email !== row.email) continue;
      mark('attempted');
      try {
        if (await deps.send(deal, YOUTUBE_FAMILY_SWITCH_EMAIL_REQUEST)) { mark('done'); asked += 1; }
      } catch { /* Sending may have succeeded before an uncertain transport error. */ }
      continue;
    }
    if (isPendingNewInviteRow(row)) {
      if (!isPendingNewInviteRow(liveRow)
        || normalizeYouTubeInvitationEmail(liveRow.emailHistory?.at(-1)) !== oldEmail) continue;
    } else if (!liveRow.invited || liveRow.cancelled || liveRow.email !== row.email) continue;
    const replacement = await deps.updateRowEmail(liveRow, event.newEmail);
    if (replacement.dealUsid !== deal.dealUsid || replacement.email !== event.newEmail
      || replacement.invited || replacement.cancelled || !replacement.emailHistory?.includes(oldEmail))
      throw new Error('Family switch Notion replacement invalid');
    mark('notion_updated');
    updated += 1;
    if (fresh.sellerReplied) { mark('done'); continue; }
    const finalMessages = await deps.listMessages(deal.chatRoomUuid);
    const finalEvent = finalMessages && findFamilySwitchEvent(deal.chatRoomUuid, finalMessages, oldEmail, now);
    if (!finalEvent || finalEvent.resolved || finalEvent.fingerprint !== event.fingerprint || finalEvent.sellerReplied) {
      mark('done'); continue;
    }
    mark('reply_attempted');
    try {
      if (await deps.send(deal, YOUTUBE_FAMILY_SWITCH_REINVITE_REPLY)) { mark('done'); replied += 1; }
    } catch { /* Never retry an uncertain chat send. */ }
  }
  return { updated, asked, replied, skipped };
}

function readJournal(path: string): FamilySwitchJournal {
  if (!existsSync(path)) return { version: 1, records: {} };
  const value = JSON.parse(readFileSync(path, 'utf8')) as FamilySwitchJournal;
  if (value?.version !== 1 || !value.records || typeof value.records !== 'object' || Array.isArray(value.records))
    throw new Error('Family switch journal invalid');
  return value;
}

export function startYouTubeFamilySwitches(dependencies: Pick<FamilySwitchDependencies,
  'listDeals' | 'listMessages' | 'send'>): void {
  if (process.env.YOUTUBE_FAMILY_SWITCH_ENABLED !== 'true') return;
  const token = process.env.NOTION_API_TOKEN?.trim();
  const dataSourceId = process.env.NOTION_INVITATION_DATA_SOURCE_ID?.trim() || DEFAULT_DATA_SOURCE_ID;
  if (!token || !process.env.TYPESAFE_API_KEY || !/^[a-f0-9-]{32,36}$/i.test(dataSourceId)) {
    console.error('[YouTubeFamilySwitch] Notion or Jev connection missing'); return;
  }
  const notion = createNotionInvitationClient(token, dataSourceId);
  const journalPath = process.env.YOUTUBE_FAMILY_SWITCH_JOURNAL_PATH || DEFAULT_JOURNAL;
  const lockPath = process.env.YOUTUBE_FAMILY_SWITCH_LOCK_PATH || DEFAULT_LOCK;
  const intervalMs = Math.max(60_000, Number(process.env.YOUTUBE_FAMILY_SWITCH_INTERVAL_MS) || 5 * 60_000);
  const run = createSingleFlightRunner(async () => {
    if (process.env.AUTO_REPLY_ENABLE_SEND !== 'true' || loadSafeModeConfig().enabled) return;
    await runWithExclusivePollLock(lockPath, async () => {
      try {
        const result = await syncYouTubeFamilySwitches({ ...dependencies, ...notion,
          classify: classifyFamilySwitchIssue,
          readJournal: () => readJournal(journalPath),
          writeJournal: (journal) => writeJsonAtomic(journalPath, journal),
        });
        if (result.updated || result.asked || result.replied) console.log('[YouTubeFamilySwitch] sync', result);
      } catch (error) {
        console.error('[YouTubeFamilySwitch] sync failed', error instanceof Error ? error.message : 'unknown error');
      }
    });
  });
  setTimeout(() => { void run(); setInterval(() => { void run(); }, intervalMs); }, 20_000);
}
