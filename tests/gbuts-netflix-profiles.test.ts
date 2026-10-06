import { expect, test } from 'vitest';
import { allocateNetflixProfiles, availableNetflixProfiles } from '../src/lib/gbuts-netflix-profiles';
import { accountGbutsInventory, emptyGbutsOttStore } from '../src/lib/gbuts-ott';
import { fixtureListing, fixtureOrder } from './fixtures/gbuts-ott';
const now = new Date('2026-10-06T08:00:00Z');
const management = () => ({ services: [{ serviceType: '넷플릭스', accounts: [{ serviceType: '넷플릭스', email: 'account@example.com', members: [], totalSlots: 5 }] }], onSaleByKeepAcct: {} });
function fixture() {
  const store = emptyGbutsOttStore(); store.listings.l = fixtureListing({ id: 'l', capacity: 5 });
  for (const i of [5, 4, 3, 2, 1]) store.orders[`100:${i}`] = fixtureOrder({ key: `100:${i}`, memberSeq: i, userSeq: i, listingId: 'l', purchasedAt: `2026-10-06 10:0${i}:00` });
  return store;
}
test('assigns five buyers by purchase time and remembers the vacated third place after restart', () => {
  const store = fixture(); allocateNetflixProfiles(store, management(), [], now);
  for (let i = 1; i <= 5; i++) expect(store.orders[`100:${i}`]).toMatchObject({ profileNumber: i, profileName: String(i) });
  const restored = structuredClone(store); restored.orders['100:3'].cancelStatus = 'REFUNDED';
  restored.orders['100:6'] = fixtureOrder({ key: '100:6', memberSeq: 6, userSeq: 6, listingId: 'l', purchasedAt: '2026-10-06 12:00:00' });
  allocateNetflixProfiles(restored, management(), [], now);
  expect(restored.orders['100:6'].profileNumber).toBe(3);
  expect(restored.orders['100:3'].profileReleasedAt).toBe(now.toISOString());
  for (const i of [1, 2, 4, 5]) expect(restored.orders[`100:${i}`].profileNumber).toBe(i);
});

test('pending refund and missing roster hold assigned places across a closed listing', () => {
  const store = fixture(); allocateNetflixProfiles(store, management(), [], now);
  store.orders['100:3'].cancelStatus = 'REFUND_REQUESTED';
  store.orders['100:4'].status = 'MISSING';
  store.listings.l.state = 'closed';
  allocateNetflixProfiles(store, management(), [], now);
  expect(availableNetflixProfiles(store, management(), [], 'account@example.com', now)).toEqual([]);
  expect(accountGbutsInventory(store, '넷플릭스', 'account@example.com', now).currentUsers).toBe(5);
  expect(store.orders['100:3'].profileReleasedAt).toBeUndefined();
  expect(store.orders['100:4'].profileReleasedAt).toBeUndefined();
  store.orders['100:4'].status = 'APPLY';
  allocateNetflixProfiles(store, management(), [], now);
  expect(store.orders['100:4'].profileNumber).toBe(4);
});

test('expiry returns a number but reactivation of its old lease cannot reclaim it', () => {
  const store = fixture(); allocateNetflixProfiles(store, management(), [], now);
  store.orders['100:3'].endDate = '2026-10-05';
  store.orders['100:6'] = fixtureOrder({ key: '100:6', memberSeq: 6, listingId: 'l', purchasedAt: '2026-10-06 12:00:00' });
  allocateNetflixProfiles(store, management(), [], now);
  expect(store.orders['100:3'].profileReleaseReason).toBe('expired');
  expect(store.orders['100:6'].profileNumber).toBe(3);
  store.orders['100:3'].endDate = '2026-12-01';
  expect(() => allocateNetflixProfiles(store, management(), [], now)).toThrow('다시 활성화');
});

test('all listings share one profile book while a different account has its own book', () => {
  const store = fixture(); allocateNetflixProfiles(store, management(), [], now);
  store.listings.second = fixtureListing({ id: 'second', postSeq: 200 });
  store.orders['200:1'] = fixtureOrder({ key: '200:1', postSeq: 200, listingId: 'second', purchasedAt: '2026-10-06 12:00:00' });
  expect(() => allocateNetflixProfiles(store, management(), [], now)).toThrow('사용 가능한');
  store.orders['100:3'].cancelStatus = 'REFUNDED';
  allocateNetflixProfiles(store, management(), [], now);
  expect(store.orders['200:1'].profileNumber).toBe(3);
  store.listings.other = fixtureListing({ id: 'other', postSeq: 300, accountEmail: 'other@example.com' });
  store.orders['300:1'] = fixtureOrder({ key: '300:1', postSeq: 300, listingId: 'other' });
  const m = management(); m.services[0].accounts.push({ ...m.services[0].accounts[0], email: 'other@example.com' });
  allocateNetflixProfiles(store, m, [], now);
  expect(store.orders['300:1'].profileNumber).toBe(1);
});

test('mapped GrayTag and manual profiles are unavailable and unknown external profiles stop allocation', () => {
  const store = emptyGbutsOttStore(); store.listings.l = fixtureListing({ id: 'l' });
  store.orders['100:1'] = fixtureOrder({ listingId: 'l' });
  const m: any = management();
  m.services[0].accounts[0].members.push({ dealUsid: 'd1', productUsid: 'p1', profileName: '프로필1', status: 'Using', endDateTime: '20261231T2359' });
  m.onSaleByKeepAcct['account@example.com'] = [{ productUsid: 'p2', profileName: '2', productType: '넷플릭스', endDateTime: '20261231T2359' }];
  const manual = [{ id: 'm1', serviceType: '넷플릭스', accountEmail: 'account@example.com', status: 'active', endDate: '2026-12-01', profileName: '3번' }];
  allocateNetflixProfiles(store, m, manual, now);
  expect(store.orders['100:1'].profileNumber).toBe(4);
  m.services[0].accounts[0].members[0].profileName = '감귤';
  expect(() => allocateNetflixProfiles(store, m, manual, now)).toThrow('기존 프로필 번호');
});

test('rejects existing duplicate assignments and never renumbers a previously delivered nickname', () => {
  const store = fixture(); allocateNetflixProfiles(store, management(), [], now);
  store.orders['100:5'].profileNumber = 1; store.orders['100:5'].profileName = '1';
  expect(() => allocateNetflixProfiles(store, management(), [], now)).toThrow('중복 배정');
  const old = fixture(); old.orders['100:1'].profileName = '감귤'; old.orders['100:1'].delivery = 'confirmed';
  expect(() => allocateNetflixProfiles(old, management(), [], now)).toThrow('자동으로 번호를 변경');
});
