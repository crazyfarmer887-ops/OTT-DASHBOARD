import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tempDir: string;
const originalToken = process.env.AIO_ADMIN_TOKEN;
const originalPinStore = process.env.EMAIL_ALIAS_PIN_STORE_PATH;
const originalGeneratedStore = process.env.GENERATED_ACCOUNTS_PATH;

beforeEach(() => {
  vi.resetModules();
  tempDir = mkdtempSync(join(tmpdir(), 'email-alias-fill-'));
  process.env.EMAIL_ALIAS_PIN_STORE_PATH = join(tempDir, 'alias-pins.json');
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(tempDir, { recursive: true, force: true });
  if (originalToken === undefined) delete process.env.AIO_ADMIN_TOKEN;
  else process.env.AIO_ADMIN_TOKEN = originalToken;
  if (originalPinStore === undefined) delete process.env.EMAIL_ALIAS_PIN_STORE_PATH;
  else process.env.EMAIL_ALIAS_PIN_STORE_PATH = originalPinStore;
  if (originalGeneratedStore === undefined) delete process.env.GENERATED_ACCOUNTS_PATH;
  else process.env.GENERATED_ACCOUNTS_PATH = originalGeneratedStore;
});

describe('email alias fill lookup', () => {
  it('matches account email to SimpleLogin alias id and PIN', async () => {
    writeFileSync(process.env.EMAIL_ALIAS_PIN_STORE_PATH!, JSON.stringify({
      '101': { pin: '2468', updatedAt: '2026-04-26T00:00:00Z' },
    }), 'utf8');
    const { resolveEmailAliasFill } = await import('./src/api/email-alias-fill.ts');

    const result = await resolveEmailAliasFill({
      accountEmail: 'disney6.darkened459@aleeas.com',
      serviceType: '디즈니플러스',
      aliases: [
        { id: 101, email: 'disney6.darkened459@aleeas.com', enabled: true },
      ],
    });

    expect(result).toMatchObject({
      ok: true,
      found: true,
      email: 'disney6.darkened459@aleeas.com',
      emailId: 101,
      pin: '2468',
      missing: [],
    });
    expect(result.memo).toContain('https://email-verify.one/email/mail/101');
    expect(result.memo).toContain('2468');
  });

  it('matches TVING double-pass accounts only to the same bundle alias', async () => {
    writeFileSync(process.env.EMAIL_ALIAS_PIN_STORE_PATH!, JSON.stringify({
      '42948775': { pin: '607759', updatedAt: '2026-05-02T23:06:38.289Z' },
      '43949717': { pin: '919693', updatedAt: '2026-05-23T09:48:12.469Z' },
    }), 'utf8');
    const { resolveEmailAliasFill } = await import('./src/api/email-alias-fill.ts');

    const result = await resolveEmailAliasFill({
      accountEmail: 'gtwavve8',
      serviceType: '티빙',
      aliases: [
        { id: 43949717, email: 'gtwavve13.gout658@aleeas.com', enabled: true },
        { id: 42948775, email: 'gtwavve8.retry470@aleeas.com', enabled: true },
      ],
    });

    expect(result).toMatchObject({ ok: true, found: true, emailId: 42948775, pin: '607759' });
    expect(result.memo).toContain('https://email-verify.one/email/mail/42948775');
  });

  it('fails closed for TVING double-pass accounts when the same bundle alias is absent', async () => {
    writeFileSync(process.env.EMAIL_ALIAS_PIN_STORE_PATH!, JSON.stringify({
      '43949717': { pin: '919693', updatedAt: '2026-05-23T09:48:12.469Z' },
    }), 'utf8');
    const { resolveEmailAliasFill } = await import('./src/api/email-alias-fill.ts');

    const result = await resolveEmailAliasFill({
      accountEmail: 'gtwavve8',
      serviceType: '티빙',
      aliases: [
        { id: 43949717, email: 'gtwavve13.gout658@aleeas.com', enabled: true },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.emailId).toBeNull();
    expect(result.pin).toBeNull();
    expect(result.memo).toBe('');
  });

  it('fails closed for concrete email accounts when exact alias is absent', async () => {
    writeFileSync(process.env.EMAIL_ALIAS_PIN_STORE_PATH!, JSON.stringify({
      '42994795': { pin: '681965', updatedAt: '2026-05-18T09:35:06.605Z' },
    }), 'utf8');
    const { resolveEmailAliasFill } = await import('./src/api/email-alias-fill.ts');

    const result = await resolveEmailAliasFill({
      accountEmail: 'gtdny9.claim390@aleeas.com',
      serviceType: '디즈니플러스',
      aliases: [
        { id: 42994795, email: 'disney7.county770@aleeas.com', enabled: true },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.emailId).toBeNull();
    expect(result.pin).toBeNull();
    expect(result.missing).toEqual(expect.arrayContaining(['email', 'pin']));
  });

  it('reports missing alias and PIN without placeholders when no data exists', async () => {
    writeFileSync(process.env.EMAIL_ALIAS_PIN_STORE_PATH!, JSON.stringify({}), 'utf8');
    const { resolveEmailAliasFill } = await import('./src/api/email-alias-fill.ts');

    const result = await resolveEmailAliasFill({
      accountEmail: 'missing@example.com',
      serviceType: '디즈니플러스',
      aliases: [],
    });

    expect(result.ok).toBe(false);
    expect(result.found).toBe(false);
    expect(result.missing).toEqual(expect.arrayContaining(['email', 'pin']));
    expect(result.memo).toBe('');
  });

  it('protects /api/email-alias-fill with admin token and returns lookup result', async () => {
    process.env.AIO_ADMIN_TOKEN = 'test-admin-token';
    writeFileSync(process.env.EMAIL_ALIAS_PIN_STORE_PATH!, JSON.stringify({
      '202': { pin: '1357', updatedAt: '2026-04-26T00:00:00Z' },
    }), 'utf8');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      aliases: [{ id: 202, email: 'netflix1.foo@example.com', enabled: true }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })));
    const app = (await import('./src/api/index.ts')).default;

    const forbidden = await app.request('/api/email-alias-fill?email=netflix1.foo%40example.com&serviceType=넷플릭스');
    expect(forbidden.status).toBe(403);

    const allowed = await app.request('/api/email-alias-fill?email=netflix1.foo%40example.com&serviceType=넷플릭스', {
      headers: { 'x-admin-token': 'test-admin-token' },
    });
    expect(allowed.status).toBe(200);
    const body = await allowed.json() as any;
    expect(body).toMatchObject({ ok: true, found: true, emailId: 202, pin: '1357' });
  });

  it('falls back to locally generated account alias refs when the email dashboard page list misses a new alias', async () => {
    process.env.AIO_ADMIN_TOKEN = 'test-admin-token';
    process.env.GENERATED_ACCOUNTS_PATH = join(tempDir, 'generated-accounts.json');
    writeFileSync(process.env.EMAIL_ALIAS_PIN_STORE_PATH!, JSON.stringify({
      '44877806': { pin: '074056', updatedAt: '2026-06-11T11:52:30.454Z' },
    }), 'utf8');
    writeFileSync(process.env.GENERATED_ACCOUNTS_PATH, JSON.stringify({
      '1781178750454-44877806': {
        id: '1781178750454-44877806',
        serviceType: '티빙+웨이브',
        email: 'gtwavve15.dig092@aleeas.com',
        password: 'u2mhe1t!va',
        pin: '074056',
        emailId: 44877806,
        memo: '',
        createdAt: '2026-06-11T11:52:30.454Z',
        paymentStatus: 'paid',
        paidAt: '2026-06-11T11:57:47.091Z',
        source: 'account-generator',
      },
    }), 'utf8');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ aliases: [] }), { status: 200, headers: { 'content-type': 'application/json' } })));
    const app = (await import('./src/api/index.ts')).default;

    const allowed = await app.request('/api/email-alias-fill?email=gtwavve15.dig092%40aleeas.com&serviceType=티빙%2B웨이브', {
      headers: { 'x-admin-token': 'test-admin-token' },
    });
    expect(allowed.status).toBe(200);
    const body = await allowed.json() as any;
    expect(body).toMatchObject({ ok: true, found: true, emailId: 44877806, email: 'gtwavve15.dig092@aleeas.com', pin: '074056' });
  });
});
