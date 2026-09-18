export type ManagementGraytagAccountId = 'primary' | 'youtube-invite-sales';

export interface ManagementAccountScope {
  useLocalAccountRecords: boolean;
  persistLocalAccountState: boolean;
}

/**
 * Generated accounts, archived access links, checklists, payment cards and hidden-account
 * preferences predate multi-account support and belong to the primary GrayTag account.
 * Never merge or mutate them while browsing the dedicated YouTube sales account.
 */
export function managementAccountScope(accountId: ManagementGraytagAccountId): ManagementAccountScope {
  const primary = accountId === 'primary';
  return {
    useLocalAccountRecords: primary,
    persistLocalAccountState: primary,
  };
}
