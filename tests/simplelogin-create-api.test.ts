import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let tempDir: string;
const originalEnv = {
  AIO_ADMIN_TOKEN: process.env.AIO_ADMIN_TOKEN,
  SIMPLELOGIN_API_KEY: process.env.SIMPLELOGIN_API_KEY,
  GENERATED_ACCOUNTS_PATH: process.env.GENERATED_ACCOUNTS_PATH,
  EMAIL_ALIAS_PIN_STORE_PATH: process.env.EMAIL_ALIAS_PIN_STORE_PATH,
  SIMPLELOGIN_ALIAS_INVENTORY_PATH: process.env.SIMPLELOGIN_ALIAS_INVENTORY_PATH,
};

beforeEach(() => {
  vi.resetModules();
  tempDir = mkdtempSync(join(tmpdir(), 'simplelogin-create-'));
  process.env.AIO_ADMIN_TOKEN = 'test-admin-token';
  process.env.SIMPLELOGIN_API_KEY = 'test-api-key';
  process.env.GENERATED_ACCOUNTS_PATH = join(tempDir, 'generated.json');
  process.env.EMAIL_ALIAS_PIN_STORE_PATH = join(tempDir, 'pins.json');
  process.env.SIMPLELOGIN_ALIAS_INVENTORY_PATH = join(tempDir, 'simplelogin-alias-inventory.json');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  rmSync(tempDir, { recursive: true, force: true });
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('generated account SimpleLogin create contract', () => {
  test('returns a structured retriable response and never creates when stale inventory refresh is rate limited', async () => {
    let optionsCalls = 0;
    let createCalls = 0;
    writeFileSync(process.env.SIMPLELOGIN_ALIAS_INVENTORY_PATH!, JSON.stringify({
      aliases: [{ id: 11, email: 'known@example.com' }],
      fetchedAt: '2020-01-01T00:00:00.000Z',
    }));
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes('/aliases?page_id=0')) {
        return Response.json({ error: 'rate limited' }, { status: 429, headers: { 'retry-after': '7' } });
      }
      if (url.includes('/v5/alias/options')) {
        optionsCalls += 1;
        return Response.json({ suffixes: [] });
      }
      if (url.includes('/v2/alias/custom/new')) {
        createCalls += 1;
        return Response.json({});
      }
      throw new Error(`unexpected fetch: ${url}`);
    }));

    const app = (await import('../src/api/index.ts')).default;
    const response = await app.request('/generated-accounts/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-token': 'test-admin-token' },
      body: JSON.stringify({ serviceType: '넷플릭스', aliasPrefix: 'fx17' }),
    });
    const body = await response.json() as any;

    expect(response.status).toBe(503);
    expect(body.error).toMatch(/별칭 목록 조회 실패.*429/);
    expect(body).toMatchObject({
      code: 'SIMPLELOGIN_ALIAS_INVENTORY_RATE_LIMITED',
      retryAfterMs: 7000,
      retriable: true,
    });
    expect(optionsCalls).toBe(0);
    expect(createCalls).toBe(0);
  });

  test('recovers a matching manual-prefix orphan before options or custom-create POST', async () => {
    let optionsCalls = 0;
    let createCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes('/aliases?page_id=0')) {
        return Response.json({ aliases: [{ id: 170, email: 'fx17.unbiased099@aleeas.com', note: '[Graytag 계정 생성기] 넷플릭스 · prefix:fx17 · 2026-07-24T00:00:00.000Z' }] });
      }
      if (url.includes('/aliases?page_id=1')) return Response.json({ aliases: [] });
      if (url.includes('/v5/alias/options')) {
        optionsCalls += 1;
        return Response.json({ suffixes: [{ signed_suffix: '.example.com.signature' }] });
      }
      if (url.includes('/v2/alias/custom/new')) {
        createCalls += 1;
        return Response.json({ alias: { id: 999, email: 'unexpected@example.com' } });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }));

    const app = (await import('../src/api/index.ts')).default;
    const response = await app.request('/generated-accounts/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-token': 'test-admin-token' },
      body: JSON.stringify({ serviceType: '넷플릭스', aliasPrefix: 'fx17' }),
    });
    const body = await response.json() as any;

    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.account).toMatchObject({ email: 'fx17.unbiased099@aleeas.com', emailId: 170, serviceType: '넷플릭스' });
    expect(optionsCalls).toBe(0);
    expect(createCalls).toBe(0);
  });

  test('creates normally when a same-prefix alias has the wrong generator note', async () => {
    let createCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes('/aliases?page_id=0')) {
        return Response.json({ aliases: [{ id: 170, email: 'fx17.useralias@aleeas.com', note: '개인용 넷플릭스 · prefix:fx17' }] });
      }
      if (url.includes('/aliases?page_id=1')) return Response.json({ aliases: [] });
      if (url.includes('/v5/alias/options')) return Response.json({ suffixes: [{ signed_suffix: '.example.com.signature' }] });
      if (url.includes('/v2/alias/custom/new')) {
        createCalls += 1;
        return Response.json({ alias: { id: 171, email: 'fx17.generated@aleeas.com' } });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }));

    const app = (await import('../src/api/index.ts')).default;
    const response = await app.request('/generated-accounts/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-token': 'test-admin-token' },
      body: JSON.stringify({ serviceType: '넷플릭스', aliasPrefix: 'fx17' }),
    });
    const body = await response.json() as any;

    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.account).toMatchObject({ email: 'fx17.generated@aleeas.com', emailId: 171 });
    expect(createCalls).toBe(1);
    const cache = JSON.parse(readFileSync(process.env.SIMPLELOGIN_ALIAS_INVENTORY_PATH!, 'utf8'));
    expect(cache.aliases).toContainEqual(expect.objectContaining({
      id: 171,
      email: 'fx17.generated@aleeas.com',
      note: expect.stringContaining('[Graytag 계정 생성기] 넷플릭스'),
    }));
  });

  test('fails closed before options and create POST when orphan recovery is ambiguous', async () => {
    let optionsCalls = 0;
    let createCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes('/aliases?page_id=0')) {
        return Response.json({ aliases: [
          { id: 170, email: 'fx17.first@aleeas.com', note: '[Graytag 계정 생성기] 넷플릭스 · prefix:fx17 · first' },
          { id: 171, email: 'fx17.second@aleeas.com', note: '[Graytag 계정 생성기] 넷플릭스 · prefix:fx17 · second' },
        ] });
      }
      if (url.includes('/aliases?page_id=1')) return Response.json({ aliases: [] });
      if (url.includes('/v5/alias/options')) {
        optionsCalls += 1;
        return Response.json({ suffixes: [] });
      }
      if (url.includes('/v2/alias/custom/new')) {
        createCalls += 1;
        return Response.json({});
      }
      throw new Error(`unexpected fetch: ${url}`);
    }));

    const app = (await import('../src/api/index.ts')).default;
    const response = await app.request('/generated-accounts/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-token': 'test-admin-token' },
      body: JSON.stringify({ serviceType: '넷플릭스', aliasPrefix: 'fx17' }),
    });
    const body = await response.json() as any;

    expect(response.status).toBe(500);
    expect(body.error).toMatch(/복구.*후보.*여러/);
    expect(optionsCalls).toBe(0);
    expect(createCalls).toBe(0);
  });

  test('creates once and resolves a missing response id from the exact-email newest-page lookup', async () => {
    let createCalls = 0;
    let listPageZeroCalls = 0;
    let listPageOneCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/aliases?page_id=0')) {
        listPageZeroCalls += 1;
        const aliases = listPageZeroCalls === 1
          ? []
          : [{ alias: { id: 0, email: 'Created.Alias@Example.com' } }];
        return Response.json({ aliases });
      }
      if (url.includes('/aliases?page_id=1')) {
        listPageOneCalls += 1;
        return Response.json({ aliases: [] });
      }
      if (url.includes('/v5/alias/options')) {
        return Response.json({ suffixes: [{ signed_suffix: '.example.com.signature' }] });
      }
      if (url.includes('/v2/alias/custom/new')) {
        createCalls += 1;
        expect(init?.method).toBe('POST');
        return Response.json({ alias: 'Created.Alias@Example.com' });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }));

    const app = (await import('../src/api/index.ts')).default;
    const response = await app.request('/generated-accounts/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-token': 'test-admin-token' },
      body: JSON.stringify({ serviceType: '넷플릭스', aliasPrefix: 'netflix77' }),
    });
    const body = await response.json() as any;

    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.account).toMatchObject({ email: 'created.alias@example.com', emailId: 0 });
    expect(createCalls).toBe(1);
    expect(listPageZeroCalls).toBe(2);
    expect(listPageOneCalls).toBe(0);
    expect(JSON.parse(readFileSync(process.env.SIMPLELOGIN_ALIAS_INVENTORY_PATH!, 'utf8')).aliases)
      .toContainEqual(expect.objectContaining({ id: 0, email: 'created.alias@example.com' }));
  });
});
