import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendSellerAlert } from './src/alerts/telegram.ts';

const originalToken = process.env.SELLER_ALERT_TELEGRAM_BOT_TOKEN;
const originalChat = process.env.SELLER_ALERT_TELEGRAM_CHAT_ID;

let tmp: string | null = null;

afterEach(() => {
  if (originalToken === undefined) delete process.env.SELLER_ALERT_TELEGRAM_BOT_TOKEN;
  else process.env.SELLER_ALERT_TELEGRAM_BOT_TOKEN = originalToken;
  if (originalChat === undefined) delete process.env.SELLER_ALERT_TELEGRAM_CHAT_ID;
  else process.env.SELLER_ALERT_TELEGRAM_CHAT_ID = originalChat;
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = null;
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function tempStatePath() {
  tmp = mkdtempSync(join(tmpdir(), 'seller-alert-'));
  return join(tmp, 'alert-state.json');
}

describe('seller Telegram alerts', () => {
  it.each(['gbuts', 'linkid', 'graytag'] as const)('routes every %s alert category to its service topic', async provider => {
    vi.stubEnv('SELLER_ALERT_TELEGRAM_BOT_TOKEN', 'test-token');
    vi.stubEnv('SELLER_ALERT_TELEGRAM_CHAT_ID', 'test-chat');
    vi.stubEnv(`SELLER_ALERT_TELEGRAM_${provider.toUpperCase()}_THREAD_ID`, '101');
    const fetchMock = vi.fn(async (_url: string, _init?: any) => new Response('{"ok":true}'));
    const statePath = tempStatePath();
    for (const category of ['purchase', 'inquiry', 'auto-reply', 'system'] as const) {
      vi.stubEnv(`SELLER_ALERT_TELEGRAM_${category.replace('-', '_').toUpperCase()}_THREAD_ID`, '999');
      await sendSellerAlert({ provider, category, key: category, title: '서비스 알림',
        body: '링키드 gbuts graytag https://example.com/graytag', actionUrl: 'https://email-verify.one/dashboard',
        statePath, fetchImpl: fetchMock });
    }
    expect(fetchMock).toHaveBeenCalledTimes(4);
    for (const [, init] of fetchMock.mock.calls) {
      expect(JSON.parse(init.body)).toMatchObject({ chat_id: 'test-chat', message_thread_id: 101 });
    }
  });

  it('keeps category routing when a service topic is not configured', async () => {
    vi.stubEnv('SELLER_ALERT_TELEGRAM_BOT_TOKEN', 'test-token');
    vi.stubEnv('SELLER_ALERT_TELEGRAM_CHAT_ID', 'test-chat');
    vi.stubEnv('SELLER_ALERT_TELEGRAM_GBUTS_THREAD_ID', '');
    vi.stubEnv('SELLER_ALERT_TELEGRAM_INQUIRY_THREAD_ID', '202');
    const fetchMock = vi.fn(async (_url: string, _init?: any) => new Response('{"ok":true}'));
    await sendSellerAlert({ provider: 'gbuts', category: 'inquiry', key: 'fallback', title: '문의', body: '내용',
      statePath: tempStatePath(), fetchImpl: fetchMock });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).message_thread_id).toBe(202);
  });

  it('does not infer service routing from buyer text or links', async () => {
    vi.stubEnv('SELLER_ALERT_TELEGRAM_BOT_TOKEN', 'test-token');
    vi.stubEnv('SELLER_ALERT_TELEGRAM_CHAT_ID', 'test-chat');
    vi.stubEnv('SELLER_ALERT_TELEGRAM_LINKID_THREAD_ID', '303');
    vi.stubEnv('SELLER_ALERT_TELEGRAM_SYSTEM_THREAD_ID', '');
    const fetchMock = vi.fn(async (_url: string, _init?: any) => new Response('{"ok":true}'));
    await sendSellerAlert({ key: 'unknown', title: '링키드', body: 'https://linkid.pw',
      statePath: tempStatePath(), fetchImpl: fetchMock });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty('message_thread_id');
  });


  it('keeps an explicit official chat button even if a buyer message contains a different URL', async () => {
    process.env.SELLER_ALERT_TELEGRAM_BOT_TOKEN = 'test-token';
    process.env.SELLER_ALERT_TELEGRAM_CHAT_ID = 'test-chat';
    const fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    await sendSellerAlert({ key: 'chat-link', title: '벗츠 채팅', body: '여기 보세요 https://example.com/buyer-link',
      actionUrl: 'https://gbuts.com/seller/chats', category: 'inquiry', statePath: tempStatePath(), fetchImpl: fetchMock as any });
    const payload = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(payload.text).toContain('https://example.com/buyer-link');
    expect(payload.reply_markup.inline_keyboard[0][0].url).toBe('https://gbuts.com/seller/chats');
  });
  it('is quietly disabled when Telegram env is missing', async () => {
    delete process.env.SELLER_ALERT_TELEGRAM_BOT_TOKEN;
    delete process.env.SELLER_ALERT_TELEGRAM_CHAT_ID;
    const fetchMock = vi.fn();

    const result = await sendSellerAlert({
      key: 'poll-daemon-failure',
      title: 'PollDaemon 장애',
      body: '연속 실패 3회',
      statePath: tempStatePath(),
      fetchImpl: fetchMock as any,
      nowMs: 1_000,
    });

    expect(result).toEqual({ sent: false, reason: 'disabled' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends once and throttles the same key for 30 minutes by default', async () => {
    process.env.SELLER_ALERT_TELEGRAM_BOT_TOKEN = 'test-token';
    process.env.SELLER_ALERT_TELEGRAM_CHAT_ID = 'test-chat';
    const statePath = tempStatePath();
    const fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));

    const first = await sendSellerAlert({ key: 'same-key', title: '첫 알림', body: '내용', statePath, fetchImpl: fetchMock as any, nowMs: 10_000 });
    const second = await sendSellerAlert({ key: 'same-key', title: '두번째 알림', body: '내용', statePath, fetchImpl: fetchMock as any, nowMs: 10_000 + 29 * 60_000 });
    const third = await sendSellerAlert({ key: 'same-key', title: '세번째 알림', body: '내용', statePath, fetchImpl: fetchMock as any, nowMs: 10_000 + 31 * 60_000 });

    expect(first).toEqual({ sent: true, reason: 'sent' });
    expect(second).toEqual({ sent: false, reason: 'throttled' });
    expect(third).toEqual({ sent: true, reason: 'sent' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('redacts likely sensitive values from alert text', async () => {
    process.env.SELLER_ALERT_TELEGRAM_BOT_TOKEN = 'test-token';
    process.env.SELLER_ALERT_TELEGRAM_CHAT_ID = 'test-chat';
    const fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));

    await sendSellerAlert({
      key: 'sensitive',
      title: '세션 장애',
      body: 'JSESSIONID=abc123 token=secret password=hunter2 /home/ubuntu/secret-file',
      statePath: tempStatePath(),
      fetchImpl: fetchMock as any,
      nowMs: 1_000,
    });

    const payload = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(payload.text).not.toContain('abc123');
    expect(payload.text).not.toContain('secret');
    expect(payload.text).not.toContain('hunter2');
    expect(payload.text).not.toContain('/home/ubuntu');
    expect(payload.text).toContain('[redacted]');
  });
});
