import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { isBuyerTextMessage, messageTimestamp, normalizeBuyerMessage } from '../api/auto-reply-message';
import type { GraytagChatMessage } from '../api/chat-message-summary';
import { isYouTubeInvitationSellerDeal } from '../api/youtube-auto-reply';
import { loadSafeModeConfig } from '../api/safe-mode';
import { writeJsonAtomic } from '../lib/graytag-sales-session';
import type { NotionDeliveryDeal } from './notion-invitation-sync';
import { createSingleFlightRunner, runWithExclusivePollLock } from './poll-daemon';
import { buyerTurnEndingAt } from './buyer-message-turn';

const DEFAULT_JOURNAL = '/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data/youtube-jev-replies.json';
const DEFAULT_LOCK = '/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data/youtube-jev-replies.lock';
const PAYMENT_PROFILE_HELP = 'https://support.google.com/paymentscenter/answer/7688666?hl=ko';
const MIN_CONFIDENCE = 0.9;
const MIN_MARGIN = 0.15;
const SETTLE_MS = 3 * 60_000;
const MAX_MESSAGE_AGE_MS = 24 * 60 * 60_000;
const REPEAT_COOLDOWN_MS = 12 * 60 * 60_000;

export type BuyerIntent = 'invitation_wait' | 'country_mismatch' | 'delivered_no_invitation' | 'premium_lost' | 'other';
export const YOUTUBE_INVITATION_WAIT_REPLY = '문의 감사합니다. 초대는 해외 현지 담당자와 소통하며 주문 순서대로 직접 진행하고 있어 최대 24시간이 걸릴 수 있습니다. 준비되는 대로 안내드릴 테니 조금만 양해 부탁드립니다.';
export const YOUTUBE_COUNTRY_MISMATCH_REPLY = `국가가 다르다는 오류를 확인한 뒤 재초대가 가능한지 살펴보겠습니다. 필요한 경우 초대장을 다시 보내드릴게요. 먼저 Google 결제 프로필의 국가와 현재 거주 국가가 일치하는지 확인해 주세요. 결제 프로필 폐쇄 방법: ${PAYMENT_PROFILE_HELP}\n\n프로필 폐쇄는 되돌릴 수 없고 결제 정보가 삭제되므로, 확인 없이 모든 프로필을 삭제하지는 마세요. YouTube 가족 초대는 가족 관리자와 같은 거주지 요건도 있어 재발송만으로 해결되지 않을 수 있습니다. 오류 화면을 보내주시면 확인에 도움이 됩니다.`;
export const YOUTUBE_DELIVERED_NO_INVITATION_REPLY = '죄송합니다. 초대 작업은 해외 현지 담당자와 함께 진행하고 있어 소통에 차질이 생길 수 있습니다. 24시간 내에도 초대장이 오지 않으면 이 대화창으로 한 번 더 문의해 주세요.';
export const YOUTUBE_PREMIUM_LOST_REPLY = '죄송합니다. 초대 작업은 해외 현지 담당자와 함께 진행하고 있어 소통에 차질이 생길 수 있습니다. 저희가 임의로 프리미엄을 해제하는 경우는 없습니다. 현재 이용 상태를 한 번 더 확인하신 뒤에도 프리미엄이 보이지 않으면 이 대화창으로 다시 문의해 주세요.';

const POST_DELIVERY_STATUSES = new Set(['Delivered', 'Using', 'UsingNearExpiration', 'DeliveredAndCheckPrepaid']);

function intentMatchesStatus(intent: BuyerIntent, status: string): boolean {
  if (intent === 'invitation_wait' || intent === 'country_mismatch') return status === 'Delivering';
  return POST_DELIVERY_STATUSES.has(status);
}

function isPostDeliveryIntent(intent: BuyerIntent): intent is 'delivered_no_invitation' | 'premium_lost' {
  return intent === 'delivered_no_invitation' || intent === 'premium_lost';
}

/** A confident model decision still needs to be about one current, actionable issue. */
export function isSafeYouTubeBuyerIntent(message: string, intent: BuyerIntent): boolean {
  const text = normalizeBuyerMessage(message);
  if (intent === 'other' || !text || /취소\s*(?:해|할|하고|원해|부탁)|환불|반품|삭제|이메일.*(?:변경|바꾸|수정)|(?:변경|바꾸|수정).*이메일|계정.*(?:변경|바꾸)|[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(text)) return false;
  if (intent === 'delivered_no_invitation') {
    return /초대|메일|이메일|링크/.test(text)
      && /안\s*(?:왔|와|오|보이|보여)|못\s*받|오지\s*않|도착하지\s*않|미도착|미수신|없(?:어|습|네|음|다)/.test(text)
      && !/국가|나라|지역|가족\s*(?:변경|그룹)|12개월|1년|받았는데|왔는데|지금\s*(?:왔|보여)|방금\s*(?:왔|보여)|해결됐|해결했/.test(text);
  }
  if (intent === 'premium_lost') {
    return /프리미엄|premium/i.test(text)
      && /(?:안\s*(?:되|돼|나오|떠|보이)|없어|사라|풀렸|끊겼|해제|취소됐|종료됐|멈췄|중단됐|광고\s*(?:나와|나오|떠))/.test(text)
      && /가입|참여|이용|사용|잘\s*되|되다가|쓰다가|받았|초대|풀렸|끊겼|해제|사라|다시\s*광고/.test(text)
      && !/국가|나라|지역|가족\s*(?:변경|그룹\s*(?:변경|가입))|12개월|1년|지금\s*(?:돼|되네|해결)|방금\s*(?:돼|되네|해결)/.test(text);
  }
  const countryMention = /국가|나라|지역|country|region/i.test(text);
  if (intent === 'invitation_wait') return !countryMention;
  if (!countryMention || !/다르|다른|달라|틀리|불일치|일치하지|안\s*맞|맞지|mismatch|different|국가\s*설정\s*(?:오류|에러)/i.test(text)) return false;
  if (/초대\s*전|초대받기\s*전|초대장\s*오기\s*전|(?:초대장?|초대장이)\s*(?:이|가)?\s*(?:아직\s*)?(?:안\s*왔|오지|못\s*받|안\s*받(?!아))|아직\s*초대\s*(?:안|못)/.test(text)) return false;
  if (/만약|뜨면|다르면|일치하지\s*않으면|괜찮(?:나요|을까요)|가능한가요/.test(text)) return false;
  return /뜨|뜹|떠|나오|나와|표시|오류|에러|수락|가입|못|안\s*되|안\s*된|안\s*돼|안\s*됨|불가|거절|보내|받|초대장|링크|다르다네요|틀리대|틀리다고/.test(text);
}

type JournalRecord = { fingerprint: string; state: 'baseline' | 'ignored' | 'attempted' | 'sent'; updatedAt: string; lastSentIntent?: BuyerIntent; lastSentAt?: string };
export interface JevReplyJournal { version: 1; startedAt: string; postStartedAt?: string; records: Record<string, JournalRecord> }
export interface JevReplyDependencies {
  listDeals(): Promise<NotionDeliveryDeal[] | null>;
  listMessages(room: string): Promise<GraytagChatMessage[] | null>;
  providerStatus(dealUsid: string): Promise<string | null>;
  classify(message: string, dealStatus: string): Promise<BuyerIntent>;
  send(deal: NotionDeliveryDeal, message: string): Promise<boolean>;
  alertCountryIssue(deal: NotionDeliveryDeal): Promise<void>;
  alertPostDeliveryIssue?(deal: NotionDeliveryDeal, intent: 'delivered_no_invitation' | 'premium_lost'): Promise<void>;
  readJournal(): JevReplyJournal | null;
  writeJournal(journal: JevReplyJournal): void;
  now?(): number;
  scope?: 'pre' | 'post';
}

function chatTime(value: string): number {
  const dotted = /^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\s+(\d{1,2}):(\d{1,2})/.exec(value);
  if (dotted) return Date.UTC(+dotted[1], +dotted[2] - 1, +dotted[3], +dotted[4] - 9, +dotted[5]);
  return Date.parse(value);
}

function latestBuyerMessage(room: string, messages: GraytagChatMessage[]): { text: string; time: number; fingerprint: string } | null {
  const timestamp = (message: GraytagChatMessage) => messageTimestamp({ chatRoomUuid: room,
    ...message, message: message.message || '' });
  const stamped = messages.map((message, index) => ({ message, index, time: chatTime(timestamp(message)) }))
    .filter((entry) => Number.isFinite(entry.time) && entry.time > 0 && normalizeBuyerMessage(entry.message.message))
    .map((entry) => ({ ...entry, buyer: isBuyerTextMessage({ chatRoomUuid: room, ...entry.message,
      message: entry.message.message || '' }), text: normalizeBuyerMessage(entry.message.message) }))
    .sort((a, b) => a.time - b.time || a.index - b.index);
  const latestIndex = stamped.findLastIndex((entry) => entry.buyer);
  if (latestIndex < 0) return null;
  const latest = stamped[latestIndex];
  // If a seller has replied in the same timestamp minute, defer to the human.
  if (stamped.some(({ message, time }) => (message.owned || message.isOwned) && time >= latest.time)) return null;
  const turn = buyerTurnEndingAt(stamped, latestIndex);
  const text = turn.map((entry) => entry.text).join('\n');
  // Preserve existing one-message fingerprints so a deploy cannot replay old inquiries.
  const fingerprintInput = turn.length === 1
    ? `${room}\0${timestamp(latest.message)}\0${text}`
    : `${room}\0${turn.map((entry) => `${timestamp(entry.message)}:${entry.text}`).join('\0')}`;
  const fingerprint = createHash('sha256').update(fingerprintInput).digest('hex');
  return { text, time: latest.time, fingerprint };
}

export async function classifyYouTubeBuyerIntent(message: string, dealStatus = 'Delivering', apiKey = process.env.TYPESAFE_API_KEY || ''): Promise<BuyerIntent> {
  if (!apiKey) throw new Error('TYPESAFE_API_KEY is not configured');
  const response = await fetch('https://api.typesafe.ai/v1/systemone', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      state: `Order status: ${dealStatus}\nBuyer: ${normalizeBuyerMessage(message).slice(0, 3000)}`,
      model: process.env.TYPESAFE_MODEL || 'jev-1.13.0',
      questions: { intent: {
        type: 'choice',
        instructions: 'The latest message is from the buyer in a paid YouTube Premium invitation order. Use the order status as context. Delivering means delivery is not marked complete; Delivered/Using means it is. Classify the current problem, not an old problem that the buyer says is resolved. Short shorthand such as 언제쯤 올까요, 초대 좀 빨리요, 배송 언제요 asks about invitation timing before delivery. A country error means an actual country/region mismatch while accepting an invitation. Select other for mixed intents, family-group switching limits, cancellation, refund, changing accounts, or unclear messages.',
        criteria: {
          invitation_wait: 'Only for Delivering: buyer asks when an invitation/delivery will arrive or urges seller to send it, without reporting a completed delivery.',
          country_mismatch: 'Only for Delivering: actual country/region mismatch error while accepting a sent invitation.',
          delivered_no_invitation: 'Only for Delivered/Using: delivery is marked complete but buyer says the invitation email/link has not arrived or cannot be found. No country/family error.',
          premium_lost: 'Only for Delivered/Using: buyer joined or previously used Premium, but Premium disappeared, stopped, or is not active after joining. No family switch or country error.',
          other: 'Unrelated, resolved, hypothetical, family-group switch, cancellation/refund, email or account change, multiple distinct requests, or unclear.',
        },
      } },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Jev HTTP ${response.status}`);
  const result = await response.json() as { answers?: { intent?: { choice?: string; confidence?: number; probabilities?: Record<string, number> } } };
  const answer = result.answers?.intent;
  const choice = answer?.choice;
  const probabilities = answer?.probabilities;
  if (!choice || !probabilities || !['invitation_wait', 'country_mismatch', 'delivered_no_invitation', 'premium_lost'].includes(choice)) return 'other';
  if (!intentMatchesStatus(choice as BuyerIntent, dealStatus)) return 'other';
  const selected = probabilities[choice];
  const next = Math.max(...Object.entries(probabilities).filter(([key]) => key !== choice).map(([, value]) => value));
  const explicitWait = choice === 'invitation_wait'
    && /초대|배송|전달/.test(message)
    && /언제|기다|늦|빨리|안\s*(?:오|왔|옵)|보내|해주/.test(message);
  const neededConfidence = explicitWait ? 0.8 : MIN_CONFIDENCE;
  const neededProbability = explicitWait ? 0.85 : MIN_CONFIDENCE;
  if (!Number.isFinite(answer?.confidence) || (answer?.confidence || 0) < neededConfidence
    || !Number.isFinite(selected) || selected < neededProbability || !Number.isFinite(next)
    || selected - next < MIN_MARGIN) return 'other';
  return isSafeYouTubeBuyerIntent(message, choice as BuyerIntent) ? choice as BuyerIntent : 'other';
}

export async function syncYouTubeJevReplies(deps: JevReplyDependencies): Promise<{ baselined: number; sent: number; ignored: number; attempted: number }> {
  const deals = await deps.listDeals();
  if (!deals) throw new Error('YouTube seller deals unavailable');
  const now = deps.now?.() ?? Date.now();
  const active = deals.filter((deal) => ((deps.scope !== 'post' && deal.dealStatus === 'Delivering')
    || (deps.scope !== 'pre' && POST_DELIVERY_STATUSES.has(deal.dealStatus)))
    && deal.dealUsid && deal.chatRoomUuid && isYouTubeInvitationSellerDeal({ ...deal }));
  let journal = deps.readJournal();
  if (!journal) {
    journal = { version: 1, startedAt: new Date(now).toISOString(),
      postStartedAt: deps.scope === 'post' ? new Date(now).toISOString() : undefined, records: {} };
    // Establish a cursor for existing conversations before enabling sends.
    for (const deal of active) {
      const messages = await deps.listMessages(deal.chatRoomUuid);
      if (!messages) continue;
      const latest = latestBuyerMessage(deal.chatRoomUuid, messages);
      if (latest) journal.records[deal.dealUsid] = { fingerprint: latest.fingerprint, state: 'baseline', updatedAt: new Date(now).toISOString() };
    }
    deps.writeJournal(journal);
    return { baselined: Object.keys(journal.records).length, sent: 0, ignored: 0, attempted: 0 };
  }
  if (deps.scope === 'post' && !journal.postStartedAt) {
    journal.postStartedAt = new Date(now).toISOString();
    let baselined = 0;
    for (const deal of active) {
      const messages = await deps.listMessages(deal.chatRoomUuid);
      if (!messages) continue;
      const latest = latestBuyerMessage(deal.chatRoomUuid, messages);
      if (!latest) continue;
      journal.records[deal.dealUsid] = { ...journal.records[deal.dealUsid],
        fingerprint: latest.fingerprint, state: 'baseline', updatedAt: journal.postStartedAt };
      baselined += 1;
    }
    deps.writeJournal(journal);
    return { baselined, sent: 0, ignored: 0, attempted: 0 };
  }
  let sent = 0; let ignored = 0; let attempted = 0;
  for (const deal of active) {
    const messages = await deps.listMessages(deal.chatRoomUuid);
    if (!messages) continue;
    const latest = latestBuyerMessage(deal.chatRoomUuid, messages);
    if (!latest || journal.records[deal.dealUsid]?.fingerprint === latest.fingerprint) continue;
    const previous = journal.records[deal.dealUsid];
    const mark = (state: JournalRecord['state'], intent?: BuyerIntent) => {
      journal!.records[deal.dealUsid] = {
        fingerprint: latest.fingerprint, state, updatedAt: new Date(now).toISOString(),
        lastSentIntent: state === 'sent' ? intent : previous?.lastSentIntent,
        lastSentAt: state === 'sent' ? new Date(now).toISOString() : previous?.lastSentAt,
      };
      deps.writeJournal(journal!);
    };
    if (latest.time < Date.parse(deps.scope === 'post' ? journal.postStartedAt || journal.startedAt : journal.startedAt)
      || now - latest.time < SETTLE_MS
      || now - latest.time > MAX_MESSAGE_AGE_MS || latest.time > now + 60_000) continue;
    let intent: BuyerIntent;
    try { intent = await deps.classify(latest.text, deal.dealStatus); } catch { continue; }
    const postIntent = isPostDeliveryIntent(intent);
    const repeatedPostIntent = postIntent && previous?.lastSentIntent === intent && Boolean(previous.lastSentAt);
    if (intent === 'other' || !intentMatchesStatus(intent, deal.dealStatus)
      || !isSafeYouTubeBuyerIntent(latest.text, intent)) { mark('ignored'); ignored += 1; continue; }
    if (repeatedPostIntent) {
      mark('ignored'); ignored += 1;
      if (previous?.lastSentAt && now - Date.parse(previous.lastSentAt) >= 24 * 60 * 60_000
        && intentMatchesStatus(intent, await deps.providerStatus(deal.dealUsid) || ''))
        if (isPostDeliveryIntent(intent)) await deps.alertPostDeliveryIssue?.(deal, intent).catch(() => {});
      continue;
    }
    if (previous?.lastSentIntent === intent && previous.lastSentAt
      && now - Date.parse(previous.lastSentAt) < REPEAT_COOLDOWN_MS) { mark('ignored'); ignored += 1; continue; }
    // Recheck the live status and conversation after the external classifier call.
    const liveStatus = await deps.providerStatus(deal.dealUsid);
    if (!liveStatus || !intentMatchesStatus(intent, liveStatus)) continue;
    const current = await deps.listMessages(deal.chatRoomUuid);
    if (!current || latestBuyerMessage(deal.chatRoomUuid, current)?.fingerprint !== latest.fingerprint) continue;
    mark('attempted', intent);
    attempted += 1;
    if (isPostDeliveryIntent(intent)) await deps.alertPostDeliveryIssue?.(deal, intent).catch(() => {});
    const reply = intent === 'country_mismatch' ? YOUTUBE_COUNTRY_MISMATCH_REPLY
      : intent === 'delivered_no_invitation' ? YOUTUBE_DELIVERED_NO_INVITATION_REPLY
        : intent === 'premium_lost' ? YOUTUBE_PREMIUM_LOST_REPLY : YOUTUBE_INVITATION_WAIT_REPLY;
    try {
      if (!await deps.send(deal, reply)) continue;
      mark('sent', intent); sent += 1;
      if (intent === 'country_mismatch') await deps.alertCountryIssue(deal).catch(() => {});
    } catch { /* The send may have succeeded before its connection failed. Never retry this fingerprint. */ }
  }
  return { baselined: 0, sent, ignored, attempted };
}

function readJournal(path: string): JevReplyJournal | null {
  if (!existsSync(path)) return null;
  const value = JSON.parse(readFileSync(path, 'utf8')) as JevReplyJournal;
  if (value?.version !== 1 || !value.startedAt || !value.records || typeof value.records !== 'object' || Array.isArray(value.records))
    throw new Error('YouTube Jev reply journal invalid');
  return value;
}

export function startYouTubeJevReplies(dependencies: Pick<JevReplyDependencies,
  'listDeals' | 'listMessages' | 'providerStatus' | 'send' | 'alertCountryIssue' | 'alertPostDeliveryIssue'>): void {
  if (process.env.YOUTUBE_JEV_AUTO_REPLY_ENABLED !== 'true') return;
  if (!process.env.TYPESAFE_API_KEY) { console.error('[YouTubeJevReplies] Jev key missing'); return; }
  const journalPath = process.env.YOUTUBE_JEV_REPLY_JOURNAL_PATH || DEFAULT_JOURNAL;
  const lockPath = process.env.YOUTUBE_JEV_REPLY_LOCK_PATH || DEFAULT_LOCK;
  const intervalMs = Math.max(30_000, Number(process.env.YOUTUBE_JEV_REPLY_INTERVAL_MS) || 60_000);
  const postIntervalMs = Math.max(60_000, Number(process.env.YOUTUBE_JEV_POST_DELIVERY_INTERVAL_MS) || 5 * 60_000);
  const makeRun = (scope: 'pre' | 'post') => createSingleFlightRunner(async () => {
    if (process.env.AUTO_REPLY_ENABLE_SEND !== 'true' || loadSafeModeConfig().enabled) return;
    await runWithExclusivePollLock(lockPath, async () => {
      try {
        const result = await syncYouTubeJevReplies({
          ...dependencies, scope, classify: (message, status) => classifyYouTubeBuyerIntent(message, status),
          readJournal: () => readJournal(journalPath),
          writeJournal: (journal) => writeJsonAtomic(journalPath, journal),
        });
        if (result.baselined || result.sent || result.ignored || result.attempted) console.log('[YouTubeJevReplies] sync', scope, result);
      } catch (error) {
        console.error('[YouTubeJevReplies] sync failed', scope, error instanceof Error ? error.message : 'unknown error');
      }
    });
  });
  const runPre = makeRun('pre');
  const runPost = makeRun('post');
  setTimeout(() => { void runPre(); setInterval(() => { void runPre(); }, intervalMs); }, 15_000);
  setTimeout(() => { void runPost(); setInterval(() => { void runPost(); }, postIntervalMs); }, 45_000);
}
