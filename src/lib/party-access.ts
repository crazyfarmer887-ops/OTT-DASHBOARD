import { createHash } from 'node:crypto';
import type { GeneratedAccountStore } from './generated-accounts';
import { isGraytagAccessNoticeCredential } from './graytag-fill';
import type { PartyMaintenanceChecklistStore } from './party-maintenance-checklist';
import type { ProfileAssignment } from './profile-nickname';
import { DOUBLE_PASS_LABEL, TVING_SERVICE, WAVVE_SERVICE, resolveDoublePassBundleNo } from './tving-wavve-bundle';
export { buildPartyAccessDeliveryTemplate } from './party-access-template';

export type PartyAccessMemberKind = 'graytag' | 'manual';

export interface PartyAccessMemberRef {
  kind: PartyAccessMemberKind;
  memberId: string;
  memberName: string;
  status: string;
  statusName?: string;
  startDateTime?: string | null;
  endDateTime?: string | null;
}

export interface PartyAccessLinkRecord {
  id: string;
  shareToken?: string;
  tokenHash: string;
  serviceType: string;
  accountEmail: string;
  fallbackPassword: string;
  fallbackPin: string;
  profileName: string;
  emailAccessUrl: string;
  member: PartyAccessMemberRef;
  createdAt: string;
  revokedAt: string | null;
  lastViewedAt: string | null;
  viewCount: number;
}

export type PartyAccessLinkStore = Record<string, PartyAccessLinkRecord>;

export interface PartyAccessCredentials {
  id: string;
  password: string;
  pin: string;
  updatedAt: string;
}

export interface PartyAccessProfileStatus {
  profileName: string;
  memberName: string;
  status: string;
  statusName: string;
  startDateTime: string | null;
  endDateTime: string | null;
  isCurrentMember: boolean;
}

export interface PartyAccessDeliverySnapshot {
  serviceType: string;
  accountEmail: string;
  memberKind: PartyAccessMemberKind;
  memberId: string;
  memberName: string;
  password: string;
  pin: string;
  emailAccessUrl: string;
  profileName: string;
  deliveredAt: string;
  revokedAt: string | null;
}

export interface PartyAccessMemberStatusLike {
  kind?: PartyAccessMemberKind;
  memberId: string;
  memberName?: string | null;
  status?: string | null;
  statusName?: string | null;
  startDateTime?: string | null;
  endDateTime?: string | null;
}

const ACTIVE_PARTY_MEMBER_STATUS_CODES = new Set([
  'active',
  'current',
  'deliveredandcheckprepaid',
  'using',
  'usingnearexpiration',
]);

const ACTIVE_PARTY_MEMBER_STATUS_NAMES = [
  '계정확인중',
  '사용중',
  '이용중',
  '종료임박',
];

const MARKETPLACE_OR_INTERNAL_STATUS_CODES = new Set([
  'onsale',
  'sale',
  'selling',
  'waiting',
]);

export function normalizePartyAccessToken(token: string): string {
  return String(token || '').trim().replace(/[^A-Za-z0-9._~-]/g, '');
}

export function partyAccessTokenHash(token: string): string {
  return createHash('sha256').update(normalizePartyAccessToken(token)).digest('hex');
}

export function extractPartyAccessTokensFromText(text: string): string[] {
  const tokens: string[] = [];
  const seen = new Set<string>();
  const pattern = /https?:\/\/email-verify\.(?:one|xyz)\/(?:dashboard\/)?access\/([^\s<>'\"]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(String(text || ''))) !== null) {
    const token = normalizePartyAccessToken(String(match[1] || '').replace(/[),.;:!?，。、]+$/g, ''));
    if (!token || seen.has(token)) continue;
    seen.add(token);
    tokens.push(token);
  }
  return tokens;
}

function normalizeKeyPart(value: string): string {
  return String(value || '').trim();
}

export function isManagementSyntheticPartyAccessRecord(
  record: Pick<PartyAccessLinkRecord, 'id' | 'shareToken'> | null | undefined,
): boolean {
  if (!record || normalizeKeyPart(String(record.shareToken || ''))) return false;
  return normalizeKeyPart(record.id).endsWith(':management');
}

export function normalizeEmailVerifyUrl(value: string): string {
  return normalizeKeyPart(value)
    .replace(/^http:\/\/email-verify\.xyz(?=\/|$)/i, 'https://email-verify.one')
    .replace(/^https?:\/\/email-verify\.xyz(?=\/|$)/i, 'https://email-verify.one')
    .replace(/^http:\/\/email-verify\.one(?=\/|$)/i, 'https://email-verify.one');
}

export function isWavvePartyAccessService(serviceType: string): boolean {
  const value = normalizeKeyPart(serviceType).toLowerCase().replace(/\s+/g, '');
  return value === WAVVE_SERVICE || value === 'wavve' || value === '웨이브';
}

export function partyAccessAccountKey(serviceType: string, accountEmail: string): string {
  return `${normalizeKeyPart(serviceType)}:${normalizeKeyPart(accountEmail)}`;
}

export function partyAccessMemberHistoryKey(serviceType: string, accountEmail: string, kind: PartyAccessMemberKind, memberId: string): string {
  return `${partyAccessAccountKey(serviceType, accountEmail)}:${kind}:${normalizeKeyPart(memberId)}`;
}

function parseDateEndOfDay(value: string | null | undefined): Date | null {
  if (!value) return null;
  const raw = String(value).trim();
  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})T/);
  if (compact) return new Date(`${compact[1]}-${compact[2]}-${compact[3]}T23:59:59.999Z`);
  const short = raw.replace(/\s/g, '').match(/^(\d{2})\.(\d{1,2})\.(\d{1,2})/);
  if (short) {
    const yy = Number(short[1]);
    const year = yy < 50 ? 2000 + yy : 1900 + yy;
    return new Date(`${year}-${short[2].padStart(2, '0')}-${short[3].padStart(2, '0')}T23:59:59.999Z`);
  }
  const m = raw.match(/(\d{4})[-./\s]+(\d{1,2})[-./\s]+(\d{1,2})/);
  if (m) return new Date(`${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}T23:59:59.999Z`);
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function compactStatusText(value: string | null | undefined): string {
  return String(value || '').trim().replace(/\s+/g, '').toLowerCase();
}

function isEndedStatus(status: string, statusName = ''): boolean {
  const code = compactStatusText(status);
  const name = compactStatusText(statusName);
  const combined = `${code} ${name}`;

  if (/^cancel/.test(code) || /^finished/.test(code)) return true;
  if (/(normalfinished|finished|cancelled|canceled|deleted|expired|withdrawn|withdrawal|left|leave|ended|terminated|refund)/.test(code)) return true;
  if (/(거래취소|취소|만료|삭제|탈퇴|이탈|나감|나간|환불|거래완료|중도종료)/.test(combined)) return true;
  if (name === '종료' || name === '완료') return true;
  return false;
}


function isCurrentPartyAccessProfileStatus(status: string, statusName = ''): boolean {
  const code = compactStatusText(status);
  const name = compactStatusText(statusName);
  if (isEndedStatus(status, statusName)) return false;
  if (MARKETPLACE_OR_INTERNAL_STATUS_CODES.has(code)) return false;
  if (!code && !name) return true;
  if (ACTIVE_PARTY_MEMBER_STATUS_CODES.has(code)) return true;
  return ACTIVE_PARTY_MEMBER_STATUS_NAMES.some((activeName) => name.includes(compactStatusText(activeName)));
}

function partyAccessProfileLimit(serviceType: string): number {
  const service = normalizeKeyPart(serviceType).toLowerCase().replace(/\s+/g, '');
  if (service === '디즈니플러스' || service === 'disney+' || service === 'disneyplus') return 6;
  if (service === '넷플릭스' || service === 'netflix') return 5;
  if (service === '티빙' || service === 'tving' || service === '왓챠플레이' || service === 'watcha' || service === '웨이브' || service === 'wavve') return 4;
  return 0;
}

export function createPartyAccessLinkRecord(input: {
  token: string;
  now?: string;
  serviceType: string;
  accountEmail: string;
  fallbackPassword?: string;
  fallbackPin?: string;
  profileName?: string;
  emailAccessUrl?: string;
  member: PartyAccessMemberRef;
}): PartyAccessLinkRecord {
  const now = input.now || new Date().toISOString();
  const tokenHash = partyAccessTokenHash(input.token);
  const memberId = normalizeKeyPart(input.member.memberId);
  return {
    id: `${partyAccessAccountKey(input.serviceType, input.accountEmail)}:${input.member.kind}:${memberId}:${tokenHash.slice(0, 12)}`,
    shareToken: normalizePartyAccessToken(input.token),
    tokenHash,
    serviceType: normalizeKeyPart(input.serviceType),
    accountEmail: normalizeKeyPart(input.accountEmail),
    fallbackPassword: String(input.fallbackPassword || '').slice(0, 300),
    fallbackPin: String(input.fallbackPin || '').replace(/\D/g, '').slice(0, 6),
    profileName: normalizeKeyPart(input.profileName || input.member.memberName || '(미확인)').slice(0, 40),
    emailAccessUrl: normalizeEmailVerifyUrl(normalizeKeyPart(input.emailAccessUrl || '')).slice(0, 500),
    member: {
      kind: input.member.kind,
      memberId,
      memberName: normalizeKeyPart(input.member.memberName || '(미확인)'),
      status: normalizeKeyPart(input.member.status),
      statusName: normalizeKeyPart(input.member.statusName || input.member.status),
      startDateTime: input.member.startDateTime || null,
      endDateTime: input.member.endDateTime || null,
    },
    createdAt: now,
    revokedAt: null,
    lastViewedAt: null,
    viewCount: 0,
  };
}

export function isPartyAccessAllowed(record: PartyAccessLinkRecord, now = new Date().toISOString()): { allowed: boolean; reason: 'active' | 'revoked' | 'ended-status' | 'expired' | 'missing-record' } {
  if (!record) return { allowed: false, reason: 'missing-record' };
  const end = parseDateEndOfDay(record.member.endDateTime);
  const isExpiredByDate = Boolean(end && end.getTime() < new Date(now).getTime());
  if (isExpiredByDate) return { allowed: false, reason: 'expired' };

  // Buyer-facing access URLs must remain usable until the paid end date.
  // Graytag status/revokedAt can change because of internal cancellation/conflict flows,
  // but customers were already given this URL; only an actually expired endDate blocks it.
  return { allowed: true, reason: 'active' };
}

export function mergeRecoverablePartyAccessBackupStores(
  primary: PartyAccessLinkStore = {},
  backups: PartyAccessLinkStore[] = [],
  now = new Date().toISOString(),
): { store: PartyAccessLinkStore; recoveredCount: number } {
  const next: PartyAccessLinkStore = { ...(primary || {}) };
  let recoveredCount = 0;

  for (const backup of backups || []) {
    for (const [tokenHash, record] of Object.entries(backup || {})) {
      if (next[tokenHash]) continue;
      if (!record?.shareToken) continue;
      if (record.tokenHash !== tokenHash) continue;
      if (partyAccessTokenHash(record.shareToken) !== tokenHash) continue;
      if (!isPartyAccessAllowed(record, now).allowed) continue;
      next[tokenHash] = record;
      recoveredCount += 1;
    }
  }

  return { store: next, recoveredCount };
}

export function buildPartyAccessDeliverySnapshotByMember(
  store: PartyAccessLinkStore = {},
  options: { includeManagementSynthetic?: boolean } = {},
): Map<string, PartyAccessDeliverySnapshot> {
  const snapshots = new Map<string, PartyAccessDeliverySnapshot>();
  const records = Object.values(store || {})
    .filter((record) => record && record.member?.memberId)
    .filter((record) => options.includeManagementSynthetic !== false || !isManagementSyntheticPartyAccessRecord(record))
    .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
  for (const record of records) {
    const key = partyAccessMemberHistoryKey(record.serviceType, record.accountEmail, record.member.kind, record.member.memberId);
    snapshots.set(key, {
      serviceType: record.serviceType,
      accountEmail: record.accountEmail,
      memberKind: record.member.kind,
      memberId: record.member.memberId,
      memberName: record.member.memberName,
      password: normalizeKeyPart(record.fallbackPassword),
      pin: normalizeKeyPart(record.fallbackPin).replace(/\D/g, '').slice(0, 6),
      emailAccessUrl: normalizeKeyPart(record.emailAccessUrl),
      profileName: normalizeKeyPart(record.profileName),
      deliveredAt: normalizeKeyPart(record.createdAt),
      revokedAt: record.revokedAt || null,
    });
  }
  return snapshots;
}

export function resolvePartyAccessDeliverySnapshotByListing(
  snapshots: Map<string, PartyAccessDeliverySnapshot>,
  input: {
    serviceType: string;
    dealUsid?: string | null;
    productUsid?: string | null;
  },
): PartyAccessDeliverySnapshot | undefined {
  const serviceType = normalizeKeyPart(input.serviceType);
  const productUsid = normalizeKeyPart(String(input.productUsid || ''));
  const dealUsid = normalizeKeyPart(String(input.dealUsid || ''));
  const values = Array.from(snapshots.values())
    .filter((snapshot) => normalizeKeyPart(snapshot.serviceType) === serviceType)
    .filter((snapshot) => !snapshot.revokedAt)
    .sort((a, b) => String(b.deliveredAt || '').localeCompare(String(a.deliveredAt || '')));

  // 판매중(fill:productUsid) 링크가 실제 계정 매핑의 원천이다. Graytag 공개 ID가
  // "아래 메세지를 확인해주세요" 같은 안내 문구여도 /access 링크 기록으로 복원한다.
  // 같은 productUsid로 링크가 여러 번 만들어졌다면 취소되지 않은 최신 링크를 신뢰한다.
  if (productUsid) {
    const fillSnapshot = values.find((snapshot) => normalizeKeyPart(snapshot.memberId) === `fill:${productUsid}`);
    if (fillSnapshot) return fillSnapshot;
  }
  if (dealUsid) {
    return values.find((snapshot) => normalizeKeyPart(snapshot.memberId) === dealUsid);
  }
  return undefined;
}

export function resolvePartyAccessDeliverySnapshotForDeal(
  snapshots: Map<string, PartyAccessDeliverySnapshot>,
  input: {
    serviceType: string;
    accountEmail: string;
    dealUsid?: string | null;
    productUsid?: string | null;
  },
): PartyAccessDeliverySnapshot | undefined {
  const serviceType = normalizeKeyPart(input.serviceType);
  const accountEmail = normalizeKeyPart(input.accountEmail);
  const productUsid = normalizeKeyPart(String(input.productUsid || ''));
  const dealUsid = normalizeKeyPart(String(input.dealUsid || ''));

  // 판매중(fill:productUsid) 링크가 먼저 만들어지고, 구매 후 dealUsid가 새로 생긴다.
  // 이때 기존 fill 링크의 프로필명이 원래 자리 배정이므로 dealUsid 히스토리보다 우선한다.
  if (productUsid) {
    const fillSnapshot = snapshots.get(partyAccessMemberHistoryKey(serviceType, accountEmail, 'graytag', `fill:${productUsid}`));
    if (fillSnapshot && !fillSnapshot.revokedAt) return fillSnapshot;
  }
  if (dealUsid) {
    const dealSnapshot = snapshots.get(partyAccessMemberHistoryKey(serviceType, accountEmail, 'graytag', dealUsid));
    if (dealSnapshot && !dealSnapshot.revokedAt) return dealSnapshot;
  }
  return resolvePartyAccessDeliverySnapshotByListing(snapshots, { serviceType, dealUsid, productUsid });
}

export function syncPartyAccessStoreWithMembers(input: {
  store: PartyAccessLinkStore;
  members: PartyAccessMemberStatusLike[];
  now?: string;
}): { store: PartyAccessLinkStore; changed: boolean } {
  const now = input.now || new Date().toISOString();
  const statusByKey = new Map<string, PartyAccessMemberStatusLike>();
  for (const member of input.members || []) {
    const kind = member.kind === 'manual' ? 'manual' : 'graytag';
    const memberId = normalizeKeyPart(member.memberId);
    if (!memberId) continue;
    statusByKey.set(`${kind}:${memberId}`, member);
  }
  let changed = false;
  const next: PartyAccessLinkStore = { ...(input.store || {}) };
  for (const [tokenHash, record] of Object.entries(input.store || {})) {
    if (!record?.member?.memberId) continue;
    const status = statusByKey.get(`${record.member.kind}:${record.member.memberId}`);
    const syntheticManagementRecord = isManagementSyntheticPartyAccessRecord(record);
    if (!status) {
      if (syntheticManagementRecord && !record.revokedAt) {
        next[tokenHash] = { ...record, revokedAt: now };
        changed = true;
      }
      continue;
    }
    const updatedMember = {
      ...record.member,
      memberName: normalizeKeyPart(String(status.memberName ?? record.member.memberName)) || record.member.memberName,
      status: normalizeKeyPart(String(status.status ?? record.member.status)),
      statusName: normalizeKeyPart(String(status.statusName ?? status.status ?? record.member.statusName ?? record.member.status)),
      startDateTime: status.startDateTime !== undefined ? status.startDateTime || null : record.member.startDateTime || null,
      endDateTime: status.endDateTime !== undefined ? status.endDateTime || null : record.member.endDateTime || null,
    };
    const end = parseDateEndOfDay(updatedMember.endDateTime);
    const shouldRevoke = Boolean(end && end.getTime() < new Date(now).getTime()) && isEndedStatus(updatedMember.status, updatedMember.statusName);
    const shareTokenFillRecord = Boolean(record.shareToken) && normalizeKeyPart(record.member.memberId).startsWith('fill:');
    const effectiveMember = shareTokenFillRecord && shouldRevoke ? record.member : updatedMember;
    const updated: PartyAccessLinkRecord = {
      ...record,
      member: effectiveMember,
      // Live/current member data is authoritative for accidental stale revocations.
      // If Graytag now says the member is Using/current again, reopen the existing
      // share token instead of leaving the buyer's access URL permanently blocked.
      // Pre-sale fill links are seller-created listing memos. A cancelled/no-show
      // deal can share the same productUsid while the listing/link still needs to
      // stay usable for resend/repost until its own end date, so do not let ended
      // deal statuses overwrite or revoke share-token fill records.
      revokedAt: shouldRevoke ? (shareTokenFillRecord ? record.revokedAt : (record.revokedAt || now)) : null,
    };
    if (JSON.stringify(updated) !== JSON.stringify(record)) {
      next[tokenHash] = updated;
      changed = true;
    }
  }
  return { store: next, changed };
}

export function reconcileManagementSyntheticPartyAccessRoster(input: {
  store: PartyAccessLinkStore;
  accounts: Array<{
    serviceType: string;
    accountEmail: string;
    currentMemberIds: string[];
  }>;
  now?: string;
}): { store: PartyAccessLinkStore; changed: boolean } {
  const now = input.now || new Date().toISOString();
  const currentMemberIdsByAccount = new Map(
    (input.accounts || []).map((account) => [
      partyAccessAccountKey(account.serviceType, account.accountEmail),
      new Set((account.currentMemberIds || []).map(normalizeKeyPart).filter(Boolean)),
    ]),
  );
  const next: PartyAccessLinkStore = { ...(input.store || {}) };
  let changed = false;

  for (const [tokenHash, record] of Object.entries(input.store || {})) {
    if (!isManagementSyntheticPartyAccessRecord(record)) continue;
    const currentMemberIds = currentMemberIdsByAccount.get(partyAccessAccountKey(record.serviceType, record.accountEmail));
    if (!currentMemberIds) continue;
    const revokedAt = currentMemberIds.has(normalizeKeyPart(record.member.memberId)) ? null : (record.revokedAt || now);
    if (revokedAt === record.revokedAt) continue;
    next[tokenHash] = { ...record, revokedAt };
    changed = true;
  }

  return { store: next, changed };
}

function findGeneratedAccount(store: GeneratedAccountStore, serviceType: string, accountEmail: string) {
  const exactKey = partyAccessAccountKey(serviceType, accountEmail);
  const lowerEmail = normalizeKeyPart(accountEmail).toLowerCase();
  const normalizedService = normalizeKeyPart(serviceType);
  const exact = Object.values(store || {}).find((account) => {
    const accountAny = account as any;
    const accountService = normalizeKeyPart(accountAny.serviceType);
    const accountEmail = normalizeKeyPart(accountAny.email).toLowerCase();
    if (partyAccessAccountKey(accountAny.serviceType, accountAny.email) === exactKey) return true;
    if (accountEmail === lowerEmail && accountService === normalizedService) return true;
    if (accountEmail === lowerEmail && normalizeKeyPart(accountAny.sourceServiceType || '') === normalizedService) return true;
    if (accountEmail === lowerEmail && normalizedService === WAVVE_SERVICE && accountService === DOUBLE_PASS_LABEL) return true;
    return false;
  });
  if (exact) return exact;

  if (normalizedService !== TVING_SERVICE) return undefined;
  const tvingBundleNo = resolveDoublePassBundleNo({ serviceType: TVING_SERVICE, loginId: accountEmail });
  if (!tvingBundleNo) return undefined;
  return Object.values(store || {}).find((account) => {
    const accountAny = account as any;
    const accountService = normalizeKeyPart(accountAny.serviceType);
    if (accountService !== DOUBLE_PASS_LABEL && accountService !== WAVVE_SERVICE) return false;
    const wavveBundleNo = resolveDoublePassBundleNo({ serviceType: WAVVE_SERVICE, email: accountAny.email, accountId: accountAny.email });
    return wavveBundleNo === tvingBundleNo;
  });
}

function emailAccessUrlFromAliasId(aliasId: unknown): string {
  const value = normalizeKeyPart(String(aliasId ?? ''));
  return value ? `https://email-verify.one/email/mail/${encodeURIComponent(value)}` : '';
}

function findLatestSiblingWithValue(store: PartyAccessLinkStore, record: PartyAccessLinkRecord, field: 'fallbackPassword' | 'fallbackPin' | 'emailAccessUrl'): string {
  const key = partyAccessAccountKey(record.serviceType, record.accountEmail);
  return Object.values(store || {})
    .filter((item) => item && item.tokenHash !== record.tokenHash)
    .filter((item) => partyAccessAccountKey(item.serviceType, item.accountEmail) === key)
    .filter((item) => normalizeKeyPart(String((item as any)[field] || '')))
    .filter((item) => field !== 'fallbackPassword' || !isGraytagAccessNoticeCredential(String((item as any)[field] || '')))
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))[0]?.[field] || '';
}

function usablePartyAccessCredential(value: string | null | undefined): string {
  const trimmed = normalizeKeyPart(String(value || ''));
  return isGraytagAccessNoticeCredential(trimmed) ? '' : trimmed;
}

export function resolvePartyAccessEmailAccessUrl(
  record: PartyAccessLinkRecord,
  checklistStore: PartyMaintenanceChecklistStore = {},
  generatedStore: GeneratedAccountStore = {},
): string {
  if (isWavvePartyAccessService(record.serviceType)) return '';
  const key = partyAccessAccountKey(record.serviceType, record.accountEmail);
  const state = checklistStore[key];
  const generated = findGeneratedAccount(generatedStore, record.serviceType, record.accountEmail) as any;
  return normalizeEmailVerifyUrl(
    normalizeKeyPart(record.emailAccessUrl)
    || emailAccessUrlFromAliasId(state?.generatedPinAliasId)
    || emailAccessUrlFromAliasId(generated?.emailId)
  );
}

export function enrichPartyAccessRecordWithKnownCredentials(
  record: PartyAccessLinkRecord,
  store: PartyAccessLinkStore = {},
  checklistStore: PartyMaintenanceChecklistStore = {},
  generatedStore: GeneratedAccountStore = {},
): PartyAccessLinkRecord {
  const key = partyAccessAccountKey(record.serviceType, record.accountEmail);
  const state = checklistStore[key];
  const generated = findGeneratedAccount(generatedStore, record.serviceType, record.accountEmail) as any;
  const accountEmail = usablePartyAccessCredential(String(state?.changedAccountEmail || ''))
    || usablePartyAccessCredential(record.accountEmail);
  const fallbackPassword = usablePartyAccessCredential(String(state?.changedPassword || ''))
    || usablePartyAccessCredential(record.fallbackPassword)
    || findLatestSiblingWithValue(store, record, 'fallbackPassword')
    || normalizeKeyPart(String(generated?.password || ''));
  const fallbackPin = normalizeKeyPart(String(state?.generatedPin || '')).replace(/\D/g, '').slice(0, 6)
    || normalizeKeyPart(record.fallbackPin)
    || findLatestSiblingWithValue(store, record, 'fallbackPin')
    || normalizeKeyPart(String(generated?.pin || '')).replace(/\D/g, '').slice(0, 6);
  const emailAccessUrl = resolvePartyAccessEmailAccessUrl({
    ...record,
    emailAccessUrl: normalizeKeyPart(record.emailAccessUrl) || findLatestSiblingWithValue(store, record, 'emailAccessUrl'),
  }, checklistStore, generatedStore);
  if (accountEmail === record.accountEmail && fallbackPassword === record.fallbackPassword && fallbackPin === record.fallbackPin && emailAccessUrl === normalizeEmailVerifyUrl(record.emailAccessUrl)) return record;
  return { ...record, accountEmail, fallbackPassword, fallbackPin, emailAccessUrl };
}

export const PARTY_ACCESS_CONSENT_PHRASES = [
  '계정 정보를 절대 변경하지 않겠습니다.',
  '로그인 안 될 때 이 페이지를 먼저 확인하겠습니다.',
  '배정된 1개 프로필만 사용하겠습니다.',
] as const;

export function isValidPartyAccessConsent(value: unknown): boolean {
  const phrases = Array.isArray(value) ? value.map((item) => String(item || '').trim()) : [];
  return PARTY_ACCESS_CONSENT_PHRASES.every((phrase, index) => phrases[index] === phrase);
}

export function resolvePartyAccessCredentials(
  record: PartyAccessLinkRecord,
  checklistStore: PartyMaintenanceChecklistStore = {},
  generatedStore: GeneratedAccountStore = {},
): PartyAccessCredentials {
  const key = partyAccessAccountKey(record.serviceType, record.accountEmail);
  const state = checklistStore[key];
  const generated = findGeneratedAccount(generatedStore, record.serviceType, record.accountEmail) as any;
  const password = usablePartyAccessCredential(String(state?.changedPassword || ''))
    || usablePartyAccessCredential(record.fallbackPassword)
    || usablePartyAccessCredential(String(generated?.password || ''));
  const pin = isWavvePartyAccessService(record.serviceType) ? '' : String(state?.generatedPin || record.fallbackPin || generated?.pin || '').trim();
  const updatedAt = String(state?.updatedAt || generated?.createdAt || record.createdAt || '');
  return { id: usablePartyAccessCredential(record.accountEmail), password, pin, updatedAt };
}

export function buildPartyAccessProfileStatuses(
  record: PartyAccessLinkRecord,
  store: PartyAccessLinkStore = {},
  now = new Date().toISOString(),
  _profileAssignments: ProfileAssignment[] = [],
): PartyAccessProfileStatus[] {
  const accountKey = partyAccessAccountKey(record.serviceType, record.accountEmail);
  const latestByMember = new Map<string, PartyAccessLinkRecord>();
  for (const sibling of Object.values(store || {})) {
    if (!sibling?.member?.memberId) continue;
    if (partyAccessAccountKey(sibling.serviceType, sibling.accountEmail) !== accountKey) continue;
    const memberKey = `${sibling.member.kind}:${sibling.member.memberId}`;
    const prev = latestByMember.get(memberKey);
    if (!prev || String(prev.createdAt || '').localeCompare(String(sibling.createdAt || '')) < 0) {
      latestByMember.set(memberKey, sibling);
    }
  }
  if (!latestByMember.has(`${record.member.kind}:${record.member.memberId}`)) {
    latestByMember.set(`${record.member.kind}:${record.member.memberId}`, record);
  }

  const latestSiblings = Array.from(latestByMember.values());
  const activeSiblings = latestSiblings
    .filter((sibling) => !sibling.revokedAt)
    .filter((sibling) => isPartyAccessAllowed(sibling, now).allowed)
    .filter((sibling) => isCurrentPartyAccessProfileStatus(sibling.member.status, sibling.member.statusName || sibling.member.status));

  // Account-management synthetic siblings are refreshed from the same authoritative
  // current-member rows shown on the operator dashboard. When they exist, stale real
  // token history must not inflate or duplicate the buyer-facing profile list.
  const managementSiblings = activeSiblings.filter(isManagementSyntheticPartyAccessRecord);
  const authoritativeSiblings = managementSiblings.length > 0
    ? [...managementSiblings, ...activeSiblings.filter((sibling) => sibling.member.kind === 'manual')]
    : activeSiblings;
  const exactCurrentKey = authoritativeSiblings.find((sibling) => sibling.member.kind === record.member.kind && sibling.member.memberId === record.member.memberId);
  const currentProfileName = normalizeKeyPart(record.profileName || record.member.memberName || '');
  const profileMatchedCurrent = exactCurrentKey || authoritativeSiblings.find((sibling) =>
    currentProfileName && normalizeKeyPart(sibling.profileName || sibling.member.memberName || '') === currentProfileName);
  const currentMemberKey = profileMatchedCurrent ? `${profileMatchedCurrent.member.kind}:${profileMatchedCurrent.member.memberId}` : '';

  const rows = authoritativeSiblings
    .map((sibling) => ({
      profileName: normalizeKeyPart(sibling.profileName || sibling.member.memberName || '(미확인)'),
      memberName: normalizeKeyPart(sibling.member.memberName || '(미확인)'),
      status: normalizeKeyPart(sibling.member.status),
      statusName: normalizeKeyPart(sibling.member.statusName || sibling.member.status),
      startDateTime: sibling.member.startDateTime || null,
      endDateTime: sibling.member.endDateTime || null,
      isCurrentMember: `${sibling.member.kind}:${sibling.member.memberId}` === currentMemberKey,
    }))
    .sort((a, b) => {
      if (a.isCurrentMember !== b.isCurrentMember) return a.isCurrentMember ? -1 : 1;
      return String(a.endDateTime || '').localeCompare(String(b.endDateTime || '')) || a.profileName.localeCompare(b.profileName);
    });

  const limit = managementSiblings.length > 0 ? 0 : partyAccessProfileLimit(record.serviceType);
  const limitedRows = limit > 0 && rows.length > limit
    ? [...rows.filter((row) => row.isCurrentMember), ...rows.filter((row) => !row.isCurrentMember).slice(0, Math.max(0, limit - rows.filter((row) => row.isCurrentMember).length))]
    : rows;

  return limitedRows.sort((a, b) => {
    if (a.isCurrentMember !== b.isCurrentMember) return a.isCurrentMember ? -1 : 1;
    return String(a.endDateTime || '').localeCompare(String(b.endDateTime || '')) || a.profileName.localeCompare(b.profileName);
  });
}

export type PartyAccessPublicPayload = {
  ok: boolean;
  reason?: string;
  serviceType?: string;
  accountEmail?: string;
  memberName?: string;
  profileName?: string;
  emailAccessUrl?: string;
  partyProfiles?: PartyAccessProfileStatus[];
  period?: { startDateTime: string | null; endDateTime: string | null };
  credentials?: PartyAccessCredentials;
  consentRequired?: boolean;
  sensitiveRedacted?: boolean;
  audit: { memberId: string; allowed: boolean; reason: string; viewedAt: string };
};

export function redactPartyAccessPayloadForConsent(payload: PartyAccessPublicPayload): PartyAccessPublicPayload {
  return {
    ok: payload.ok,
    reason: payload.reason,
    consentRequired: payload.ok ? true : undefined,
    sensitiveRedacted: true,
    serviceType: payload.serviceType,
    memberName: payload.memberName,
    period: payload.period,
    audit: payload.audit,
  };
}

export function buildPartyAccessPublicPayload(
  record: PartyAccessLinkRecord | null,
  checklistStore: PartyMaintenanceChecklistStore = {},
  generatedStore: GeneratedAccountStore = {},
  now = new Date().toISOString(),
  store: PartyAccessLinkStore = {},
  profileAssignments: ProfileAssignment[] = [],
): PartyAccessPublicPayload {
  if (!record) {
    return { ok: false, reason: 'not-found', audit: { memberId: '', allowed: false, reason: 'missing-record', viewedAt: now } };
  }
  const allowed = isPartyAccessAllowed(record, now);
  const credentialRecord = enrichPartyAccessRecordWithKnownCredentials(record, store, checklistStore, generatedStore);
  const base = {
    serviceType: record.serviceType,
    accountEmail: usablePartyAccessCredential(credentialRecord.accountEmail),
    memberName: record.member.memberName,
    profileName: record.profileName || record.member.memberName,
    emailAccessUrl: resolvePartyAccessEmailAccessUrl(credentialRecord, checklistStore, generatedStore),
    partyProfiles: buildPartyAccessProfileStatuses(record, store, now, profileAssignments),
    period: { startDateTime: record.member.startDateTime || null, endDateTime: record.member.endDateTime || null },
    audit: { memberId: record.member.memberId, allowed: allowed.allowed, reason: allowed.reason, viewedAt: now },
  };
  if (!allowed.allowed) return { ok: false, reason: allowed.reason, ...base };
  return { ok: true, ...base, credentials: resolvePartyAccessCredentials(credentialRecord, checklistStore, generatedStore) };
}
