import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let tempDir = '';
const savedEnv = { ...process.env };
const authHeaders = { 'content-type': 'application/json', 'x-admin-token': 'session-admin-token' };

beforeEach(() => {
  vi.resetModules();
  tempDir = mkdtempSync(join(tmpdir(), 'graytag-session-api-'));
  process.env.AIO_ADMIN_TOKEN = 'session-admin-token';
  process.env.AUDIT_LOG_PATH = join(tempDir, 'audit.jsonl');
  process.env.GRAYTAG_SESSION_COOKIE_PATH = join(tempDir, 'primary-cookies.json');
  process.env.YOUTUBE_GRAYTAG_SESSION_COOKIE_PATH = join(tempDir, 'youtube-sales-cookies.json');
  process.env.YOUTUBE_GRAYTAG_SESSION_STATUS_PATH = join(tempDir, 'youtube-sales-status.json');
});

afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(tempDir, { recursive: true, force: true });
  for (const key of ['AIO_ADMIN_TOKEN', 'AUDIT_LOG_PATH', 'GRAYTAG_SESSION_COOKIE_PATH', 'YOUTUBE_GRAYTAG_SESSION_COOKIE_PATH', 'YOUTUBE_GRAYTAG_SESSION_STATUS_PATH']) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe('dedicated YouTube sales session API', () => {
  test('requires admin authentication for status and import', async () => {
    const app = (await import('../src/api/index.ts')).default;
    expect((await app.request('/session/accounts')).status).toBe(403);
    expect((await app.request('/session/accounts/youtube-invite-sales/cookies', { method: 'POST' })).status).toBe(403);
  });

  test('validates, persists only auth cookies, and never returns their values', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ succeeded: true, data: { lenderDeals: [] } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })));
    const app = (await import('../src/api/index.ts')).default;
    const secret = 'session-secret-that-must-not-be-returned';
    const response = await app.request('/session/accounts/youtube-invite-sales/cookies', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ cookies: [
        { domain: '.graytag.co.kr', name: '_ga', value: 'analytics-secret' },
        { domain: 'graytag.co.kr', name: 'AWSALB', value: 'alb-secret' },
        { domain: 'graytag.co.kr', name: 'AWSALBCORS', value: 'cors-secret' },
        { domain: 'graytag.co.kr', name: 'JSESSIONID', value: secret },
      ] }),
    });

    expect(response.status).toBe(200);
    const responseText = await response.text();
    expect(responseText).not.toContain(secret);
    expect(responseText).not.toContain('alb-secret');
    expect(responseText).not.toContain('analytics-secret');
    expect(JSON.parse(readFileSync(process.env.YOUTUBE_GRAYTAG_SESSION_COOKIE_PATH!, 'utf8'))).toEqual({
      AWSALB: 'alb-secret', AWSALBCORS: 'cors-secret', JSESSIONID: secret,
    });

    const status = await app.request('/session/accounts', { headers: { 'x-admin-token': 'session-admin-token' } });
    expect(status.status).toBe(200);
    const statusText = await status.text();
    expect(statusText).toContain('유튜브 초대장 판매 전용');
    expect(statusText).not.toContain(secret);
  });

  test('does not replace the stored session when GrayTag rejects the new login', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ succeeded: false, message: 'expired' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })));
    const app = (await import('../src/api/index.ts')).default;
    const response = await app.request('/session/accounts/youtube-invite-sales/cookies', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        AWSALB: 'alb', AWSALBCORS: 'cors', JSESSIONID: 'expired-session',
      }),
    });
    expect(response.status).toBe(401);
    expect(() => readFileSync(process.env.YOUTUBE_GRAYTAG_SESSION_COOKIE_PATH!, 'utf8')).toThrow();
  });

  test('routes whole-dashboard GrayTag requests through the selected account', async () => {
    writeFileSync(process.env.YOUTUBE_GRAYTAG_SESSION_COOKIE_PATH!, JSON.stringify({ JSESSIONID: 'youtube-session' }));
    vi.stubGlobal('fetch', vi.fn(async () => {
      return new Response(JSON.stringify({ succeeded: true, data: { lenderDeals: [] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }));

    const app = (await import('../src/api/index.ts')).default;
    const response = await app.request('/my/onsale-products', {
      method: 'POST',
      headers: { ...authHeaders, 'x-graytag-account': 'youtube-invite-sales' },
      body: '{}',
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ cookieSource: 'youtube-invite-sales' });
  });
});
