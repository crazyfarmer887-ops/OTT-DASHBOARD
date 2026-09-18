import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { managementAccountScope } from '../src/lib/management-account-scope';

describe('management account scope', () => {
  test('keeps primary local account records out of the YouTube sales account', () => {
    expect(managementAccountScope('primary')).toEqual({
      useLocalAccountRecords: true,
      persistLocalAccountState: true,
    });
    expect(managementAccountScope('youtube-invite-sales')).toEqual({
      useLocalAccountRecords: false,
      persistLocalAccountState: false,
    });
  });

  test('the management route applies the account scope before reading or merging local records', () => {
    const source = readFileSync(new URL('../src/api/index.ts', import.meta.url), 'utf8');
    expect(source).toMatch(/const managementScope = managementAccountScope\(accountId\)/);
    expect(source).toMatch(/managementScope\.useLocalAccountRecords\s*\?\s*readGeneratedAccountStore\(\)\s*:\s*\{\}/);
    expect(source).toMatch(/managementScope\.useLocalAccountRecords\s*\?\s*loadPartyAccessLinkStore\(\)\s*:\s*\{\}/);
    expect(source).toMatch(/if \(managementScope\.persistLocalAccountState && syncedPartyAccess\.changed\)/);
    expect(source).toMatch(/managementScope\.useLocalAccountRecords\s*\?\s*mergeGeneratedAccountsIntoManagement/);
    expect(source).toMatch(/managementScope\.useLocalAccountRecords\s*\?\s*mergeArchivedAccountsIntoManagement/);
    expect(source).toMatch(/managementScope\.useLocalAccountRecords\s*\?\s*mergeManagementPaymentCards/);
    expect(source).toMatch(/managementScope\.useLocalAccountRecords\s*\?\s*applyManagementHiddenAccounts/);
  });
});
