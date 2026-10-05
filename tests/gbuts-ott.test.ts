import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activeOttOrder, accountGbutsInventory, isGbutsOttBuyerMatch, updateGbutsOttOrders, emptyGbutsOttStore, mergeGbutsOttManagement, sharedOttAccounts, type GbutsOttListing, type GbutsOttOrder } from '../src/lib/gbuts-ott';
import { createPartyAccessLinkRecord, isPartyAccessAllowed, buildPartyAccessProfileStatuses } from '../src/lib/party-access';
import { buildGbutsOttPost } from '../src/lib/gbuts-ott-client';

const now = new Date('2026-10-05T06:00:00Z');
import { fixtureListing, fixtureManagement, fixtureOrder } from './fixtures/gbuts-ott';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); }); afterEach(() => vi.useRealTimers());
describe('shared OTT capacity', () => {
  it('reserves unsold GButs places together with GrayTag listings', () => {
    const store = emptyGbutsOttStore(); store.listings['request-1'] = fixtureListing();
    expect(sharedOttAccounts(fixtureManagement(), [], store)[0]).toMatchObject({ total: 5, graytag: 3, gbuts: 2, available: 0 });
  });
  it('a paid member replaces a reserved GButs place rather than taking a second place', () => {
    const store = emptyGbutsOttStore(); store.listings['request-1'] = fixtureListing(); store.orders['100:1'] = fixtureOrder();
    expect(accountGbutsInventory(store, '넷플릭스', 'account@example.com', now)).toMatchObject({ currentUsers: 1, recruiting: 1 });
    expect(sharedOttAccounts(fixtureManagement(), [], store)[0].available).toBe(0);
  });
  it('keeps uncertain submissions and in-flight GrayTag registrations reserved', () => {
    const store = emptyGbutsOttStore(); store.listings['request-1'] = fixtureListing({ state: 'uncertain', capacity: 1 });
    store.graytagClaims.pending = { id: 'pending', serviceType: '넷플릭스', accountEmail: 'account@example.com', state: 'pending', createdAt: now.toISOString() };
    expect(sharedOttAccounts(fixtureManagement(), [], store)[0].available).toBe(0);
  });
  it('does not count a GrayTag claim again after its assigned product appears', () => {
    const store = emptyGbutsOttStore(); store.graytagClaims.claim = { id: 'claim', serviceType: '넷플릭스', accountEmail: 'account@example.com', productUsid: 'recruit-1', state: 'registered', createdAt: now.toISOString() };
    expect(sharedOttAccounts(fixtureManagement(), [], store)[0]).toMatchObject({ claims: 0, available: 2 });
  });
  it('closed listings release only the unsold places', () => {
    const store = emptyGbutsOttStore(); store.listings['request-1'] = fixtureListing({ state: 'closed' }); store.orders['100:1'] = fixtureOrder();
    expect(sharedOttAccounts(fixtureManagement(), [], store)[0]).toMatchObject({ gbuts: 1, available: 1 });
  });
  it('holds refund requests and releases confirmed refunds and expired members', () => {
    expect(activeOttOrder(fixtureOrder({ cancelStatus: 'REFUND_REQUESTED' }), now)).toBe(true);
    expect(activeOttOrder(fixtureOrder({ cancelStatus: 'REFUNDED' }), now)).toBe(false);
    expect(activeOttOrder(fixtureOrder({ endDate: '2026-10-04' }), now)).toBe(false);
  });
  it('detects overbooking and keeps service/account inventory separate', () => {
    const store = emptyGbutsOttStore(); store.listings['request-1'] = fixtureListing({ capacity: 3 });
    expect(sharedOttAccounts(fixtureManagement(), [], store)[0]).toMatchObject({ overbooked: true, available: 0 });
    expect(accountGbutsInventory(store, '티빙', 'account@example.com', now).currentUsers).toBe(0);
  });
  it('merges GButs counts without changing GrayTag member identities or input data', () => {
    const store = emptyGbutsOttStore(); store.listings['request-1'] = fixtureListing(); store.orders['100:1'] = fixtureOrder(); const management = fixtureManagement();
    const merged = mergeGbutsOttManagement(management, store);
    expect(merged.services[0].accounts[0]).toMatchObject({ usingCount: 3, gbutsInventory: { currentUsers: 1, recruiting: 1 } });
    expect(merged.services[0].accounts[0].members).toHaveLength(2); expect(management.services[0].accounts[0].usingCount).toBe(2);
  });
});
describe('GButs buyer access', () => {
  const record = () => createPartyAccessLinkRecord({ token: 'individual-buyer-token', serviceType: '넷플릭스', accountEmail: 'account@example.com',
    fallbackPassword: 'private-password', profileName: '구매자', member: { kind: 'gbuts', memberId: '100:1', memberName: '구매자', status: 'active', endDateTime: '2026-12-01', verifiedAt: now.toISOString() } });
  it('matches access to the exact buyer and account, rejecting changed identity or extended order dates', () => {
    const store = emptyGbutsOttStore(); store.listings['request-1'] = fixtureListing(); store.orders['100:1'] = fixtureOrder();
    const member = { seq: 1, userSeq: store.orders['100:1'].userSeq, subscriptionEndsAt: '2026-12-01 23:59:59' };
    expect(isGbutsOttBuyerMatch(store, record(), member)).toBe(true);
    expect(isGbutsOttBuyerMatch(store, record(), { ...member, userSeq: 999 })).toBe(false);
    expect(isGbutsOttBuyerMatch(store, { ...record(), accountEmail: 'other@example.com' }, member)).toBe(false);
    expect(isGbutsOttBuyerMatch(store, record(), { ...member, subscriptionEndsAt: '2027-01-01' })).toBe(false);
  });
  it('rejects orders whose dates extend beyond the bound listing before any delivery', () => {
    const store = emptyGbutsOttStore(); const listing = fixtureListing();
    expect(() => updateGbutsOttOrders(store, listing, [{ seq: 1, userSeq: 10, nickname: 'buyer', status: 'APPLY', cancelStatus: null, createdAt: '2026-10-05', subscriptionEndsAt: '2027-01-01' }], now.toISOString())).toThrow('이용 기간');
    expect(Object.values(store.orders)).toHaveLength(0);
  });
  it('allows a verified paid buyer and blocks revoked/refunded or unverified orders', () => {
    expect(isPartyAccessAllowed(record(), now.toISOString()).allowed).toBe(true);
    expect(isPartyAccessAllowed({ ...record(), revokedAt: now.toISOString() }, now.toISOString()).allowed).toBe(false);
    expect(isPartyAccessAllowed({ ...record(), member: { ...record().member, status: 'cancelled' } }, now.toISOString()).allowed).toBe(false);
    expect(isPartyAccessAllowed(record(), '2026-10-05T06:03:00Z').reason).toBe('verification-unavailable');
  });
  it('shows GButs profiles alongside authoritative GrayTag profiles', () => {
    const gbuts = record(); const grey = createPartyAccessLinkRecord({ token: 'grey', serviceType: gbuts.serviceType, accountEmail: gbuts.accountEmail,
      profileName: '그레이', member: { kind: 'graytag', memberId: 'grey-1', memberName: '그레이', status: 'Using', endDateTime: '2026-12-01' } });
    grey.id += ':management'; delete grey.shareToken;
    const rows = buildPartyAccessProfileStatuses(gbuts, { [gbuts.tokenHash]: gbuts, [grey.tokenHash]: grey }, now.toISOString());
    expect(rows.map(x => x.profileName)).toEqual(['구매자', '그레이']);
  });
  it('publishes access instructions instead of real account passwords', () => {
    const payload = buildGbutsOttPost(fixtureListing(), now);
    expect(payload).toMatchObject({ category: 5, priceType: 'DAY', memberLimit: 2, subscriptionType: 'SHARE', subscriptionEndsAt: '2026-12-01 23:59:59' });
    expect(JSON.stringify(payload)).not.toContain('private-password');
  });
});
