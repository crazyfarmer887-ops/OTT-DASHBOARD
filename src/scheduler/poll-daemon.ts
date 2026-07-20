// ─── 구매 감지 폴링 데몬 ──────────────────────────────────────
import { closeSync, existsSync, openSync, readFileSync, writeFileSync, mkdirSync, statSync, renameSync, rmSync } from 'node:fs';
import { sendSellerAlert } from '../alerts/telegram';
import { extractGraytagChats, findLatestBuyerInquiryMessage, type GraytagChatMessage } from '../api/chat-message-summary';
import { messageFingerprint, normalizeBuyerMessage, type AutoReplyCandidateMessage } from '../api/auto-reply-message';

const POLL_SESSION_PATH = '/home/ubuntu/graytag-session/cookies.json';
const POLL_INTERVAL_MS = 30 * 1000;
const POLL_SESSION_MAX_AGE_MS = Number(process.env.POLL_SESSION_MAX_AGE_MS || 10 * 60 * 1000);
const KNOWN_DEALS_PATH = '/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data/known-deals.json';
const KNOWN_CHAT_MESSAGES_PATH = '/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data/known-chat-messages.json';
const POLL_DAEMON_STATUS_PATH = '/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data/poll-daemon-status.json';
const POLL_FAILURE_ALERT_THRESHOLD = Number(process.env.POLL_FAILURE_ALERT_THRESHOLD || 3);
const DEFAULT_CHAT_ALERT_MAX_AGE_MS = 15 * 60 * 1000;
const DEFAULT_PURCHASE_FIRST_SEEN_MAX_AGE_MS = 30 * 60 * 1000;
const DEFAULT_FUTURE_CLOCK_SKEW_MS = 2 * 60 * 1000;
const POLL_DAEMON_LOCK_PATH = '/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data/poll-daemon.lock';

export function isPollSessionAlertEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !['0', 'false', 'no', 'off'].includes(String(env.POLL_SESSION_ALERTS_ENABLED ?? 'true').trim().toLowerCase());
}

const BASE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Referer': 'https://graytag.co.kr/lender/deal/list',
};

export function buildPollDealsUrl(page = 1, rows = 50): string {
  // Graytag 판매내역 now only exposes current 판매중 rows when "종료된 거래 포함" is enabled.
  return `https://graytag.co.kr/ws/lender/findBeforeUsingLenderDeals?finishedDealIncluded=true&sorting=Latest&page=${page}&rows=${rows}`;
}

export function buildPollAfterUsingDealsUrl(page = 1, rows = 50): string {
  return `https://graytag.co.kr/ws/lender/findAfterUsingLenderDeals?finishedDealIncluded=false&sorting=Latest&page=${page}&rows=${rows}`;
}

function sessionCookieMtimeMs(): number | null {
  try {
    if (!existsSync(POLL_SESSION_PATH)) return null;
    return statSync(POLL_SESSION_PATH).mtimeMs;
  } catch {
    return null;
  }
}

export function isPollSessionFresh(mtimeMs: number | null, maxAgeMs = POLL_SESSION_MAX_AGE_MS, nowMs = Date.now()): boolean {
  if (!mtimeMs || !Number.isFinite(mtimeMs)) return false;
  if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0) return true;
  return nowMs - mtimeMs <= maxAgeMs;
}

function loadSessionCookies(): { AWSALB: string; AWSALBCORS: string; JSESSIONID: string } | null {
  try {
    if (!existsSync(POLL_SESSION_PATH)) return null;
    const raw = JSON.parse(readFileSync(POLL_SESSION_PATH, 'utf8'));
    if (!raw.JSESSIONID) return null;
    return { AWSALB: raw.AWSALB || '', AWSALBCORS: raw.AWSALBCORS || '', JSESSIONID: raw.JSESSIONID };
  } catch { return null; }
}

function loadKnownDeals(): Record<string, string> {
  try {
    if (!existsSync(KNOWN_DEALS_PATH)) return {};
    return JSON.parse(readFileSync(KNOWN_DEALS_PATH, 'utf8'));
  } catch { return {}; }
}

function saveRecordStateAtomically(path: string, d: Record<string, string>): boolean {
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    const dir = path.replace(/\/[^/]+$/, '');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(tempPath, JSON.stringify(d, null, 2), { encoding: 'utf8', mode: 0o600 });
    renameSync(tempPath, path);
    return true;
  } catch {
    try { rmSync(tempPath, { force: true }); } catch {}
    return false;
  }
}

export function saveKnownDealsAtomically(path: string, d: Record<string, string>): boolean {
  return saveRecordStateAtomically(path, d);
}

function saveKnownDeals(d: Record<string, string>): boolean {
  return saveKnownDealsAtomically(KNOWN_DEALS_PATH, d);
}

function loadKnownChatMessages(): Record<string, string> {
  try {
    if (!existsSync(KNOWN_CHAT_MESSAGES_PATH)) return {};
    const parsed = JSON.parse(readFileSync(KNOWN_CHAT_MESSAGES_PATH, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

export function saveKnownChatMessagesAtomically(path: string, d: Record<string, string>): boolean {
  return saveRecordStateAtomically(path, d);
}

function saveKnownChatMessages(d: Record<string, string>): boolean {
  return saveKnownChatMessagesAtomically(KNOWN_CHAT_MESSAGES_PATH, d);
}

export interface PollChatDeal {
  dealUsid?: string;
  productUsid?: string;
  chatRoomUuid?: string;
  borrowerName?: string;
  productTypeString?: string;
  productName?: string;
  keepAcct?: string;
  productKeepAcctYn?: boolean;
  dealStatus?: string;
  startDateTime?: string;
  deliveredDateTime?: string;
  createdDateTime?: string;
  registeredDateTime?: string;
  dealRegisteredDateTime?: string;
  updatedAt?: string;
  lenderChatUnread?: boolean;
  dealDetail?: { lenderChatUnread?: boolean; chatRoomUuid?: string };
}

function buildPurchaseAlertMessage(deal: PollChatDeal, status: string): string {
  const usid = String(deal.productUsid || deal.dealUsid || '');
  const ott = deal.productTypeString ?? '';
  const borrower = deal.borrowerName ?? '(미확인)';
  const name = (deal.productName ?? '').slice(0, 30);
  return `🛒 <b>새 구매 발생!</b>\n${ott} — ${name}\n구매자: ${borrower}\nUSID: <code>${usid}</code>\n상태: ${status}`;
}

function isFirstSeenPurchaseStatus(status: string): boolean {
  return ['Delivered', 'ExtensionWaiting', 'OccupationWaiting'].includes(status);
}

export function buildNewDealStatusAlerts(
  deals: PollChatDeal[],
  known: Record<string, string>,
  options: { nowMs?: number; firstSeenMaxAgeMs?: number; futureClockSkewMs?: number; env?: NodeJS.ProcessEnv } = {},
): { updated: Record<string, string>; alerts: string[] } {
  const updated: Record<string, string> = { ...known };
  const alerts: string[] = [];
  const nowMs = options.nowMs ?? Date.now();
  const firstSeenMaxAgeMs = positiveAgeMs(
    options.firstSeenMaxAgeMs ?? options.env?.POLL_PURCHASE_FIRST_SEEN_MAX_AGE_MS ?? process.env.POLL_PURCHASE_FIRST_SEEN_MAX_AGE_MS,
    DEFAULT_PURCHASE_FIRST_SEEN_MAX_AGE_MS,
  );
  const futureClockSkewMs = nonNegativeMs(
    options.futureClockSkewMs ?? options.env?.POLL_ALERT_FUTURE_CLOCK_SKEW_MS ?? process.env.POLL_ALERT_FUTURE_CLOCK_SKEW_MS,
    DEFAULT_FUTURE_CLOCK_SKEW_MS,
  );

  for (const deal of deals) {
    const usid = String(deal.productUsid || '');
    if (!usid) continue;
    const status = String(deal.dealStatus || '');
    const prev = known[usid];
    const firstSeenEventTime = parseGraytagMessageTime(
      deal.deliveredDateTime || deal.startDateTime || deal.createdDateTime || deal.registeredDateTime || deal.dealRegisteredDateTime,
    );
    const isFreshFirstSeen = isEventWithinWindow(firstSeenEventTime, nowMs, firstSeenMaxAgeMs, futureClockSkewMs);

    if (prev === undefined) {
      updated[usid] = status;
      if (isFreshFirstSeen && isFirstSeenPurchaseStatus(status) && String(deal.borrowerName || '').trim()) {
        alerts.push(buildPurchaseAlertMessage(deal, status));
      }
    } else if (prev !== status) {
      updated[usid] = status;
      if (prev === 'OnSale' && status !== 'OnSale' && isFreshFirstSeen) {
        alerts.push(buildPurchaseAlertMessage(deal, status));
      }
    }

    if (status === 'ExtensionWaiting' && deal.productKeepAcctYn === false && isFreshFirstSeen) {
      const warnKey = 'ext_warned_' + usid;
      if (!known[warnKey]) {
        updated[warnKey] = 'warned';
        const ott = deal.productTypeString ?? '';
        alerts.push(`⚠️ <b>연장 대기 — keepAcct 없음!</b>\n${ott} USID: <code>${usid}</code>\n계정 정보를 설정해주세요.`);
      }
    }
  }

  return { updated, alerts };
}

export interface PollChatAlertCandidate {
  fingerprint: string;
  chatRoomUuid: string;
  dealUsid: string;
  borrowerName: string;
  productType: string;
  productName: string;
  keepAcct: string;
  text: string;
  timestamp: string;
}

export function parseGraytagMessageTime(value?: string): number | null {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;

  const dotted = trimmed.match(/^(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})$/);
  if (dotted) {
    const [, rawYear, rawMonth, rawDay, rawHour, rawMinute] = dotted;
    const year = Number(rawYear);
    const month = Number(rawMonth);
    const day = Number(rawDay);
    const hour = Number(rawHour);
    const minute = Number(rawMinute);
    if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
    const utcMs = Date.UTC(year, month - 1, day, hour - 9, minute);
    const korea = new Date(utcMs + 9 * 60 * 60 * 1000);
    if (
      korea.getUTCFullYear() !== year || korea.getUTCMonth() !== month - 1 || korea.getUTCDate() !== day ||
      korea.getUTCHours() !== hour || korea.getUTCMinutes() !== minute
    ) return null;
    return utcMs;
  }

  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/);
  if (!iso) return null;
  const [, rawYear, rawMonth, rawDay, rawHour, rawMinute, rawSecond] = iso;
  const year = Number(rawYear);
  const month = Number(rawMonth);
  const day = Number(rawDay);
  const hour = Number(rawHour);
  const minute = Number(rawMinute);
  const second = Number(rawSecond);
  const daysInMonth = month >= 1 && month <= 12 ? new Date(Date.UTC(year, month, 0)).getUTCDate() : 0;
  if (day < 1 || day > daysInMonth || hour > 23 || minute > 59 || second > 59) return null;
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveAgeMs(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeMs(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function isEventWithinWindow(occurredAtMs: number | null, nowMs: number, maxAgeMs: number, futureClockSkewMs: number): boolean {
  if (occurredAtMs === null) return false;
  const ageMs = nowMs - occurredAtMs;
  return ageMs >= -futureClockSkewMs && ageMs <= maxAgeMs;
}

export function buildNewChatAlertCandidate(
  deal: PollChatDeal,
  message: GraytagChatMessage | undefined,
  known: Record<string, string>,
  options: { nowMs?: number; maxAgeMs?: number; futureClockSkewMs?: number; env?: NodeJS.ProcessEnv } = {},
): PollChatAlertCandidate | null {
  const chatRoomUuid = String(deal.chatRoomUuid || deal.dealDetail?.chatRoomUuid || '').trim();
  if (!chatRoomUuid || !message?.message) return null;
  const candidate: AutoReplyCandidateMessage = {
    chatRoomUuid,
    dealUsid: String(deal.dealUsid || deal.productUsid || ''),
    buyerName: deal.borrowerName,
    productType: deal.productTypeString,
    productName: deal.productName,
    message: message.message,
    registeredDateTime: message.registeredDateTime,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
    owned: message.owned,
    isOwned: message.isOwned,
    informationMessage: message.informationMessage,
    isInfo: message.isInfo,
    messageType: message.messageType,
  };
  const fp = messageFingerprint(candidate);
  if (!fp || known[fp]) return null;
  const timestamp = candidate.registeredDateTime || candidate.createdAt || candidate.updatedAt || '';
  const occurredAtMs = parseGraytagMessageTime(timestamp);
  if (occurredAtMs === null) return null;
  const nowMs = options.nowMs ?? Date.now();
  const maxAgeMs = positiveAgeMs(
    options.maxAgeMs ?? options.env?.POLL_CHAT_ALERT_MAX_AGE_MS ?? process.env.POLL_CHAT_ALERT_MAX_AGE_MS,
    DEFAULT_CHAT_ALERT_MAX_AGE_MS,
  );
  const futureClockSkewMs = nonNegativeMs(
    options.futureClockSkewMs ?? options.env?.POLL_ALERT_FUTURE_CLOCK_SKEW_MS ?? process.env.POLL_ALERT_FUTURE_CLOCK_SKEW_MS,
    DEFAULT_FUTURE_CLOCK_SKEW_MS,
  );
  if (!isEventWithinWindow(occurredAtMs, nowMs, maxAgeMs, futureClockSkewMs)) return null;
  const text = normalizeBuyerMessage(message.message).slice(0, 800);
  if (!text) return null;
  return {
    fingerprint: fp,
    chatRoomUuid,
    dealUsid: candidate.dealUsid || '',
    borrowerName: deal.borrowerName?.trim() || '(구매자 미확인)',
    productType: deal.productTypeString || '(서비스 미확인)',
    productName: deal.productName || '',
    keepAcct: deal.keepAcct || '',
    text,
    timestamp,
  };
}

export async function reserveAndSendChatAlert(
  alert: Pick<PollChatAlertCandidate, 'fingerprint' | 'timestamp'>,
  known: Record<string, string>,
  persist: (state: Record<string, string>) => boolean,
  send: () => Promise<{ sent: boolean }>,
): Promise<boolean> {
  known[alert.fingerprint] = alert.timestamp;
  if (!persist(known)) {
    delete known[alert.fingerprint];
    return false;
  }
  const result = await send();
  return result.sent;
}

export async function persistAndSendDealAlerts(
  updated: Record<string, string>,
  persist: (state: Record<string, string>) => boolean,
  sends: Array<() => Promise<{ sent: boolean }>>,
): Promise<number> {
  if (!persist(updated)) throw new Error('failed to persist known deal state');
  let sent = 0;
  for (const send of sends) {
    const result = await send();
    if (result.sent) sent += 1;
  }
  return sent;
}

function loadPollStatus(): any {
  try {
    if (!existsSync(POLL_DAEMON_STATUS_PATH)) return {};
    return JSON.parse(readFileSync(POLL_DAEMON_STATUS_PATH, 'utf8'));
  } catch { return {}; }
}

function savePollStatus(status: any): void {
  try {
    const dir = POLL_DAEMON_STATUS_PATH.replace(/\/[^/]+$/, '');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(POLL_DAEMON_STATUS_PATH, JSON.stringify(status, null, 2), 'utf8');
  } catch {}
}

function recordPollSuccess(): void {
  savePollStatus({ ...loadPollStatus(), ok: true, lastSuccess: new Date().toISOString(), lastError: null, consecutiveFailures: 0 });
}

async function recordPollFailure(reason: string, alertKey: string, severity: 'warning' | 'critical' = 'warning'): Promise<void> {
  const prev = loadPollStatus();
  const consecutiveFailures = Number(prev?.consecutiveFailures || 0) + 1;
  savePollStatus({
    ...prev,
    ok: false,
    lastError: reason,
    lastFailure: new Date().toISOString(),
    consecutiveFailures,
  });

  const isSessionAlert = alertKey.includes('session');
  if (isSessionAlert && !isPollSessionAlertEnabled()) {
    console.warn('[PollDaemon] 세션 쿠키 장애 알림 비활성화됨');
    return;
  }

  if (consecutiveFailures >= POLL_FAILURE_ALERT_THRESHOLD || isSessionAlert) {
    const result = await sendSellerAlert({
      key: alertKey,
      title: 'PollDaemon 확인 필요',
      body: `${reason}\n연속 실패: ${consecutiveFailures}회`,
      severity,
    });
    if (result.reason === 'failed') console.error('[PollDaemon] 장애 알림 전송 실패');
  }
}

function extractLenderDeals(payload: any): any[] {
  const candidates = [
    payload?.data?.lenderDeals,
    payload?.lenderDeals,
    payload?.data?.data,
    payload?.data,
  ];
  return candidates.find(Array.isArray) || [];
}

async function sendNewChatMessageAlerts(deals: PollChatDeal[], headers: Record<string, string>): Promise<number> {
  const known = loadKnownChatMessages();
  const updated = { ...known };
  let sent = 0;
  const seenRooms = new Set<string>();
  const chatDeals = deals.filter((deal) => {
    const room = String(deal.chatRoomUuid || deal.dealDetail?.chatRoomUuid || '').trim();
    if (!room || seenRooms.has(room)) return false;
    seenRooms.add(room);
    return Boolean(deal.lenderChatUnread || deal.dealDetail?.lenderChatUnread);
  }).slice(0, 25);

  for (const deal of chatDeals) {
    const chatRoomUuid = String(deal.chatRoomUuid || deal.dealDetail?.chatRoomUuid || '').trim();
    try {
      const msgResp = await fetch(`https://graytag.co.kr/ws/chat/findChats?uuid=${encodeURIComponent(chatRoomUuid)}&page=1`, {
        headers: { ...headers, Referer: `https://graytag.co.kr/chat/${chatRoomUuid}` },
        redirect: 'manual',
        signal: AbortSignal.timeout(2500),
      });
      if (!msgResp.ok) continue;
      const msgJson = await msgResp.json() as any;
      const alert = buildNewChatAlertCandidate(deal, findLatestBuyerInquiryMessage(extractGraytagChats(msgJson)), updated);
      if (!alert) continue;
      const accountLine = alert.keepAcct ? `\n계정: ${alert.keepAcct}` : '';
      const dealLine = alert.dealUsid ? `\nUSID: ${alert.dealUsid}` : '';
      const didSend = await reserveAndSendChatAlert(alert, updated, saveKnownChatMessages, () => sendSellerAlert({
        key: `graytag-chat-${alert.fingerprint}`,
        title: '새 문의 도착',
        body: `${alert.productType} · ${alert.borrowerName}${accountLine}${dealLine}\n시간: ${alert.timestamp}\n메시지: ${alert.text}\n바로가기: https://email-verify.one/dashboard/chat?room=${encodeURIComponent(alert.chatRoomUuid)}`,
        category: 'inquiry',
        throttleMs: 0,
      }));
      if (didSend) sent += 1;
    } catch (e: any) {
      console.warn('[PollDaemon] 채팅 알림 확인 실패:', e?.message || e);
    }
  }

  saveKnownChatMessages(updated);
  return sent;
}

async function pollGraytag() {
  process.stderr.write('[PollDaemon] 폴링 실행 ' + new Date().toISOString() + '\n');
  try {
    const cookies = loadSessionCookies();
    if (!cookies) {
      console.log('[PollDaemon] 세션 쿠키 없음 — 스킵');
      await recordPollFailure('세션 쿠키 없음', 'poll-daemon-session-missing', 'critical');
      return;
    }
    if (!isPollSessionFresh(sessionCookieMtimeMs())) {
      console.log('[PollDaemon] 세션 쿠키 오래됨 — 스킵');
      await recordPollFailure('세션 쿠키 오래됨 또는 stale 상태', 'poll-daemon-session-stale', 'critical');
      return;
    }

    const cookieStr = `AWSALB=${cookies.AWSALB}; AWSALBCORS=${cookies.AWSALBCORS}; JSESSIONID=${cookies.JSESSIONID}`;
    const headers = { ...BASE_HEADERS, Cookie: cookieStr };

    const resp = await fetch(
      buildPollDealsUrl(),
      { headers }
    );
    const afterResp = await fetch(
      buildPollAfterUsingDealsUrl(),
      { headers: { ...headers, Referer: 'https://graytag.co.kr/lender/deal/listAfterUsing' } }
    );
    if (!resp.ok) {
      console.log('[PollDaemon] API 실패:', resp.status);
      await recordPollFailure(`Graytag API HTTP ${resp.status}`, 'poll-daemon-api-failure', resp.status >= 500 ? 'critical' : 'warning');
      return;
    }

    const json = await resp.json() as any;
    if (!json.succeeded) {
      console.log('[PollDaemon] API succeeded=false');
      await recordPollFailure('Graytag API succeeded=false', 'poll-daemon-api-failure');
      return;
    }

    const deals: any[] = json.data?.lenderDeals ?? [];
    let allDealsForChatAlerts: any[] = deals;
    if (afterResp.ok) {
      const afterJson = await afterResp.json() as any;
      allDealsForChatAlerts = [...deals, ...extractLenderDeals(afterJson)];
    } else {
      console.log('[PollDaemon] 사용중 채팅 API 실패:', afterResp.status);
    }
    const known = loadKnownDeals();
    const { updated, alerts } = buildNewDealStatusAlerts(deals, known);

    await persistAndSendDealAlerts(updated, saveKnownDeals, alerts.map((msg) => async () => {
      const result = await sendSellerAlert({
        key: 'poll-daemon-deal-' + msg.slice(-80),
        title: '계정 구매/판매 이벤트',
        body: msg.replace(/<[^>]+>/g, ''),
        category: 'purchase',
      });
      if (result.sent) console.log('[PollDaemon] 알림 전송:', msg.slice(0, 50));
      return result;
    }));

    const chatAlertCount = await sendNewChatMessageAlerts(allDealsForChatAlerts, headers);
    if (chatAlertCount > 0) console.log('[PollDaemon] 채팅 알림 전송:', chatAlertCount);
    recordPollSuccess();
  } catch (e: any) {
    console.error('[PollDaemon] 폴링 에러:', e.message);
    await recordPollFailure(`PollDaemon 예외: ${e.message}`, 'poll-daemon-exception', 'critical');
  }
}

export function createSingleFlightRunner(work: () => Promise<void>): () => Promise<boolean> {
  let running = false;
  return async () => {
    if (running) return false;
    running = true;
    try {
      await work();
      return true;
    } finally {
      running = false;
    }
  };
}

export async function runWithExclusivePollLock(
  lockPath: string,
  work: () => Promise<void>,
  options: { nowMs?: number; staleAfterMs?: number } = {},
): Promise<boolean> {
  const nowMs = options.nowMs ?? Date.now();
  const staleAfterMs = positiveAgeMs(options.staleAfterMs, 5 * 60 * 1000);
  const dir = lockPath.replace(/\/[^/]+$/, '');
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });

  const acquire = (): boolean => {
    try {
      const fd = openSync(lockPath, 'wx', 0o600);
      try { writeFileSync(fd, `${process.pid} ${nowMs}\n`, 'utf8'); } finally { closeSync(fd); }
      return true;
    } catch (error: any) {
      if (error?.code !== 'EEXIST') return false;
      try {
        const ownerPid = Number.parseInt(readFileSync(lockPath, 'utf8').trim().split(/\s+/)[0] || '', 10);
        if (Number.isInteger(ownerPid) && ownerPid > 0) {
          try {
            process.kill(ownerPid, 0);
            return false;
          } catch (ownerError: any) {
            if (ownerError?.code !== 'ESRCH') return false;
          }
        }
        if (nowMs - statSync(lockPath).mtimeMs <= staleAfterMs) return false;
        rmSync(lockPath, { force: true });
        const fd = openSync(lockPath, 'wx', 0o600);
        try { writeFileSync(fd, `${process.pid} ${nowMs}\n`, 'utf8'); } finally { closeSync(fd); }
        return true;
      } catch {
        return false;
      }
    }
  };

  if (!acquire()) return false;
  try {
    await work();
    return true;
  } finally {
    try { rmSync(lockPath, { force: true }); } catch {}
  }
}

const runPollGraytagSingleFlight = createSingleFlightRunner(async () => {
  await runWithExclusivePollLock(POLL_DAEMON_LOCK_PATH, pollGraytag);
});

export function startPollDaemon(): void {
  setTimeout(async () => {
    console.log('[PollDaemon] 구매 감지 폴링 시작 (30초 간격)');
    await runPollGraytagSingleFlight();
    setInterval(() => { void runPollGraytagSingleFlight(); }, POLL_INTERVAL_MS);
  }, 5000);
  console.log('[PollDaemon] 초기화 완료');
}
