import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let tempDir: string;
const originalHiddenPath = process.env.MANAGEMENT_HIDDEN_ACCOUNTS_PATH;
const originalAdminToken = process.env.AIO_ADMIN_TOKEN;

beforeEach(() => {
  vi.resetModules();
  tempDir = mkdtempSync(join(tmpdir(), 'management-hidden-'));
  process.env.MANAGEMENT_HIDDEN_ACCOUNTS_PATH = join(tempDir, 'hidden.json');
  process.env.AIO_ADMIN_TOKEN = 'test-admin-token';
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(tempDir, { recursive: true, force: true });
  if (originalHiddenPath === undefined) delete process.env.MANAGEMENT_HIDDEN_ACCOUNTS_PATH;
  else process.env.MANAGEMENT_HIDDEN_ACCOUNTS_PATH = originalHiddenPath;
  if (originalAdminToken === undefined) delete process.env.AIO_ADMIN_TOKEN;
  else process.env.AIO_ADMIN_TOKEN = originalAdminToken;
});

describe('management hidden accounts', () => {
  it('filters hidden accounts from management cards, on-sale fill rows, and revenue summary', async () => {
    const { applyManagementHiddenAccounts } = await import('../src/lib/management-hidden-accounts.ts');
    const management = {
      services: [
        {
          serviceType: '디즈니플러스',
          accounts: [
            { email: 'visible@example.com', serviceType: '디즈니플러스', usingCount: 1, activeCount: 1, totalIncome: 1000, totalRealizedIncome: 300, members: [] },
            { email: 'hide@example.com', serviceType: '디즈니플러스', usingCount: 2, activeCount: 2, totalIncome: 9000, totalRealizedIncome: 4000, members: [] },
          ],
          totalUsingMembers: 3,
          totalActiveMembers: 3,
          totalIncome: 10000,
          totalRealized: 4300,
        },
      ],
      onSaleByKeepAcct: {
        'visible@example.com': [{ productType: '디즈니플러스', productUsid: 'visible-sale' }],
        'hide@example.com': [{ productType: '디즈니플러스', productUsid: 'hidden-sale' }],
      },
      summary: { totalUsingMembers: 3, totalActiveMembers: 3, totalIncome: 10000, totalRealized: 4300, totalAccounts: 2 },
      updatedAt: '2026-06-07T00:00:00.000Z',
    } as any;

    const filtered = applyManagementHiddenAccounts(management, [
      { serviceType: '디즈니플러스', accountEmail: 'HIDE@example.com' },
    ]);

    expect(filtered.services[0].accounts.map((account: any) => account.email)).toEqual(['visible@example.com']);
    expect(filtered.onSaleByKeepAcct).toEqual({
      'visible@example.com': [{ productType: '디즈니플러스', productUsid: 'visible-sale' }],
    });
    expect(filtered.summary).toMatchObject({
      totalUsingMembers: 1,
      totalActiveMembers: 1,
      totalIncome: 1000,
      totalRealized: 300,
      totalAccounts: 1,
    });
  });

  it('toggles visibility without deleting SimpleLogin aliases or generated accounts', async () => {
    const { hideManagementAccount, unhideManagementAccount, loadManagementHiddenAccounts } = await import('../src/lib/management-hidden-accounts.ts');

    hideManagementAccount({ serviceType: '넷플릭스', accountEmail: 'netflix@example.com', reason: 'manual-hide' });
    expect(loadManagementHiddenAccounts()).toEqual([
      expect.objectContaining({ serviceType: '넷플릭스', accountEmail: 'netflix@example.com', reason: 'manual-hide' }),
    ]);
    const saved = JSON.parse(readFileSync(process.env.MANAGEMENT_HIDDEN_ACCOUNTS_PATH!, 'utf8'));
    expect(saved.accounts[0]).not.toHaveProperty('simpleLoginAliasDeleted');
    expect(saved.accounts[0]).not.toHaveProperty('generatedAccountDeleted');

    unhideManagementAccount({ serviceType: '넷플릭스', accountEmail: 'netflix@example.com' });
    expect(loadManagementHiddenAccounts()).toEqual([]);
  });

  it('exposes admin-only API routes to hide and restore an account', async () => {
    const app = (await import('../src/api/index.ts')).default;

    const forbidden = await app.request('/api/management-hidden-accounts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ serviceType: '넷플릭스', accountEmail: 'netflix@example.com' }),
    });
    expect(forbidden.status).toBe(403);

    const hide = await app.request('/api/management-hidden-accounts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-token': 'test-admin-token' },
      body: JSON.stringify({ serviceType: '넷플릭스', accountEmail: 'netflix@example.com' }),
    });
    expect(hide.status).toBe(200);
    expect(await hide.json()).toMatchObject({ ok: true, hidden: true });

    const list = await app.request('/api/management-hidden-accounts', {
      headers: { 'x-admin-token': 'test-admin-token' },
    });
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({ accounts: [expect.objectContaining({ serviceType: '넷플릭스', accountEmail: 'netflix@example.com' })] });

    const restore = await app.request('/api/management-hidden-accounts', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json', 'x-admin-token': 'test-admin-token' },
      body: JSON.stringify({ serviceType: '넷플릭스', accountEmail: 'netflix@example.com' }),
    });
    expect(restore.status).toBe(200);
    expect(await restore.json()).toMatchObject({ ok: true, hidden: false, accounts: [] });
  });
});
