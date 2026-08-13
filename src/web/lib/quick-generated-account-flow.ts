export interface QuickGeneratedAccount {
  id: string;
  serviceType: string;
  email: string;
  password: string;
  pin: string;
  emailId: number | string;
  paymentStatus: 'pending' | 'paid';
  paidAt?: string | null;
  createdAt?: string;
  memo?: string;
  source?: 'account-generator';
}

export interface QuickPostManagementAccount {
  serviceType: string;
  email: string;
  generatedAccount?: {
    id?: string;
    linkedServiceType?: string;
    sourceServiceType?: string;
  };
}

export interface QuickPostManagementService<T extends QuickPostManagementAccount = QuickPostManagementAccount> {
  serviceType: string;
  accounts: T[];
}

export function buildQuickAccountClipboard(account: QuickGeneratedAccount): string {
  return `ID: ${account.email}\nPW: ${account.password}\n이메일 PIN: ${account.pin}`;
}

/**
 * Resolve the exact account-card action target so the quick flow reuses the current
 * "N자리 게시글 작성" feature instead of navigating to the legacy write page.
 */
export function findQuickPostAccount<T extends QuickPostManagementAccount>(
  services: QuickPostManagementService<T>[],
  generatedAccountId: string,
  sourceServiceType: string,
): T | null {
  const rows = services.flatMap(service => service.accounts)
    .filter(account => String(account.generatedAccount?.id || '') === generatedAccountId);
  if (rows.length === 0) return null;
  if (sourceServiceType === '티빙+웨이브') {
    return rows.find(account => account.generatedAccount?.linkedServiceType === '웨이브' || account.serviceType === '웨이브') || null;
  }
  return rows.find(account => account.serviceType === sourceServiceType || account.generatedAccount?.linkedServiceType === sourceServiceType)
    || rows[0]
    || null;
}
