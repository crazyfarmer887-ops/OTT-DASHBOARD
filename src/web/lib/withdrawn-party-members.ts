export interface WithdrawnPartyMemberLike {
  dealUsid: string;
  productUsid?: string | null;
  name?: string | null;
  status?: string | null;
  statusName?: string | null;
  startDateTime?: string | null;
  endDateTime?: string | null;
  remainderDays?: number | null;
  price?: string | null;
  lastPassword?: string | null;
  lastPin?: string | null;
}

export interface WithdrawnPartyAccountLike {
  serviceType: string;
  email: string;
  members: WithdrawnPartyMemberLike[];
}

export interface WithdrawnPartyMemberRow {
  id: string;
  partyKey: string;
  memberName: string;
  statusLabel: string;
  withdrawnDate: string;
  periodLabel: string;
  price: string;
  password: string;
  pin: string;
  credentialAdvice: string;
}

const FINISHED_STATUS_PATTERNS = [
  /^Finished/i,
  /^Cancel/i,
  /^Deleted$/i,
  /^Expired$/i,
  /종료/,
  /취소/,
  /만료/,
  /삭제/,
];

const ACTIVE_STATUS_PATTERNS = [
  /^Using$/i,
  /^UsingNearExpiration$/i,
  /^DeliveredAndCheckPrepaid$/i,
  /계정\s*확인중/,
];

export const GRAYTAG_CANCEL_COUNTING_START_DATE = '2026-05-06';

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

export function normalizeWithdrawnDate(value: string | null | undefined): string {
  const raw = compact(value);
  if (!raw) return '';
  const compactGraytag = raw.match(/^(\d{4})(\d{2})(\d{2})T/);
  if (compactGraytag) return `${compactGraytag[1]}-${compactGraytag[2]}-${compactGraytag[3]}`;
  const short = raw.replace(/\s/g, '').match(/^(\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (short) {
    const yy = Number(short[1]);
    const year = yy < 50 ? 2000 + yy : 1900 + yy;
    return `${year}-${short[2].padStart(2, '0')}-${short[3].padStart(2, '0')}`;
  }
  const full = raw.match(/(\d{4})[-./\s]+(\d{1,2})[-./\s]+(\d{1,2})/);
  if (full) return `${full[1]}-${full[2].padStart(2, '0')}-${full[3].padStart(2, '0')}`;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
}

function isPastDate(value: string | null | undefined, now: string): boolean {
  const normalized = normalizeWithdrawnDate(value);
  if (!normalized) return false;
  return new Date(`${normalized}T23:59:59.999Z`).getTime() < new Date(now).getTime();
}

function isFinishedStatus(member: WithdrawnPartyMemberLike): boolean {
  const text = `${compact(member.status)} ${compact(member.statusName)}`.trim();
  return FINISHED_STATUS_PATTERNS.some(pattern => pattern.test(text));
}

function isCurrentlyActiveStatus(member: WithdrawnPartyMemberLike): boolean {
  const text = `${compact(member.status)} ${compact(member.statusName)}`.trim();
  return ACTIVE_STATUS_PATTERNS.some(pattern => pattern.test(text));
}

function isCancelledStatus(member: WithdrawnPartyMemberLike): boolean {
  const text = `${compact(member.status)} ${compact(member.statusName)}`.trim();
  return /^Cancel/i.test(text) || /취소|거래취소/.test(text);
}

function cancellationCountingDate(member: WithdrawnPartyMemberLike): string {
  return normalizeWithdrawnDate(member.endDateTime) || normalizeWithdrawnDate(member.startDateTime);
}

function shouldCountCancelledMember(member: WithdrawnPartyMemberLike): boolean {
  if (!isCancelledStatus(member)) return true;
  const date = cancellationCountingDate(member);
  if (!date) return true;
  return date >= GRAYTAG_CANCEL_COUNTING_START_DATE;
}

function shouldShowAsWithdrawn(member: WithdrawnPartyMemberLike, now: string): boolean {
  if (!shouldCountCancelledMember(member)) return false;
  if (isFinishedStatus(member)) return true;
  const remainder = Number(member.remainderDays ?? 0);
  if (Number.isFinite(remainder) && remainder < 0) return true;
  if (isCurrentlyActiveStatus(member) && isPastDate(member.endDateTime, now)) return true;
  return false;
}

function statusLabel(member: WithdrawnPartyMemberLike): string {
  const label = compact(member.statusName);
  if (label) return label;
  const status = compact(member.status);
  if (/^Cancel/i.test(status)) return '취소';
  if (/^Finished/i.test(status)) return '종료';
  if (/^Deleted$/i.test(status)) return '삭제';
  return status || '탈퇴/종료';
}

function buildCredentialAdvice(password: string, pin: string): string {
  if (password && pin) return 'PW/PIN 둘 다 점검';
  if (password) return 'PW 변경 검토';
  if (pin) return 'PIN 변경 검토';
  return '저장된 PW/PIN 없음';
}

export function buildWithdrawnPartyMembers(input: {
  account: WithdrawnPartyAccountLike;
  password?: string | null;
  pin?: string | null;
  now?: string;
}): WithdrawnPartyMemberRow[] {
  const now = input.now || new Date().toISOString();
  return (input.account.members || [])
    .filter(member => shouldShowAsWithdrawn(member, now))
    .map(member => {
      const withdrawnDate = normalizeWithdrawnDate(member.endDateTime) || normalizeWithdrawnDate(now);
      const start = normalizeWithdrawnDate(member.startDateTime);
      const password = compact(member.lastPassword);
      const pin = compact(member.lastPin).replace(/\D/g, '').slice(0, 6);
      return {
        id: compact(member.dealUsid) || `${compact(input.account.serviceType)}:${compact(input.account.email)}:${compact(member.name)}:${withdrawnDate}`,
        partyKey: compact(member.productUsid) || compact(member.dealUsid) || '파티 미확인',
        memberName: compact(member.name) || '(미확인)',
        statusLabel: statusLabel(member),
        withdrawnDate,
        periodLabel: start || withdrawnDate ? `${start || '?'} ~ ${withdrawnDate || '?'}` : '-',
        price: compact(member.price) || '-',
        password,
        pin,
        credentialAdvice: buildCredentialAdvice(password, pin),
      };
    })
    .sort((a, b) => b.withdrawnDate.localeCompare(a.withdrawnDate) || a.partyKey.localeCompare(b.partyKey) || a.memberName.localeCompare(b.memberName));
}
