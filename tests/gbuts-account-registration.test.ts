import { Hono } from 'hono';
import { expect, test } from 'vitest';
import { registerManualAccountRoutes } from '../src/api/manual-account-registration';
import { mergeGeneratedAccountsIntoManagement, type GeneratedAccountStore } from '../src/lib/generated-accounts';
import { emptyGbutsOttStore, sharedOttAccounts } from '../src/lib/gbuts-ott';

test('registration saves an account before a listing and exposes paid future-expiry shared inventory once', async () => {
  let store: GeneratedAccountStore = {};
  const app = new Hono(); registerManualAccountRoutes(app, { read: () => store, write: next => { store = next; } });
  const response = await app.request('/generated-accounts/register', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serviceType: '티빙', email: 'mytvingid', password: 'secret!', paymentStatus: 'paid', expiryDate: '2099-12-01' }) });
  expect(response.status).toBe(200);
  const account = (await response.json()).account;
  expect(account).toMatchObject({ email: 'mytvingid', password: 'secret!', registrationKind: 'manual', emailId: '', paymentStatus: 'paid' });
  const management = mergeGeneratedAccountsIntoManagement({ services: [], summary: { totalAccounts: 0 }, onSaleByKeepAcct: {} }, store);
  expect(sharedOttAccounts(management, [], emptyGbutsOttStore())[0]).toMatchObject({ available: 4, endDate: '2099-12-01' });
  const again = mergeGeneratedAccountsIntoManagement(management, store);
  expect(again.summary.totalAccounts).toBe(1);
  expect(sharedOttAccounts(again, [], emptyGbutsOttStore())).toHaveLength(1);
});

test('duplicate and malformed registrations do not overwrite supplied credentials', async () => {
  let store: GeneratedAccountStore = {};
  const app = new Hono(); registerManualAccountRoutes(app, { read: () => store, write: next => { store = next; } });
  const register = (body: object) => app.request('/generated-accounts/register', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serviceType: '넷플릭스', email: 'new@example.com', password: 'secret!', ...body }) });
  expect((await register({})).status).toBe(200);
  expect((await register({ email: 'NEW@example.com', password: 'different' })).status).toBe(409);
  for (const invalid of [{ serviceType: 'unsupported' }, { email: '(직접전달)' }, { email: '아래메세지를꼭확인해주세요' }, { password: ' ' }, { expiryDate: '2099-02-30' }]) {
    expect((await register(invalid)).status).toBe(400);
  }
  expect(Object.values(store)).toHaveLength(1);
  expect(Object.values(store)[0].password).toBe('secret!');
  const management = mergeGeneratedAccountsIntoManagement({ services: [], summary: { totalAccounts: 0 }, onSaleByKeepAcct: {} }, store);
  expect(sharedOttAccounts(management, [], emptyGbutsOttStore())[0].available).toBe(0);
});

test('updated payment and expiry overlay a cached account without dropping reservations or duplicating slots', async () => {
  const { buildGeneratedAccount, normalizeGeneratedAccountPatch } = await import('../src/lib/generated-accounts');
  const pending = buildGeneratedAccount({ serviceType: '넷플릭스', alias: { id: 123, email: 'new@example.com' }, password: 'secret!', pin: '123456', memo: '' });
  const cached = mergeGeneratedAccountsIntoManagement({ services: [], summary: { totalAccounts: 0 }, onSaleByKeepAcct: {} }, { [pending.id]: pending });
  const paid = { ...pending, ...normalizeGeneratedAccountPatch({ paymentStatus: 'paid', expiryDate: '2099-12-01' }) };
  const member = { status: 'Using', endDateTime: '2099-12-01', productUsid: 'old-member' };
  cached.services[0].accounts[0].members = [member];
  const updated = mergeGeneratedAccountsIntoManagement(cached, { [paid.id]: paid });
  expect(updated.services[0].accounts[0].members).toEqual([member]);
  expect(updated.services[0].accounts[0].expiryDate).toBe('2099-12-01');
  expect(updated.summary.totalAccounts).toBe(1);
  expect(sharedOttAccounts(updated, [], emptyGbutsOttStore())[0]).toMatchObject({ occupied: 1, available: 4 });
  expect(() => normalizeGeneratedAccountPatch({ expiryDate: '2099-02-30' })).toThrow();
});

test('paid bundle expiry reaches both canonical service rows even when browsing a pending cached bundle', async () => {
  const { buildGeneratedAccount, normalizeGeneratedAccountPatch, registeredAccountSalesTargets } = await import('../src/lib/generated-accounts');
  const pending = buildGeneratedAccount({ serviceType: '티빙+웨이브', alias: { id: 4, email: 'gtwavve4.example@aleeas.com' }, password: 'secret!', pin: '123456', memo: '' });
  const cached = mergeGeneratedAccountsIntoManagement({ services: [], summary: { totalAccounts: 0 }, onSaleByKeepAcct: {} }, { [pending.id]: pending });
  const paid = { ...pending, ...normalizeGeneratedAccountPatch({ paymentStatus: 'paid', expiryDate: '2099-12-01' }) };
  const updated = mergeGeneratedAccountsIntoManagement(cached, { [paid.id]: paid });
  expect(updated.services.flatMap(service => service.accounts)).toHaveLength(2);
  expect(sharedOttAccounts(updated, [], emptyGbutsOttStore()).map(account => account.available)).toEqual([4, 4]);
  expect(registeredAccountSalesTargets(paid).find(account => account.serviceType === '티빙')?.email).toBe('gtwavve4');
});

test('unchecking bundle payment on a cached account immediately stops further sales while keeping existing occupants', async () => {
  const { buildGeneratedAccount } = await import('../src/lib/generated-accounts');
  const account = { ...buildGeneratedAccount({ serviceType: '티빙+웨이브', alias: { id: 8, email: 'gtwavve8.example@aleeas.com' }, password: 'secret!', pin: '', memo: '' }), paymentStatus: 'paid' as const, expiryDate: '2099-12-01' };
  const cached = mergeGeneratedAccountsIntoManagement({ services: [], summary: { totalAccounts: 0 }, onSaleByKeepAcct: {} }, { [account.id]: account });
  cached.services[0].accounts[0].members = [{ status: 'Using', endDateTime: '2099-12-01', productUsid: 'existing' }];
  const updated = mergeGeneratedAccountsIntoManagement(cached, { [account.id]: { ...account, paymentStatus: 'pending', expiryDate: null } });
  const inventory = sharedOttAccounts(updated, [], emptyGbutsOttStore());
  expect(inventory.every(row => row.available === 0)).toBe(true);
  expect(inventory[0].occupied).toBe(1);
  expect(updated.summary.totalAccounts).toBe(2);
});

test('manual bundle uses the supplied TVING login and rejects a second registration of either linked account', async () => {
  let store: GeneratedAccountStore = {};
  const app = new Hono(); registerManualAccountRoutes(app, { read: () => store, write: next => { store = next; } });
  const register = (body: object) => app.request('/generated-accounts/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const response = await register({ serviceType: '티빙+웨이브', email: 'alice2026@example.com', tvingLoginId: 'alice_tving', password: 'secret!', paymentStatus: 'paid', expiryDate: '2099-12-01' });
  expect(response.status).toBe(200);
  const { registeredAccountSalesTargets } = await import('../src/lib/generated-accounts');
  expect(registeredAccountSalesTargets((await response.json()).account)).toContainEqual({ serviceType: '티빙', email: 'alice_tving' });
  expect((await register({ serviceType: '웨이브', email: 'alice2026@example.com', password: 'different' })).status).toBe(409);
  expect((await register({ serviceType: '티빙', email: 'alice_tving', password: 'different' })).status).toBe(409);
});

test('buyer delivery resolves the explicit manual TVING login before any unrelated numeric bundle', async () => {
  const { buildGeneratedAccount, manualRegisteredAccount } = await import('../src/lib/generated-accounts');
  const { createPartyAccessLinkRecord, enrichPartyAccessRecordWithKnownCredentials } = await import('../src/lib/party-access');
  const unrelated = buildGeneratedAccount({ serviceType: '티빙+웨이브', alias: { id: 4, email: 'gtwavve4.example@aleeas.com' }, password: 'wrong-password', pin: '444444', memo: '' });
  const manual = manualRegisteredAccount({ serviceType: '티빙+웨이브', email: 'alice2026@example.com', tvingLoginId: 'mytving4', password: 'correct-password' }, 'manual-1');
  const record = createPartyAccessLinkRecord({ token: 'a'.repeat(32), serviceType: '티빙', accountEmail: 'mytving4', member: { kind: 'gbuts', memberId: '100:1', memberName: 'buyer', status: 'active' } });
  const enriched = enrichPartyAccessRecordWithKnownCredentials(record, {}, {}, { [unrelated.id]: unrelated, [manual.id]: manual });
  expect(enriched.fallbackPassword).toBe('correct-password');
  expect(enriched.fallbackPin).toBe(''); expect(enriched.emailAccessUrl).toBe('');
});

test('pending bundle overlays fresh provider rows by canonical login without requiring generated metadata', async () => {
  const { manualRegisteredAccount } = await import('../src/lib/generated-accounts');
  const account = manualRegisteredAccount({ serviceType: '티빙+웨이브', email: 'bundle@example.com', tvingLoginId: 'bundle_id', password: 'secret!', expiryDate: null }, 'bundle');
  const services = [{ serviceType: '티빙', email: 'bundle_id' }, { serviceType: '웨이브', email: 'bundle@example.com' }].map(row => ({ serviceType: row.serviceType,
    accounts: [{ ...row, totalSlots: 4, expiryDate: '2099-12-01', members: [{ status: 'Using', endDateTime: '2099-12-01', productUsid: row.serviceType }] }], totalUsingMembers: 1, totalActiveMembers: 1, totalIncome: 0, totalRealized: 0 }));
  const updated = mergeGeneratedAccountsIntoManagement({ services, summary: { totalAccounts: 2 }, onSaleByKeepAcct: {} }, { [account.id]: account });
  expect(updated.summary.totalAccounts).toBe(2);
  expect(sharedOttAccounts(updated, [], emptyGbutsOttStore()).map(row => ({ occupied: row.occupied, available: row.available }))).toEqual([{ occupied: 1, available: 0 }, { occupied: 1, available: 0 }]);
});
