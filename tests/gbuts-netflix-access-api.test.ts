import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
const provider = vi.hoisted(() => ({ members: [] as any[] }));
vi.mock('../src/api/gbuts-ott', async importOriginal => ({ ...(await importOriginal<any>()), gbutsOttClient: () => ({ listOttMembers: async () => provider.members }) }));
import app, { gbutsOttRuntimeDependencies } from '../src/api/index';
import { createPartyAccessLinkRecord } from '../src/lib/party-access';
import { emptyGbutsOttStore } from '../src/lib/gbuts-ott';
import { fixtureListing, fixtureOrder } from './fixtures/gbuts-ott';
let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'netflix-access-'));
  vi.stubEnv('AIO_ADMIN_TOKEN', 'test-admin-token');
  vi.stubEnv('GBUTS_OTT_STORE_PATH', join(directory, 'orders.json'));
  vi.stubEnv('PARTY_ACCESS_LINKS_PATH', join(directory, 'access.json'));
});
afterEach(() => { vi.unstubAllEnvs(); rmSync(directory, { recursive: true, force: true }); });
test('both periodic refresh and real public consent route deny the former buyer of a reused profile', async () => {
  const now = new Date().toISOString();
  const store = emptyGbutsOttStore(); store.listings['request-1'] = fixtureListing();
  store.orders['100:3'] = fixtureOrder({ key: '100:3', memberSeq: 3, userSeq: 30, profileNumber: 3, profileName: '3', profileReleasedAt: now, profileReleaseReason: 'refunded', verifiedAt: now });
  store.orders['100:6'] = fixtureOrder({ key: '100:6', memberSeq: 6, userSeq: 60, profileNumber: 3, profileName: '3', verifiedAt: now });
  writeFileSync(process.env.GBUTS_OTT_STORE_PATH!, JSON.stringify(store));
  const record = createPartyAccessLinkRecord({ token: 'released-buyer', serviceType: '넷플릭스', accountEmail: 'account@example.com', profileName: '3', fallbackPassword: 'private-password',
    member: { kind: 'gbuts', memberId: '100:3', memberName: 'old buyer', status: 'active', endDateTime: '2026-12-01', verifiedAt: now } });
  writeFileSync(process.env.PARTY_ACCESS_LINKS_PATH!, JSON.stringify({ [record.tokenHash]: record }));
  provider.members = [{ seq: 3, userSeq: 30, status: 'APPLY', cancelStatus: null, subscriptionEndsAt: '2026-12-01' }];
  await gbutsOttRuntimeDependencies.refreshAccess(Object.values(store.orders));
  expect(JSON.parse(readFileSync(process.env.PARTY_ACCESS_LINKS_PATH!, 'utf8'))[record.tokenHash].revokedAt).toBeTruthy();
  const response = await app.request('/party-access/released-buyer');
  const body = await response.json() as any;
  expect(body.ok).toBe(false); expect(body.credentials).toBeUndefined();
  const consent = await app.request('/party-access/released-buyer/consent', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phrases: ['계정 정보를 절대 변경하지 않겠습니다.', '로그인 안 될 때 이 페이지를 먼저 확인하겠습니다.', '배정된 1개 프로필만 사용하겠습니다.'] }) });
  expect((await consent.json() as any).credentials).toBeUndefined();
});
test('real manual member endpoint rejects an occupied GButs profile before any persistence', async () => {
  const store = emptyGbutsOttStore(); store.listings['request-1'] = fixtureListing();
  store.orders['100:1'] = fixtureOrder({ profileNumber: 1, profileName: '1' });
  writeFileSync(process.env.GBUTS_OTT_STORE_PATH!, JSON.stringify(store));
  const response = await app.request('/manual-members', { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-token': 'test-admin-token' },
    body: JSON.stringify({ serviceType: '넷플릭스', accountEmail: 'account@example.com', memberName: '1', startDate: '2026-10-06', endDate: '2026-12-01', price: 1000 }) });
  expect(response.status).toBe(409); expect((await response.json() as any).error).toContain('벗츠 구매자');
});
