import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createYouTubeInvitationsApp } from '../src/api/youtube-invitations';
import { reconcileYouTubeInvitationProviderDeals } from '../src/lib/youtube-invitation-poller';
import { YouTubeInvitationJobsStore } from '../src/lib/youtube-invitations';
import { auditYouTubeInviteFlow } from '../scripts/audit-youtube-invite-flow';

const ENV_KEYS = [
  'YOUTUBE_INVITE_SALES_ENABLED',
  'YOUTUBE_INVITE_AUTO_MESSAGE_ENABLED',
  'YOUTUBE_INVITE_PROVIDER_AUTOMATION_ENABLED',
  'YOUTUBE_FAMILY_GROUPS_PATH',
  'YOUTUBE_INVITATIONS_PATH',
  'YOUTUBE_PRODUCT_REGISTRATIONS_PATH',
  'YOUTUBE_CAPACITY_LOCK_PATH',
] as const;
const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
let root = '';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'youtube-invite-e2e-'));
  Object.assign(process.env, {
    YOUTUBE_INVITE_SALES_ENABLED: 'true',
    YOUTUBE_INVITE_AUTO_MESSAGE_ENABLED: 'false',
    YOUTUBE_INVITE_PROVIDER_AUTOMATION_ENABLED: 'true',
    YOUTUBE_FAMILY_GROUPS_PATH: join(root, 'family-groups.json'),
    YOUTUBE_INVITATIONS_PATH: join(root, 'invitations.json'),
    YOUTUBE_PRODUCT_REGISTRATIONS_PATH: join(root, 'registrations.json'),
    YOUTUBE_CAPACITY_LOCK_PATH: join(root, 'capacity.lock'),
  });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.restoreAllMocks();
});

function mutation(app: ReturnType<typeof createYouTubeInvitationsApp>, path: string, body: unknown = {}, reason = 'mocked e2e evidence') {
  return app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-audit-reason': encodeURIComponent(reason) },
    body: JSON.stringify(body),
  });
}

function fileSnapshots() {
  return Object.fromEntries([
    process.env.YOUTUBE_FAMILY_GROUPS_PATH!,
    process.env.YOUTUBE_INVITATIONS_PATH!,
    process.env.YOUTUBE_PRODUCT_REGISTRATIONS_PATH!,
  ].map((path) => [path, readFileSync(path, 'utf8')]));
}

describe('YouTube invitation mocked E2E', () => {
  test('proves the full invitation lifecycle, idempotency, and zero credential-delivery calls', async () => {
    const rootRoute = vi.fn(async (path: string) => {
      if (path === '/post/registerProduct') {
        return new Response(JSON.stringify({ succeeded: true, data: 'product-mocked-1' }), { status: 200 });
      }
      throw new Error(`forbidden mocked root route: ${path}`);
    });
    const registerProduct = vi.fn(async () => rootRoute('/post/registerProduct'));
    const finishDelivery = vi.fn(async () => new Response(JSON.stringify({ succeeded: true }), { status: 200 }));
    const providerStatuses = ['Delivered', 'Using'];
    const fetchProviderStatus = vi.fn(async () => providerStatuses.shift() ?? 'Using');
    const app = createYouTubeInvitationsApp({ registerProduct, finishDelivery, fetchProviderStatus, actor: () => 'mock-admin' });

    const groupResponse = await mutation(app, '/family-groups', {
      label: 'E2E 가족 그룹', managerEmail: 'manager.private@example.com', subscriptionEndDate: '2027-12-31', sellableSeats: 2,
    });
    expect(groupResponse.status).toBe(201);
    const group = (await groupResponse.json() as any).familyGroup;
    expect(group.managerEmailMasked).not.toContain('manager.private@example.com');

    const capacityBefore = await (await app.request('/family-groups')).json() as any;
    expect(capacityBefore.familyGroups).toEqual([expect.objectContaining({ id: group.id, availableSeats: 2 })]);

    const productBody = { familyGroupId: group.id, endDate: '20271231T2359', price: 7900, name: '유튜브 프리미엄', sellingGuide: '결제 후 가족 초대' };
    const productHeaders = { 'content-type': 'application/json', 'idempotency-key': 'mocked-e2e-registration-1', 'x-audit-reason': 'mocked product registration' };
    const firstProduct = await app.request('/products', { method: 'POST', headers: productHeaders, body: JSON.stringify(productBody) });
    expect(firstProduct.status).toBe(201);
    expect(await firstProduct.json()).toMatchObject({ productUsid: 'product-mocked-1', status: 'registered' });
    const replayProduct = await app.request('/products', { method: 'POST', headers: productHeaders, body: JSON.stringify(productBody) });
    expect(replayProduct.status).toBe(200);
    expect(await replayProduct.json()).toMatchObject({ replayed: true, productUsid: 'product-mocked-1' });
    expect(registerProduct).toHaveBeenCalledTimes(1);

    const journal = await (await app.request('/products/registrations')).json() as any;
    expect(journal.registrations).toEqual([expect.objectContaining({ status: 'registered', productUsid: 'product-mocked-1', familyGroupId: group.id })]);
    expect((await (await app.request('/family-groups')).json() as any).familyGroups[0].availableSeats).toBe(1);

    const ingestBody = {
      dealUsid: 'deal-mocked-1', productUsid: 'product-mocked-1', chatRoomUuid: 'chat-private-1', buyerName: '구매자',
      endDateTime: '2027-12-31T14:59:00.000Z', providerStatus: 'Delivering',
    };
    const ingested = await mutation(app, '/invitations/ingest', ingestBody);
    expect(ingested.status).toBe(201);
    const invitation = (await ingested.json() as any).invitation;
    expect(invitation.status).toBe('waiting_for_buyer_email');
    expect((await mutation(app, '/invitations/ingest', ingestBody)).status).toBe(200);
    expect(new YouTubeInvitationJobsStore(process.env.YOUTUBE_INVITATIONS_PATH!).read().jobs).toHaveLength(1);

    const invitationPath = `/invitations/${encodeURIComponent(invitation.id)}`;
    const candidate = await mutation(app, `${invitationPath}/email-candidate`, { message: '초대 주소 Buyer.Private@Example.com 입니다' });
    expect(await candidate.json()).toMatchObject({ result: { kind: 'single_candidate' }, invitation: { status: 'email_candidate_found' } });
    expect((await mutation(app, `${invitationPath}/confirm-email`, { email: 'buyer.private@example.com' })).status).toBe(200);
    expect((await mutation(app, `${invitationPath}/mark-invite-sent`)).status).toBe(200);

    const delivered = await mutation(app, `${invitationPath}/finish-delivery`);
    expect(await delivered.json()).toMatchObject({ invitation: { status: 'delivered_waiting_inspection' }, providerStatus: 'Delivered' });
    const active = await mutation(app, `${invitationPath}/reconcile`);
    expect(await active.json()).toMatchObject({ invitation: { status: 'active' }, providerStatus: 'Using' });
    expect(finishDelivery).toHaveBeenCalledTimes(1);
    expect(fetchProviderStatus).toHaveBeenCalledTimes(2);
    expect(new YouTubeInvitationJobsStore(process.env.YOUTUBE_INVITATIONS_PATH!).read().jobs).toHaveLength(1);

    expect(rootRoute).toHaveBeenCalledTimes(1);
    expect(rootRoute).toHaveBeenCalledWith('/post/registerProduct');
    expect(rootRoute).not.toHaveBeenCalledWith('/post/keepAcct');
    expect(rootRoute).not.toHaveBeenCalledWith('/api/party-access-links');
    expect(rootRoute).not.toHaveBeenCalledWith('/api/profile-assignments');
  });

  test('never automatically retries an uncertain product provider outcome', async () => {
    const registerProduct = vi.fn(async () => { throw new DOMException('mock timeout', 'TimeoutError'); });
    const app = createYouTubeInvitationsApp({ registerProduct });
    const group = (await (await mutation(app, '/family-groups', {
      label: '불확실 그룹', managerEmail: 'uncertain.manager@example.com', subscriptionEndDate: null, sellableSeats: 1,
    })).json() as any).familyGroup;
    const request = {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'mocked-uncertain-registration', 'x-audit-reason': 'uncertain provider test' },
      body: JSON.stringify({ familyGroupId: group.id, endDate: '20271231T2359', price: 7900, name: '유튜브', sellingGuide: '초대' }),
    };
    expect((await app.request('/products', request)).status).toBe(502);
    expect((await app.request('/products', request)).status).toBe(409);
    expect(registerProduct).toHaveBeenCalledTimes(1);
  });

  test('poll reconciliation is deal-idempotent and the audit is stable, PII-safe, and read-only', async () => {
    const app = createYouTubeInvitationsApp({ registerProduct: async () => new Response(JSON.stringify({ succeeded: true, data: 'product-audit-1' }), { status: 200 }) });
    const group = (await (await mutation(app, '/family-groups', {
      label: '감사 그룹', managerEmail: 'manager.audit@example.com', subscriptionEndDate: null, sellableSeats: 1,
    })).json() as any).familyGroup;
    await app.request('/products', {
      method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'mocked-audit-registration', 'x-audit-reason': 'audit setup' },
      body: JSON.stringify({ familyGroupId: group.id, endDate: '20271231T2359', price: 7900, name: '유튜브', sellingGuide: '초대' }),
    });
    const deal = { dealUsid: 'deal-secret-audit', productUsid: 'product-audit-1', chatRoomUuid: 'chat-secret-audit', borrowerName: '민감 구매자', endDateTime: null, dealStatus: 'Delivering' };
    const logger = vi.fn();
    const first = reconcileYouTubeInvitationProviderDeals([deal], { logger });
    const second = reconcileYouTubeInvitationProviderDeals([deal], { logger });
    expect(first.created).toBe(1);
    expect(second.created).toBe(0);
    expect(new YouTubeInvitationJobsStore(process.env.YOUTUBE_INVITATIONS_PATH!).read().jobs).toHaveLength(1);

    const before = fileSnapshots();
    const report = auditYouTubeInviteFlow(process.env);
    const after = fileSnapshots();
    expect(after).toEqual(before);
    expect(report).toMatchObject({ schemaVersion: 1, readOnly: true, counts: { familyGroups: 1, registrations: 1, invitations: 1 }, invariants: { ok: true } });
    expect(JSON.stringify(report)).toBe(JSON.stringify(auditYouTubeInviteFlow(process.env)));
    const serialized = JSON.stringify(report);
    for (const pii of ['manager.audit@example.com', 'deal-secret-audit', 'chat-secret-audit', '민감 구매자']) expect(serialized).not.toContain(pii);
  });
});
