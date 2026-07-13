import { describe, expect, test } from 'vitest';
import { mergeArchivedAccountsIntoManagement } from '../src/lib/management-archived-accounts';

const emptyManagement = () => ({ services: [], summary: { totalAccounts: 0 } });

const accessRecord = (overrides: Record<string, unknown> = {}) => ({
  id: 'access-1', tokenHash: 'hash-1', serviceType: '넷플릭스', accountEmail: 'expired@example.com',
  fallbackPassword: 'stored-password', fallbackPin: '123456', profileName: '딸기', emailAccessUrl: '',
  member: { kind: 'graytag', memberId: 'deal-old', memberName: '과거 구매자', status: 'NormalFinished', statusName: '완료', endDateTime: '2026-05-01T00:00:00.000Z' },
  createdAt: '2026-04-01T00:00:00.000Z', revokedAt: '2026-05-01T00:00:00.000Z', lastViewedAt: null, viewCount: 0,
  ...overrides,
});

describe('management archived accounts', () => {
  test('keeps a zero-member expired account card from persisted access credentials', () => {
    const result = mergeArchivedAccountsIntoManagement(emptyManagement(), { old: accessRecord() } as any, {} as any);
    const account = result.services[0].accounts[0];
    expect(account).toMatchObject({
      email: 'expired@example.com', serviceType: '넷플릭스', members: [], usingCount: 0, activeCount: 0,
      keepPasswd: 'stored-password', archivedAccount: true, credentialSource: 'party-access-history', expiryDate: '2026-05-01T00:00:00.000Z',
    });
    expect(result.summary.totalAccounts).toBe(1);
  });

  test('prefers the latest persisted real password and saved maintenance ID without duplicating an existing account', () => {
    const management = { services: [{ serviceType: '넷플릭스', accounts: [{ email: 'expired@example.com', serviceType: '넷플릭스', members: [], usingCount: 0, activeCount: 0 }], totalUsingMembers: 0, totalActiveMembers: 0, totalIncome: 0, totalRealized: 0 }], summary: { totalAccounts: 1 } };
    const result = mergeArchivedAccountsIntoManagement(management as any, {
      old: accessRecord(),
      latest: accessRecord({ id: 'access-2', tokenHash: 'hash-2', fallbackPassword: '', fallbackPin: '', createdAt: '2026-05-02T00:00:00.000Z' }),
    } as any, {
      '넷플릭스:expired@example.com': { key: '넷플릭스:expired@example.com', changedAccountEmail: 'saved-login-id', changedPassword: 'maintenance-password', generatedPin: '654321', updatedAt: '2026-05-03T00:00:00.000Z' },
    } as any);
    expect(result.services[0].accounts).toHaveLength(1);
    expect(result.services[0].accounts[0]).toMatchObject({ keepPasswd: 'maintenance-password', archivedAccount: true, archivedCredential: { id: 'saved-login-id', password: 'maintenance-password', pin: '654321' } });
    expect(result.summary.totalAccounts).toBe(1);
  });

  test('keeps older non-empty credentials when the newest access snapshot is redacted', () => {
    const result = mergeArchivedAccountsIntoManagement(emptyManagement(), {
      old: accessRecord(),
      latest: accessRecord({ id: 'access-2', tokenHash: 'hash-2', fallbackPassword: '', fallbackPin: '', createdAt: '2026-05-02T00:00:00.000Z' }),
    } as any, {} as any);
    expect(result.services[0].accounts[0].archivedCredential).toMatchObject({ password: 'stored-password', pin: '123456' });
  });

  test('does not create account cards from placeholder credentials', () => {
    const result = mergeArchivedAccountsIntoManagement(emptyManagement(), { old: accessRecord({ accountEmail: '아래 메세지를 꼭 확인해주세요' }) } as any, {} as any);
    expect(result.services).toEqual([]);
  });
});
