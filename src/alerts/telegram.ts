import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type SellerAlertResult =
  | { sent: true; reason: 'sent' }
  | { sent: false; reason: 'disabled' | 'throttled' | 'failed' };

type FetchLike = (url: string, init?: any) => Promise<{ ok: boolean; status?: number; text?: () => Promise<string> }>;

export type SellerAlertCategory = 'purchase' | 'inquiry' | 'auto-reply' | 'system';

export type SellerAlertInput = {
  key: string;
  title: string;
  body: string;
  severity?: 'warning' | 'critical';
  category?: SellerAlertCategory;
  statePath?: string;
  throttleMs?: number;
  nowMs?: number;
  fetchImpl?: FetchLike;
};

const DEFAULT_ALERT_STATE_PATH = '/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data/alert-state.json';
const DEFAULT_THROTTLE_MS = 30 * 60 * 1000;

type AlertState = { sentAtByKey?: Record<string, number> };

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
    writeFileSync(path, JSON.stringify({ sentAtByKey: state.sentAtByKey || {} }, null, 2), 'utf8');
  } catch {
    // Alerting must never break the dashboard/daemon path.
  }
}

export function sanitizeAlertText(raw: string): string {
  return String(raw || '')
    .replace(/(JSESSIONID|AWSALB|AWSALBCORS|sessionId|token|secret|password|passwd|pw|authorization|cookie)\s*[=:]\s*[^\s\n;,&]+/gi, '$1=[redacted]')
    .replace(/\/home\/[^\s\n"']+/g, '[path]')
    .replace(/\/tmp\/[^\s\n"']+/g, '[path]')
    .replace(/\/var\/[^\s\n"']+/g, '[path]')
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, '[ip]')
    .slice(0, 3500);
}

function categoryLabel(category: SellerAlertCategory | undefined): string {
  if (category === 'purchase') return '🛒 계정 구매';
  if (category === 'inquiry') return '💬 문의';
  if (category === 'auto-reply') return '🤖 자동응답';
  return '⚙️ 시스템';
}

function categoryThreadId(category: SellerAlertCategory | undefined): string {
  const upper = String(category || 'system').replace(/[^A-Za-z0-9]/g, '_').toUpperCase();
  return env(`SELLER_ALERT_TELEGRAM_${upper}_THREAD_ID`);
}

function extractFirstUrl(text: string): string {
  return String(text || '').match(/https?:\/\/[^\s)]+/)?.[0] || '';
}

function buildText(input: SellerAlertInput): string {
  const icon = input.severity === 'critical' ? '🚨' : '⚠️';
  const label = categoryLabel(input.category);
  const title = sanitizeAlertText(input.title).replace(/[<>]/g, '');
  const body = sanitizeAlertText(input.body);
  return `${icon} [${label}] ${title}\n${body}`.trim();
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
  const sentAtByKey = state.sentAtByKey || {};
  const lastSentAt = Number(sentAtByKey[key] || 0);

  if (throttleMs > 0 && lastSentAt > 0 && nowMs - lastSentAt < throttleMs) {
    return { sent: false, reason: 'throttled' };
  }

  const fetcher = input.fetchImpl || (globalThis.fetch as unknown as FetchLike | undefined);
  const text = buildText(input);
  const payload: Record<string, any> = { chat_id: chatId, text, disable_web_page_preview: true };
  const threadId = categoryThreadId(input.category);
  if (threadId) payload.message_thread_id = Number(threadId) || threadId;
  const url = extractFirstUrl(input.body);
  if (url) {
    payload.reply_markup = {
      inline_keyboard: [[{ text: input.category === 'purchase' ? '계정 구매 확인' : input.category === 'inquiry' ? '문의 바로보기' : '대시보드 열기', url }]],
    };
  }
  const body = JSON.stringify(payload);

  if (env('SELLER_ALERT_TELEGRAM_DRY_RUN') === 'true') {
    sentAtByKey[key] = nowMs;
    saveState(statePath, { sentAtByKey });
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
        saveState(statePath, { sentAtByKey });
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
    saveState(statePath, { sentAtByKey });
    return { sent: true, reason: 'sent' };
  } catch {
    return { sent: false, reason: 'failed' };
  }
}
