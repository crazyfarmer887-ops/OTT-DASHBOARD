import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import apiApp from '../src/api/index';
import { createPartyAccessLinkRecord } from '../src/lib/party-access';

const adminToken = 'test-admin-token';
const originalFetch = globalThis.fetch;
let tempDir = '';

function authed(path: string, body: Record<string, unknown>) {
  return apiApp.request(path, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${adminToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ JSESSIONID: 'session', ...body }),
  });
}

describe('keep account credential safety', () => {
  beforeEach(() => {
    process.env.AIO_ADMIN_TOKEN = adminToken;
    tempDir = mkdtempSync(join(tmpdir(), 'keep-acct-safety-'));
    process.env.PARTY_ACCESS_LINKS_PATH = join(tempDir, 'party-access-links.json');
    writeFileSync(process.env.PARTY_ACCESS_LINKS_PATH, '{}', 'utf8');
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ succeeded: true }), { status: 200, headers: { 'content-type': 'application/json' } })) as any;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.AIO_ADMIN_TOKEN;
    delete process.env.PARTY_ACCESS_LINKS_PATH;
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = '';
    vi.restoreAllMocks();
  });

  test('rejects Graytag access notice text before it can be saved as account credentials', async () => {
    const res = await authed('/post/keepAcct', {
      productUsid: 'product-1',
      keepAcct: '아래 메세지를 꼭 확인해주세요',
      keepPasswd: '그래야 계정에 접근할 수 있습니다.',
      keepMemo: '안내문',
    });
    const json = await res.json() as any;

    expect(res.status).toBe(400);
    expect(json.error).toContain('계정 매핑 필요');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test('allows Graytag access notice text only when keepMemo maps to a real access link record', async () => {
    const token = 'valid-access-token';
    const record = createPartyAccessLinkRecord({
      token,
      now: '2026-06-03T00:00:00.000Z',
      serviceType: '티빙',
      accountEmail: 'real@example.com',
      fallbackPassword: 'real-password',
      fallbackPin: '123456',
      member: { kind: 'graytag', memberId: 'fill:product-1', memberName: '구매자', status: 'OnSale', endDateTime: '2026-11-04' },
    });
    writeFileSync(process.env.PARTY_ACCESS_LINKS_PATH!, JSON.stringify({ [record.tokenHash]: record }, null, 2), 'utf8');

    const res = await authed('/post/keepAcct', {
      productUsid: 'product-1',
      keepAcct: '아래 메세지를 꼭 확인해주세요',
      keepPasswd: '그래야 계정에 접근할 수 있습니다.',
      keepMemo: `계정 업데이트 주소: https://email-verify.one/dashboard/access/${token}`,
    });
    const json = await res.json() as any;

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [, init] = (globalThis.fetch as any).mock.calls[0];
    expect(JSON.parse(init.body)).toMatchObject({
      keepAcct: '아래 메세지를 꼭 확인해주세요',
      keepPasswd: '그래야 계정에 접근할 수 있습니다.',
    });
  });

  test('rejects Graytag access notice text when keepMemo access link cannot be mapped', async () => {
    const res = await authed('/post/keepAcct', {
      productUsid: 'product-1',
      keepAcct: '아래 메세지를 꼭 확인해주세요',
      keepPasswd: '그래야 계정에 접근할 수 있습니다.',
      keepMemo: '계정 업데이트 주소: https://email-verify.one/dashboard/access/missing-token',
    });
    const json = await res.json() as any;

    expect(res.status).toBe(400);
    expect(json.error).toContain('계정 매핑 필요');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  test('keeps normal account credential updates working', async () => {
    const res = await authed('/post/keepAcct', {
      productUsid: 'product-1',
      keepAcct: 'buyer@example.com',
      keepPasswd: 'normal-password',
      keepMemo: '정상 메모',
    });
    const json = await res.json() as any;

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [, init] = (globalThis.fetch as any).mock.calls[0];
    expect(JSON.parse(init.body)).toMatchObject({ keepAcct: 'buyer@example.com', keepPasswd: 'normal-password' });
  });
});
