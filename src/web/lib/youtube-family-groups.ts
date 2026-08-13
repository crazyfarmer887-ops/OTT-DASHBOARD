export interface YouTubeFamilyGroupDto {
  id: string;
  label: string;
  managerEmailMasked: string;
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

function parseSafeFamilyGroup(value: unknown): YouTubeFamilyGroupDto | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const subscriptionEndDate = item.subscriptionEndDate;
  if (
    typeof item.id !== 'string' || !item.id ||
    typeof item.label !== 'string' || !item.label ||
    typeof item.managerEmailMasked !== 'string' || !item.managerEmailMasked ||
    !(subscriptionEndDate === null || (typeof subscriptionEndDate === 'string' && isRealIsoDate(subscriptionEndDate))) ||
    !Number.isInteger(item.sellableSeats) || Number(item.sellableSeats) < 1 || Number(item.sellableSeats) > 20 ||
    !Number.isInteger(item.availableSeats) || Number(item.availableSeats) < 0 || Number(item.availableSeats) > Number(item.sellableSeats) ||
    typeof item.enabled !== 'boolean' ||
    typeof item.createdAt !== 'string' ||
    typeof item.updatedAt !== 'string'
  ) return null;
  return {
    id: item.id,
    label: item.label,
    managerEmailMasked: item.managerEmailMasked,
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
