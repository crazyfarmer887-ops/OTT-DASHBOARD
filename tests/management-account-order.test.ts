import { describe, expect, it } from 'vitest';

import {
  getVisibleManagementAccounts,
  isPaidManagementAccount,
  parseManagementExpiryDate,
} from '../src/web/lib/management-account-order.ts';

describe('management account payment classification', () => {
  it('treats generated-account payment status as authoritative', () => {
    expect(isPaidManagementAccount({
      email: 'pending@example.com',
      serviceType: '넷플릭스',
      expiryDate: null,
      generatedAccount: { paymentStatus: 'pending' },
      paymentCard: { label: '업무카드' },
    })).toBe(false);
    expect(isPaidManagementAccount({
      email: 'paid@example.com',
      serviceType: '넷플릭스',
      expiryDate: null,
      generatedAccount: { paymentStatus: 'paid' },
    })).toBe(true);
  });

  it('classifies legacy accounts by meaningful card metadata, including renewal day', () => {
    const base = { email: 'legacy@example.com', serviceType: '넷플릭스', expiryDate: null };
    expect(isPaidManagementAccount(base)).toBe(false);
    expect(isPaidManagementAccount({ ...base, paymentCard: { label: '   ', cardIssuer: '', last4: '' } })).toBe(false);
    expect(isPaidManagementAccount({ ...base, paymentCard: { label: '업무카드' } })).toBe(true);
    expect(isPaidManagementAccount({ ...base, paymentCard: { cardIssuer: '현대' } })).toBe(true);
    expect(isPaidManagementAccount({ ...base, paymentCard: { last4: '1234' } })).toBe(true);
    expect(isPaidManagementAccount({ ...base, paymentCard: { renewalDay: 17 } })).toBe(true);
  });
});

describe('management expiry parsing', () => {
  it('parses Graytag dotted, dashed, and ISO dates while rejecting invalid dates', () => {
    const expected = Date.UTC(2026, 6, 3);
    expect(parseManagementExpiryDate('2026. 07. 03')).toBe(expected);
    expect(parseManagementExpiryDate('2026.07.03')).toBe(expected);
    expect(parseManagementExpiryDate('2026-07-03')).toBe(expected);
    expect(parseManagementExpiryDate('2026-07-03T14:30:00+09:00')).toBe(Date.parse('2026-07-03T14:30:00+09:00'));
    expect(parseManagementExpiryDate('2026. 02. 31')).toBeNull();
    expect(parseManagementExpiryDate('not-a-date')).toBeNull();
    expect(parseManagementExpiryDate(null)).toBeNull();
  });
});

describe('management account filtering and order', () => {
  it('filters whole accounts, excludes direct delivery, sorts expiry ascending, and does not mutate inputs', () => {
    const members = [{ status: 'Finished' }, { status: 'Using' }];
    const accounts = [
      { email: 'missing@example.com', serviceType: '넷플릭스', expiryDate: null, members, paymentCard: { label: '카드' } },
      { email: 'later@example.com', serviceType: '넷플릭스', expiryDate: '2026. 08. 01', members, paymentCard: { last4: '1234' } },
      { email: '(직접전달)', serviceType: '넷플릭스', expiryDate: '2026. 01. 01', members, paymentCard: { label: '카드' } },
      { email: 'earlier@example.com', serviceType: '넷플릭스', expiryDate: '2026-07-01', members, generatedAccount: { paymentStatus: 'paid' as const } },
      { email: 'unpaid@example.com', serviceType: '넷플릭스', expiryDate: '2026-06-01', members, generatedAccount: { paymentStatus: 'pending' as const }, paymentCard: { label: '카드' } },
    ];
    const originalOrder = accounts.map((account) => account.email);

    const paid = getVisibleManagementAccounts(accounts, 'paid');

    expect(paid.map((account) => account.email)).toEqual(['earlier@example.com', 'later@example.com', 'missing@example.com']);
    expect(paid[0].members).toBe(members);
    expect(accounts.map((account) => account.email)).toEqual(originalOrder);
  });

  it('puts invalid expiry last and breaks equal-date ties by service then email', () => {
    const paid = { label: '카드' };
    const accounts = [
      { email: 'z@example.com', serviceType: '웨이브', expiryDate: '2026-07-01', paymentCard: paid },
      { email: 'invalid@example.com', serviceType: '넷플릭스', expiryDate: '2026-02-31', paymentCard: paid },
      { email: 'b@example.com', serviceType: '넷플릭스', expiryDate: '2026-07-01', paymentCard: paid },
      { email: 'a@example.com', serviceType: '넷플릭스', expiryDate: '2026-07-01', paymentCard: paid },
    ];

    expect(getVisibleManagementAccounts(accounts, 'paid').map((account) => account.email)).toEqual([
      'a@example.com',
      'b@example.com',
      'z@example.com',
      'invalid@example.com',
    ]);
  });

  it('returns pending generated and metadata-free legacy accounts in the unpaid group', () => {
    const accounts = [
      { email: 'legacy@example.com', serviceType: '넷플릭스', expiryDate: null },
      { email: 'pending@example.com', serviceType: '넷플릭스', expiryDate: null, generatedAccount: { paymentStatus: 'pending' as const }, paymentCard: { last4: '1234' } },
      { email: 'paid@example.com', serviceType: '넷플릭스', expiryDate: null, generatedAccount: { paymentStatus: 'paid' as const } },
    ];

    expect(getVisibleManagementAccounts(accounts, 'unpaid').map((account) => account.email)).toEqual([
      'legacy@example.com',
      'pending@example.com',
    ]);
  });
});
