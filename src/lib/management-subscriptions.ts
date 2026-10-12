import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

/** A cancellation confirms future billing stopped; it does not undo a paid period. */
export interface ManagementSubscription {
  serviceType: string;
  accountEmail: string;
  status: 'cancelled';
  confirmedAt: string;
  accessUntil: string | null;
  monthlyAmount: number;
  newlyCancelled: boolean;
  billingOwnerKey: string | null;
  note: string;
  updatedAt: string;
}
export type ManagementSubscriptionStore = Record<string, ManagementSubscription>;
const SERVICES = new Set(['넷플릭스', '디즈니플러스', '티빙', '웨이브']);
const DEFAULT_PATH = '/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data/management-subscriptions.json';
const storePath = () => process.env.MANAGEMENT_SUBSCRIPTIONS_PATH || DEFAULT_PATH;
export const managementSubscriptionKey = (service: string, account: string) => `${service.trim()}:${account.trim().toLowerCase()}`;

function dateOnly(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new Error('invalid date');
  return value;
}

export function normalizeManagementSubscription(input: Record<string, unknown>, now = new Date().toISOString()): ManagementSubscription {
  const serviceType = String(input.serviceType || '').trim();
  const accountEmail = String(input.accountEmail || '').trim().toLowerCase();
  if (!SERVICES.has(serviceType) || !accountEmail || accountEmail === '(직접전달)' || accountEmail.length > 300) throw new Error('invalid service/account');
  if (input.status !== 'cancelled') throw new Error('invalid subscription status');
  if (!Number.isSafeInteger(input.monthlyAmount) || Number(input.monthlyAmount) < 0) throw new Error('invalid monthly amount');
  if (typeof input.newlyCancelled !== 'boolean') throw new Error('newlyCancelled required');
  const billingOwnerKey = input.billingOwnerKey == null ? null : String(input.billingOwnerKey).trim();
  if (billingOwnerKey && (input.monthlyAmount !== 0 || input.newlyCancelled !== false)) throw new Error('linked account must not duplicate savings');
  return {
    serviceType, accountEmail, status: 'cancelled', confirmedAt: dateOnly(input.confirmedAt),
    accessUntil: input.accessUntil == null ? null : dateOnly(input.accessUntil),
    monthlyAmount: Number(input.monthlyAmount), newlyCancelled: input.newlyCancelled,
    billingOwnerKey, note: String(input.note || '').slice(0, 500), updatedAt: now,
  };
}

export function loadManagementSubscriptions(): ManagementSubscriptionStore {
  let raw: string;
  try { raw = readFileSync(storePath(), 'utf8'); }
  catch (error: any) { if (error.code === 'ENOENT') return {}; throw error; }
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid subscription store');
  const result: ManagementSubscriptionStore = {};
  for (const item of Object.values(parsed)) {
    const row = normalizeManagementSubscription(item as Record<string, unknown>, String((item as ManagementSubscription).updatedAt));
    result[managementSubscriptionKey(row.serviceType, row.accountEmail)] = row;
  }
  return result;
}

export function upsertManagementSubscription(input: Record<string, unknown>): ManagementSubscription {
  const row = normalizeManagementSubscription(input);
  const store = loadManagementSubscriptions();
  store[managementSubscriptionKey(row.serviceType, row.accountEmail)] = row;
  const path = storePath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(store, null, 2), { mode: 0o600 });
  renameSync(temp, path);
  return row;
}
