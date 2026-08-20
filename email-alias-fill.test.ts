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

  it('matches a TVING bundle alias whose PIN is configured as a hash only', async () => {
    writeFileSync(process.env.EMAIL_ALIAS_PIN_STORE_PATH!, JSON.stringify({
      '42948775': { hash: 'scrypt:bundle-hash-only-value', updatedAt: '2026-06-12T00:00:00Z' },
    }), 'utf8');
    const { resolveEmailAliasFill } = await import('./src/api/email-alias-fill.ts');

    const result = await resolveEmailAliasFill({
      accountEmail: 'gtwavve8',
      serviceType: '티빙',
      aliases: [
        { id: 42948775, email: 'gtwavve8.retry470@aleeas.com', enabled: true },
      ],
    });

    expect(result).toMatchObject({
      ok: false,
      found: false,
      email: 'gtwavve8.retry470@aleeas.com',
      emailId: 42948775,
      pin: null,
      memo: '',
      missing: [],
      pinConfigured: true,
      pinRecoverable: false,
      message: 'PIN은 설정되어 있지만 기존 번호 원문은 확인할 수 없어요.',
    });
    expect(JSON.stringify(result)).not.toContain('bundle-hash-only-value');
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
    expect(allowed.headers.get('cache-control')).toBe('no-store');
    const body = await allowed.json() as any;
    expect(body).toMatchObject({ ok: true, found: true, emailId: 202, pin: '1357' });
  });

  it('reports a hash-only alias PIN as configured but not recoverable without exposing the hash', async () => {
    writeFileSync(process.env.EMAIL_ALIAS_PIN_STORE_PATH!, JSON.stringify({
      '303': { hash: 'scrypt:fake-hash-only-value', updatedAt: '2026-06-12T00:00:00Z' },
    }), 'utf8');
    const { resolveEmailAliasFill } = await import('./src/api/email-alias-fill.ts');

    const result = await resolveEmailAliasFill({
      accountEmail: 'hash-only.test@example.com',
      serviceType: '넷플릭스',
      aliases: [{ id: 303, email: 'hash-only.test@example.com', enabled: true }],
    });

    expect(result).toMatchObject({
      ok: false,
      found: false,
      emailId: 303,
      pin: null,
      memo: '',
      missing: [],
      pinConfigured: true,
      pinRecoverable: false,
      message: 'PIN은 설정되어 있지만 기존 번호 원문은 확인할 수 없어요.',
    });
    expect(JSON.stringify(result)).not.toContain('fake-hash-only-value');
  });

  it('keeps a real unconfigured alias classified as missing PIN', async () => {
    writeFileSync(process.env.EMAIL_ALIAS_PIN_STORE_PATH!, JSON.stringify({}), 'utf8');
    const { resolveEmailAliasFill } = await import('./src/api/email-alias-fill.ts');

    const result = await resolveEmailAliasFill({
      accountEmail: 'no-pin.test@example.com',
      serviceType: '넷플릭스',
      aliases: [{ id: 304, email: 'no-pin.test@example.com', enabled: true }],
    });

    expect(result).toMatchObject({
      ok: false,
      found: false,
      emailId: 304,
      pin: null,
      memo: '',
      missing: ['pin'],
      pinConfigured: false,
      pinRecoverable: false,
    });
  });

  it('rejects a generated-account PIN when the live exact alias id no longer matches the generated account', async () => {
    writeFileSync(process.env.EMAIL_ALIAS_PIN_STORE_PATH!, JSON.stringify({
      '999': { hash: 'scrypt:hashed-pin-only' },
    }), 'utf8');
    const { resolveEmailAliasFill } = await import('./src/api/email-alias-fill.ts');

    const result = await resolveEmailAliasFill({
      accountEmail: 'netflix-generated@example.com',
      serviceType: '넷플릭스',
      aliases: [{ id: 999, email: 'netflix-generated@example.com', enabled: true }],
      fallbackPin: '074056',
      fallbackEmailId: 44877806,
    });

    expect(result).toMatchObject({ ok: false, found: false, emailId: 999, pin: null, missing: [], pinConfigured: true, pinRecoverable: false });
    expect(result.memo).toBe('');
  });

  it('rejects a generated-account PIN from a different service even when email and alias id match', async () => {
    writeFileSync(process.env.EMAIL_ALIAS_PIN_STORE_PATH!, JSON.stringify({
      '44877806': { hash: 'scrypt:hashed-pin-only' },
    }), 'utf8');
    const { resolveEmailAliasFill } = await import('./src/api/email-alias-fill.ts');

    const result = await resolveEmailAliasFill({
      accountEmail: 'netflix-generated@example.com',
      serviceType: '넷플릭스',
      aliases: [{ id: 44877806, email: 'netflix-generated@example.com', enabled: true }],
      fallbackPin: '074056',
      fallbackEmailId: 44877806,
      fallbackServiceType: '디즈니플러스',
    });

    expect(result).toMatchObject({ ok: false, found: false, emailId: 44877806, pin: null, missing: [], pinConfigured: true, pinRecoverable: false });
  });

  it('rejects non-digit generated-account PIN text instead of silently normalizing it', async () => {
    writeFileSync(process.env.EMAIL_ALIAS_PIN_STORE_PATH!, JSON.stringify({
      '44877806': { hash: 'scrypt:hashed-pin-only' },
    }), 'utf8');
    const { resolveEmailAliasFill } = await import('./src/api/email-alias-fill.ts');

    const result = await resolveEmailAliasFill({
      accountEmail: 'netflix-generated@example.com',
      serviceType: '넷플릭스',
      aliases: [{ id: 44877806, email: 'netflix-generated@example.com', enabled: true }],
      fallbackPin: 'abc074-056xyz',
      fallbackEmailId: 44877806,
      fallbackServiceType: '넷플릭스',
    });

    expect(result).toMatchObject({ ok: false, found: false, emailId: 44877806, pin: null, missing: [], pinConfigured: true, pinRecoverable: false });
  });

  it('falls back to the exact generated-account PIN after the email dashboard migrates PIN storage to hashes', async () => {
    process.env.AIO_ADMIN_TOKEN = 'test-admin-token';
    process.env.GENERATED_ACCOUNTS_PATH = join(tempDir, 'generated-accounts.json');
    writeFileSync(process.env.EMAIL_ALIAS_PIN_STORE_PATH!, JSON.stringify({
      '44877806': { hash: 'scrypt:hashed-pin-only', updatedAt: '2026-06-11T11:52:30.454Z' },
    }), 'utf8');
    writeFileSync(process.env.GENERATED_ACCOUNTS_PATH, JSON.stringify({
      '1781178750454-44877806': {
        id: '1781178750454-44877806',
        serviceType: '넷플릭스',
        email: 'netflix-generated@example.com',
        password: 'test-password-not-a-secret',
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

    const allowed = await app.request('/api/email-alias-fill?email=netflix-generated%40example.com&serviceType=넷플릭스', {
      headers: { 'x-admin-token': 'test-admin-token' },
    });
    expect(allowed.status).toBe(200);
    const body = await allowed.json() as any;
    expect(body).toMatchObject({ ok: true, found: true, emailId: 44877806, email: 'netflix-generated@example.com', pin: '074056' });
  });
});
