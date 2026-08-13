import { buildYouTubeSharingNoKeepProductModel } from './graytag-fill';
import { fingerprintYouTubeProductRegistration } from './youtube-product-registrations';

export interface YouTubeProductRegistrationReconciliationClaim {
  attemptId: string;
  requestFingerprint: string;
  familyGroupId: string;
}

export interface AuthoritativeYouTubeSellerProducts {
  authoritative: boolean;
  rows: readonly unknown[];
}

type ReconciliationResult = { status: 'registered'; productUsid: string } | { status: 'uncertain' };
type SellerRead = (url: string, options: RequestInit) => Promise<Response>;

const SELLER_PRODUCTS_URL = 'https://graytag.co.kr/ws/lender/findBeforeUsingLenderDeals?finishedDealIncluded=false&sorting=Latest&page=1&rows=500';

function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

function canonicalEndDate(value: unknown): string | null {
  const raw = text(value);
  const compact = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})$/.exec(raw);
  const dotted = /^(\d{2})\.\s*(\d{2})\.\s*(\d{2})(?:\s+(\d{2}):(\d{2}))?$/.exec(raw);
  const parts = compact
    ? compact.slice(1).map(Number)
    : dotted
      ? [2000 + Number(dotted[1]), ...dotted.slice(2).map((part) => Number(part || 0))]
      : null;
  if (!parts) return null;
  const [year, month, day, hour, minute] = parts;
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day
    || date.getUTCHours() !== hour || date.getUTCMinutes() !== minute) return null;
  return `${year}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}${String(minute).padStart(2, '0')}`;
}

function positivePrice(value: unknown): number | null {
  const normalized = typeof value === 'number' ? value : Number(text(value).replace(/[^0-9]/g, ''));
  return Number.isSafeInteger(normalized) && normalized > 0 ? normalized : null;
}

function normalizedCandidate(row: any) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  if (text(row.dealStatus ?? row.productAvailable ?? row.status) !== 'OnSale') return null;
  const category = text(row.tempProductCategory ?? row.productCategory ?? row.productTypeString ?? row.productTypeCode)
    .toLowerCase().replace(/\s+/g, '');
  if (category !== 'youtube' && category !== '유튜브') return null;
  const endDate = canonicalEndDate(row.endDateTime ?? row.endDate ?? row.end);
  const price = positivePrice(row.purePrice ?? row.price);
  const name = text(row.productName ?? row.name);
  const sellingGuide = text(row.sellingGuide);
  if (!endDate || price === null || !name || !sellingGuide) return null;
  try {
    return buildYouTubeSharingNoKeepProductModel({ endDate, price, name, sellingGuide });
  } catch {
    return null;
  }
}

function validProductUsid(value: unknown): string | null {
  const productUsid = text(value);
  return /^[A-Za-z0-9_-]{1,128}$/.test(productUsid) ? productUsid : null;
}

export function reconcileYouTubeProductRegistration(
  claim: YouTubeProductRegistrationReconciliationClaim,
  observation: AuthoritativeYouTubeSellerProducts,
): ReconciliationResult {
  if (!observation.authoritative || !Array.isArray(observation.rows)) return { status: 'uncertain' };
  const matches: string[] = [];
  for (const row of observation.rows as any[]) {
    const model = normalizedCandidate(row);
    if (!model || fingerprintYouTubeProductRegistration(claim.familyGroupId, model) !== claim.requestFingerprint) continue;
    const productUsid = validProductUsid(row.productUsid ?? row.usid);
    if (!productUsid) return { status: 'uncertain' };
    matches.push(productUsid);
  }
  return matches.length === 1
    ? { status: 'registered', productUsid: matches[0] }
    : { status: 'uncertain' };
}

export async function readAuthoritativeYouTubeSellerProducts(
  read: SellerRead,
  headers: HeadersInit,
): Promise<AuthoritativeYouTubeSellerProducts> {
  try {
    const response = await read(SELLER_PRODUCTS_URL, {
      method: 'GET', headers, redirect: 'manual', signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok || response.redirected || (response.status >= 300 && response.status < 400)) {
      return { authoritative: false, rows: [] };
    }
    const payload: any = await response.json();
    if (!payload || typeof payload !== 'object' || payload.succeeded === false) return { authoritative: false, rows: [] };
    const rows = [payload?.data?.lenderDeals, payload?.lenderDeals, payload?.data?.data?.lenderDeals].find(Array.isArray);
    // A full page cannot prove that the result set was exhausted.
    if (!Array.isArray(rows) || rows.length >= 500) return { authoritative: false, rows: [] };
    return { authoritative: true, rows };
  } catch {
    return { authoritative: false, rows: [] };
  }
}
