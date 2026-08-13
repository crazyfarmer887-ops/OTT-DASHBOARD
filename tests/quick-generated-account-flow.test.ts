import { describe, expect, test } from 'vitest';
import {
  buildQuickAccountClipboard,
  findQuickPostAccount,
  type QuickGeneratedAccount,
} from '../src/web/lib/quick-generated-account-flow';

const account: QuickGeneratedAccount = {
  id: 'generated-1',
  serviceType: '넷플릭스',
  email: 'new@example.com',
  password: 'secret-password',
  pin: '123456',
  emailId: 321,
  paymentStatus: 'pending',
};

describe('quick generated account workflow', () => {
  test('builds a compact copy block without unrelated metadata', () => {
    expect(buildQuickAccountClipboard(account)).toBe('ID: new@example.com\nPW: secret-password\n이메일 PIN: 123456');
  });

  test('selects the current account-card posting target for a generated account', () => {
    const netflix = { serviceType: '넷플릭스', email: 'new@example.com', generatedAccount: { id: 'generated-1', linkedServiceType: '넷플릭스' } };
    expect(findQuickPostAccount([{ serviceType: '넷플릭스', accounts: [netflix] }], 'generated-1', '넷플릭스')).toBe(netflix);
  });

  test('uses the Wavve account-card posting target for a paid double-pass', () => {
    const tving = { serviceType: '티빙', email: 'gtwavve9', generatedAccount: { id: 'bundle-1', linkedServiceType: '티빙' } };
    const wavve = { serviceType: '웨이브', email: 'gtwavve9@example.com', generatedAccount: { id: 'bundle-1', linkedServiceType: '웨이브' } };
    expect(findQuickPostAccount([
      { serviceType: '티빙', accounts: [tving] },
      { serviceType: '웨이브', accounts: [wavve] },
    ], 'bundle-1', '티빙+웨이브')).toBe(wavve);
  });

  test('fails closed when the current account-card row is unavailable', () => {
    expect(findQuickPostAccount([], 'missing', '넷플릭스')).toBeNull();
  });
});
