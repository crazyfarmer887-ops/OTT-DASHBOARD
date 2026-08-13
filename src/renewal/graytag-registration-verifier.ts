import type { RenewalJob } from './job-store';
import type { RegistrationEvidenceSnapshot } from './reconciliation';

export interface RegistrationEvidenceRows {
  capturedAt: string;
  nearExpirationDeals?: readonly unknown[];
  sellerOnSaleProducts?: readonly unknown[];
  oldDealAuthoritative: boolean;
  sellerListingAuthoritative: boolean;
}

function text(value: unknown): string {
  return String(value ?? '').trim();
}

export function canonicalGraytagRegistrationDate(value: unknown): string | null {
  const raw = text(value);
  const canonical = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})$/);
  const dotted = raw.match(/^(\d{2})\.\s*(\d{2})\.\s*(\d{2})(?:\s+(\d{2}):(\d{2}))?$/);
  const parts = canonical
    ? [Number(canonical[1]), Number(canonical[2]), Number(canonical[3]), Number(canonical[4]), Number(canonical[5])]
    : dotted
      ? [2000 + Number(dotted[1]), Number(dotted[2]), Number(dotted[3]), Number(dotted[4] ?? 0), Number(dotted[5] ?? 0)]
      : null;
  if (!parts) return null;
  const [year, month, day, hour, minute] = parts;
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day
    || date.getUTCHours() !== hour || date.getUTCMinutes() !== minute) return null;
  return `${year}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}${String(minute).padStart(2, '0')}`;
}

function price(row: any): number | null {
  const value = Number(row?.purePrice ?? row?.price);
  return Number.isFinite(value) ? value : null;
}

function isExplicitlyLinked(row: any, job: Pick<RenewalJob, 'dealUsid' | 'productUsid'>): boolean {
  const sourceDealUsid = text(row?.sourceDealUsid ?? row?.dealUsid);
  const previousProductUsid = text(row?.previousProductUsid);
  return (Boolean(sourceDealUsid) && sourceDealUsid === job.dealUsid)
    || (Boolean(previousProductUsid) && previousProductUsid === job.productUsid);
}

function isConservativeComposite(row: any, oldDeal: any, targetNewEnd: string): boolean {
  if (!oldDeal) return false;
  const oldName = text(oldDeal.productName ?? oldDeal.name);
  const oldType = text(oldDeal.productTypeString ?? oldDeal.productType);
  const rowName = text(row?.productName ?? row?.name);
  const rowType = text(row?.productTypeString ?? row?.productType);
  return Boolean(oldName && oldType && rowName === oldName && rowType === oldType)
    && price(oldDeal) !== null && price(row) === price(oldDeal)
    && canonicalGraytagRegistrationDate(row?.endDateTime ?? row?.endDate ?? row?.end) === targetNewEnd;
}

/** Build evidence without retaining any provider identifiers. */
export function buildRegistrationEvidenceSnapshot(
  job: Pick<RenewalJob, 'dealUsid' | 'productUsid' | 'newEnd'>,
  input: RegistrationEvidenceRows,
): RegistrationEvidenceSnapshot {
  const nearRows = Array.isArray(input.nearExpirationDeals) ? input.nearExpirationDeals as any[] : [];
  const sellerRows = Array.isArray(input.sellerOnSaleProducts) ? input.sellerOnSaleProducts as any[] : [];
  const oldDeal = nearRows.find((row) => text(row?.dealUsid) === job.dealUsid);
  const targetNewEnd = canonicalGraytagRegistrationDate(job.newEnd);
  const onSaleRows = sellerRows.filter((row) => text(row?.dealStatus ?? row?.productAvailable ?? row?.status) === 'OnSale');
  const exactListings = onSaleRows.filter((row) => isExplicitlyLinked(row, job));
  const exactListing = exactListings.find((row) => text(row?.priceType) === 'Extended'
    && Boolean(targetNewEnd)
    && canonicalGraytagRegistrationDate(row?.endDateTime ?? row?.endDate ?? row?.end) === targetNewEnd
    && Boolean(text(row?.productUsid ?? row?.usid))) || exactListings[0];
  const compositeListing = exactListing || onSaleRows.find((row) => Boolean(targetNewEnd) && isConservativeComposite(row, oldDeal, targetNewEnd!));
  const listing = exactListing || compositeListing;
  return {
    capturedAt: input.capturedAt,
    oldDeal: {
      authoritative: input.oldDealAuthoritative,
      present: Boolean(oldDeal),
      extensionProductExist: typeof oldDeal?.extensionProductExist === 'boolean' ? oldDeal.extensionProductExist : null,
      extensionStatus: oldDeal ? text(oldDeal.extensionStatus) || null : null,
      dealStatus: oldDeal ? text(oldDeal.dealStatus) || null : null,
    },
    extensionListing: {
      authoritative: input.sellerListingAuthoritative,
      present: Boolean(listing),
      priceType: listing ? text(listing.priceType) || null : null,
      linkedDeal: Boolean(exactListing),
      targetNewEnd: Boolean(listing && targetNewEnd
        && canonicalGraytagRegistrationDate(listing.endDateTime ?? listing.endDate ?? listing.end) === targetNewEnd),
      productIdPresent: Boolean(listing && text(listing.productUsid ?? listing.usid)),
    },
    error: !input.oldDealAuthoritative || !input.sellerListingAuthoritative,
  };
}
