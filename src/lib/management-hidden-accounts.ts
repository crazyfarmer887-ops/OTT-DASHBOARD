import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

export interface ManagementHiddenAccount {
  serviceType: string;
  accountEmail: string;
  reason?: string;
  hiddenAt?: string;
  updatedAt?: string;
}

export interface ManagementHiddenAccountStore {
  accounts: ManagementHiddenAccount[];
}

const DEFAULT_MANAGEMENT_HIDDEN_ACCOUNTS_PATH = '/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data/management-hidden-accounts.json';

export function managementHiddenAccountsPath(): string {
  return process.env.MANAGEMENT_HIDDEN_ACCOUNTS_PATH || DEFAULT_MANAGEMENT_HIDDEN_ACCOUNTS_PATH;
}

export function normalizeManagementHiddenService(value: string): string {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '');
}

export function normalizeManagementHiddenAccount(value: string): string {
  return String(value || '').trim().toLowerCase();
}

function normalizeHiddenAccountItem(item: Partial<ManagementHiddenAccount>): ManagementHiddenAccount | null {
  const serviceType = String(item.serviceType || '').trim();
  const accountEmail = normalizeManagementHiddenAccount(String(item.accountEmail || ''));
  if (!serviceType || !accountEmail) return null;
  return {
    serviceType,
    accountEmail,
    ...(item.reason ? { reason: String(item.reason).slice(0, 300) } : {}),
    ...(item.hiddenAt ? { hiddenAt: String(item.hiddenAt).slice(0, 80) } : {}),
    ...(item.updatedAt ? { updatedAt: String(item.updatedAt).slice(0, 80) } : {}),
  };
}

export function loadManagementHiddenAccounts(): ManagementHiddenAccount[] {
  try {
    const path = managementHiddenAccountsPath();
    if (!existsSync(path)) return [];
    const parsed = JSON.parse(readFileSync(path, 'utf-8'));
    const items = Array.isArray(parsed?.accounts) ? parsed.accounts : Array.isArray(parsed) ? parsed : [];
    return items.map(normalizeHiddenAccountItem).filter(Boolean) as ManagementHiddenAccount[];
  } catch {
    return [];
  }
}

export function saveManagementHiddenAccounts(accounts: ManagementHiddenAccount[]): ManagementHiddenAccountStore {
  const normalized: ManagementHiddenAccount[] = [];
  const seen = new Set<string>();
  for (const raw of accounts) {
    const item = normalizeHiddenAccountItem(raw);
    if (!item) continue;
    const key = `${normalizeManagementHiddenService(item.serviceType)}:${normalizeManagementHiddenAccount(item.accountEmail)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(item);
  }
  const path = managementHiddenAccountsPath();
  const dir = path.replace(/\/[^\/]+$/, '');
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  const store = { accounts: normalized };
  writeFileSync(path, JSON.stringify(store, null, 2), 'utf-8');
  return store;
}

export function isManagementAccountHidden(
  hiddenAccounts: ManagementHiddenAccount[],
  serviceType: string,
  accountEmail: string,
): boolean {
  const service = normalizeManagementHiddenService(serviceType);
  const email = normalizeManagementHiddenAccount(accountEmail);
  if (!service || !email) return false;
  return hiddenAccounts.some(item => (
    normalizeManagementHiddenService(item.serviceType) === service &&
    normalizeManagementHiddenAccount(item.accountEmail) === email
  ));
}

export function hideManagementAccount(input: Pick<ManagementHiddenAccount, 'serviceType' | 'accountEmail'> & Partial<ManagementHiddenAccount>, now = new Date().toISOString()): ManagementHiddenAccountStore {
  const current = loadManagementHiddenAccounts();
  const serviceType = String(input.serviceType || '').trim();
  const accountEmail = normalizeManagementHiddenAccount(String(input.accountEmail || ''));
  if (!serviceType || !accountEmail) return saveManagementHiddenAccounts(current);
  const nextItem: ManagementHiddenAccount = {
    serviceType,
    accountEmail,
    ...(input.reason ? { reason: String(input.reason).slice(0, 300) } : {}),
    hiddenAt: input.hiddenAt || now,
    updatedAt: now,
  };
  const remaining = current.filter(item => !isManagementAccountHidden([item], serviceType, accountEmail));
  return saveManagementHiddenAccounts([...remaining, nextItem]);
}

export function unhideManagementAccount(input: Pick<ManagementHiddenAccount, 'serviceType' | 'accountEmail'>): ManagementHiddenAccountStore {
  const current = loadManagementHiddenAccounts();
  const serviceType = String(input.serviceType || '').trim();
  const accountEmail = normalizeManagementHiddenAccount(String(input.accountEmail || ''));
  return saveManagementHiddenAccounts(current.filter(item => !isManagementAccountHidden([item], serviceType, accountEmail)));
}

export function applyManagementHiddenAccounts<T extends { services?: any[]; onSaleByKeepAcct?: Record<string, any[]>; summary?: any }>(
  management: T,
  hiddenAccounts: ManagementHiddenAccount[] = loadManagementHiddenAccounts(),
): T {
  const hidden = hiddenAccounts.map(normalizeHiddenAccountItem).filter(Boolean) as ManagementHiddenAccount[];
  if (hidden.length === 0 || !Array.isArray(management.services)) return management;
  const services = management.services
    .map((svc: any) => {
      const accounts = (svc.accounts || []).filter((acct: any) => !isManagementAccountHidden(hidden, String(acct.serviceType || svc.serviceType || ''), String(acct.email || '')));
      return {
        ...svc,
        accounts,
        totalUsingMembers: accounts.reduce((sum: number, acct: any) => sum + Number(acct.usingCount || 0), 0),
        totalActiveMembers: accounts.reduce((sum: number, acct: any) => sum + Number(acct.activeCount || 0), 0),
        totalIncome: accounts.reduce((sum: number, acct: any) => sum + Number(acct.totalIncome || 0), 0),
        totalRealized: accounts.reduce((sum: number, acct: any) => sum + Number(acct.totalRealizedIncome || 0), 0),
      };
    })
    .filter((svc: any) => (svc.accounts || []).length > 0);
  const onSaleByKeepAcct: Record<string, any[]> = {};
  for (const [accountEmail, items] of Object.entries(management.onSaleByKeepAcct || {})) {
    const visibleItems = (Array.isArray(items) ? items : []).filter((item: any) => {
      const serviceType = String(item?.productType || item?.serviceType || '').trim();
      return !isManagementAccountHidden(hidden, serviceType, accountEmail);
    });
    if (visibleItems.length > 0) onSaleByKeepAcct[accountEmail] = visibleItems;
  }
  return {
    ...management,
    services,
    onSaleByKeepAcct,
    summary: management.summary ? {
      ...management.summary,
      totalUsingMembers: services.reduce((sum: number, svc: any) => sum + Number(svc.totalUsingMembers || 0), 0),
      totalActiveMembers: services.reduce((sum: number, svc: any) => sum + Number(svc.totalActiveMembers || 0), 0),
      totalIncome: services.reduce((sum: number, svc: any) => sum + Number(svc.totalIncome || 0), 0),
      totalRealized: services.reduce((sum: number, svc: any) => sum + Number(svc.totalRealized || 0), 0),
      totalAccounts: services.reduce((sum: number, svc: any) => sum + (svc.accounts || []).length, 0),
    } : management.summary,
  };
}
