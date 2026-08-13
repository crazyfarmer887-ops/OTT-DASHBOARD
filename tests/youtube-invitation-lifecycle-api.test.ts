import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createYouTubeInvitationsApp, type YouTubeInvitationAuditEvent } from '../src/api/youtube-invitations';
import { YouTubeFamilyGroupsStore, YouTubeInvitationJobsStore } from '../src/lib/youtube-invitations';
import { YouTubeProductRegistrationsStore } from '../src/lib/youtube-product-registrations';

const at = '2026-08-11T10:00:00.000Z';
let root = '';
let audits: YouTubeInvitationAuditEvent[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'youtube-lifecycle-api-'));
  process.env.YOUTUBE_INVITE_SALES_ENABLED = 'true';
  process.env.YOUTUBE_FAMILY_GROUPS_PATH = join(root, 'groups.json');
  process.env.YOUTUBE_INVITATIONS_PATH = join(root, 'jobs.json');
  process.env.YOUTUBE_PRODUCT_REGISTRATIONS_PATH = join(root, 'registrations.json');
  process.env.YOUTUBE_CAPACITY_LOCK_PATH = join(root, 'capacity.lock');
  new YouTubeFamilyGroupsStore(process.env.YOUTUBE_FAMILY_GROUPS_PATH).write({ version: 1, familyGroups: [{
    id: 'group-1', label: '운영 그룹', managerEmail: 'manager@example.com', subscriptionEndDate: null,
    sellableSeats: 5, enabled: true, createdAt: at, updatedAt: at,
  }] });
  const registrations = new YouTubeProductRegistrationsStore(process.env.YOUTUBE_PRODUCT_REGISTRATIONS_PATH, { allowUnsafeIsolatedClaim: true });
  registrations.claim({ idempotencyKey: 'registration-1', requestFingerprint: 'a'.repeat(64), familyGroupId: 'group-1', actor: 'admin', reasonCode: 'registered', at });
  registrations.complete('registration-1', 'registered', { actor: 'admin', reasonCode: 'provider-succeeded', productUsid: 'product-1', at: '2026-08-11T10:00:01.000Z' });
  audits = [];
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  for (const key of ['YOUTUBE_INVITE_SALES_ENABLED', 'YOUTUBE_FAMILY_GROUPS_PATH', 'YOUTUBE_INVITATIONS_PATH', 'YOUTUBE_PRODUCT_REGISTRATIONS_PATH', 'YOUTUBE_CAPACITY_LOCK_PATH']) delete process.env[key];
});

function app(overrides: Parameters<typeof createYouTubeInvitationsApp>[0] = {}) {
  return createYouTubeInvitationsApp({
    actor: () => 'operator-admin',
    invitationAudit: event => audits.push(event),
    finishDelivery: vi.fn(async () => new Response(JSON.stringify({ succeeded: true }), { status: 200, headers: { 'content-type': 'application/json' } })),
    fetchProviderStatus: vi.fn(async () => 'Delivered'),
    ...overrides,
  });
}

function mutation(target: ReturnType<typeof app>, path: string, body?: unknown, reason = 'operator verified evidence') {
  return target.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-audit-reason': encodeURIComponent(reason) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const ingestBody = {
  dealUsid: 'deal-1', productUsid: 'product-1', chatRoomUuid: 'chat-1', buyerName: '구매자',
  endDateTime: '2027-08-11T10:00:00.000Z', providerStatus: 'Delivering',
};

async function ingest(target: ReturnType<typeof app>) {
  const response = await mutation(target, '/invitations/ingest', ingestBody);
  expect(response.status).toBe(201);
  return (await response.json() as any).invitation;
}

async function advanceToInviteSent(target: ReturnType<typeof app>) {
  const invitation = await ingest(target);
  expect((await mutation(target, `/invitations/${encodeURIComponent(invitation.id)}/email-candidate`, { message: 'buyer@example.com' })).status).toBe(200);
  expect((await mutation(target, `/invitations/${encodeURIComponent(invitation.id)}/confirm-email`, { email: 'BUYER@example.com' })).status).toBe(200);
  expect((await mutation(target, `/invitations/${encodeURIComponent(invitation.id)}/mark-invite-sent`, {})).status).toBe(200);
  return invitation;
}

describe('YouTube invitation lifecycle API', () => {
  test('rejects email-like audit reasons before lifecycle mutation or audit and accepts a safe Korean reason', async () => {
    const target = app();
    for (const reason of ['buyer@example.com', 'buyer＠example.com', 'buyer﹫example.com']) {
      const response = await mutation(target, '/invitations/ingest', ingestBody, reason);
      expect(response.status, reason).toBe(400);
      expect(() => new YouTubeInvitationJobsStore(process.env.YOUTUBE_INVITATIONS_PATH!).read()).toThrow();
      expect(audits).toEqual([]);
    }

    const safeReason = '운영자 증거 확인';
    const accepted = await mutation(target, '/invitations/ingest', ingestBody, safeReason);
    expect(accepted.status).toBe(201);
    const stored = new YouTubeInvitationJobsStore(process.env.YOUTUBE_INVITATIONS_PATH!).read().jobs[0];
    expect(stored.history[0].reason).toBe(safeReason);
    expect(audits).toEqual([expect.objectContaining({ reason: safeReason })]);
    expect(JSON.stringify(stored.history)).not.toContain('buyer@example.com');
  });

  test('ingests only a registered product and atomically advances to waiting_for_buyer_email', async () => {
    const target = app();
    const response = await mutation(target, '/invitations/ingest', ingestBody);
    expect(response.status).toBe(201);
    const payload = await response.json() as any;
    expect(payload).toMatchObject({ ok: true, replayed: false, invitation: {
      id: expect.stringMatching(/^invitation-[a-f0-9]{20}$/), dealDisplayId: expect.stringMatching(/^deal-[a-f0-9]{12}$/),
      productDisplayId: expect.stringMatching(/^product-[a-f0-9]{12}$/),
      familyGroupId: 'group-1', buyerName: '구매자', buyerEmailMasked: null, status: 'waiting_for_buyer_email',
    } });
    expect(JSON.stringify(payload.invitation)).not.toContain('deal-1');
    expect(JSON.stringify(payload.invitation)).not.toContain('product-1');
    expect(payload.invitation).not.toHaveProperty('dealUsid');
    expect(payload.invitation).not.toHaveProperty('productUsid');
    expect(payload.invitation).not.toHaveProperty('buyerGoogleEmail');
    expect(payload.invitation).not.toHaveProperty('chatRoomUuid');
    expect(payload.invitation.history[0]).not.toHaveProperty('actor');
    const stored = new YouTubeInvitationJobsStore(process.env.YOUTUBE_INVITATIONS_PATH!).read().jobs[0];
    expect(stored.status).toBe('waiting_for_buyer_email');
    expect(stored.history).toHaveLength(1);
    expect(stored.history[0]).toMatchObject({ from: 'waiting_for_group_assignment', to: 'waiting_for_buyer_email', actor: 'operator-admin', reason: 'operator verified evidence' });
    expect(audits).toEqual([expect.objectContaining({ action: 'ingest', outcome: 'success', actor: 'operator-admin', reason: 'operator verified evidence', jobId: stored.id, dealUsid: 'deal-1' })]);
  });

  test('enforces reason/flag/exact ingest binding and idempotency conflicts', async () => {
    const target = app();
    const missingReason = await target.request('/invitations/ingest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(ingestBody) });
    expect(missingReason.status).toBe(400);
    expect((await mutation(target, '/invitations/ingest', { ...ingestBody, providerStatus: 'Using' })).status).toBe(400);
    expect((await mutation(target, '/invitations/ingest', { ...ingestBody, productUsid: 'unknown' })).status).toBe(409);
    expect((await mutation(target, '/invitations/ingest', { ...ingestBody, extra: true })).status).toBe(400);
    await ingest(target);
    const replay = await mutation(target, '/invitations/ingest', { ...ingestBody, buyerName: '변경 허용', endDateTime: null });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ replayed: true });
    expect((await mutation(target, '/invitations/ingest', { ...ingestBody, chatRoomUuid: 'other-chat' })).status).toBe(409);
    expect((await mutation(target, '/invitations/ingest', { ...ingestBody, productUsid: 'PRODUCT-1' })).status).toBe(409);
    process.env.YOUTUBE_INVITE_SALES_ENABLED = 'false';
    expect((await mutation(target, '/invitations/ingest', { ...ingestBody, dealUsid: 'deal-2' })).status).toBe(503);
  });

  test('parses none/ambiguous without mutation, stores one candidate, confirms exact normalized email, and records invite evidence', async () => {
    const target = app();
    const invitation = await ingest(target);
    const path = `/invitations/${encodeURIComponent(invitation.id)}`;
    const none = await mutation(target, `${path}/email-candidate`, { message: '이메일이 없습니다' });
    expect(await none.json()).toEqual({ ok: true, result: { kind: 'none' } });
    const ambiguous = await mutation(target, `${path}/email-candidate`, { message: 'first@example.com second@example.com' });
    const ambiguousPayload = await ambiguous.json() as any;
    expect(ambiguousPayload.result.kind).toBe('ambiguous');
    expect(JSON.stringify(ambiguousPayload)).not.toContain('first@example.com');
    expect(new YouTubeInvitationJobsStore(process.env.YOUTUBE_INVITATIONS_PATH!).read().jobs[0].status).toBe('waiting_for_buyer_email');

    const single = await mutation(target, `${path}/email-candidate`, { message: 'Buyer@Example.com' });
    const singlePayload = await single.json() as any;
    expect(singlePayload).toMatchObject({ result: { kind: 'single_candidate', masked: 'b***r@e*****e.com' }, invitation: { status: 'email_candidate_found', buyerEmailMasked: 'b***r@e*****e.com' } });
    expect(JSON.stringify(singlePayload)).not.toContain('buyer@example.com');
    expect((await mutation(target, `${path}/email-candidate`, { message: 'again@example.com' })).status).toBe(409);
    expect((await mutation(target, `${path}/confirm-email`, { email: 'different@example.com' })).status).toBe(409);
    const confirmed = await mutation(target, `${path}/confirm-email`, { email: ' BUYER@EXAMPLE.COM ' });
    expect(confirmed.status).toBe(200);
    expect(await confirmed.json()).toMatchObject({ invitation: { status: 'email_confirmed', buyerEmailMasked: 'b***r@e*****e.com' } });
    expect((await mutation(target, `${path}/invite-sent`, { unexpected: true })).status).toBe(400);
    const sent = await mutation(target, `${path}/invite-sent`);
    expect(sent.status).toBe(200);
    expect(await sent.json()).toMatchObject({ invitation: { status: 'invite_sent' } });
    expect((await mutation(target, `${path}/invite-sent`, {})).status).toBe(409);
    expect(readFileSync(process.env.YOUTUBE_INVITATIONS_PATH!, 'utf8')).toContain('buyer@example.com');
    expect(JSON.stringify(audits)).not.toContain('buyer@example.com');
  });

  test('supports the canonical mark-invite-sent route and keeps invite-sent as a backwards-compatible alias', async () => {
    const canonicalTarget = app();
    const canonicalInvitation = await ingest(canonicalTarget);
    const canonicalPath = `/invitations/${encodeURIComponent(canonicalInvitation.id)}`;
    expect((await mutation(canonicalTarget, `${canonicalPath}/email-candidate`, { message: 'buyer@example.com' })).status).toBe(200);
    expect((await mutation(canonicalTarget, `${canonicalPath}/confirm-email`, { email: 'buyer@example.com' })).status).toBe(200);
    expect((await mutation(canonicalTarget, `${canonicalPath}/mark-invite-sent`, {})).status).toBe(200);

    const aliasTarget = app();
    const ingestedAlias = await mutation(aliasTarget, '/invitations/ingest', { ...ingestBody, dealUsid: 'deal-alias', chatRoomUuid: 'chat-alias' });
    expect(ingestedAlias.status).toBe(201);
    const alias = (await ingestedAlias.json() as any).invitation;
    const aliasPath = `/invitations/${encodeURIComponent(alias.id)}`;
    expect((await mutation(aliasTarget, `${aliasPath}/email-candidate`, { message: 'alias@example.com' })).status).toBe(200);
    expect((await mutation(aliasTarget, `${aliasPath}/confirm-email`, { email: 'alias@example.com' })).status).toBe(200);
    expect((await mutation(aliasTarget, `${aliasPath}/invite-sent`, {})).status).toBe(200);
  });

  test('persists pending before one provider call and reconciles a successful finish to Delivered', async () => {
    let observed = '';
    const finishDelivery = vi.fn(async () => {
      observed = new YouTubeInvitationJobsStore(process.env.YOUTUBE_INVITATIONS_PATH!).read().jobs[0].status;
      return new Response(JSON.stringify({ succeeded: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    const fetchProviderStatus = vi.fn(async () => 'Delivered');
    const target = app({ finishDelivery, fetchProviderStatus });
    const invitation = await advanceToInviteSent(target);
    const response = await mutation(target, `/invitations/${encodeURIComponent(invitation.id)}/finish-delivery`);
    expect(response.status).toBe(200);
    expect(observed).toBe('delivery_completion_pending');
    expect(finishDelivery).toHaveBeenCalledTimes(1);
    expect(fetchProviderStatus).toHaveBeenCalledTimes(1);
    expect(await response.json()).toMatchObject({ invitation: { status: 'delivered_waiting_inspection' } });
  });

  test.each([null, 'Delivering'])('keeps a trustworthy accepted finish pending when confirmation is %s', async (providerStatus) => {
    const finishDelivery = vi.fn(async () => new Response(JSON.stringify({ succeeded: true }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const fetchProviderStatus = vi.fn(async () => providerStatus);
    const target = app({ finishDelivery, fetchProviderStatus });
    const invitation = await advanceToInviteSent(target);
    const path = `/invitations/${encodeURIComponent(invitation.id)}/finish-delivery`;

    const first = await mutation(target, path);
    expect(first.status).toBe(202);
    expect(await first.json()).toMatchObject({
      ok: false,
      code: 'YOUTUBE_DELIVERY_ACCEPTED_PENDING_CONFIRMATION',
      invitation: { status: 'delivery_completion_pending' },
    });
    expect(finishDelivery).toHaveBeenCalledTimes(1);
    expect(fetchProviderStatus).toHaveBeenCalledTimes(1);

    const second = await mutation(target, path);
    expect(finishDelivery).toHaveBeenCalledTimes(1);
    expect(fetchProviderStatus).toHaveBeenCalledTimes(2);
    expect([202, 502]).toContain(second.status);
    expect(new YouTubeInvitationJobsStore(process.env.YOUTUBE_INVITATIONS_PATH!).read().jobs[0].status)
      .toBe('delivery_completion_pending');
  });

  test.each(['Using', 'UnexpectedProviderStatus'])('fails closed without inferring Delivered when confirmation is %s', async (providerStatus) => {
    const finishDelivery = vi.fn(async () => new Response(JSON.stringify({ succeeded: true }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const fetchProviderStatus = vi.fn(async () => providerStatus);
    const target = app({ finishDelivery, fetchProviderStatus });
    const invitation = await advanceToInviteSent(target);
    const response = await mutation(target, `/invitations/${encodeURIComponent(invitation.id)}/finish-delivery`);

    expect([202, 409]).toContain(response.status);
    expect(finishDelivery).toHaveBeenCalledTimes(1);
    expect(fetchProviderStatus).toHaveBeenCalledTimes(1);
    expect(new YouTubeInvitationJobsStore(process.env.YOUTUBE_INVITATIONS_PATH!).read().jobs[0].status)
      .toBe('delivery_completion_pending');
  });

  test('maps an explicit 2xx provider rejection to failed and resumes only from the recorded prior state', async () => {
    const target = app({ finishDelivery: vi.fn(async () => new Response(JSON.stringify({ succeeded: false }), { status: 200, headers: { 'content-type': 'application/json' } })) });
    const invitation = await advanceToInviteSent(target);
    const path = `/invitations/${encodeURIComponent(invitation.id)}`;
    const failed = await mutation(target, `${path}/finish-delivery`);
    expect(failed.status).toBe(409);
    expect(await failed.json()).toMatchObject({ invitation: { status: 'failed' } });
    const resumed = await mutation(target, `${path}/resume`);
    expect(resumed.status).toBe(200);
    expect(await resumed.json()).toMatchObject({ invitation: { status: 'delivery_completion_pending' } });
    expect((await mutation(target, `${path}/resume`)).status).toBe(409);
  });

  test('refuses to resume a failed invitation when another reservation filled the group capacity', async () => {
    const groupsStore = new YouTubeFamilyGroupsStore(process.env.YOUTUBE_FAMILY_GROUPS_PATH!);
    const group = groupsStore.read().familyGroups[0];
    groupsStore.write({ version: 1, familyGroups: [{ ...group, sellableSeats: 1 }] });
    const failed = {
      id: 'youtube-invitation:failed-deal', dealUsid: 'failed-deal', productUsid: 'different-product',
      chatRoomUuid: 'private-room', familyGroupId: 'group-1', buyerName: '구매자', buyerGoogleEmail: null,
      endDateTime: null, status: 'failed' as const, createdAt: at, updatedAt: at,
      history: [
        { from: null, to: 'waiting_for_group_assignment' as const, actor: 'system', reason: 'created', at },
        { from: 'waiting_for_group_assignment' as const, to: 'failed' as const, actor: 'operator', reason: 'paused', at },
      ],
    };
    const jobsStore = new YouTubeInvitationJobsStore(process.env.YOUTUBE_INVITATIONS_PATH!);
    jobsStore.write({ version: 1, jobs: [failed] });
    const target = app();
    const listed = await target.request('/invitations');
    const publicId = ((await listed.json()) as any).invitations[0].id;

    const response = await mutation(target, `/invitations/${encodeURIComponent(publicId)}/resume`);

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ ok: false, error: 'youtube capacity unavailable' });
    expect(jobsStore.read().jobs[0].status).toBe('failed');
    expect(audits).toEqual([expect.objectContaining({ action: 'resume', outcome: 'failed' })]);
  });

  test('keeps timeout uncertain pending and never calls finish provider again, using reconciliation instead', async () => {
    const finishDelivery = vi.fn(async () => { throw new DOMException('timeout', 'TimeoutError'); });
    const fetchProviderStatus = vi.fn(async () => 'Delivered');
    const target = app({ finishDelivery, fetchProviderStatus });
    const invitation = await advanceToInviteSent(target);
    const path = `/invitations/${encodeURIComponent(invitation.id)}`;
    const first = await mutation(target, `${path}/finish-delivery`);
    expect(first.status).toBe(502);
    expect(await first.json()).toMatchObject({ ok: false, code: 'YOUTUBE_DELIVERY_OUTCOME_UNCERTAIN', invitation: { status: 'delivery_completion_pending' } });
    const second = await mutation(target, `${path}/finish-delivery`);
    expect(second.status).toBe(200);
    expect(finishDelivery).toHaveBeenCalledTimes(1);
    expect(fetchProviderStatus).toHaveBeenCalledTimes(1);
    expect(await second.json()).toMatchObject({ invitation: { status: 'delivered_waiting_inspection' } });
    expect(audits.some(event => event.action === 'finish-delivery' && event.outcome === 'uncertain')).toBe(true);
  });

  test.each([
    ['HTTP 500 false payload', () => new Response(JSON.stringify({ succeeded: false }), { status: 500, headers: { 'content-type': 'application/json' } })],
    ['HTTP 409 false payload', () => new Response(JSON.stringify({ succeeded: false }), { status: 409, headers: { 'content-type': 'application/json' } })],
    ['HTTP 302 false payload', () => new Response(JSON.stringify({ succeeded: false }), { status: 302, headers: { 'content-type': 'application/json' } })],
    ['invalid JSON', () => new Response('not-json', { status: 200, headers: { 'content-type': 'application/json' } })],
    ['invalid response shape', () => new Response(JSON.stringify({ succeeded: 'false' }), { status: 200, headers: { 'content-type': 'application/json' } })],
  ])('keeps %s uncertain and never retries finish delivery', async (_label, responseFactory) => {
    const finishDelivery = vi.fn(async () => responseFactory());
    const fetchProviderStatus = vi.fn(async () => null);
    const target = app({ finishDelivery, fetchProviderStatus });
    const invitation = await advanceToInviteSent(target);
    const path = `/invitations/${encodeURIComponent(invitation.id)}`;

    const first = await mutation(target, `${path}/finish-delivery`);
    expect(first.status).toBe(502);
    expect(await first.json()).toMatchObject({
      code: 'YOUTUBE_DELIVERY_OUTCOME_UNCERTAIN',
      invitation: { status: 'delivery_completion_pending' },
    });
    const second = await mutation(target, `${path}/finish-delivery`);
    expect(second.status).toBe(502);
    expect(finishDelivery).toHaveBeenCalledTimes(1);
    expect(fetchProviderStatus).toHaveBeenCalledTimes(1);
    expect(new YouTubeInvitationJobsStore(process.env.YOUTUBE_INVITATIONS_PATH!).read().jobs[0].status)
      .toBe('delivery_completion_pending');
  });

  test('reconciles Delivered, Using and terminal statuses idempotently and rejects unknown observations without writes', async () => {
    const statuses = ['Delivered', 'Delivered', 'Using', 'Using', 'NormalFinished', 'NormalFinished'];
    const fetchProviderStatus = vi.fn(async () => statuses.shift() ?? null);
    const target = app({ fetchProviderStatus });
    const invitation = await advanceToInviteSent(target);
    const path = `/invitations/${encodeURIComponent(invitation.id)}`;
    for (const expected of ['delivered_waiting_inspection', 'delivered_waiting_inspection', 'active', 'active', 'ended', 'ended']) {
      const response = await mutation(target, `${path}/reconcile`);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ invitation: { status: expected } });
    }
    const before = readFileSync(process.env.YOUTUBE_INVITATIONS_PATH!, 'utf8');
    const unknown = await mutation(app({ fetchProviderStatus: vi.fn(async () => null) }), `${path}/reconcile`);
    expect(unknown.status).toBe(502);
    expect(readFileSync(process.env.YOUTUBE_INVITATIONS_PATH!, 'utf8')).toBe(before);
  });

  test('returns 409 without write for unsupported or illegal provider status', async () => {
    const target = app({ fetchProviderStatus: vi.fn(async () => 'Using') });
    const invitation = await ingest(target);
    const path = `/invitations/${encodeURIComponent(invitation.id)}`;
    const before = readFileSync(process.env.YOUTUBE_INVITATIONS_PATH!, 'utf8');
    expect((await mutation(target, `${path}/reconcile`)).status).toBe(409);
    expect(readFileSync(process.env.YOUTUBE_INVITATIONS_PATH!, 'utf8')).toBe(before);
    const unsupported = app({ fetchProviderStatus: vi.fn(async () => 'Delivering') });
    expect((await mutation(unsupported, `${path}/reconcile`)).status).toBe(409);
    expect(readFileSync(process.env.YOUTUBE_INVITATIONS_PATH!, 'utf8')).toBe(before);
  });

  test('lists sorted filtered safe DTOs without raw buyer email', async () => {
    const target = app();
    const invitation = await advanceToInviteSent(target);
    const response = await target.request('/invitations?status=invite_sent&familyGroupId=group-1');
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain(invitation.id);
    expect(text).toContain('b***r@e*****e.com');
    expect(text).not.toContain('buyer@example.com');
    expect(text).not.toContain('buyerGoogleEmail');
    expect((await target.request('/invitations?status=not-real')).status).toBe(400);
  });
});
