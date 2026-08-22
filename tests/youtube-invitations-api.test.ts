import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Hono } from 'hono';
import { YouTubeProductRegistrationsStore } from '../src/lib/youtube-product-registrations';
import { ensureYouTubeInvitationJob } from '../src/lib/youtube-invitations';

let tempDir = '';
const savedEnv = { ...process.env };

function request(path: string, init: RequestInit = {}) {
  return import('../src/api/index.ts').then(({ default: app }) => app.request(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-admin-token': 'youtube-admin-token',
      'x-audit-reason': 'Task4A test mutation',
      ...(init.headers || {}),
    },
  }));
}

async function serverMountedRequest(path: string, init: RequestInit = {}) {
  const apiApp = (await import('../src/api/index.ts')).default;
  const serverApp = new Hono();
  serverApp.route('/api', apiApp);
  return serverApp.request(path, init);
}

async function createGroup(overrides: Record<string, unknown> = {}) {
  const response = await request('/youtube/family-groups', {
    method: 'POST',
    body: JSON.stringify({
      label: '가족 그룹', managerEmail: 'manager@example.com', subscriptionEndDate: null, sellableSeats: 5,
      ...overrides,
    }),
  });
  return { response, body: await response.json() as any };
}

beforeEach(() => {
  vi.resetModules();
  tempDir = mkdtempSync(join(tmpdir(), 'youtube-api-'));
  process.env.AIO_ADMIN_TOKEN = 'youtube-admin-token';
  process.env.AIO_ADMIN_ACTOR = 'task4a-admin';
  process.env.AUDIT_LOG_PATH = join(tempDir, 'audit', 'audit.jsonl');
  process.env.YOUTUBE_INVITE_SALES_ENABLED = 'true';
  process.env.YOUTUBE_FAMILY_GROUPS_PATH = join(tempDir, 'groups', 'family-groups.json');
  process.env.YOUTUBE_INVITATIONS_PATH = join(tempDir, 'jobs', 'invitations.json');
  process.env.YOUTUBE_PRODUCT_REGISTRATIONS_PATH = join(tempDir, 'registrations', 'journal.json');
  process.env.YOUTUBE_CAPACITY_LOCK_PATH = join(tempDir, 'capacity.lock');
});

afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(tempDir, { recursive: true, force: true });
  for (const key of ['AIO_ADMIN_TOKEN', 'AIO_ADMIN_ACTOR', 'AUDIT_LOG_PATH', 'YOUTUBE_INVITE_SALES_ENABLED', 'YOUTUBE_FAMILY_GROUPS_PATH', 'YOUTUBE_INVITATIONS_PATH', 'YOUTUBE_PRODUCT_REGISTRATIONS_PATH', 'YOUTUBE_CAPACITY_LOCK_PATH']) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe('YouTube family-group API', () => {
  test('protects the canonical server mount and never serves the duplicated /api/api path', async () => {
    const canonical = '/api/youtube/family-groups';
    const duplicated = '/api/api/youtube/family-groups';
    expect((await serverMountedRequest(canonical)).status).toBe(403);
    const duplicateResponse = await serverMountedRequest(duplicated);
    expect([403, 404]).toContain(duplicateResponse.status);
    expect(await duplicateResponse.text()).not.toContain('manager@example.com');

    const created = await serverMountedRequest(canonical, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-token': 'youtube-admin-token', 'x-audit-reason': 'canonical mount create' },
      body: JSON.stringify({ label: '서버 마운트', managerEmail: 'manager@example.com', subscriptionEndDate: null, sellableSeats: 5 }),
    });
    expect(created.status).toBe(201);
    const listed = await serverMountedRequest(canonical, { headers: { 'x-admin-token': 'youtube-admin-token' } });
    expect(listed.status).toBe(200);
    expect(await listed.text()).not.toContain('manager@example.com');
  });

  test('protects GET and writes, gates mutations, then creates and lists a PII-safe group', async () => {
    const app = (await import('../src/api/index.ts')).default;
    expect((await app.request('/youtube/family-groups')).status).toBe(403);
    expect((await app.request('/youtube/family-groups', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    })).status).toBe(403);

    process.env.YOUTUBE_INVITE_SALES_ENABLED = 'false';
    const disabled = await request('/youtube/family-groups', {
      method: 'POST',
      body: JSON.stringify({ label: '가족 A', managerEmail: 'manager@example.com', subscriptionEndDate: null, sellableSeats: 5 }),
    });
    expect(disabled.status).toBe(503);
    expect(await disabled.json()).toMatchObject({ ok: false, enabled: false, error: 'YOUTUBE_INVITE_SALES_DISABLED' });
    expect(existsSync(process.env.YOUTUBE_FAMILY_GROUPS_PATH!)).toBe(false);

    process.env.YOUTUBE_INVITE_SALES_ENABLED = 'true';
    const createdResponse = await request('/youtube/family-groups', {
      method: 'POST',
      body: JSON.stringify({ label: ' 가족 A ', managerEmail: ' Manager@Example.com ', subscriptionEndDate: '2027-08-11', sellableSeats: 5 }),
    });
    const created = await createdResponse.json() as any;
    expect(createdResponse.status, JSON.stringify(created)).toBe(201);
    expect(created).toMatchObject({
      ok: true, enabled: true,
      familyGroup: { label: '가족 A', managerEmailMasked: 'm***r@example.com', subscriptionEndDate: '2027-08-11', sellableSeats: 5, enabled: true },
    });
    expect(created.familyGroup.id).toMatch(/^youtube-family-group:/);
    expect(created.familyGroup.createdAt).toBe(created.familyGroup.updatedAt);
    expect(created.familyGroup).not.toHaveProperty('managerEmail');
    expect(created.familyGroup.listingCode).toBe('manger');
    expect(createdResponse.headers.get('cache-control')).toBe('no-store');

    const listResponse = await request('/youtube/family-groups');
    expect(listResponse.status).toBe(200);
    expect(await listResponse.json()).toMatchObject({ ok: true, enabled: true, familyGroups: [{ id: created.familyGroup.id, availableSeats: 5 }] });
    expect(listResponse.headers.get('cache-control')).toBe('no-store');
    expect(JSON.parse(readFileSync(process.env.YOUTUBE_FAMILY_GROUPS_PATH!, 'utf8'))).toMatchObject({ version: 1, familyGroups: [{ managerEmail: 'manager@example.com' }] });
    expect(JSON.parse(readFileSync(process.env.YOUTUBE_INVITATIONS_PATH!, 'utf8'))).toEqual({ version: 1, jobs: [] });
  });

  test('validates exact create fields and rejects duplicate normalized manager email', async () => {
    const invalidBodies = [
      { label: '', managerEmail: 'manager@example.com', subscriptionEndDate: null, sellableSeats: 5 },
      { label: 'x'.repeat(121), managerEmail: 'manager@example.com', subscriptionEndDate: null, sellableSeats: 5 },
      { label: '그룹', managerEmail: 'not-an-email', subscriptionEndDate: null, sellableSeats: 5 },
      { label: '그룹', managerEmail: '.manager@example.com', subscriptionEndDate: null, sellableSeats: 5 },
      { label: '그룹', managerEmail: 'manager..x@example.com', subscriptionEndDate: null, sellableSeats: 5 },
      { label: '그룹', managerEmail: 'manager.@example.com', subscriptionEndDate: null, sellableSeats: 5 },
      { label: '그룹', managerEmail: 'manager@example.com', subscriptionEndDate: '2026-02-30', sellableSeats: 5 },
      { label: '그룹', managerEmail: 'manager@example.com', subscriptionEndDate: null, sellableSeats: 0 },
      { label: '그룹', managerEmail: 'manager@example.com', subscriptionEndDate: null, sellableSeats: 21 },
      { label: '그룹', managerEmail: 'manager@example.com', subscriptionEndDate: null, sellableSeats: 5, unexpected: true },
    ];
    for (const body of invalidBodies) {
      const response = await request('/youtube/family-groups', { method: 'POST', body: JSON.stringify(body) });
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
    expect((await createGroup()).response.status).toBe(201);
    const duplicate = await createGroup({ label: '다른 그룹', managerEmail: ' MANAGER@EXAMPLE.COM ' });
    expect(duplicate.response.status).toBe(409);
    expect(JSON.stringify(duplicate.body)).not.toContain('manager@example.com');
    const customDomain = await createGroup({
      label: '사용자 도메인', managerEmail: "Manager.O'Connor@custom-domain.example",
    });
    expect(customDomain.response.status).toBe(201);
    expect(customDomain.body.familyGroup.managerEmailMasked).toBe('m***r@custom-domain.example');
    expect(customDomain.body.familyGroup.listingCode).toBe('mannor');
    const shortLocal = await createGroup({ label: '짧은 코드', managerEmail: 'ABCDEF@short.example' });
    expect(shortLocal.response.status).toBe(201);
    expect(shortLocal.body.familyGroup.listingCode).toBe('abcdef');
    expect(shortLocal.body.familyGroup).not.toHaveProperty('managerEmail');
  });

  test('updates accepted fields, rejects invalid patches, and soft deletes idempotently', async () => {
    const first = await createGroup();
    const second = await createGroup({ label: '두번째', managerEmail: 'second@example.com' });
    const original = first.body.familyGroup;
    for (const body of [{}, { unknown: true }, { sellableSeats: 1.5 }, { subscriptionEndDate: '11/08/2026' }]) {
      const invalid = await request(`/youtube/family-groups/${original.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      expect(invalid.status, JSON.stringify(body)).toBe(400);
    }
    const duplicate = await request(`/youtube/family-groups/${original.id}`, { method: 'PATCH', body: JSON.stringify({ managerEmail: ' SECOND@EXAMPLE.COM ' }) });
    expect(duplicate.status).toBe(409);
    const updatedResponse = await request(`/youtube/family-groups/${original.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ label: ' 변경됨 ', managerEmail: 'changed@example.com', subscriptionEndDate: '2027-12-31', sellableSeats: 7, enabled: false }),
    });
    const updated = await updatedResponse.json() as any;
    expect(updatedResponse.status).toBe(200);
    expect(updated.familyGroup).toMatchObject({
      id: original.id, createdAt: original.createdAt, label: '변경됨', managerEmailMasked: 'c***d@example.com',
      subscriptionEndDate: '2027-12-31', sellableSeats: 7, enabled: false,
    });
    expect(updated.familyGroup).not.toHaveProperty('managerEmail');
    expect((await request('/youtube/family-groups/missing', { method: 'PATCH', body: JSON.stringify({ enabled: true }) })).status).toBe(404);
    const deleteOnce = await request(`/youtube/family-groups/${second.body.familyGroup.id}`, { method: 'DELETE' });
    const deleted = await deleteOnce.json() as any;
    expect(deleteOnce.status).toBe(200);
    expect(deleted.familyGroup.enabled).toBe(false);
    expect(JSON.stringify(deleted)).not.toContain('second@example.com');
    const deleteTwice = await request(`/youtube/family-groups/${second.body.familyGroup.id}`, { method: 'DELETE' });
    expect(deleteTwice.status).toBe(200);
    expect((await deleteTwice.json() as any).familyGroup).toEqual(deleted.familyGroup);
    expect((await request('/youtube/family-groups/missing', { method: 'DELETE' })).status).toBe(404);
  });

  test('rejects reducing sellable seats below cross-store occupied and reserved products', async () => {
    const created = await createGroup({ sellableSeats: 4 });
    const group = created.body.familyGroup;
    const { YouTubeInvitationJobsStore } = await import('../src/lib/youtube-invitations');
    const jobsStore = new YouTubeInvitationJobsStore(process.env.YOUTUBE_INVITATIONS_PATH!);
    jobsStore.write({ version: 1, jobs: [{
      id: 'youtube-invitation:deal-seat', dealUsid: 'deal-seat', productUsid: 'product-shared',
      chatRoomUuid: 'chat-seat', familyGroupId: group.id, buyerName: '구매자', buyerGoogleEmail: null,
      endDateTime: null, status: 'waiting_for_group_assignment', createdAt: group.createdAt, updatedAt: group.createdAt, history: [],
    }] });
    const journal = new YouTubeProductRegistrationsStore(process.env.YOUTUBE_PRODUCT_REGISTRATIONS_PATH!, { allowUnsafeIsolatedClaim: true });
    journal.claim({ idempotencyKey: 'seat-reservation-1', requestFingerprint: '8'.repeat(64), familyGroupId: group.id, actor: 'admin', reasonCode: 'reserve', at: group.createdAt });
    journal.complete('seat-reservation-1', 'registered', { actor: 'admin', reasonCode: 'done', productUsid: 'PRODUCT-SHARED', at: new Date(Date.parse(group.createdAt) + 1).toISOString() });
    journal.claim({ idempotencyKey: 'seat-reservation-2', requestFingerprint: '7'.repeat(64), familyGroupId: group.id, actor: 'admin', reasonCode: 'reserve', at: new Date(Date.parse(group.createdAt) + 2).toISOString() });
    journal.complete('seat-reservation-2', 'uncertain', { actor: 'admin', reasonCode: 'timeout', at: new Date(Date.parse(group.createdAt) + 3).toISOString() });

    const rejected = await request(`/youtube/family-groups/${group.id}`, { method: 'PATCH', body: JSON.stringify({ sellableSeats: 1 }) });
    expect(rejected.status).toBe(409);
    expect(await rejected.json()).toEqual({ ok: false, error: 'sellable seats below occupied capacity' });
    expect(JSON.parse(readFileSync(process.env.YOUTUBE_FAMILY_GROUPS_PATH!, 'utf8')).familyGroups[0].sellableSeats).toBe(4);

    const accepted = await request(`/youtube/family-groups/${group.id}`, { method: 'PATCH', body: JSON.stringify({ sellableSeats: 2 }) });
    expect(accepted.status).toBe(200);
  });

  test('requires a sanitized audit reason before every mutation but not GET', async () => {
    const app = (await import('../src/api/index.ts')).default;
    const body = JSON.stringify({
      label: '감사 사유', managerEmail: 'reason@example.com', subscriptionEndDate: null, sellableSeats: 5,
    });
    const missing = await app.request('/youtube/family-groups', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-admin-token': 'youtube-admin-token' },
      body,
    });
    expect(missing.status).toBe(400);
    expect(existsSync(process.env.YOUTUBE_FAMILY_GROUPS_PATH!)).toBe(false);

    for (const reason of ['   ', 'x'.repeat(201), `control${String.fromCharCode(1)}character`, `delete${String.fromCharCode(127)}character`, 'buyer@example.com', 'buyer＠example.com', 'buyer﹫example.com']) {
      const response = await request('/youtube/family-groups', {
        method: 'POST', headers: { 'x-audit-reason': encodeURIComponent(reason) }, body,
      });
      expect(response.status, JSON.stringify(reason)).toBe(400);
      expect(existsSync(process.env.YOUTUBE_FAMILY_GROUPS_PATH!)).toBe(false);
      expect(existsSync(process.env.AUDIT_LOG_PATH!)).toBe(false);
    }

    const safeReason = '가족 그룹 생성 확인';
    const accepted = await request('/youtube/family-groups', {
      method: 'POST', headers: { 'x-audit-reason': encodeURIComponent(safeReason) }, body,
    });
    expect(accepted.status).toBe(201);
    const auditContents = readFileSync(process.env.AUDIT_LOG_PATH!, 'utf8');
    expect(auditContents).toContain(safeReason);
    expect(auditContents).not.toContain('buyer@example.com');

    const get = await app.request('/youtube/family-groups', {
      headers: { 'x-admin-token': 'youtube-admin-token' },
    });
    expect(get.status).toBe(200);
  });

  test('computes available seats from invitation jobs and returns disabled GET data to admins', async () => {
    const created = await createGroup({ sellableSeats: 3 });
    const group = created.body.familyGroup;
    await request('/youtube/family-groups');
    writeFileSync(process.env.YOUTUBE_INVITATIONS_PATH!, JSON.stringify({
      version: 1,
      jobs: [{
        id: 'youtube-invitation:deal-capacity', dealUsid: 'deal-capacity', productUsid: 'product-capacity',
        chatRoomUuid: 'chat-capacity', familyGroupId: group.id, buyerName: '구매자', buyerGoogleEmail: null,
        endDateTime: null, status: 'waiting_for_group_assignment', createdAt: group.createdAt, updatedAt: group.createdAt, history: [],
      }],
    }));
    process.env.YOUTUBE_INVITE_SALES_ENABLED = 'false';
    const response = await request('/youtube/family-groups');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ enabled: false, familyGroups: [{ id: group.id, availableSeats: 2 }] });
  });

  test('computes available seats from one cross-store snapshot and dedupes a registered product against jobs', async () => {
    const created = await createGroup({ sellableSeats: 4 });
    const group = created.body.familyGroup;
    const { YouTubeInvitationJobsStore } = await import('../src/lib/youtube-invitations');
    const dedupJob = ensureYouTubeInvitationJob([], {
      dealUsid: 'deal-dedup', productUsid: 'product-shared', chatRoomUuid: 'private-room', familyGroupId: group.id,
      buyerName: '구매자', buyerGoogleEmail: null, endDateTime: null,
    }, group.createdAt).job;
    new YouTubeInvitationJobsStore(process.env.YOUTUBE_INVITATIONS_PATH!).write({ version: 1, jobs: [dedupJob] });
    const journal = new YouTubeProductRegistrationsStore(process.env.YOUTUBE_PRODUCT_REGISTRATIONS_PATH!, { allowUnsafeIsolatedClaim: true });
    journal.claim({ idempotencyKey: 'snapshot-registered', requestFingerprint: 'a'.repeat(64), familyGroupId: group.id, actor: 'test', reasonCode: 'test', at: group.createdAt });
    journal.complete('snapshot-registered', 'registered', { actor: 'test', reasonCode: 'done', productUsid: 'PRODUCT-SHARED', at: new Date(Date.parse(group.createdAt) + 1).toISOString() });
    journal.claim({ idempotencyKey: 'snapshot-submitting', requestFingerprint: 'b'.repeat(64), familyGroupId: group.id, actor: 'test', reasonCode: 'test', at: new Date(Date.parse(group.createdAt) + 2).toISOString() });
    journal.claim({ idempotencyKey: 'snapshot-uncertain', requestFingerprint: 'c'.repeat(64), familyGroupId: group.id, actor: 'test', reasonCode: 'test', at: new Date(Date.parse(group.createdAt) + 3).toISOString() });
    journal.complete('snapshot-uncertain', 'uncertain', { actor: 'test', reasonCode: 'timeout', at: new Date(Date.parse(group.createdAt) + 4).toISOString() });

    const payload = await (await request('/youtube/family-groups')).json() as any;
    expect(payload.familyGroups[0].availableSeats).toBe(1);
  });

  test('evaluates store paths per request rather than at module import time', async () => {
    const app = (await import('../src/api/index.ts')).default;
    const firstPath = process.env.YOUTUBE_FAMILY_GROUPS_PATH!;
    process.env.YOUTUBE_FAMILY_GROUPS_PATH = join(tempDir, 'later', 'groups.json');
    const response = await app.request('/youtube/family-groups', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-token': 'youtube-admin-token', 'x-audit-reason': 'later path create' },
      body: JSON.stringify({ label: '나중 경로', managerEmail: 'later@example.com', subscriptionEndDate: null, sellableSeats: 2 }),
    });
    expect(response.status).toBe(201);
    expect(existsSync(firstPath)).toBe(false);
    expect(existsSync(process.env.YOUTUBE_FAMILY_GROUPS_PATH)).toBe(true);
  });

  test('fails closed on corrupt stores and never overwrites corrupt contents', async () => {
    mkdirSync(join(tempDir, 'groups'), { recursive: true, mode: 0o700 });
    const corrupt = '{"version":1,"familyGroups":[';
    writeFileSync(process.env.YOUTUBE_FAMILY_GROUPS_PATH!, corrupt, { mode: 0o600 });
    const getResponse = await request('/youtube/family-groups');
    expect(getResponse.status).toBe(500);
    expect(await getResponse.json()).toEqual({ ok: false, error: 'youtube store unavailable' });
    expect(readFileSync(process.env.YOUTUBE_FAMILY_GROUPS_PATH!, 'utf8')).toBe(corrupt);
    const mutation = await createGroup();
    expect(mutation.response.status).toBe(500);
    expect(JSON.stringify(mutation.body)).not.toContain(process.env.YOUTUBE_FAMILY_GROUPS_PATH!);
    expect(readFileSync(process.env.YOUTUBE_FAMILY_GROUPS_PATH!, 'utf8')).toBe(corrupt);
  });

  test('uses no-store for errors and audits only successful mutations without PII', async () => {
    const forbidden = await serverMountedRequest('/api/youtube/family-groups');
    expect(forbidden.headers.get('cache-control')).toBe('no-store');
    const invalid = await request('/youtube/family-groups', { method: 'POST', body: '{}' });
    expect(invalid.status).toBe(400);
    expect(invalid.headers.get('cache-control')).toBe('no-store');
    expect(existsSync(process.env.AUDIT_LOG_PATH!)).toBe(false);

    const created = await createGroup();
    const id = created.body.familyGroup.id;
    await request(`/youtube/family-groups/${id}`, { method: 'PATCH', body: JSON.stringify({ label: '감사 변경' }) });
    await request(`/youtube/family-groups/${id}`, { method: 'DELETE' });
    await request('/youtube/family-groups/missing', { method: 'DELETE' });

    const contents = readFileSync(process.env.AUDIT_LOG_PATH!, 'utf8');
    const entries = contents.trim().split('\n').map((line) => JSON.parse(line));
    expect(entries.map((entry) => entry.action)).toEqual([
      'youtube.family-group.create', 'youtube.family-group.update', 'youtube.family-group.disable',
    ]);
    expect(entries.every((entry) => entry.result === 'success')).toBe(true);
    expect(entries.every((entry) => entry.targetId === entries[0].targetId)).toBe(true);
    expect(entries[0].targetId).toMatch(/^sha256:[a-f0-9]{16}$/);
    expect(entries.every((entry) => entry.actor === 'task4a-admin')).toBe(true);
    expect(entries.every((entry) => entry.details?.reason === 'Task4A test mutation')).toBe(true);
    expect(entries.every((entry) => !('authenticatedActor' in (entry.details || {})))).toBe(true);
    expect(contents).not.toContain('youtube-admin-token');
    expect(contents).not.toContain('manager@example.com');
    expect(contents).not.toContain(id);
  });

  test('hashes stable YouTube audit identifiers and persists invitation details with status and reason only', async () => {
    const rawProductUsid = 'product-private-Task5A';
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes('proxy.webshare.io')) return new Response('', { status: 200 });
      if (url.includes('/ws/lender/registerProduct')) {
        return new Response(JSON.stringify({ succeeded: true, data: rawProductUsid }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error('unexpected external request in audit test');
    }));

    const created = await createGroup({ subscriptionEndDate: '2027-08-11' });
    expect(created.response.status).toBe(201);
    const rawFamilyGroupId = created.body.familyGroup.id as string;
    const product = await request('/youtube/products', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'task5a-private-product' },
      body: JSON.stringify({
        familyGroupId: rawFamilyGroupId,
        endDate: '20270811T2359',
        price: 7900,
        name: '유튜브',
        sellingGuide: '안내',
      }),
    });
    expect(product.status, await product.clone().text()).toBe(201);

    const rawDealUsid = 'deal-private-Task5A';
    const rawChatRoomUuid = '087fa5a4-1354-4ed1-a452-c174e0246488';
    const ingest = await request('/youtube/invitations/ingest', {
      method: 'POST',
      body: JSON.stringify({
        dealUsid: rawDealUsid,
        productUsid: rawProductUsid,
        chatRoomUuid: rawChatRoomUuid,
        buyerName: '구매자',
        endDateTime: '2027-08-11T10:00:00.000Z',
        providerStatus: 'Delivering',
      }),
    });
    expect(ingest.status, await ingest.clone().text()).toBe(201);
    const rawJobId = (await ingest.json() as any).invitation.id as string;

    const contents = readFileSync(process.env.AUDIT_LOG_PATH!, 'utf8');
    for (const rawIdentifier of [rawDealUsid, rawJobId, rawChatRoomUuid, rawProductUsid, rawFamilyGroupId]) {
      expect(contents).not.toContain(rawIdentifier);
    }
    const entries = contents.trim().split('\n').map((line) => JSON.parse(line));
    expect(entries.every((entry) => /^sha256:[a-f0-9]{16}$/.test(entry.targetId))).toBe(true);
    const invitationEntry = entries.find((entry) => entry.action === 'youtube.invitation.ingest.success');
    expect(invitationEntry).toBeTruthy();
    expect(invitationEntry.details).toEqual({ reason: 'Task4A test mutation', status: 'success' });
    expect(Object.keys(invitationEntry.details)).toEqual(['reason', 'status']);
  });
});
