export interface YouTubeFamilyGroupDto {
  id: string;
  label: string;
  managerEmailMasked: string;
  listingCode: string;
  subscriptionEndDate: string | null;
  sellableSeats: number;
  availableSeats: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface YouTubeFamilyGroupsResult {
  enabled: boolean;
  familyGroups: YouTubeFamilyGroupDto[];
}

export interface YouTubeFamilyGroupDraft {
  label: string;
  managerEmail: string;
  subscriptionEndDate: string;
  sellableSeats: string;
}

export type YouTubeInvitationStatus =
  | 'waiting_for_group_assignment'
  | 'waiting_for_buyer_email'
  | 'email_candidate_found'
  | 'email_confirmed'
  | 'invite_sent'
  | 'delivery_completion_pending'
  | 'delivered_waiting_inspection'
  | 'active'
  | 'failed'
  | 'ended';

export interface YouTubeInvitationSummaryDto {
  id: string;
  productDisplayId: string;
  familyGroupId: string;
  buyerName: string;
  buyerEmailMasked: string | null;
  endDateTime: string | null;
  status: YouTubeInvitationStatus;
  updatedAt: string;
}

export interface YouTubeInvitationsResult {
  enabled: boolean;
  invitations: YouTubeInvitationSummaryDto[];
}

export type YouTubeProductRegistrationStatus = 'submitting' | 'registered' | 'uncertain' | 'failed';

export function getYouTubeRegistrationDisplayLabel(status: YouTubeProductRegistrationStatus): string {
  return {
    registered: '구매 대기',
    submitting: '등록 처리 중',
    uncertain: '등록 결과 확인 필요',
    failed: '등록 실패',
  }[status];
}

export interface YouTubeProductRegistrationSummaryDto {
  registrationDisplayId: string;
  productDisplayId: string | null;
  familyGroupId: string;
  status: YouTubeProductRegistrationStatus;
  createdAt: string;
  updatedAt: string;
}

export interface YouTubeProductRegistrationsResult {
  enabled: boolean;
  registrations: YouTubeProductRegistrationSummaryDto[];
}

export interface YouTubeLinkedProductRegistration extends YouTubeProductRegistrationSummaryDto {
  invitation: YouTubeInvitationSummaryDto | null;
}

export interface YouTubeFamilyGroupSummary extends YouTubeFamilyGroupDto {
  activeCount: number;
  pendingCount: number;
  acceptedCount: number;
  failedCount: number;
  occupiedSeats: number;
  members: YouTubeInvitationSummaryDto[];
  registrations: YouTubeLinkedProductRegistration[];
  registeredRegistrationCount: number;
  pendingRegistrationCount: number;
  uncertainRegistrationCount: number;
  failedRegistrationCount: number;
}

export type YouTubeFamilyGroupCreateBody = {
  label: string;
  managerEmail: string;
  subscriptionEndDate: string | null;
  sellableSeats: number;
};

export type YouTubeFamilyGroupPatchBody = Partial<YouTubeFamilyGroupCreateBody>;

export function isYouTubeManagementService(serviceType: string): boolean {
  const normalized = String(serviceType || '').trim().toLowerCase().replace(/\s+/g, '');
  return normalized.includes('유튜브') || normalized.includes('youtube');
}

export function partitionYouTubeManagementServices<T extends { serviceType: string }>(services: T[]): {
  credentialServices: T[];
  unmappedYouTubeServices: T[];
} {
  return {
    credentialServices: services.filter(service => !isYouTubeManagementService(service.serviceType)),
    unmappedYouTubeServices: services.filter(service => isYouTubeManagementService(service.serviceType)),
  };
}

const EMAIL_PATTERN = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isRealIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function safeDtoText(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= max
    && !/[\x00-\x1f\x7f]/.test(value) ? value : null;
}

function isSafeIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 50) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

function isMaskedEmail(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 320 && value.includes('*')
    && value.includes('@') && !/\s/.test(value);
}

function isListingCode(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 6
    && !/[\x00-\x20\x7f]/.test(value) && value === value.toLowerCase();
}

function isPrivacySafeIdentifier(value: unknown, prefix: 'product' | 'registration'): value is string {
  return typeof value === 'string' && new RegExp(`^${prefix}-[a-f0-9]{12}$`).test(value);
}

function parseSafeFamilyGroup(value: unknown): YouTubeFamilyGroupDto | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const id = safeDtoText(item.id, 200);
  const label = safeDtoText(item.label, 120);
  const subscriptionEndDate = item.subscriptionEndDate;
  if (
    !id || !label || !isMaskedEmail(item.managerEmailMasked) || !isListingCode(item.listingCode) ||
    !(subscriptionEndDate === null || (typeof subscriptionEndDate === 'string' && isRealIsoDate(subscriptionEndDate))) ||
    !Number.isInteger(item.sellableSeats) || Number(item.sellableSeats) < 1 || Number(item.sellableSeats) > 20 ||
    !Number.isInteger(item.availableSeats) || Number(item.availableSeats) < 0 || Number(item.availableSeats) > Number(item.sellableSeats) ||
    typeof item.enabled !== 'boolean' ||
    !isSafeIsoTimestamp(item.createdAt) ||
    !isSafeIsoTimestamp(item.updatedAt)
  ) return null;
  return {
    id,
    label,
    managerEmailMasked: item.managerEmailMasked,
    listingCode: item.listingCode,
    subscriptionEndDate,
    sellableSeats: Number(item.sellableSeats),
    availableSeats: Number(item.availableSeats),
    enabled: item.enabled,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

export function parseYouTubeFamilyGroupsResponse(value: unknown): YouTubeFamilyGroupsResult | null {
  if (!value || typeof value !== 'object') return null;
  const response = value as Record<string, unknown>;
  if (response.ok !== true || typeof response.enabled !== 'boolean' || !Array.isArray(response.familyGroups)) return null;
  const familyGroups = response.familyGroups.map(parseSafeFamilyGroup);
  if (familyGroups.some((group) => group === null)) return null;
  return { enabled: response.enabled, familyGroups: familyGroups as YouTubeFamilyGroupDto[] };
}

const YOUTUBE_INVITATION_STATUSES = new Set<YouTubeInvitationStatus>([
  'waiting_for_group_assignment', 'waiting_for_buyer_email', 'email_candidate_found', 'email_confirmed',
  'invite_sent', 'delivery_completion_pending', 'delivered_waiting_inspection', 'active', 'failed', 'ended',
]);

function parseSafeInvitation(value: unknown): YouTubeInvitationSummaryDto | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const id = safeDtoText(item.id, 200);
  const productDisplayId = item.productDisplayId;
  const familyGroupId = safeDtoText(item.familyGroupId, 200);
  const buyerName = safeDtoText(item.buyerName, 200);
  const status = item.status as YouTubeInvitationStatus;
  const updatedAt = item.updatedAt;
  const buyerEmailMasked = item.buyerEmailMasked;
  const endDateTime = item.endDateTime;
  if (!id || !isPrivacySafeIdentifier(productDisplayId, 'product') || !familyGroupId || !buyerName
    || !isSafeIsoTimestamp(updatedAt) || !YOUTUBE_INVITATION_STATUSES.has(status)
    || !(buyerEmailMasked === null || isMaskedEmail(buyerEmailMasked))
    || !(endDateTime === null || isSafeIsoTimestamp(endDateTime))) return null;
  return { id, productDisplayId, familyGroupId, buyerName, buyerEmailMasked, endDateTime, status, updatedAt };
}

export function parseYouTubeInvitationsResponse(value: unknown): YouTubeInvitationsResult | null {
  if (!value || typeof value !== 'object') return null;
  const response = value as Record<string, unknown>;
  if (response.ok !== true || typeof response.enabled !== 'boolean' || !Array.isArray(response.invitations)) return null;
  const invitations = response.invitations.map(parseSafeInvitation);
  if (invitations.some((invitation) => invitation === null)) return null;
  return { enabled: response.enabled, invitations: invitations as YouTubeInvitationSummaryDto[] };
}

const YOUTUBE_PRODUCT_REGISTRATION_STATUSES = new Set<YouTubeProductRegistrationStatus>([
  'submitting', 'registered', 'uncertain', 'failed',
]);

function parseSafeProductRegistration(value: unknown): YouTubeProductRegistrationSummaryDto | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const registrationDisplayId = item.registrationDisplayId;
  const productDisplayId = item.productDisplayId;
  const familyGroupId = safeDtoText(item.familyGroupId, 200);
  const status = item.status as YouTubeProductRegistrationStatus;
  if (!isPrivacySafeIdentifier(registrationDisplayId, 'registration') || !familyGroupId
    || !(productDisplayId === null || isPrivacySafeIdentifier(productDisplayId, 'product'))
    || !YOUTUBE_PRODUCT_REGISTRATION_STATUSES.has(status)
    || !isSafeIsoTimestamp(item.createdAt) || !isSafeIsoTimestamp(item.updatedAt)) return null;
  return { registrationDisplayId, productDisplayId, familyGroupId, status, createdAt: item.createdAt, updatedAt: item.updatedAt };
}

export function parseYouTubeProductRegistrationsResponse(value: unknown): YouTubeProductRegistrationsResult | null {
  if (!value || typeof value !== 'object') return null;
  const response = value as Record<string, unknown>;
  if (response.ok !== true || typeof response.enabled !== 'boolean' || !Array.isArray(response.registrations)) return null;
  const registrations = response.registrations.map(parseSafeProductRegistration);
  if (registrations.some((registration) => registration === null)) return null;
  return { enabled: response.enabled, registrations: registrations as YouTubeProductRegistrationSummaryDto[] };
}

const PENDING_INVITATION_STATUSES = new Set<YouTubeInvitationStatus>([
  'waiting_for_group_assignment', 'waiting_for_buyer_email', 'email_candidate_found', 'email_confirmed',
  'invite_sent', 'delivery_completion_pending',
]);

export function summarizeYouTubeFamilyGroup(
  group: YouTubeFamilyGroupDto,
  invitations: readonly YouTubeInvitationSummaryDto[],
  productRegistrations: readonly YouTubeProductRegistrationSummaryDto[] = [],
): YouTubeFamilyGroupSummary {
  const members = invitations
    .filter((invitation) => invitation.familyGroupId === group.id && invitation.status !== 'ended')
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id));
  const registrations = productRegistrations
    .filter((registration) => registration.familyGroupId === group.id)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt)
      || right.updatedAt.localeCompare(left.updatedAt)
      || left.registrationDisplayId.localeCompare(right.registrationDisplayId))
    .map((registration) => ({
      ...registration,
      invitation: registration.productDisplayId
        ? members.find((member) => member.productDisplayId === registration.productDisplayId) || null
        : null,
    }));
  return {
    ...group,
    activeCount: members.filter((member) => member.status === 'active').length,
    pendingCount: members.filter((member) => PENDING_INVITATION_STATUSES.has(member.status)).length,
    acceptedCount: members.filter((member) => member.status === 'delivered_waiting_inspection').length,
    failedCount: members.filter((member) => member.status === 'failed').length,
    occupiedSeats: Math.max(0, group.sellableSeats - group.availableSeats),
    members,
    registrations,
    registeredRegistrationCount: registrations.filter((registration) => registration.status === 'registered').length,
    pendingRegistrationCount: registrations.filter((registration) => registration.status === 'submitting').length,
    uncertainRegistrationCount: registrations.filter((registration) => registration.status === 'uncertain').length,
    failedRegistrationCount: registrations.filter((registration) => registration.status === 'failed').length,
  };
}

function parseSeats(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const seats = Number(value);
  return Number.isInteger(seats) ? seats : null;
}

export function validateYouTubeFamilyGroupDraft(
  draft: YouTubeFamilyGroupDraft,
  options: { allowBlankEmail?: boolean; occupiedSeats?: number } = {},
): string | null {
  const label = draft.label.trim();
  if (!label || label.length > 120) return '그룹 이름은 1~120자로 입력해주세요.';
  const email = draft.managerEmail.trim();
  if ((!options.allowBlankEmail || email) && (email.length > 254 || !EMAIL_PATTERN.test(email))) {
    return '올바른 관리자 이메일을 입력해주세요.';
  }
  const date = draft.subscriptionEndDate.trim();
  if (date && !isRealIsoDate(date)) return '올바른 구독 종료 날짜를 입력해주세요.';
  const seats = parseSeats(draft.sellableSeats);
  if (seats === null || seats < 1 || seats > 20) return '판매 좌석은 1~20 사이의 정수로 입력해주세요.';
  const occupiedSeats = Math.max(0, options.occupiedSeats ?? 0);
  if (seats < occupiedSeats) return `현재 사용 중인 ${occupiedSeats}석보다 적게 설정할 수 없습니다.`;
  return null;
}

export function buildYouTubeFamilyGroupCreateBody(draft: YouTubeFamilyGroupDraft): YouTubeFamilyGroupCreateBody {
  return {
    label: draft.label.trim(),
    managerEmail: draft.managerEmail.trim(),
    subscriptionEndDate: draft.subscriptionEndDate.trim() || null,
    sellableSeats: Number(draft.sellableSeats),
  };
}

export function buildYouTubeFamilyGroupPatchBody(
  original: YouTubeFamilyGroupDto,
  draft: YouTubeFamilyGroupDraft,
): YouTubeFamilyGroupPatchBody {
  const patch: YouTubeFamilyGroupPatchBody = {};
  const label = draft.label.trim();
  const managerEmail = draft.managerEmail.trim();
  const subscriptionEndDate = draft.subscriptionEndDate.trim() || null;
  const sellableSeats = Number(draft.sellableSeats);
  if (label !== original.label) patch.label = label;
  if (managerEmail) patch.managerEmail = managerEmail;
  if (subscriptionEndDate !== original.subscriptionEndDate) patch.subscriptionEndDate = subscriptionEndDate;
  if (sellableSeats !== original.sellableSeats) patch.sellableSeats = sellableSeats;
  return patch;
}
