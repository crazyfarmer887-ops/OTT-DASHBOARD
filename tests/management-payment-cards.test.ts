import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let tempDir: string;
const originalStorePath = process.env.MANAGEMENT_PAYMENT_CARDS_PATH;
const originalHiddenStorePath = process.env.MANAGEMENT_HIDDEN_ACCOUNTS_PATH;
const originalAdminToken = process.env.AIO_ADMIN_TOKEN;

beforeEach(() => {
  vi.resetModules();
  tempDir = mkdtempSync(join(tmpdir(), 'management-payment-cards-'));
  process.env.MANAGEMENT_PAYMENT_CARDS_PATH = join(tempDir, 'payment-cards.json');
  process.env.AIO_ADMIN_TOKEN = 'test-admin-token';
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(tempDir, { recursive: true, force: true });
  if (originalStorePath === undefined) delete process.env.MANAGEMENT_PAYMENT_CARDS_PATH;
  else process.env.MANAGEMENT_PAYMENT_CARDS_PATH = originalStorePath;
  if (originalHiddenStorePath === undefined) delete process.env.MANAGEMENT_HIDDEN_ACCOUNTS_PATH;
  else process.env.MANAGEMENT_HIDDEN_ACCOUNTS_PATH = originalHiddenStorePath;
  if (originalAdminToken === undefined) delete process.env.AIO_ADMIN_TOKEN;
  else process.env.AIO_ADMIN_TOKEN = originalAdminToken;
});

describe('management payment-card metadata helper and store', () => {
  it('normalizes account keys and accepts only safe display metadata', async () => {
    const { managementPaymentCardKey, normalizeManagementPaymentCardInput } = await import('../src/lib/management-payment-cards.ts');

    expect(managementPaymentCardKey(' 넷 플 릭 스 ', ' Owner@Example.COM ')).toBe('넷플릭스:owner@example.com');
    expect(normalizeManagementPaymentCardInput({
      serviceType: ' 넷플릭스 ',
      accountEmail: ' Owner@Example.COM ',
      label: ' 현대카드 ',
      cardIssuer: ' 현대 ',
      last4: '1234',
      cardNumber: '4111111111111111',
      cvv: '123',
      expiry: '12/30',
    } as any, '2026-07-13T00:00:00.000Z')).toEqual({
      serviceType: '넷플릭스',
      accountEmail: 'owner@example.com',
      label: '현대카드',
      cardIssuer: '현대',
      last4: '1234',
      updatedAt: '2026-07-13T00:00:00.000Z',
    });
  });

  it('rejects invalid lengths and anything except exactly four last digits', async () => {
    const { normalizeManagementPaymentCardInput } = await import('../src/lib/management-payment-cards.ts');
    const base = { serviceType: '넷플릭스', accountEmail: 'owner@example.com', label: '현대카드', cardIssuer: '현대' };

    expect(() => normalizeManagementPaymentCardInput({ ...base, last4: '123' })).toThrow(/last4/);
    expect(() => normalizeManagementPaymentCardInput({ ...base, last4: '12a4' })).toThrow(/last4/);
    expect(() => normalizeManagementPaymentCardInput({ ...base, label: '가'.repeat(61), last4: '1234' })).toThrow(/label/);
    expect(() => normalizeManagementPaymentCardInput({ ...base, cardIssuer: '가'.repeat(61), last4: '1234' })).toThrow(/cardIssuer/);
  });

  it('accepts an integer Netflix renewal day from 1 through 31 without requiring card metadata', async () => {
    const { normalizeManagementPaymentCardInput } = await import('../src/lib/management-payment-cards.ts');

    expect(normalizeManagementPaymentCardInput({
      serviceType: ' 넷플릭스 ',
      accountEmail: ' Owner@Example.COM ',
      renewalDay: 17,
    }, '2026-07-16T00:00:00.000Z')).toEqual({
      serviceType: '넷플릭스',
      accountEmail: 'owner@example.com',
      renewalDay: 17,
      updatedAt: '2026-07-16T00:00:00.000Z',
    });
  });

  it('rejects unsafe renewal days and renewal metadata for non-Netflix services', async () => {
    const { normalizeManagementPaymentCardInput } = await import('../src/lib/management-payment-cards.ts');
    const netflix = { serviceType: '넷플릭스', accountEmail: 'owner@example.com', label: '업무카드' };

    for (const renewalDay of [0, 32, 1.5, '17', true]) {
      expect(() => normalizeManagementPaymentCardInput({ ...netflix, renewalDay })).toThrow(/renewalDay/);
    }
    expect(() => normalizeManagementPaymentCardInput({
      serviceType: '디즈니 플러스', accountEmail: 'owner@example.com', label: '업무카드', renewalDay: 17,
    })).toThrow(/Netflix|넷플릭스|serviceType/);

    // Existing payment-card payloads for every service remain valid.
    expect(normalizeManagementPaymentCardInput({
      serviceType: '디즈니 플러스', accountEmail: 'owner@example.com', label: '업무카드', last4: '1234',
    })).toMatchObject({ serviceType: '디즈니 플러스', label: '업무카드', last4: '1234' });
  });

  it('atomically upserts and deletes a 0600 local JSON store without retaining sensitive fields', async () => {
    const { deleteManagementPaymentCard, loadManagementPaymentCards, upsertManagementPaymentCard } = await import('../src/lib/management-payment-cards.ts');
    const path = process.env.MANAGEMENT_PAYMENT_CARDS_PATH!;

    upsertManagementPaymentCard({
      serviceType: '넷플릭스', accountEmail: 'Owner@Example.com', label: '현대카드', cardIssuer: '현대', last4: '1234',
      cardNumber: '4111111111111111', cvv: '123', expiry: '12/30',
    } as any, '2026-07-13T00:00:00.000Z');

    expect(statSync(path).mode & 0o777).toBe(0o600);
    const raw = readFileSync(path, 'utf8');
    expect(raw).not.toContain('4111111111111111');
    expect(raw).not.toContain('"cvv"');
    expect(raw).not.toContain('12/30');
    expect(loadManagementPaymentCards()).toEqual({
      '넷플릭스:owner@example.com': {
        serviceType: '넷플릭스', accountEmail: 'owner@example.com', label: '현대카드', cardIssuer: '현대', last4: '1234', updatedAt: '2026-07-13T00:00:00.000Z',
      },
    });

    deleteManagementPaymentCard({ serviceType: ' 넷 플 릭 스 ', accountEmail: 'OWNER@example.com' });
    expect(loadManagementPaymentCards()).toEqual({});
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it('fails closed on malformed JSON and preserves the corrupt file during upsert and delete', async () => {
    const { deleteManagementPaymentCard, loadManagementPaymentCards, upsertManagementPaymentCard } = await import('../src/lib/management-payment-cards.ts');
    const path = process.env.MANAGEMENT_PAYMENT_CARDS_PATH!;
    const corrupt = '{"cards":{"broken":';
    writeFileSync(path, corrupt, 'utf8');

    expect(() => loadManagementPaymentCards()).toThrow(/read|parse|invalid|malformed/i);
    expect(() => upsertManagementPaymentCard({ serviceType: '넷플릭스', accountEmail: 'owner@example.com', label: '현대카드' })).toThrow();
    expect(readFileSync(path, 'utf8')).toBe(corrupt);
    expect(() => deleteManagementPaymentCard({ serviceType: '넷플릭스', accountEmail: 'owner@example.com' })).toThrow();
    expect(readFileSync(path, 'utf8')).toBe(corrupt);
  });

  it('treats read errors other than ENOENT as fatal and does not replace the unreadable store', async () => {
    const { loadManagementPaymentCards, upsertManagementPaymentCard } = await import('../src/lib/management-payment-cards.ts');
    const path = process.env.MANAGEMENT_PAYMENT_CARDS_PATH!;
    const original = '{"cards":{}}';
    writeFileSync(path, original, 'utf8');
    chmodSync(path, 0o000);

    try {
      expect(() => loadManagementPaymentCards()).toThrow();
      expect(() => upsertManagementPaymentCard({ serviceType: '넷플릭스', accountEmail: 'owner@example.com', label: '현대카드' })).toThrow();
    } finally {
      chmodSync(path, 0o600);
    }
    expect(readFileSync(path, 'utf8')).toBe(original);
  });

  it('merges card metadata into active and archived account cards without coupling it to hidden-account state', async () => {
    const { mergeManagementPaymentCards } = await import('../src/lib/management-payment-cards.ts');
    const management = {
      services: [{ serviceType: '넷플릭스', accounts: [
        { email: 'active@example.com', serviceType: '넷플릭스' },
        { email: 'archived@example.com', serviceType: '넷플릭스', archivedAccount: true },
      ] }],
    };
    const cards = {
      '넷플릭스:active@example.com': { serviceType: '넷플릭스', accountEmail: 'active@example.com', label: '현대카드', cardIssuer: '현대', last4: '1234', updatedAt: 'now' },
      '넷플릭스:archived@example.com': { serviceType: '넷플릭스', accountEmail: 'archived@example.com', label: '업무카드', cardIssuer: '신한', last4: '9876', updatedAt: 'now' },
    };

    const result = mergeManagementPaymentCards(management as any, cards as any);
    expect(result.services[0].accounts[0].paymentCard).toMatchObject({ label: '현대카드', last4: '1234' });
    expect(result.services[0].accounts[1]).toMatchObject({ archivedAccount: true, paymentCard: { serviceType: '넷플릭스', accountEmail: 'archived@example.com', label: '업무카드', cardIssuer: '신한', last4: '9876', updatedAt: 'now' } });
  });

  it('round-trips and merges a Netflix renewal-only record while loading legacy card records', async () => {
    const { loadManagementPaymentCards, mergeManagementPaymentCards, upsertManagementPaymentCard } = await import('../src/lib/management-payment-cards.ts');
    const path = process.env.MANAGEMENT_PAYMENT_CARDS_PATH!;
    writeFileSync(path, JSON.stringify({ cards: {
      legacy: { serviceType: '넷플릭스', accountEmail: 'legacy@example.com', label: '기존 카드', updatedAt: 'before' },
    } }), 'utf8');

    upsertManagementPaymentCard({ serviceType: '넷플릭스', accountEmail: 'renewal@example.com', renewalDay: 31 }, '2026-07-16T00:00:00.000Z');
    const cards = loadManagementPaymentCards();
    expect(cards['넷플릭스:legacy@example.com']).toMatchObject({ label: '기존 카드' });
    expect(cards['넷플릭스:renewal@example.com']).toMatchObject({ renewalDay: 31 });

    const result = mergeManagementPaymentCards({ services: [{ serviceType: '넷플릭스', accounts: [
      { email: 'renewal@example.com', serviceType: '넷플릭스' },
    ] }] }, cards);
    expect(result.services?.[0].accounts?.[0].paymentCard).toMatchObject({ renewalDay: 31 });
  });
});

describe('management payment-card admin API', () => {
  async function seedManagedAccounts(accounts: Array<{ serviceType: string; email: string }>) {
    const { replaceManagementPaymentCardAccountKeys } = await import('../src/lib/management-payment-cards.ts');
    replaceManagementPaymentCardAccountKeys({ services: [{ serviceType: '넷플릭스', accounts }] });
  }

  it('requires admin auth for read, save, and delete', async () => {
    const app = (await import('../src/api/index.ts')).default;
    for (const request of [
      app.request('/api/management-payment-cards'),
      app.request('/api/management-payment-cards', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{}' }),
      app.request('/api/management-payment-cards', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: '{}' }),
    ]) {
      expect((await request).status).toBe(403);
    }
  });

  it('saves, lists, validates, and deletes only safe card metadata', async () => {
    const app = (await import('../src/api/index.ts')).default;
    await seedManagedAccounts([{ serviceType: '넷플릭스', email: 'owner@example.com' }]);
    const headers = { 'content-type': 'application/json', 'x-admin-token': 'test-admin-token' };
    const save = await app.request('/api/management-payment-cards', {
      method: 'PUT', headers,
      body: JSON.stringify({ serviceType: '넷플릭스', accountEmail: 'Owner@Example.com', label: '현대카드', cardIssuer: '현대', last4: '1234', cardNumber: '4111111111111111', cvv: '123', expiry: '12/30' }),
    });
    expect(save.status).toBe(200);
    const savedBody = await save.json() as any;
    expect(savedBody).toMatchObject({ ok: true, card: { serviceType: '넷플릭스', accountEmail: 'owner@example.com', label: '현대카드', cardIssuer: '현대', last4: '1234' } });
    expect(JSON.stringify(savedBody)).not.toContain('4111111111111111');
    expect(savedBody.card).not.toHaveProperty('cvv');
    expect(savedBody.card).not.toHaveProperty('expiry');

    const list = await app.request('/api/management-payment-cards', { headers: { 'x-admin-token': 'test-admin-token' } });
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({ cards: [expect.objectContaining({ label: '현대카드', last4: '1234' })] });

    const invalid = await app.request('/api/management-payment-cards', {
      method: 'PUT', headers,
      body: JSON.stringify({ serviceType: '넷플릭스', accountEmail: 'owner@example.com', label: '현대카드', last4: '12345' }),
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ ok: false, error: expect.stringMatching(/last4/) });

    const remove = await app.request('/api/management-payment-cards', {
      method: 'DELETE', headers,
      body: JSON.stringify({ serviceType: '넷 플 릭 스', accountEmail: 'OWNER@example.com' }),
    });
    expect(remove.status).toBe(200);
    expect(await remove.json()).toMatchObject({ ok: true, deleted: true, cards: [] });
  });

  it('saves and lists a renewal-only Netflix record and rejects invalid service/range API payloads', async () => {
    const app = (await import('../src/api/index.ts')).default;
    await seedManagedAccounts([
      { serviceType: '넷플릭스', email: 'netflix@example.com' },
      { serviceType: '디즈니 플러스', email: 'disney@example.com' },
    ]);
    const headers = { 'content-type': 'application/json', 'x-admin-token': 'test-admin-token' };

    const save = await app.request('/api/management-payment-cards', {
      method: 'PUT', headers,
      body: JSON.stringify({ serviceType: '넷플릭스', accountEmail: 'netflix@example.com', renewalDay: 23 }),
    });
    expect(save.status).toBe(200);
    expect(await save.json()).toMatchObject({ ok: true, card: { renewalDay: 23 } });

    const list = await app.request('/api/management-payment-cards', { headers: { 'x-admin-token': 'test-admin-token' } });
    expect(await list.json()).toMatchObject({ cards: [expect.objectContaining({ renewalDay: 23 })] });

    for (const payload of [
      { serviceType: '넷플릭스', accountEmail: 'netflix@example.com', renewalDay: 0 },
      { serviceType: '넷플릭스', accountEmail: 'netflix@example.com', renewalDay: 32 },
      { serviceType: '디즈니 플러스', accountEmail: 'disney@example.com', label: '기존 카드', renewalDay: 10 },
    ]) {
      const response = await app.request('/api/management-payment-cards', { method: 'PUT', headers, body: JSON.stringify(payload) });
      expect(response.status).toBe(400);
    }
  });

  it('rejects unknown or typo account keys, empty metadata, and deletion of a missing card', async () => {
    const app = (await import('../src/api/index.ts')).default;
    await seedManagedAccounts([{ serviceType: '넷플릭스', email: 'owner@example.com' }]);
    const headers = { 'content-type': 'application/json', 'x-admin-token': 'test-admin-token' };

    const unknown = await app.request('/api/management-payment-cards', {
      method: 'PUT', headers,
      body: JSON.stringify({ serviceType: '넷플릭스', accountEmail: 'typo@example.com', label: '현대카드' }),
    });
    expect(unknown.status).toBe(404);

    const empty = await app.request('/api/management-payment-cards', {
      method: 'PUT', headers,
      body: JSON.stringify({ serviceType: '넷플릭스', accountEmail: 'owner@example.com', label: ' ', cardIssuer: '' }),
    });
    expect(empty.status).toBe(400);

    const missing = await app.request('/api/management-payment-cards', {
      method: 'DELETE', headers,
      body: JSON.stringify({ serviceType: '넷플릭스', accountEmail: 'owner@example.com' }),
    });
    expect(missing.status).toBe(404);
  });

  it('accepts archived and hidden source-of-truth account keys', async () => {
    const app = (await import('../src/api/index.ts')).default;
    const { replaceManagementPaymentCardAccountKeys } = await import('../src/lib/management-payment-cards.ts');
    replaceManagementPaymentCardAccountKeys({ services: [{ serviceType: '넷플릭스', accounts: [
      { serviceType: '넷플릭스', email: 'archived@example.com', archivedAccount: true },
    ] }] });
    process.env.MANAGEMENT_HIDDEN_ACCOUNTS_PATH = join(tempDir, 'hidden.json');
    writeFileSync(process.env.MANAGEMENT_HIDDEN_ACCOUNTS_PATH, JSON.stringify({ accounts: [
      { serviceType: '디즈니 플러스', accountEmail: 'hidden@example.com' },
    ] }), 'utf8');
    const headers = { 'content-type': 'application/json', 'x-admin-token': 'test-admin-token' };

    for (const body of [
      { serviceType: '넷플릭스', accountEmail: 'archived@example.com', label: '보관카드' },
      { serviceType: '디즈니플러스', accountEmail: 'hidden@example.com', last4: '1234' },
    ]) {
      const response = await app.request('/api/management-payment-cards', { method: 'PUT', headers, body: JSON.stringify(body) });
      expect(response.status).toBe(200);
    }
  });
});
