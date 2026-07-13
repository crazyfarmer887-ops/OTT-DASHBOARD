import { isGraytagAccessNoticeCredential } from './graytag-fill';
import type { PartyAccessLinkRecord, PartyAccessLinkStore } from './party-access';
import type { PartyMaintenanceChecklistState, PartyMaintenanceChecklistStore } from './party-maintenance-checklist';

interface ManagementShape {
  services: Array<{ serviceType: string; accounts: any[]; totalUsingMembers: number; totalActiveMembers: number; totalIncome: number; totalRealized: number }>;
  summary: { totalAccounts: number; [key: string]: unknown };
  [key: string]: unknown;
}

const normalize = (value: unknown) => String(value || '').trim();
const accountKey = (serviceType: unknown, email: unknown) => `${normalize(serviceType)}:${normalize(email).toLowerCase()}`;

function latestRecordsByAccount(store: PartyAccessLinkStore): Map<string, PartyAccessLinkRecord> {
  const latest = new Map<string, PartyAccessLinkRecord>();
  for (const record of Object.values(store || {})) {
    const serviceType = normalize(record?.serviceType);
    const email = normalize(record?.accountEmail);
    if (!serviceType || !email || isGraytagAccessNoticeCredential(email)) continue;
    const key = accountKey(serviceType, email);
    const previous = latest.get(key);
    if (!previous) {
      latest.set(key, { ...record });
      continue;
    }
    const recordIsNewer = normalize(record.createdAt).localeCompare(normalize(previous.createdAt)) > 0;
    const newest = recordIsNewer ? record : previous;
    const older = recordIsNewer ? previous : record;
    latest.set(key, {
      ...newest,
      fallbackPassword: normalize(newest.fallbackPassword) || normalize(older.fallbackPassword),
      fallbackPin: normalize(newest.fallbackPin) || normalize(older.fallbackPin),
      emailAccessUrl: normalize(newest.emailAccessUrl) || normalize(older.emailAccessUrl),
    });
  }
  return latest;
}

function checklistForAccount(store: PartyMaintenanceChecklistStore, serviceType: string, email: string): PartyMaintenanceChecklistState | undefined {
  const direct = store[`${serviceType}:${email}`];
  if (direct) return direct;
  return Object.values(store || {}).find((state) => {
    const rawKey = String(state?.key || '');
    const separator = rawKey.indexOf(':');
    if (separator < 0) return false;
    return accountKey(serviceType, email) === accountKey(rawKey.slice(0, separator), rawKey.slice(separator + 1));
  });
}

export function mergeArchivedAccountsIntoManagement<T extends ManagementShape>(management: T, accessStore: PartyAccessLinkStore, checklistStore: PartyMaintenanceChecklistStore): T {
  const next = {
    ...management,
    services: management.services.map((service) => ({ ...service, accounts: service.accounts.map((account) => ({ ...account })) })),
    summary: { ...management.summary },
  } as T;
  const latest = latestRecordsByAccount(accessStore);
  const existing = new Map<string, any>();
  for (const service of next.services) for (const account of service.accounts) existing.set(accountKey(account.serviceType || service.serviceType, account.email), account);

  let added = 0;
  for (const [key, record] of latest) {
    const serviceType = normalize(record.serviceType);
    const email = normalize(record.accountEmail);
    const checklist = checklistForAccount(checklistStore, serviceType, email);
    const password = normalize(checklist?.changedPassword) || normalize(record.fallbackPassword);
    const id = normalize(checklist?.changedAccountEmail) || email;
    const pin = normalize(checklist?.generatedPin) || normalize(record.fallbackPin);
    let account = existing.get(key);
    if (!account) {
      account = {
        email, serviceType, members: [], usingCount: 0, activeCount: 0, totalSlots: 6,
        totalIncome: 0, totalRealizedIncome: 0, expiryDate: record.member?.endDateTime || null,
      };
      let service = next.services.find((item) => item.serviceType === serviceType);
      if (!service) {
        service = { serviceType, accounts: [], totalUsingMembers: 0, totalActiveMembers: 0, totalIncome: 0, totalRealized: 0 };
        next.services.push(service);
      }
      service.accounts.push(account);
      existing.set(key, account);
      added += 1;
    }
    if (Number(account.usingCount || 0) === 0 && Number(account.activeCount || 0) === 0 && !account.generatedAccount) {
      account.archivedAccount = true;
      account.credentialSource = checklist && (checklist.changedAccountEmail || checklist.changedPassword || checklist.generatedPin) ? 'maintenance' : 'party-access-history';
      account.archivedCredential = { id, password, pin };
      if (password) account.keepPasswd = password;
      if (!account.expiryDate && record.member?.endDateTime) account.expiryDate = record.member.endDateTime;
    }
  }
  next.summary.totalAccounts = Number(next.summary.totalAccounts || 0) + added;
  return next;
}
