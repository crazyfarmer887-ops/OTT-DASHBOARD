import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import apiApp from '../src/api/index';
import { createPartyAccessLinkRecord, partyAccessTokenHash } from '../src/lib/party-access';

const adminToken = 'test-admin-token';
let tempDir: string;
const originalAdminToken = process.env.AIO_ADMIN_TOKEN;
const originalPartyAccessLinksPath = process.env.PARTY_ACCESS_LINKS_PATH;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'party-access-admin-credentials-'));
  process.env.AIO_ADMIN_TOKEN = adminToken;
  process.env.PARTY_ACCESS_LINKS_PATH = join(tempDir, 'party-access-links.json');
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
  if (originalAdminToken === undefined) delete process.env.AIO_ADMIN_TOKEN;
  else process.env.AIO_ADMIN_TOKEN = originalAdminToken;
  if (originalPartyAccessLinksPath === undefined) delete process.env.PARTY_ACCESS_LINKS_PATH;
  else process.env.PARTY_ACCESS_LINKS_PATH = originalPartyAccessLinksPath;
});

function seedAccessRecord(token: string, overrides: Partial<Parameters<typeof createPartyAccessLinkRecord>[0]> = {}) {
  const record = createPartyAccessLinkRecord({
    token,
    now: '2026-06-07T00:00:00.000Z',
    serviceType: '넷플릭스',
    accountEmail: 'old-id@example.com',
    fallbackPassword: 'old-password',
    profileName: '사과',
    member: {
      kind: 'graytag',
      memberId: 'deal-admin-edit',
      memberName: '구매자',
      status: 'Using',
      statusName: '사용중',
      startDateTime: '2026-06-01',
      endDateTime: '2026-09-01',
    },
    ...overrides,
  });
  writeFileSync(process.env.PARTY_ACCESS_LINKS_PATH!, JSON.stringify({ [record.tokenHash]: record }, null, 2), 'utf8');
  return record;
}

describe('admin-only buyer access credential edits', () => {
  test('rejects credential edits without the admin token', async () => {
    seedAccessRecord('admin-edit-token');

    const res = await apiApp.request('/party-access/admin-edit-token/credentials', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accountEmail: 'new-id@example.com', password: 'new-password' }),
    });

    expect(res.status).toBe(403);
  });

  test('admin can update the ID/PW delivered by an existing access page', async () => {
    seedAccessRecord('admin-edit-token');

    const patchRes = await apiApp.request('/party-access/admin-edit-token/credentials', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-admin-token': adminToken },
      body: JSON.stringify({ accountEmail: 'new-id@example.com', password: 'new-password' }),
    });

    expect(patchRes.status).toBe(200);
    const patchJson = await patchRes.json() as any;
    expect(patchJson.ok).toBe(true);
    expect(patchJson.credentials).toMatchObject({ id: 'new-id@example.com', password: 'new-password' });

    const store = JSON.parse(readFileSync(process.env.PARTY_ACCESS_LINKS_PATH!, 'utf8')) as any;
    const updated = store[partyAccessTokenHash('admin-edit-token')];
    expect(updated.accountEmail).toBe('new-id@example.com');
    expect(updated.fallbackPassword).toBe('new-password');
  });

  test('fill-created access pages return from the local access record without waiting on live Graytag refresh', async () => {
    seedAccessRecord('fill-access-token', {
      serviceType: '티빙',
      accountEmail: 'fill-id@example.com',
      fallbackPassword: 'fill-password',
      profileName: '망고',
      member: {
        kind: 'graytag',
        memberId: 'fill:product-1',
        memberName: '구매자',
        status: 'OnSale',
        statusName: '판매중',
        startDateTime: null,
        endDateTime: '2026-09-01',
      },
    });

    const startedAt = Date.now();
    const res = await apiApp.request('/party-access/fill-access-token');
    const elapsedMs = Date.now() - startedAt;
    const json = await res.json() as any;

    expect(res.status).toBe(200);
    expect(elapsedMs).toBeLessThan(3000);
    expect(json.ok).toBe(true);
    expect(json.sensitiveRedacted).toBe(true);
  });
});
