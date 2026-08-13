import { describe, expect, test, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import apiApp from '../src/api/index';
import { PARTY_ACCESS_CONSENT_PHRASES } from '../src/lib/party-access';

const token = 'test-admin-token';
let tempDir = '';

function authed(path: string, init: RequestInit = {}) {
  return apiApp.request(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
}

function candidate(unique: string, message = '로그인이 안돼요') {
  return {
    chatRoomUuid: unique,
    dealUsid: 'deal-1',
    buyerName: '민수',
    productType: '넷플릭스',
    productName: '넷플릭스 프리미엄',
    message,
    registeredDateTime: '2026-04-28T01:00:00Z',
  };
}

describe('auto reply API', () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'auto-reply-api-'));
    process.env.AIO_ADMIN_TOKEN = token;
    process.env.AUTO_REPLY_JOBS_PATH = join(tempDir, 'jobs.json');
    process.env.AUTO_REPLY_CONFIG_PATH = join(tempDir, 'config.json');
    process.env.PARTY_ACCESS_LINKS_PATH = join(tempDir, 'party-access-links.json');
    process.env.AUTO_REPLY_ENABLED = 'true';
    process.env.AUTO_REPLY_DRAFT_ONLY = 'true';
    process.env.AUTO_REPLY_USE_HERMES = 'false';
    process.env.AUTO_REPLY_ENABLE_SEND = 'false';
    process.env.SELLER_ALERT_TELEGRAM_BOT_TOKEN = 'test-bot-token';
    process.env.SELLER_ALERT_TELEGRAM_CHAT_ID = 'test-chat-id';
    process.env.SELLER_ALERT_TELEGRAM_DRY_RUN = 'true';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(tempDir, { recursive: true, force: true });
    delete process.env.AUTO_REPLY_JOBS_PATH;
    delete process.env.AUTO_REPLY_CONFIG_PATH;
    delete process.env.PARTY_ACCESS_LINKS_PATH;
    delete process.env.AUTO_REPLY_ENABLED;
    delete process.env.AUTO_REPLY_DRAFT_ONLY;
    delete process.env.AUTO_REPLY_USE_HERMES;
    delete process.env.AUTO_REPLY_ENABLE_SEND;
    delete process.env.AUTO_REPLY_TEST_NOW;
    delete process.env.SELLER_ALERT_TELEGRAM_BOT_TOKEN;
    delete process.env.SELLER_ALERT_TELEGRAM_CHAT_ID;
    delete process.env.SELLER_ALERT_TELEGRAM_DRY_RUN;
  });

  test('requires admin auth for auto-reply log', async () => {
    const res = await apiApp.request('/chat/auto-reply-log');
    expect(res.status).toBe(403);
  });

  test('tick with mock candidates queues and drafts without sending in draft-only mode', async () => {
    const unique = `api-room-${Date.now()}`;
    const res = await authed('/chat/auto-reply/tick', {
      method: 'POST',
      body: JSON.stringify({
        dryRun: true,
        candidates: [candidate(unique)],
      }),
    });
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.ok).toBe(true);
    expect(json.newJobs).toBe(1);
    expect(json.drafted).toBe(1);
    expect(json.sent).toBe(0);

    const log = await authed('/chat/auto-reply-log?limit=1');
    const data = await log.json() as any;
    expect(data.jobs[0].telegramAlertSentAt).toBeTruthy();
  });

  test('tick skips an already drafted fingerprint instead of reprocessing it', async () => {
    const unique = `api-dedupe-room-${Date.now()}`;
    const body = JSON.stringify({ dryRun: true, candidates: [candidate(unique)] });
    const first = await authed('/chat/auto-reply/tick', { method: 'POST', body });
    expect((await first.json() as any).drafted).toBe(1);

    const second = await authed('/chat/auto-reply/tick', { method: 'POST', body });
    const json = await second.json() as any;
    expect(json.newJobs).toBe(0);
    expect(json.drafted).toBe(0);
    expect(json.skipped).toBe(1);
    expect(json.sent).toBe(0);
  });

  test('auto-reply state disables AI drafting and leaves Telegram notification only', async () => {
    await authed('/chat/auto-reply/state', {
      method: 'POST',
      body: JSON.stringify({ enabled: false, delaySeconds: 0 }),
    });

    const res = await authed('/chat/auto-reply/tick', {
      method: 'POST',
      body: JSON.stringify({ dryRun: false, candidates: [candidate(`api-disabled-room-${Date.now()}`)] }),
    });
    const json = await res.json() as any;
    expect(json.blocked).toBe(1);

    const log = await authed('/chat/auto-reply-log?limit=1');
    const data = await log.json() as any;
    expect(data.jobs[0].blockReason).toBe('자동응답이 꺼져 있음 · 텔레그램 알림만 전송');
  });

  test('daily first buyer message drafts account access notice and later acknowledgement is ignored', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 302 })));
    process.env.AUTO_REPLY_ENABLE_SEND = 'true';
    process.env.AUTO_REPLY_TEST_NOW = '2026-05-04T06:00:00Z'; // 15:00 KST
    const unique = `api-daily-room-${Date.now()}`;
    const firstCandidate = {
      ...candidate(unique, '로그인이 안돼요'),
      keepAcct: 'buyer-account@example.com',
      keepPasswd: 'pw-should-not-print',
      profileName: '고슴도치',
      dealStatus: 'Using',
      statusName: '이용 중',
      startDateTime: '2026-05-01T00:00:00Z',
      endDateTime: '2026-12-31T00:00:00Z',
    };
    const first = await authed('/chat/auto-reply/tick', {
      method: 'POST',
      body: JSON.stringify({ dryRun: true, candidates: [firstCandidate] }),
    });
    const firstJson = await first.json() as any;
    expect(firstJson.drafted).toBe(1);

    const log = await authed('/chat/auto-reply-log?limit=1');
    const data = await log.json() as any;
    expect(data.jobs[0].category).toContain('daily_account_access_notice');
    expect(data.jobs[0].draftReply).toContain('우선 아래 계정 업데이트 주소');
    expect(data.jobs[0].draftReply).toContain('/dashboard/access/');
    const accessUrl = String(data.jobs[0].draftReply).match(/https?:\/\/[^\s]+\/dashboard\/access\/[^\s✅]+/)?.[0] || '';
    expect(accessUrl).toBeTruthy();
    expect(accessUrl.startsWith('https://email-verify.one/dashboard/access/')).toBe(true);
    const accessToken = decodeURIComponent(accessUrl.split('/dashboard/access/')[1] || '');
    const publicRes = await apiApp.request(`/party-access/${encodeURIComponent(accessToken)}`);
    const publicData = await publicRes.json() as any;
    expect(publicData.ok).toBe(true);
    expect(publicData.sensitiveRedacted).toBe(true);
    expect(publicData.profileName).toBeUndefined();
    expect(publicData.credentials).toBeUndefined();

    const consentRes = await apiApp.request(`/party-access/${encodeURIComponent(accessToken)}/consent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phrases: [...PARTY_ACCESS_CONSENT_PHRASES] }),
    });
    const consentData = await consentRes.json() as any;
    expect(consentData.profileName).toBe('고슴도치');
    expect(consentData.credentials.password).toBeTruthy();

    process.env.AUTO_REPLY_TEST_NOW = '2026-05-05T06:00:00Z';
    const second = await authed('/chat/auto-reply/tick', {
      method: 'POST',
      body: JSON.stringify({ dryRun: true, candidates: [{ ...firstCandidate, message: '로그인 문의 다시', registeredDateTime: '2026-05-05T06:00:00Z' }] }),
    });
    expect((await second.json() as any).drafted).toBe(1);
    const secondLog = await authed('/chat/auto-reply-log?limit=1');
    const secondData = await secondLog.json() as any;
    const secondAccessUrl = String(secondData.jobs[0].draftReply).match(/https?:\/\/[^\s]+\/dashboard\/access\/[^\s✅]+/)?.[0] || '';
    expect(secondAccessUrl).toBe(accessUrl);

    const ack = await authed('/chat/auto-reply/tick', {
      method: 'POST',
      body: JSON.stringify({ dryRun: true, candidates: [{ ...firstCandidate, message: '네 감사합니다', registeredDateTime: '2026-05-04T06:01:00Z' }] }),
    });
    const ackJson = await ack.json() as any;
    expect(ackJson.ignored).toBe(1);
  });

  test('off-hours notice is added outside 14-21 KST even when daily account guide is also sent', async () => {
    process.env.AUTO_REPLY_ENABLE_SEND = 'true';
    process.env.AUTO_REPLY_TEST_NOW = '2026-05-04T13:00:00Z'; // 22:00 KST
    const unique = `api-offhours-room-${Date.now()}`;
    const res = await authed('/chat/auto-reply/tick', {
      method: 'POST',
      body: JSON.stringify({ dryRun: true, candidates: [{ ...candidate(unique), keepAcct: 'buyer-account@example.com', keepPasswd: 'pw', dealStatus: 'Using' }] }),
    });
    expect((await res.json() as any).drafted).toBe(1);
    const log = await authed('/chat/auto-reply-log?limit=1');
    const data = await log.json() as any;
    expect(data.jobs[0].category).toContain('daily_account_access_notice');
    expect(data.jobs[0].category).toContain('off_hours_notice');
    expect(data.jobs[0].draftReply).toContain('문의 가능 시간은 14:00 ~ 21:00입니다');
    expect(data.jobs[0].draftReply.trim().startsWith('문의 가능 시간은 14:00 ~ 21:00입니다')).toBe(true);
  });

  test('manual AI reply endpoint uses Hermes path or safe fallback, not OpenAI/PicoClaw', async () => {
    const res = await authed('/chat/ai-reply', {
      method: 'POST',
      body: JSON.stringify({ messages: [{ message: '로그인이 안돼요', isOwned: false }], productType: '넷플릭스' }),
    });
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.reply).toContain('확인');
    expect(json.model).toBe('hermes-disabled-safe-fallback');
  });
});
