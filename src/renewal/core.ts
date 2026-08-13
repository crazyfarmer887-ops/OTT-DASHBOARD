export const SERVICE_CATEGORY_MAP = Object.freeze({
  디즈니플러스: 'disney',
  넷플릭스: 'Netflix',
  왓챠플레이: 'WatchaPlay',
  웨이브: 'wavve',
  티빙: 'tving',
} as const);

export type SupportedService = keyof typeof SERVICE_CATEGORY_MAP;
export type ServiceCategory = (typeof SERVICE_CATEGORY_MAP)[SupportedService];

export interface ParsedGraytagDate {
  canonical: string;
  addDays(days: number): string;
}

function formatGraytagDate(date: Date): string {
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}T${String(date.getUTCHours()).padStart(2, '0')}${String(date.getUTCMinutes()).padStart(2, '0')}`;
}

export function parseGraytagEndDate(value: unknown): ParsedGraytagDate | null {
  const match = String(value ?? '').trim().match(/^(\d{2})\.\s*(\d{2})\.\s*(\d{2})(?:\s+(\d{2}):(\d{2}))?$/);
  if (!match) return null;
  const year = 2000 + Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4] ?? 0);
  const minute = Number(match[5] ?? 0);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day || date.getUTCHours() !== hour || date.getUTCMinutes() !== minute) return null;
  return {
    canonical: formatGraytagDate(date),
    addDays(days: number) {
      const next = new Date(date.getTime());
      next.setUTCDate(next.getUTCDate() + days);
      return formatGraytagDate(next);
    },
  };
}

export function serviceCategoryFor(value: unknown): ServiceCategory | null {
  return SERVICE_CATEGORY_MAP[String(value ?? '').trim() as SupportedService] ?? null;
}

export interface RenewalCandidate {
  dealUsid: string;
  productUsid: string;
  chatRoomUuid: string;
  productTypeString: SupportedService;
  category: ServiceCategory;
  productName: string;
  sellingGuide: string;
  dealDays: number;
  purePrice: number;
  oldEnd: string;
  newEnd: string;
  idempotencyKey: string;
  buyer: string;
  account: string;
}

export function renewalIdempotencyKey(dealUsid: string, oldEnd: string): string {
  return `renewal:${encodeURIComponent(dealUsid.trim())}:${oldEnd}`;
}

function nonEmpty(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || null;
}

export function normalizeRenewalCandidate(row: any): RenewalCandidate | null {
  if (!row || !['UsingNearExpiration', 'ExtensionUsingNearExpiration'].includes(String(row.dealStatus))) return null;
  if (String(row.productTypeCode ?? '').trim() === 'D' || row.extensionStatus != null || row.extensionProductExist === true) return null;
  const dealUsid = nonEmpty(row.dealUsid);
  const productUsid = nonEmpty(row.productUsid);
  const chatRoomUuid = nonEmpty(row.chatRoomUuid);
  const productName = nonEmpty(row.productName);
  const sellingGuide = nonEmpty(row.sellingGuide);
  const service = nonEmpty(row.productTypeString) as SupportedService | null;
  const category = serviceCategoryFor(service);
  const end = parseGraytagEndDate(row.endDateTime);
  const dealDays = Number(row.dealDays);
  const purePrice = Number(row.purePrice);
  if (!dealUsid || !productUsid || !chatRoomUuid || !productName || !sellingGuide || !service || !category || !end) return null;
  if (!Number.isInteger(dealDays) || dealDays <= 0 || !Number.isFinite(purePrice) || purePrice <= 0) return null;
  return {
    dealUsid,
    productUsid,
    chatRoomUuid,
    productTypeString: service,
    category,
    productName,
    sellingGuide,
    dealDays,
    purePrice,
    oldEnd: end.canonical,
    newEnd: end.addDays(dealDays),
    idempotencyKey: renewalIdempotencyKey(dealUsid, end.canonical),
    buyer: maskPerson(row.borrowerName ?? row.buyerName),
    account: maskAccount(row.accountEmail ?? row.account ?? row.email),
  };
}

export interface ExtensionProductModel {
  name: string;
  sellingGuide: string;
  endDate: string;
  priceType: 'Extended';
  tempProductCategory: ServiceCategory;
  dealUsid: string;
  dealEndDate: string;
  price: number;
}

export function buildExtensionProductModel(candidate: RenewalCandidate): ExtensionProductModel {
  return {
    name: candidate.productName,
    sellingGuide: candidate.sellingGuide,
    endDate: candidate.newEnd,
    priceType: 'Extended',
    tempProductCategory: candidate.category,
    dealUsid: candidate.dealUsid,
    dealEndDate: candidate.oldEnd,
    price: candidate.purePrice,
  };
}

export const RENEWAL_MESSAGE = '연장 상품이 등록되었습니다.\n' +
  '채팅에 표시된 연장 상품을 통해 연장을 신청하실 수 있습니다.\n' +
  '서비스 이용 경험을 후기로 남겨주시면 감사의 뜻으로 CU 상품권 1,000원권을 드립니다. 별점과 후기 내용은 혜택 제공 여부에 영향을 주지 않으며, 거래당 1회 제공됩니다.\n' +
  '후기 작성 후 이 채팅으로 알려주세요.';

const FORBIDDEN_REVIEW_PRESSURE = ['긍정적인 리뷰', '좋은 리뷰', '별점 5점'] as const;

export function isNeutralRenewalMessage(message: unknown): boolean {
  const text = typeof message === 'string' ? message.trim() : '';
  return Boolean(text) && FORBIDDEN_REVIEW_PRESSURE.every((phrase) => !text.includes(phrase));
}

export function buildRenewalMessage(template?: string): string {
  if (template !== undefined && !isNeutralRenewalMessage(template)) throw new Error('renewal message must use neutral disclosed copy');
  return template?.trim() || RENEWAL_MESSAGE;
}

export const RENEWAL_CATEGORY_ORDER: readonly ServiceCategory[] = ['Netflix', 'tving', 'wavve', 'disney', 'WatchaPlay'];

export function sortRenewalRows<T extends { category: ServiceCategory; oldEnd: string; idempotencyKey: string }>(rows: readonly T[]): T[] {
  const categoryRank = new Map(RENEWAL_CATEGORY_ORDER.map((category, index) => [category, index]));
  return [...rows].sort((a, b) =>
    (categoryRank.get(a.category) ?? 999) - (categoryRank.get(b.category) ?? 999)
    || a.oldEnd.localeCompare(b.oldEnd)
    || a.idempotencyKey.localeCompare(b.idempotencyKey));
}

function maskPerson(value: unknown): string {
  const text = String(value ?? '').trim();
  if (!text) return '-';
  if (text.length === 1) return '*';
  if (text.length === 2) return `${text[0]}*`;
  return `${text[0]}${'*'.repeat(Math.max(1, text.length - 2))}${text.at(-1)}`;
}

function maskAccount(value: unknown): string {
  const text = String(value ?? '').trim();
  if (!text) return '-';
  const at = text.indexOf('@');
  if (at < 0) return maskPerson(text);
  const local = text.slice(0, at);
  const shown = local.slice(0, Math.min(2, local.length));
  return `${shown}***${text.slice(at)}`;
}

export interface RenewalPreviewRow {
  idempotencyKey: string; dealUsid: string; productUsid: string;
  service: SupportedService; category: ServiceCategory; buyer: string; account: string;
  oldEnd: string; newEnd: string; dealDays: number; price: number;
  eligible: boolean; reason: string | null; jobStatus: string | null;
  registrationStatus: 'not_started' | 'registered' | 'failed' | 'uncertain';
  messageStatus: 'not_started' | 'sent' | 'failed'; couponStatus: string;
  skipReason?: 'policy_disabled' | 'target_reached';
}

export function buildRenewalPreviewRows(providerRows: unknown[], jobs: Array<Record<string, any>> = []): RenewalPreviewRow[] {
  const byKey = new Map(jobs.map((job) => [String(job.idempotencyKey), job]));
  const previews = providerRows.flatMap((providerRow: any) => {
    const candidate = normalizeRenewalCandidate(providerRow);
    if (!candidate) return [];
    const job = byKey.get(candidate.idempotencyKey);
    const registrationStatus = job?.status === 'uncertain' ? 'uncertain'
      : job?.registeredAt || ['registered', 'messaged', 'message_error'].includes(job?.status) ? 'registered'
      : job?.status === 'error' ? 'failed' : 'not_started';
    const messageStatus = job?.status === 'messaged' ? 'sent' : job?.status === 'message_error' ? 'failed' : 'not_started';
    return [{
      idempotencyKey: candidate.idempotencyKey, dealUsid: candidate.dealUsid, productUsid: candidate.productUsid,
      service: candidate.productTypeString, category: candidate.category,
      buyer: maskPerson(providerRow.borrowerName ?? providerRow.buyerName),
      account: maskAccount(providerRow.accountEmail ?? providerRow.account ?? providerRow.email),
      oldEnd: candidate.oldEnd, newEnd: candidate.newEnd, dealDays: candidate.dealDays, price: candidate.purePrice,
      eligible: !job, reason: job ? (job.status === 'uncertain' ? 'registration_uncertain' : 'already_processed') : null,
      jobStatus: job?.status ?? null, registrationStatus, messageStatus,
      couponStatus: job?.couponStatus ?? 'not_started', skipReason: job?.skipReason,
    } satisfies RenewalPreviewRow];
  });
  return sortRenewalRows(previews);
}
