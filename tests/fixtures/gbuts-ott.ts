import type { GbutsOttListing, GbutsOttOrder } from '../../src/lib/gbuts-ott';
const now = new Date('2026-10-05T06:00:00Z');
export const fixtureManagement = () => ({ services: [{ serviceType: '넷플릭스', totalUsingMembers: 2, totalActiveMembers: 3, accounts: [{
  email: 'account@example.com', serviceType: '넷플릭스', totalSlots: 5, usingCount: 2, activeCount: 3, expiryDate: '20261231T2359', keepPasswd: 'private-password',
  members: [1, 2].map(i => ({ dealUsid: `deal-${i}`, productUsid: `product-${i}`, status: 'Using', endDateTime: '20261231T2359', profileName: `프로필${i}` })),
}] }], onSaleByKeepAcct: { 'account@example.com': [{ productUsid: 'recruit-1', productType: '넷플릭스', endDateTime: '20261231T2359' }] } });
export const fixtureListing = (patch: Partial<GbutsOttListing> = {}): GbutsOttListing => ({ id: 'request-1', requestHash: 'hash', serviceType: '넷플릭스', accountEmail: 'account@example.com', capacity: 2,
  dailyPrice: 200, endDate: '2026-12-01', title: '프리미엄', description: '본인 프로필만 이용해주세요.', state: 'registered', postSeq: 100, createdAt: now.toISOString(), ...patch });
export const fixtureOrder = (patch: Partial<GbutsOttOrder> = {}): GbutsOttOrder => ({ key: '100:1', listingId: 'request-1', postSeq: 100, memberSeq: 1, userSeq: 10,
  name: '구매자', status: 'APPLY', cancelStatus: null, startDate: '2026-10-05', endDate: '2026-12-01', delivery: 'ready', verifiedAt: now.toISOString(), ...patch });

