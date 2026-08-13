export type FilterMode = 'unpaid' | 'paid';

export interface ManagementAccountOrderItem {
  email: string;
  serviceType: string;
  expiryDate: string | null;
  generatedAccount?: { paymentStatus: 'pending' | 'paid' };
  paymentCard?: {
    label?: string;
    cardIssuer?: string;
    last4?: string;
    renewalDay?: number;
  };
}

export function parseManagementExpiryDate(value: string | null | undefined): number | null {
  const input = String(value ?? '').trim();
  if (!input) return null;

  const dateOnly = input.match(/^(\d{4})\s*[.-]\s*(\d{1,2})\s*[.-]\s*(\d{1,2})\.?$/);
  if (dateOnly) {
    const [, yearText, monthText, dayText] = dateOnly;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const timestamp = Date.UTC(year, month - 1, day);
    const parsed = new Date(timestamp);
    return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
      ? timestamp
      : null;
  }

  const timestamp = Date.parse(input);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function getVisibleManagementAccounts<T extends ManagementAccountOrderItem>(
  accounts: readonly T[],
  filter: FilterMode,
): T[] {
  return accounts
    .map((account, index) => ({ account, index }))
    .filter(({ account }) => account.email.trim() !== '(직접전달)')
    .filter(({ account }) => isPaidManagementAccount(account) === (filter === 'paid'))
    .sort((left, right) => {
      const leftExpiry = parseManagementExpiryDate(left.account.expiryDate);
      const rightExpiry = parseManagementExpiryDate(right.account.expiryDate);
      if (leftExpiry !== null || rightExpiry !== null) {
        if (leftExpiry === null) return 1;
        if (rightExpiry === null) return -1;
        if (leftExpiry !== rightExpiry) return leftExpiry - rightExpiry;
      }
      const serviceOrder = left.account.serviceType.localeCompare(right.account.serviceType, 'ko');
      if (serviceOrder !== 0) return serviceOrder;
      const emailOrder = left.account.email.localeCompare(right.account.email, 'en');
      return emailOrder !== 0 ? emailOrder : left.index - right.index;
    })
    .map(({ account }) => account);
}

export function isPaidManagementAccount(account: ManagementAccountOrderItem): boolean {
  if (account.generatedAccount) return account.generatedAccount.paymentStatus === 'paid';
  const card = account.paymentCard;
  if (!card) return false;
  return [card.label, card.cardIssuer, card.last4].some((value) => String(value ?? '').trim().length > 0)
    || (typeof card.renewalDay === 'number' && Number.isFinite(card.renewalDay) && card.renewalDay > 0);
}
