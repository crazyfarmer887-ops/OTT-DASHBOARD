import { isGraytagAccessNoticeCredential } from './graytag-fill';
import type { PartyAccessDeliverySnapshot } from './party-access';

export interface ManagementAccountResolutionInput {
  serviceType: string;
  rawKeepAcct: string;
  dealStatus: string;
  dealUsid: string;
  productUsid: string;
  placeholderSnapshotByDealUsid: ReadonlyMap<string, PartyAccessDeliverySnapshot>;
  onSaleSnapshotByProductUsid: ReadonlyMap<string, PartyAccessDeliverySnapshot>;
  uniqueOnSaleSnapshotForService?: PartyAccessDeliverySnapshot;
  directListingSnapshot?: PartyAccessDeliverySnapshot;
  assignmentAccountEmail?: string;
}

export interface ManagementAccountResolution {
  accountEmail: string;
  snapshot?: PartyAccessDeliverySnapshot;
}

function usableSnapshot(
  snapshot: PartyAccessDeliverySnapshot | undefined,
  serviceType: string,
): PartyAccessDeliverySnapshot | undefined {
  if (!snapshot || snapshot.revokedAt) return undefined;
  if (String(snapshot.serviceType || '').trim() !== serviceType) return undefined;
  const accountEmail = String(snapshot.accountEmail || '').trim();
  if (!accountEmail || isGraytagAccessNoticeCredential(accountEmail)) return undefined;
  return snapshot;
}

/**
 * Resolves the management grouping account without broad current-member inference.
 * Service-wide on-sale evidence is listing-only and must never leak into Using deals.
 */
export function resolveManagementAccount(input: ManagementAccountResolutionInput): ManagementAccountResolution {
  const rawKeepAcct = String(input.rawKeepAcct || '').trim();
  if (!isGraytagAccessNoticeCredential(rawKeepAcct)) {
    return { accountEmail: rawKeepAcct || '(직접전달)' };
  }

  const serviceType = String(input.serviceType || '').trim();
  const dealUsid = String(input.dealUsid || '').trim();
  const productUsid = String(input.productUsid || '').trim();
  const candidates: Array<PartyAccessDeliverySnapshot | undefined> = [
    dealUsid ? input.placeholderSnapshotByDealUsid.get(dealUsid) : undefined,
    productUsid ? input.onSaleSnapshotByProductUsid.get(productUsid) : undefined,
    input.directListingSnapshot,
    String(input.dealStatus || '').trim().toLowerCase() === 'onsale'
      ? input.uniqueOnSaleSnapshotForService
      : undefined,
  ];

  for (const candidate of candidates) {
    const snapshot = usableSnapshot(candidate, serviceType);
    if (snapshot) return { accountEmail: String(snapshot.accountEmail).trim(), snapshot };
  }

  const assignmentAccountEmail = String(input.assignmentAccountEmail || '').trim();
  if (assignmentAccountEmail && !isGraytagAccessNoticeCredential(assignmentAccountEmail)) {
    return { accountEmail: assignmentAccountEmail };
  }
  return { accountEmail: '(직접전달)' };
}
