import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activeOttOrder, accountGbutsInventory, isGbutsOttBuyerMatch, updateGbutsOttOrders, emptyGbutsOttStore, mergeGbutsOttManagement, sharedOttAccounts, type GbutsOttListing, type GbutsOttOrder } from '../src/lib/gbuts-ott';
import { disneyEveryviewAccountKey } from '../src/lib/gbuts-disney-everyview';
import { createPartyAccessLinkRecord, isPartyAccessAllowed, buildPartyAccessProfileStatuses } from '../src/lib/party-access';
import { buildGbutsOttPost } from '../src/lib/gbuts-ott-client';

const now = new Date('2026-10-05T06:00:00Z');
import { fixtureListing, fixtureManagement, fixtureOrder } from './fixtures/gbuts-ott';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); }); afterEach(() => vi.useRealTimers());
describe('shared OTT capacity', () => {
  it.each(['(직접전달)', '아래 메세지를 확인해주세요', ''])('does not offer account placeholders as sellable inventory: %s', email => {
    const management = fixtureManagement(); management.services[0].accounts[0].email = email;
    expect(sharedOttAccounts(management, [], emptyGbutsOttStore())[0]).toMatchObject({ eligible: false, available: 0 });
  });
  it('reserves unsold GButs places together with GrayTag listings', () => {
    const store = emptyGbutsOttStore(); store.listings['request-1'] = fixtureListing();
    expect(sharedOttAccounts(fixtureManagement(), [], store)[0]).toMatchObject({ total: 5, graytag: 3, gbuts: 2, available: 0 });
  });
  it('counts a dedicated Everyview sixth seat exactly once before, during and after sale', () => {
    const store=emptyGbutsOttStore(),email='account@example.com',key=disneyEveryviewAccountKey(email);
    store.listings['request-1']=fixtureListing({serviceType:'디즈니플러스',deliveryMode:'disney-numbered-password',capacity:5});
    const management={services:[{serviceType:'디즈니플러스',accounts:[{email,serviceType:'디즈니플러스',totalSlots:6,
      members:[],expiryDate:'2026-12-31',generatedAccount:{paymentStatus:'paid'}}]}],onSaleByKeepAcct:{}} as any;
    expect(sharedOttAccounts(management,[],store,now)[0]).toMatchObject({total:6,gbuts:5,everyview:0,occupied:5,available:1});
    store.disneyEveryview={[key]:{accountCapacity:6,partyIds:[],snapshots:{}}};
    expect(sharedOttAccounts(management,[],store,now)[0]).toMatchObject({gbuts:5,everyview:1,occupied:6,available:0,overbooked:false});
    store.disneyEveryview[key]={accountCapacity:6,partyIds:[1],snapshots:{'1':{source:'everyview:1',complete:true,
      advertisedVacancies:1,verifiedAt:now.toISOString(),claims:[{id:'seat6',profileNumber:6,kind:'advertised',state:'pending'}]}}};
    expect(sharedOttAccounts(management,[],store,now)[0]).toMatchObject({everyview:1,occupied:6,available:0});
    store.disneyEveryview[key].snapshots['1']={source:'everyview:1',complete:true,advertisedVacancies:0,verifiedAt:now.toISOString(),
      claims:[{id:'seat6',profileNumber:6,kind:'buyer',state:'active'}]};
    expect(sharedOttAccounts(management,[],store,now)[0]).toMatchObject({everyview:1,occupied:6,available:0});
    store.disneyEveryview[key].snapshots['1'].complete=false;
    expect(sharedOttAccounts(management,[],store,now)[0]).toMatchObject({everyview:1,occupied:6,available:0});
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
    expect(String(payload.subscriptionPrincipal)).toContain('1:1 채팅');
    expect(String(payload.subscriptionPrincipal)).not.toContain('링크');
    expect(String(payload.noticeAfterOrder)).toContain('이메일 인증·로그인 코드는 제공하지 않습니다.');
  });
  it('replaces only obsolete Netflix access-link notices and preserves unrelated merchant copy', () => {
    const old = buildGbutsOttPost(fixtureListing({ noticeAfterOrder: '계정 확인 링크: https://email-verify.one/dashboard/access/history' }), now);
    expect(String(old.noticeAfterOrder)).not.toContain('email-verify.one');
    const custom = '비밀번호 입력 전용. 배정받은 프로필만 사용해주세요.';
    expect(buildGbutsOttPost(fixtureListing({ noticeAfterOrder: custom }), now).noticeAfterOrder).toBe(custom);
  });
});
