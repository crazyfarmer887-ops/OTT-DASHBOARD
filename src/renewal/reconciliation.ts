export type RegistrationReconciliationDecision = 'registered' | 'registration_failed_safe' | 'verification_needed';

export interface RegistrationEvidenceSnapshot {
  capturedAt: string;
  oldDeal: {
    authoritative: boolean;
    present: boolean;
    extensionProductExist: boolean | null;
    extensionStatus: string | null;
    dealStatus: string | null;
  };
  extensionListing: {
    authoritative: boolean;
    present: boolean;
    priceType: string | null;
    linkedDeal: boolean;
    targetNewEnd: boolean;
    productIdPresent: boolean;
  };
  error?: boolean;
}

export interface SanitizedRegistrationEvidence {
  capturedAt: string;
  oldDealAuthoritative: boolean;
  oldDealPresent: boolean;
  extensionProductExists: boolean;
  extensionStatusPresent: boolean;
  dealStatusEligible: boolean;
  sellerListingAuthoritative: boolean;
  sellerListingPresent: boolean;
  priceTypeExtended: boolean;
  linkedDeal: boolean;
  targetNewEnd: boolean;
  productIdPresent: boolean;
  exactMatch: boolean;
  contradictory: boolean;
  authoritativeNegative: boolean;
  error: boolean;
}

export interface RegistrationReconciliationPolicy {
  minimumNegativeChecks?: number;
  minimumWindowMs?: number;
  manualAgedJob?: {
    createdAt: string;
    minimumAgeMs?: number;
    freshNegativeChecks?: number;
  };
}

const ELIGIBLE_OLD_DEAL_STATUSES = new Set(['UsingNearExpiration', 'ExtensionUsingNearExpiration']);

function isExactMatch(snapshot: RegistrationEvidenceSnapshot): boolean {
  const listing = snapshot.extensionListing;
  return listing.authoritative
    && listing.present
    && listing.priceType === 'Extended'
    && listing.linkedDeal
    && listing.targetNewEnd
    && listing.productIdPresent;
}

function isContradictory(snapshot: RegistrationEvidenceSnapshot): boolean {
  if (isExactMatch(snapshot)) return false;
  const oldDealClaimsExtension = snapshot.oldDeal.extensionProductExist === true
    || Boolean(String(snapshot.oldDeal.extensionStatus || '').trim());
  const partialSellerMatch = snapshot.extensionListing.present && (
    snapshot.extensionListing.priceType === 'Extended'
    || snapshot.extensionListing.linkedDeal
    || snapshot.extensionListing.targetNewEnd
    || snapshot.extensionListing.productIdPresent
  );
  return oldDealClaimsExtension || partialSellerMatch;
}

function isAuthoritativeNegative(snapshot: RegistrationEvidenceSnapshot): boolean {
  return !snapshot.error
    && snapshot.oldDeal.authoritative
    && snapshot.oldDeal.present
    && snapshot.oldDeal.extensionProductExist === false
    && !String(snapshot.oldDeal.extensionStatus || '').trim()
    && ELIGIBLE_OLD_DEAL_STATUSES.has(String(snapshot.oldDeal.dealStatus || ''))
    && snapshot.extensionListing.authoritative
    && !snapshot.extensionListing.present
    && !isContradictory(snapshot);
}

function validTime(value: string): number | null {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

export function summarizeRegistrationEvidence(snapshot: RegistrationEvidenceSnapshot): SanitizedRegistrationEvidence {
  const exactMatch = isExactMatch(snapshot);
  return {
    capturedAt: snapshot.capturedAt,
    oldDealAuthoritative: snapshot.oldDeal.authoritative,
    oldDealPresent: snapshot.oldDeal.present,
    extensionProductExists: snapshot.oldDeal.extensionProductExist === true,
    extensionStatusPresent: Boolean(String(snapshot.oldDeal.extensionStatus || '').trim()),
    dealStatusEligible: ELIGIBLE_OLD_DEAL_STATUSES.has(String(snapshot.oldDeal.dealStatus || '')),
    sellerListingAuthoritative: snapshot.extensionListing.authoritative,
    sellerListingPresent: snapshot.extensionListing.present,
    priceTypeExtended: snapshot.extensionListing.priceType === 'Extended',
    linkedDeal: snapshot.extensionListing.linkedDeal,
    targetNewEnd: snapshot.extensionListing.targetNewEnd,
    productIdPresent: snapshot.extensionListing.productIdPresent,
    exactMatch,
    contradictory: isContradictory(snapshot),
    authoritativeNegative: isAuthoritativeNegative(snapshot),
    error: snapshot.error === true,
  };
}

export function decideRegistrationReconciliation(
  snapshots: readonly RegistrationEvidenceSnapshot[],
  policy: RegistrationReconciliationPolicy = {},
): RegistrationReconciliationDecision {
  if (snapshots.some(isExactMatch)) return 'registered';
  if (!snapshots.length) return 'verification_needed';

  const summaries = snapshots.map(summarizeRegistrationEvidence);
  if (summaries.some((snapshot) => snapshot.error || snapshot.contradictory
    || !snapshot.oldDealAuthoritative || !snapshot.oldDealPresent || !snapshot.sellerListingAuthoritative)) {
    return 'verification_needed';
  }
  const negatives = summaries.filter((snapshot) => snapshot.authoritativeNegative);
  if (negatives.length !== summaries.length) return 'verification_needed';

  const times = negatives.map((snapshot) => validTime(snapshot.capturedAt));
  if (times.some((time) => time === null)) return 'verification_needed';
  const numericTimes = times as number[];
  const span = Math.max(...numericTimes) - Math.min(...numericTimes);
  const minimumChecks = Math.max(3, Math.floor(policy.minimumNegativeChecks ?? 3));
  const minimumWindowMs = Math.max(10_000, Math.floor(policy.minimumWindowMs ?? 10_000));
  if (negatives.length >= minimumChecks && span >= minimumWindowMs) return 'registration_failed_safe';

  const manual = policy.manualAgedJob;
  const createdAt = manual ? validTime(manual.createdAt) : null;
  const newest = Math.max(...numericTimes);
  const minimumAgeMs = Math.max(60_000, Math.floor(manual?.minimumAgeMs ?? 60_000));
  const freshChecks = Math.max(2, Math.floor(manual?.freshNegativeChecks ?? 2));
  if (manual && createdAt !== null && newest - createdAt >= minimumAgeMs && negatives.length >= freshChecks) {
    return 'registration_failed_safe';
  }
  return 'verification_needed';
}
