import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import apiApp from '../src/api/index';

const adminToken = 'test-admin-token';
const originalFetch = globalThis.fetch;

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
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ succeeded: true }), { status: 200, headers: { 'content-type': 'application/json' } })) as any;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.AIO_ADMIN_TOKEN;
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
    expect(json.error).toContain('안내 문구');
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
