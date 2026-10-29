import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type SellerAlertResult =
  | { sent: true; reason: 'sent' }
  | { sent: false; reason: 'disabled' | 'throttled' | 'failed' };

type FetchLike = (url: string, init?: any) => Promise<{ ok: boolean; status?: number; text?: () => Promise<string> }>;

export type SellerAlertProvider = 'gbuts' | 'linkid' | 'graytag';

export type SellerAlertCategory = 'purchase' | 'inquiry' | 'auto-reply' | 'system';

export type SellerAlertAttention = 'action-required' | 'processing' | 'completed' | 'notice';

export type SellerAlertInput = {
  /** Trusted workflow state, never inferred from customer text. */
  attention?: SellerAlertAttention;
  nextAction?: string;
  automationStatus?: string;
  key: string;
  title: string;
  body: string;
  actionUrl?: string;
  severity?: 'warning' | 'critical';
  category?: SellerAlertCategory;
  provider?: SellerAlertProvider;
  statePath?: string;
  throttleMs?: number;
  nowMs?: number;
  fetchImpl?: FetchLike;
};

const DEFAULT_ALERT_STATE_PATH = '/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data/alert-state.json';
const DEFAULT_THROTTLE_MS = 30 * 60 * 1000;

type AlertState = { sentAtByKey?: Record<string, number>; mutedKeyPrefixes?: string[] };

function env(name: string): string {
  return String(process.env[name] || '').trim();
}

function loadState(path: string): AlertState {
  try {
    if (!existsSync(path)) return { sentAtByKey: {} };
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    return raw && typeof raw === 'object' ? raw : { sentAtByKey: {} };
  } catch {
    return { sentAtByKey: {} };
  }
}

function saveState(path: string, state: AlertState): void {
  try {
    const dir = path.replace(/\/[^/]+$/, '');
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify({ sentAtByKey: state.sentAtByKey || {},
      ...(state.mutedKeyPrefixes ? { mutedKeyPrefixes: state.mutedKeyPrefixes } : {}) }, null, 2), 'utf8');
  } catch {
    // Alerting must never break the dashboard/daemon path.
  }
}

export function redactAlertText(raw: string): string {
  return String(raw || '')
    .replace(/(JSESSIONID|AWSALB|AWSALBCORS|sessionId|token|secret|password|passwd|pw|authorization|cookie)\s*[=:]\s*[^\s\n;,&]+/gi, '$1=[redacted]')
    .replace(/\/home\/[^\s\n"']+/g, '[path]')
    .replace(/\/tmp\/[^\s\n"']+/g, '[path]')
    .replace(/\/var\/[^\s\n"']+/g, '[path]')
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, '[ip]');
}
export function sanitizeAlertText(raw: string): string { return redactAlertText(raw).slice(0, 3500); }

function categoryLabel(category: SellerAlertCategory | undefined): string {
  if (category === 'purchase') return '🛒 계정 구매';
  if (category === 'inquiry') return '💬 문의';
  if (category === 'auto-reply') return '🤖 자동응답';
  return '⚙️ 시스템';
}

function alertThreadId(input: SellerAlertInput): string {
  // Route from the caller's trusted provider, never from buyer-controlled text or URLs.
  const provider = input.provider;
  if (provider === 'gbuts' || provider === 'linkid' || provider === 'graytag') {
    const threadId = env(`SELLER_ALERT_TELEGRAM_${provider.toUpperCase()}_THREAD_ID`);
    if (threadId) return threadId;
  }
  const category = input.category;
  const upper = String(category || 'system').replace(/[^A-Za-z0-9]/g, '_').toUpperCase();
  return env(`SELLER_ALERT_TELEGRAM_${upper}_THREAD_ID`);
}

function extractFirstUrl(text: string): string {
  return String(text || '').match(/https?:\/\/[^\s)]+/)?.[0] || '';
}

export function buildSellerAlertText(input: SellerAlertInput): string {
  const icon = input.severity === 'critical' ? '🚨' : '⚠️';
  const label = categoryLabel(input.category);
  const title = sanitizeAlertText(input.title).replace(/[<>]/g, '');
  const body = sanitizeAlertText(input.body);
  // Leave the owner's existing GrayTag service presentation unchanged.
  if ((input.provider === 'graytag' || !input.provider) && !input.attention) return `${icon} [${label}] ${title}\n${body}`.trim();
  const attention = input.attention || (input.category === 'system' || input.category === 'inquiry' ? 'action-required' : 'notice');
  const headers = { 'action-required': '🔴 [조치 필요]', processing: '🟡 [자동 처리 중]', completed: '🟢 [처리 완료]', notice: '🔵 [참고 알림]' };
  const next = input.nextAction || (attention === 'action-required' ? (input.category === 'inquiry' ? '구매자 채팅을 직접 확인해주세요. 자동 처리 담당이 확인되지 않은 문의입니다.' : '연결된 화면에서 아래 문제를 확인해주세요.')
    : attention === 'processing' ? '지금 할 일 없음 · 자동 처리 결과를 기다려주세요.'
    : attention === 'completed' ? '지금 할 일 없음 · 완료 결과 안내입니다.' : '즉시 조치 요청 없음 · 접수/상태 참고용입니다. 자동 처리 완료를 뜻하지 않습니다.');
  const provider = input.provider === 'gbuts' ? '벗츠' : input.provider === 'linkid' ? '링키드' : '';
  return [`${headers[attention]} ${provider && !title.startsWith(provider) ? provider + ' · ' : ''}${title.slice(0, 140)}`,
    `내 할 일: ${sanitizeAlertText(next).slice(0, 300)}`,
    input.automationStatus ? `자동 처리: ${sanitizeAlertText(input.automationStatus).slice(0, 240)}` : '', body.slice(0, 2800)].filter(Boolean).join('\n');
}

export async function sendSellerAlert(input: SellerAlertInput): Promise<SellerAlertResult> {
  const botToken = env('SELLER_ALERT_TELEGRAM_BOT_TOKEN');
  const chatId = env('SELLER_ALERT_TELEGRAM_CHAT_ID');
  if (!botToken || !chatId) return { sent: false, reason: 'disabled' };

  const statePath = input.statePath || DEFAULT_ALERT_STATE_PATH;
  const throttleMs = input.throttleMs ?? DEFAULT_THROTTLE_MS;
  const nowMs = input.nowMs ?? Date.now();
  const key = sanitizeAlertText(input.key).slice(0, 200);
  const state = loadState(statePath);
  if (Array.isArray(state.mutedKeyPrefixes) && state.mutedKeyPrefixes.some(prefix =>
    typeof prefix === 'string' && prefix.length > 0 && key.startsWith(prefix)))
    return { sent: false, reason: 'disabled' };
  const sentAtByKey = state.sentAtByKey || {};
  const lastSentAt = Number(sentAtByKey[key] || 0);

  if (throttleMs > 0 && lastSentAt > 0 && nowMs - lastSentAt < throttleMs) {
    return { sent: false, reason: 'throttled' };
  }

  const fetcher = input.fetchImpl || (globalThis.fetch as unknown as FetchLike | undefined);
  const text = buildSellerAlertText(input);
  const payload: Record<string, any> = { chat_id: chatId, text, disable_web_page_preview: true };
  // Only action-required notifications make a sound. Never silence unclassified legacy alerts.
  if (input.attention || input.provider === 'gbuts' || input.provider === 'linkid') {
    const attention = input.attention || (input.category === 'system' || input.category === 'inquiry' ? 'action-required' : 'notice');
    payload.disable_notification = attention !== 'action-required';
  }
  const threadId = alertThreadId(input);
  if (threadId) payload.message_thread_id = Number(threadId) || threadId;
  const url = input.actionUrl || extractFirstUrl(input.body);
  if (url) {
    payload.reply_markup = {
      inline_keyboard: [[{ text: input.attention === 'action-required' ? (input.category === 'inquiry' ? '구매자 채팅 열기' : '조치할 화면 열기') : input.category === 'purchase' ? '계정 구매 확인' : input.category === 'inquiry' ? '문의 바로보기' : '대시보드 열기', url }]],
    };
  }
  const body = JSON.stringify(payload);

  if (env('SELLER_ALERT_TELEGRAM_DRY_RUN') === 'true') {
    sentAtByKey[key] = nowMs;
    saveState(statePath, { ...state, sentAtByKey });
    return { sent: true, reason: 'sent' };
  }

  if (fetcher) {
    try {
      const res = await fetcher(`https://api.telegram.org/bot${encodeURIComponent(botToken)}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      });
      if (res.ok) {
        sentAtByKey[key] = nowMs;
        saveState(statePath, { ...state, sentAtByKey });
        return { sent: true, reason: 'sent' };
      }
    } catch {
      // Fall back to curl below. Some server Node fetch setups fail to reach Telegram while curl works.
    }
  }

  try {
    await execFileAsync('curl', [
      '-fsS', '--max-time', '15', '-X', 'POST',
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      '-H', 'Content-Type: application/json',
      '--data-binary', body,
    ], { timeout: 20000, maxBuffer: 128 * 1024 });
    sentAtByKey[key] = nowMs;
    saveState(statePath, { ...state, sentAtByKey });
    return { sent: true, reason: 'sent' };
  } catch {
    return { sent: false, reason: 'failed' };
  }
}
