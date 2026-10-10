import { deliverableOttOrder, hasGbutsOttProfileLease, ottKey, type GbutsOttListing, type GbutsOttOrder, type GbutsOttStore } from './gbuts-ott';
import { buildPartyAccessPublicPayload, type PartyAccessLinkStore } from './party-access';
import type { PartyMaintenanceChecklistStore } from './party-maintenance-checklist';
import type { GeneratedAccountStore } from './generated-accounts';

export function resolveGbutsOttDirectCredentials(order: GbutsOttOrder, listing: GbutsOttListing, data: {
  accessRecords: PartyAccessLinkStore; inventory: GbutsOttStore;
  maintenance: PartyMaintenanceChecklistStore; generated: GeneratedAccountStore;
}): { id: string; password: string } {
  const record = Object.values(data.accessRecords).filter(x => x.member.kind === 'gbuts' && x.member.memberId === order.key)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (!deliverableOttOrder(order) || !record || ottKey(record.serviceType, record.accountEmail) !== ottKey(listing.serviceType, listing.accountEmail)
    || record.profileName !== order.profileName || !hasGbutsOttProfileLease(data.inventory, order, record.profileName))
    throw new Error('구매자의 계정 배정을 확인하지 못했습니다.');
  const payload = buildPartyAccessPublicPayload(record, data.maintenance, data.generated, new Date().toISOString(), data.accessRecords);
  if (!payload.ok || !payload.credentials?.id || !payload.credentials.password)
    throw new Error('구매자의 최신 계정 정보를 확인하지 못했습니다.');
  return { id: payload.credentials.id, password: payload.credentials.password };
}
