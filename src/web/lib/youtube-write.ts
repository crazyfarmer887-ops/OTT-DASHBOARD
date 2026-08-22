import { appendYouTubeListingCode } from '../../lib/youtube-listing-code';

export { appendYouTubeListingCode } from '../../lib/youtube-listing-code';

export function buildYouTubeListingTitle(name: string, listingCode: string): string {
  return appendYouTubeListingCode(name.trim(), listingCode);
}

export interface YouTubeFamilyGroupDto {
  id: string;
  label: string;
  managerEmailMasked: string;
  listingCode: string;
  subscriptionEndDate: string | null;
  sellableSeats: number;
  availableSeats: number;
  enabled: boolean;
}

export interface YouTubeFamilyGroupsDto {
  ok: boolean;
  enabled: boolean;
  familyGroups: YouTubeFamilyGroupDto[];
  error?: string;
}

export type YouTubeRegistrationProgress = {
  status: 'pending' | 'running' | 'done' | 'error';
  error?: string;
};

export function getSeoulTomorrow(clock: () => Date = () => new Date()): string {
  const seoulDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(clock());
  const [year, month, day] = seoulDate.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

export function summarizeYouTubeRegistration(items: YouTubeRegistrationProgress[]) {
  const errors = items.filter(item => item.status === 'error');
  const uncertainCount = errors.filter(item => /불확실|네트워크 오류/.test(item.error || '')).length;
  const safelyStoppedCount = errors.filter(item => /후속 등록을 중단/.test(item.error || '')).length;
  return {
    successCount: items.filter(item => item.status === 'done').length,
    uncertainCount,
    safelyStoppedCount,
    failedCount: errors.length - uncertainCount - safelyStoppedCount,
    requestedCount: items.length,
  };
}

export function getYouTubePostRegistrationStep(_successCount: number): 'done' {
  return 'done';
}

export function clampYouTubeRepeat(requested: number, availableSeats: number): number {
  const capacity = Math.max(0, Math.min(20, Math.floor(availableSeats)));
  if (capacity === 0) return 0;
  return Math.max(1, Math.min(Math.floor(requested) || 1, capacity));
}

export function normalizeYouTubeEndDate(value: string, subscriptionEndDate: string | null): string {
  if (!subscriptionEndDate) return value;
  if (!value || value > subscriptionEndDate) return subscriptionEndDate;
  return value;
}

export function createYouTubeIdempotencyKey(
  cryptoLike: { randomUUID?: () => string } | undefined = globalThis.crypto,
  now = Date.now(),
  random = Math.random,
): string {
  const uuid = cryptoLike?.randomUUID?.();
  if (uuid) return `yt-${uuid}`;
  return `yt-${now.toString(36)}-${Math.floor(random() * Number.MAX_SAFE_INTEGER).toString(36)}`;
}

export function toGraytagYouTubeDate(date: string): string {
  return `${date.replace(/-/g, '')}T2359`;
}

interface YouTubeProductRequestInput {
  familyGroupId: string;
  endDate: string;
  price: number;
  name: string;
  listingCode: string;
  sellingGuide: string;
  idempotencyKey: string;
}

export function buildYouTubeProductRequest(input: YouTubeProductRequestInput): { url: string; init: RequestInit } {
  return {
    url: '/api/youtube/products',
    init: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-audit-reason': 'youtube-invitation-product-registration',
        'Idempotency-Key': input.idempotencyKey,
      },
      body: JSON.stringify({
        familyGroupId: input.familyGroupId,
        endDate: toGraytagYouTubeDate(input.endDate),
        price: Math.trunc(input.price),
        name: buildYouTubeListingTitle(input.name, input.listingCode),
        sellingGuide: input.sellingGuide,
      }),
    },
  };
}
