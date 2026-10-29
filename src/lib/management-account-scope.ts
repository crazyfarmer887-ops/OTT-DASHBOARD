import type { GraytagAccountId } from './graytag-account-session';

export type ManagementGraytagAccountId = GraytagAccountId;

export interface ManagementAccountScope {
  useLocalAccountRecords: boolean;
  persistLocalAccountState: boolean;
}

/**
 * Generated accounts, archived access links, checklists, payment cards and hidden-account
 * preferences predate multi-account support and belong to the primary GrayTag account.
 * Never merge or mutate them while browsing either dedicated account.
 */
export function managementAccountScope(accountId: ManagementGraytagAccountId): ManagementAccountScope {
  const primary = accountId === 'primary';
  return {
    useLocalAccountRecords: primary,
    persistLocalAccountState: primary,
  };
}
