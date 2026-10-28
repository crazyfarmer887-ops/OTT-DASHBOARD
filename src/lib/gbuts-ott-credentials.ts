import { deliverableOttOrder, hasGbutsOttProfileLease, ottKey, type GbutsOttListing, type GbutsOttOrder, type GbutsOttStore } from './gbuts-ott';
import { buildPartyAccessPublicPayload, createPartyAccessLinkRecord, enrichPartyAccessRecordWithKnownCredentials, resolvePartyAccessCredentials, type PartyAccessLinkStore } from './party-access';
import { assertGbutsOttCredentials, type GbutsOttCredentials } from './gbuts-disney-delivery';
import { tinyhostMailboxUrl, emailVerifyDisneyMailboxUrl } from './disney-mailbox';
import type { PartyMaintenanceChecklistStore } from './party-maintenance-checklist';
import type { GeneratedAccountStore } from './generated-accounts';

export function resolveGbutsOttDirectCredentials(order: GbutsOttOrder, listing: GbutsOttListing, data: {
  accessRecords: PartyAccessLinkStore; inventory: GbutsOttStore;
  maintenance: PartyMaintenanceChecklistStore; generated: GeneratedAccountStore;
}): GbutsOttCredentials {
  const record = Object.values(data.accessRecords).filter(x => x.member.kind === 'gbuts' && x.member.memberId === order.key)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (!deliverableOttOrder(order) || !record || ottKey(record.serviceType, record.accountEmail) !== ottKey(listing.serviceType, listing.accountEmail)
    || record.profileName !== order.profileName || !hasGbutsOttProfileLease(data.inventory, order, record.profileName))
    throw new Error('구매자의 계정 배정을 확인하지 못했습니다.');
  const payload = buildPartyAccessPublicPayload(record, data.maintenance, data.generated, new Date().toISOString(), data.accessRecords);
  if (!payload.ok || !payload.credentials?.id || !payload.credentials.password)
    throw new Error('구매자의 최신 계정 정보를 확인하지 못했습니다.');
  if (listing.deliveryMode === 'disney-numbered-password' && payload.emailAccessUrl)
    return resolveGbutsDisneyListingCredentials(listing, data);
  return { id: payload.credentials.id, password: payload.credentials.password,
    ...(listing.deliveryMode === 'disney-numbered-password' && payload.emailAccessUrl ? { emailAccessUrl: payload.emailAccessUrl } : {}) };
}

/** Admin-only publication data; never writes credentials to the sales journal. */
export function resolveGbutsDisneyListingCredentials(listing: GbutsOttListing, data: {
  accessRecords: PartyAccessLinkStore; maintenance: PartyMaintenanceChecklistStore; generated: GeneratedAccountStore;
}): GbutsOttCredentials {
  if (listing.serviceType !== '디즈니플러스' || listing.deliveryMode !== 'disney-numbered-password') throw new Error('디즈니 계정 연결을 확인해주세요.');
  const accounts = Object.values(data.generated).filter(x => ottKey(x.serviceType, x.email) === ottKey(listing.serviceType, listing.accountEmail));
  if (accounts.length !== 1 || !['tinyhost', 'emailverify'].includes(accounts[0].emailAccessProvider || '')) throw new Error('디즈니 계정의 이메일 인증 연결을 확인해주세요.');
  const record = createPartyAccessLinkRecord({ token: 'admin-disney-publication-preview', serviceType: listing.serviceType, accountEmail: listing.accountEmail, fallbackPassword: accounts[0].password,
    profileName: '1', member: { kind: 'gbuts', memberId: `preview:${listing.id}`, memberName: '(판매글 계정 확인)', status: 'active', endDateTime: listing.endDate } });
  const enriched = enrichPartyAccessRecordWithKnownCredentials(record, data.accessRecords, data.maintenance, data.generated);
  const credentials = resolvePartyAccessCredentials(enriched, data.maintenance, data.generated);
  const emailverify = accounts[0].emailAccessProvider === 'emailverify';
  if (emailverify && (credentials.id.trim().toLowerCase() !== accounts[0].email.trim().toLowerCase() || !/^\d{6}$/.test(credentials.pin))) throw new Error('이메일 인증 PIN을 확인해주세요.');
  const result = { id: credentials.id, password: credentials.password,
    emailAccessUrl: emailverify ? emailVerifyDisneyMailboxUrl(credentials.id) : tinyhostMailboxUrl(credentials.id),
    ...(emailverify ? { emailAccessPin: credentials.pin } : {}) };
  assertGbutsOttCredentials(result);
  if (!result.emailAccessUrl) throw new Error('이메일 인증 주소를 확인해주세요.');
  return result;
}

/** Netflix renewal publication uses the same current paid account resolution as buyer delivery. */
export function resolveGbutsNetflixListingCredentials(listing: GbutsOttListing, data: {
  accessRecords: PartyAccessLinkStore; maintenance: PartyMaintenanceChecklistStore; generated: GeneratedAccountStore;
}): GbutsOttCredentials {
  if (listing.serviceType !== '넷플릭스') throw new Error('넷플릭스 계정 연결을 확인해주세요.');
  const accounts = Object.values(data.generated).filter(x => ottKey(x.serviceType, x.email) === ottKey(listing.serviceType, listing.accountEmail));
  if (accounts.length !== 1 || accounts[0].paymentStatus !== 'paid') throw new Error('결제된 넷플릭스 계정 정보를 확인해주세요.');
  const record = createPartyAccessLinkRecord({ token: 'admin-netflix-publication-preview', serviceType: listing.serviceType,
    accountEmail: listing.accountEmail, fallbackPassword: accounts[0].password, profileName: '1',
    member: { kind: 'gbuts', memberId: `preview:${listing.id}`, memberName: '(판매글 계정 확인)', status: 'active', endDateTime: listing.endDate } });
  const enriched = enrichPartyAccessRecordWithKnownCredentials(record, data.accessRecords, data.maintenance, data.generated);
  const credentials = resolvePartyAccessCredentials(enriched, data.maintenance, data.generated);
  const result = { id: credentials.id, password: credentials.password }; assertGbutsOttCredentials(result); return result;
}
