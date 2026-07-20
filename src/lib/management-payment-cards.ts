import { chmodSync, closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';

export const MANAGEMENT_PAYMENT_CARD_TEXT_MAX_LENGTH = 60;

export interface ManagementPaymentCard {
  serviceType: string;
  accountEmail: string;
  label?: string;
  cardIssuer?: string;
  last4?: string;
  renewalDay?: number;
  updatedAt: string;
}

export type ManagementPaymentCardStore = Record<string, ManagementPaymentCard>;

const managementPaymentCardAccountKeys = new Set<string>();

const DEFAULT_MANAGEMENT_PAYMENT_CARDS_PATH = '/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data/management-payment-cards.json';

export function managementPaymentCardsPath(): string {
  return process.env.MANAGEMENT_PAYMENT_CARDS_PATH || DEFAULT_MANAGEMENT_PAYMENT_CARDS_PATH;
}

export function normalizeManagementPaymentCardService(value: unknown): string {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '');
}

export function isNetflixManagementPaymentCardService(value: unknown): boolean {
  const normalized = normalizeManagementPaymentCardService(value);
  return normalized === '넷플릭스' || normalized === 'netflix';
}

export function normalizeManagementPaymentCardAccount(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

export function managementPaymentCardKey(serviceType: unknown, accountEmail: unknown): string {
  return `${normalizeManagementPaymentCardService(serviceType)}:${normalizeManagementPaymentCardAccount(accountEmail)}`;
}

export function replaceManagementPaymentCardAccountKeys(management: { services?: Array<{ serviceType?: string; accounts?: any[] }> }): Set<string> {
  const next = new Set<string>();
  for (const service of management?.services || []) {
    for (const account of service.accounts || []) {
      const key = managementPaymentCardKey(account?.serviceType || service.serviceType, account?.email);
      if (!key.startsWith(':') && !key.endsWith(':')) next.add(key);
    }
  }
  managementPaymentCardAccountKeys.clear();
  for (const key of next) managementPaymentCardAccountKeys.add(key);
  return new Set(managementPaymentCardAccountKeys);
}

export function isManagementPaymentCardAccountKeyKnown(
  serviceType: unknown,
  accountEmail: unknown,
  additionalAccounts: Array<{ serviceType?: string; accountEmail?: string }> = [],
): boolean {
  const requestedKey = managementPaymentCardKey(serviceType, accountEmail);
  if (managementPaymentCardAccountKeys.has(requestedKey)) return true;
  return additionalAccounts.some(account => managementPaymentCardKey(account.serviceType, account.accountEmail) === requestedKey);
}

function normalizeLimitedText(value: unknown, field: 'label' | 'cardIssuer'): string | undefined {
  const normalized = String(value || '').trim().replace(/\s+/g, ' ');
  if (!normalized) return undefined;
  if (normalized.length > MANAGEMENT_PAYMENT_CARD_TEXT_MAX_LENGTH) {
    throw new Error(`${field} must be ${MANAGEMENT_PAYMENT_CARD_TEXT_MAX_LENGTH} characters or fewer`);
  }
  return normalized;
}

export function normalizeManagementPaymentCardInput(input: Record<string, unknown>, now = new Date().toISOString()): ManagementPaymentCard {
  const serviceType = String(input?.serviceType || '').trim();
  const accountEmail = normalizeManagementPaymentCardAccount(input?.accountEmail);
  if (!normalizeManagementPaymentCardService(serviceType) || !accountEmail) throw new Error('serviceType/accountEmail required');

  const label = normalizeLimitedText(input?.label, 'label');
  const cardIssuer = normalizeLimitedText(input?.cardIssuer, 'cardIssuer');
  const rawLast4 = String(input?.last4 || '').trim();
  if (rawLast4 && !/^\d{4}$/.test(rawLast4)) throw new Error('last4 must be exactly 4 digits');
  const hasRenewalDay = input?.renewalDay !== undefined && input?.renewalDay !== null && input?.renewalDay !== '';
  let renewalDay: number | undefined;
  if (hasRenewalDay) {
    if (!Number.isInteger(input.renewalDay) || Number(input.renewalDay) < 1 || Number(input.renewalDay) > 31) {
      throw new Error('renewalDay must be an integer from 1 through 31');
    }
    if (!isNetflixManagementPaymentCardService(serviceType)) {
      throw new Error('renewalDay is supported only for Netflix serviceType');
    }
    renewalDay = Number(input.renewalDay);
  }
  if (!label && !cardIssuer && !rawLast4 && renewalDay === undefined) {
    throw new Error('at least one of label/cardIssuer/last4/renewalDay is required');
  }

  return {
    serviceType,
    accountEmail,
    ...(label ? { label } : {}),
    ...(cardIssuer ? { cardIssuer } : {}),
    ...(rawLast4 ? { last4: rawLast4 } : {}),
    ...(renewalDay !== undefined ? { renewalDay } : {}),
    updatedAt: String(now),
  };
}

function normalizeStoredCard(value: unknown): ManagementPaymentCard | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  try {
    const raw = value as Record<string, unknown>;
    return normalizeManagementPaymentCardInput(raw, String(raw.updatedAt || ''));
  } catch {
    return null;
  }
}

export function loadManagementPaymentCards(): ManagementPaymentCardStore {
  const path = managementPaymentCardsPath();
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error: any) {
    if (error?.code === 'ENOENT') return {};
    throw new Error(`Failed to read management payment-card store: ${error?.message || error}`);
  }

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch (error: any) {
    throw new Error(`Malformed management payment-card store JSON: ${error?.message || error}`);
  }
  const source = parsed?.cards !== undefined ? parsed.cards : parsed;
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new Error('Invalid management payment-card store shape');
  }
  const store: ManagementPaymentCardStore = {};
  for (const value of Object.values(source)) {
    const card = normalizeStoredCard(value);
    if (!card) throw new Error('Invalid management payment-card store entry');
    store[managementPaymentCardKey(card.serviceType, card.accountEmail)] = card;
  }
  return store;
}

export function saveManagementPaymentCards(store: ManagementPaymentCardStore): ManagementPaymentCardStore {
  const normalized: ManagementPaymentCardStore = {};
  for (const value of Object.values(store || {})) {
    const card = normalizeStoredCard(value);
    if (card) normalized[managementPaymentCardKey(card.serviceType, card.accountEmail)] = card;
  }

  const path = managementPaymentCardsPath();
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tempPath = join(dir, `.${basename(path)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
  let fd: number | undefined;
  try {
    fd = openSync(tempPath, 'wx', 0o600);
    writeFileSync(fd, JSON.stringify({ cards: normalized }, null, 2), 'utf8');
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(tempPath, path);
    chmodSync(path, 0o600);
  } catch (error) {
    if (fd !== undefined) closeSync(fd);
    try { unlinkSync(tempPath); } catch { /* temp may already have been renamed */ }
    throw error;
  }
  return normalized;
}

export function upsertManagementPaymentCard(input: Record<string, unknown>, now = new Date().toISOString()): ManagementPaymentCard {
  const card = normalizeManagementPaymentCardInput(input, now);
  const store = loadManagementPaymentCards();
  store[managementPaymentCardKey(card.serviceType, card.accountEmail)] = card;
  saveManagementPaymentCards(store);
  return card;
}

export function deleteManagementPaymentCard(input: Pick<ManagementPaymentCard, 'serviceType' | 'accountEmail'>): ManagementPaymentCardStore {
  const store = loadManagementPaymentCards();
  delete store[managementPaymentCardKey(input.serviceType, input.accountEmail)];
  return saveManagementPaymentCards(store);
}

export function mergeManagementPaymentCards<T extends { services?: Array<{ serviceType?: string; accounts?: any[] }> }>(management: T, cards = loadManagementPaymentCards()): T {
  return {
    ...management,
    services: (management.services || []).map((service) => ({
      ...service,
      accounts: (service.accounts || []).map((account) => {
        const paymentCard = cards[managementPaymentCardKey(account.serviceType || service.serviceType, account.email)];
        return paymentCard ? { ...account, paymentCard: { ...paymentCard } } : { ...account };
      }),
    })),
  } as T;
}
