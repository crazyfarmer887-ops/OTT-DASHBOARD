import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { closeSync, mkdtempSync, openSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { YouTubeFamilyGroupsStore, YouTubeInvitationJobsStore } from '../src/lib/youtube-invitations';
import { createYouTubeInvitationsApp } from '../src/api/youtube-invitations';
import { fingerprintYouTubeProductRegistration, YouTubeProductRegistrationsStore } from '../src/lib/youtube-product-registrations';
import { buildYouTubeSharingNoKeepProductModel } from '../src/lib/graytag-fill';

let root = '';
const saved = { ...process.env };
const now = '2026-08-11T00:00:00.000Z';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'youtube-product-api-'));
  process.env.YOUTUBE_INVITE_SALES_ENABLED = 'true';
  process.env.YOUTUBE_FAMILY_GROUPS_PATH = join(root, 'groups.json');
  process.env.YOUTUBE_INVITATIONS_PATH = join(root, 'jobs.json');
  process.env.YOUTUBE_PRODUCT_REGISTRATIONS_PATH = join(root, 'registrations.json');
  process.env.YOUTUBE_CAPACITY_LOCK_PATH = join(root, 'capacity.lock');
  new YouTubeFamilyGroupsStore(process.env.YOUTUBE_FAMILY_GROUPS_PATH).write({ version: 1, familyGroups: [{ id: 'group-1', label: '그룹', managerEmail: 'manager@example.com', subscriptionEndDate: '2027-08-31', sellableSeats: 1, enabled: true, createdAt: now, updatedAt: now }] });
  new YouTubeInvitationJobsStore(process.env.YOUTUBE_INVITATIONS_PATH).write({ version: 1, jobs: [] });
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); for (const key of ['YOUTUBE_INVITE_SALES_ENABLED','YOUTUBE_FAMILY_GROUPS_PATH','YOUTUBE_INVITATIONS_PATH','YOUTUBE_PRODUCT_REGISTRATIONS_PATH','YOUTUBE_CAPACITY_LOCK_PATH','AIO_ADMIN_TOKEN','AIO_ADMIN_ACTOR']) saved[key] === undefined ? delete process.env[key] : process.env[key] = saved[key]; });

const body = { familyGroupId: 'group-1', endDate: '20270831T2359', price: 7900, name: ' 유튜브 ', sellingGuide: ' 안내 ' };
function post(app: ReturnType<typeof createYouTubeInvitationsApp>, key = 'request-key-1000', value: unknown = body, reason = 'product registration') {
  return app.request('/products', { method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': key, 'x-audit-reason': encodeURIComponent(reason) }, body: JSON.stringify(value) });
}

describe('YouTube product registration API', () => {
  test('returns an actionable validation error without claiming or calling the provider', async () => {
    const registerProduct = vi.fn();
    const app = createYouTubeInvitationsApp({ registerProduct });
    const response = await post(app, 'overlong-guide-request', { ...body, sellingGuide: '가'.repeat(301) });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      ok: false,
      error: '유튜브 상품 설명은 300자 이하여야 해요.',
      code: 'YOUTUBE_PRODUCT_VALIDATION_FAILED',
    });
    expect(registerProduct).not.toHaveBeenCalled();
    expect(await (await app.request('/products/registrations')).json()).toMatchObject({ registrations: [] });
  });

  test('uses an injected clock to reject today/past dates and expired groups before provider or claim', async () => {
    const registerProduct = vi.fn();
    const app = createYouTubeInvitationsApp({ registerProduct, now: () => new Date('2026-08-14T15:30:00.000Z') }); // Seoul: 2026-08-15
    for (const [key, endDate] of [['past-date', '20260814T2359'], ['seoul-today', '20260815T2359']]) {
      const response = await post(app, `${key}-request`, { ...body, endDate });
      expect(response.status).toBe(400);
    }
    new YouTubeFamilyGroupsStore(process.env.YOUTUBE_FAMILY_GROUPS_PATH!).write({ version: 1, familyGroups: [{ id: 'group-1', label: '그룹', managerEmail: 'manager@example.com', subscriptionEndDate: '2026-08-14', sellableSeats: 1, enabled: true, createdAt: now, updatedAt: now }] });
    expect((await post(app, 'expired-group-request', { ...body, endDate: '20260816T2359' })).status).toBe(409);
    expect(registerProduct).not.toHaveBeenCalled();
    expect(await (await app.request('/products/registrations')).json()).toMatchObject({ registrations: [] });
  });

  test('rejects email-like audit reasons before claim, provider, or audit and accepts a safe Korean reason', async () => {
    const registerProduct = vi.fn(async () => new Response(JSON.stringify({ succeeded: true, data: 'product-safe-reason' }), { status: 200 }));
    const audit = vi.fn();
    const app = createYouTubeInvitationsApp({ registerProduct, audit });
    for (const [index, reason] of ['buyer@example.com', 'buyer＠example.com', 'buyer﹫example.com'].entries()) {
      expect((await post(app, `unsafe-reason-${index}`, body, reason)).status).toBe(400);
    }
    expect(registerProduct).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    expect(await (await app.request('/products/registrations')).json()).toMatchObject({ registrations: [] });

    const safeReason = '상품 등록 사유 확인';
    expect((await post(app, 'safe-reason-1000', body, safeReason)).status).toBe(201);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ reason: safeReason }));
  });

  test('injects the exact SharingNoKeep model, registers once, then replays', async () => {
    const registerProduct = vi.fn(async () => new Response(JSON.stringify({ succeeded: true, data: 'product-1' }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const audit = vi.fn();
    const app = createYouTubeInvitationsApp({ registerProduct, actor: () => 'admin:test', audit });
    const first = await post(app); expect(first.status).toBe(201);
    expect(await first.json()).toEqual({ ok: true, productUsid: 'product-1', familyGroupId: 'group-1', status: 'registered' });
    expect(registerProduct).toHaveBeenCalledWith({ tempProductCategory: 'youtube', endDate: '20270831T2359', priceType: 'Normal', price: '7900', name: '유튜브', sellingGuide: '안내' });
    const second = await post(app); expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ replayed: true, productUsid: 'product-1', status: 'registered' });
    expect(registerProduct).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(registerProduct.mock.calls)).not.toContain('keepAcct');
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'registered', actor: 'admin:test', reason: 'product registration' }));
  });

  test('strips the family-group Gmail marker from the final model and fingerprints the clean title', async () => {
    new YouTubeFamilyGroupsStore(process.env.YOUTUBE_FAMILY_GROUPS_PATH!).write({ version: 1, familyGroups: [{
      id: 'group-1', label: '그룹', managerEmail: 'abcde123@gmail.com', subscriptionEndDate: '2027-08-31',
      sellableSeats: 1, enabled: true, createdAt: now, updatedAt: now,
    }] });
    const registerProduct = vi.fn(async () => new Response(JSON.stringify({ succeeded: true, data: 'product-coded' }), { status: 200 }));
    const app = createYouTubeInvitationsApp({ registerProduct });

    const first = await post(app, 'request-key-listing-code', { ...body, name: '유튜브 프리미엄' });
    expect(first.status).toBe(201);
    expect(registerProduct).toHaveBeenCalledWith(expect.objectContaining({ name: '유튜브 프리미엄' }));
    const cleanModel = buildYouTubeSharingNoKeepProductModel({ ...body, name: '유튜브 프리미엄' });
    expect(new YouTubeProductRegistrationsStore(process.env.YOUTUBE_PRODUCT_REGISTRATIONS_PATH!).list()[0].requestFingerprint)
      .toBe(fingerprintYouTubeProductRegistration('group-1', cleanModel));

    const replay = await post(app, 'request-key-listing-code', { ...body, name: '유튜브 프리미엄 abc123' });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ replayed: true, productUsid: 'product-coded' });
    expect(registerProduct).toHaveBeenCalledTimes(1);
  });

  test('replays a registered legacy coded fingerprint when the new frontend sends a clean title', async () => {
    new YouTubeFamilyGroupsStore(process.env.YOUTUBE_FAMILY_GROUPS_PATH!).write({ version: 1, familyGroups: [{
      id: 'group-1', label: '그룹', managerEmail: 'abcde123@gmail.com', subscriptionEndDate: '2027-08-31',
      sellableSeats: 1, enabled: true, createdAt: now, updatedAt: now,
    }] });
    const legacyModel = buildYouTubeSharingNoKeepProductModel({ ...body, name: '유튜브 프리미엄 abc123' });
    const legacyFingerprint = fingerprintYouTubeProductRegistration('group-1', legacyModel);
    const store = new YouTubeProductRegistrationsStore(process.env.YOUTUBE_PRODUCT_REGISTRATIONS_PATH!, { allowUnsafeIsolatedClaim: true });
    store.claim({ idempotencyKey: 'request-key-legacy-replay', requestFingerprint: legacyFingerprint, familyGroupId: 'group-1', actor: 'admin', reasonCode: 'legacy-create', at: now });
    store.complete('request-key-legacy-replay', 'registered', { actor: 'admin', reasonCode: 'legacy-done', productUsid: 'product-legacy', at: '2026-08-11T00:00:01.000Z' });
    const registerProduct = vi.fn();
    const app = createYouTubeInvitationsApp({ registerProduct });

    const replay = await post(app, 'request-key-legacy-replay', { ...body, name: '유튜브 프리미엄' });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ replayed: true, productUsid: 'product-legacy' });
    expect(registerProduct).not.toHaveBeenCalled();

    const changed = await post(app, 'request-key-legacy-replay', { ...body, name: '유튜브 프리미엄', sellingGuide: '변경된 안내' });
    expect(changed.status).toBe(409);
    expect(await changed.json()).toMatchObject({ code: 'YOUTUBE_PRODUCT_IDEMPOTENCY_CONFLICT' });
  });

  test('replays the exact legacy submitted-title fingerprint without normalizing punctuation or spaces', async () => {
    new YouTubeFamilyGroupsStore(process.env.YOUTUBE_FAMILY_GROUPS_PATH!).write({ version: 1, familyGroups: [{
      id: 'group-1', label: '그룹', managerEmail: 'abcde123@gmail.com', subscriptionEndDate: '2027-08-31',
      sellableSeats: 1, enabled: true, createdAt: now, updatedAt: now,
    }] });
    const exactLegacyModel = buildYouTubeSharingNoKeepProductModel({ ...body, name: '유튜브!!  프리미엄' });
    const exactLegacyFingerprint = fingerprintYouTubeProductRegistration('group-1', exactLegacyModel);
    const store = new YouTubeProductRegistrationsStore(process.env.YOUTUBE_PRODUCT_REGISTRATIONS_PATH!, { allowUnsafeIsolatedClaim: true });
    store.claim({ idempotencyKey: 'request-key-exact-legacy', requestFingerprint: exactLegacyFingerprint, familyGroupId: 'group-1', actor: 'admin', reasonCode: 'legacy-create', at: now });
    store.complete('request-key-exact-legacy', 'registered', { actor: 'admin', reasonCode: 'legacy-done', productUsid: 'product-exact-legacy', at: '2026-08-11T00:00:01.000Z' });
    const registerProduct = vi.fn();
    const app = createYouTubeInvitationsApp({ registerProduct });

    const replay = await post(app, 'request-key-exact-legacy', { ...body, name: '유튜브!!  프리미엄' });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ replayed: true, productUsid: 'product-exact-legacy' });
    expect(registerProduct).not.toHaveBeenCalled();

    const changed = await post(app, 'request-key-exact-legacy', { ...body, name: '유튜브!!  프리미엄', sellingGuide: '변경된 안내' });
    expect(changed.status).toBe(409);
    expect(await changed.json()).toMatchObject({ code: 'YOUTUBE_PRODUCT_IDEMPOTENCY_CONFLICT' });
  });

  test('always accepts the exact submitted fingerprint when a legacy title already contains the code', async () => {
    new YouTubeFamilyGroupsStore(process.env.YOUTUBE_FAMILY_GROUPS_PATH!).write({ version: 1, familyGroups: [{
      id: 'group-1', label: '그룹', managerEmail: 'abcde123@gmail.com', subscriptionEndDate: '2027-08-31',
      sellableSeats: 1, enabled: true, createdAt: now, updatedAt: now,
    }] });
    const exactLegacyModel = buildYouTubeSharingNoKeepProductModel({ ...body, name: '유튜브!!  프리미엄 ABC123' });
    const exactLegacyFingerprint = fingerprintYouTubeProductRegistration('group-1', exactLegacyModel);
    const store = new YouTubeProductRegistrationsStore(process.env.YOUTUBE_PRODUCT_REGISTRATIONS_PATH!, { allowUnsafeIsolatedClaim: true });
    store.claim({ idempotencyKey: 'request-key-exact-coded', requestFingerprint: exactLegacyFingerprint, familyGroupId: 'group-1', actor: 'admin', reasonCode: 'legacy-create', at: now });
    store.complete('request-key-exact-coded', 'registered', { actor: 'admin', reasonCode: 'legacy-done', productUsid: 'product-exact-coded', at: '2026-08-11T00:00:01.000Z' });
    const registerProduct = vi.fn();
    const app = createYouTubeInvitationsApp({ registerProduct });

    const replay = await post(app, 'request-key-exact-coded', { ...body, name: '유튜브!!  프리미엄 ABC123' });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ replayed: true, productUsid: 'product-exact-coded' });
    expect(registerProduct).not.toHaveBeenCalled();
  });

  test('marks timeout uncertain and blocks a second call without retrying', async () => {
    const registerProduct = vi.fn(async () => { throw new DOMException('timed out model-secret', 'TimeoutError'); });
    const app = createYouTubeInvitationsApp({ registerProduct, actor: () => 'admin:test' });
    const first = await post(app, 'request-key-2000'); expect(first.status).toBe(502); expect(await first.json()).toMatchObject({ code: 'YOUTUBE_PRODUCT_REGISTRATION_UNCERTAIN' });
    const second = await post(app, 'request-key-2000'); expect(second.status).toBe(409); expect(await second.json()).toMatchObject({ code: 'YOUTUBE_PRODUCT_REGISTRATION_UNCERTAIN' });
    expect(registerProduct).toHaveBeenCalledTimes(1);
  });

  test('keeps an active submitting lease at 409 without mutation or lookup', async () => {
    const registerProduct = vi.fn();
    const reconcileProductRegistration = vi.fn();
    const app = createYouTubeInvitationsApp({ registerProduct, reconcileProductRegistration, now: () => new Date('2026-08-11T00:00:30.000Z') });
    const model = buildYouTubeSharingNoKeepProductModel({ ...body, name: '유튜브' });
    new YouTubeProductRegistrationsStore(process.env.YOUTUBE_PRODUCT_REGISTRATIONS_PATH!, { allowUnsafeIsolatedClaim: true }).claim({ idempotencyKey: 'request-key-active-lease', requestFingerprint: fingerprintYouTubeProductRegistration('group-1', model), familyGroupId: 'group-1', actor: 'admin', reasonCode: 'create', at: now });
    const response = await post(app, 'request-key-active-lease');
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'YOUTUBE_PRODUCT_REGISTRATION_IN_PROGRESS' });
    expect(registerProduct).not.toHaveBeenCalled();
    expect(reconcileProductRegistration).not.toHaveBeenCalled();
  });

  test('recovers an expired submitting lease by authoritative lookup without repeating POST', async () => {
    const registerProduct = vi.fn();
    const reconcileProductRegistration = vi.fn(async () => ({ status: 'registered' as const, productUsid: 'product-recovered' }));
    const app = createYouTubeInvitationsApp({ registerProduct, reconcileProductRegistration, now: () => new Date('2026-08-11T00:02:00.000Z') });
    const model = buildYouTubeSharingNoKeepProductModel({ ...body, name: '유튜브' });
    const store = new YouTubeProductRegistrationsStore(process.env.YOUTUBE_PRODUCT_REGISTRATIONS_PATH!, { allowUnsafeIsolatedClaim: true });
    const claim = store.claim({ idempotencyKey: 'request-key-stale-found', requestFingerprint: fingerprintYouTubeProductRegistration('group-1', model), familyGroupId: 'group-1', actor: 'admin', reasonCode: 'create', at: now });
    if (claim.kind !== 'claimed') throw new Error('expected claim');
    const response = await post(app, 'request-key-stale-found');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, replayed: true, productUsid: 'product-recovered', familyGroupId: 'group-1', status: 'registered' });
    expect(registerProduct).not.toHaveBeenCalled();
    expect(reconcileProductRegistration).toHaveBeenCalledWith({ attemptId: claim.record.attemptId, requestFingerprint: claim.record.requestFingerprint, familyGroupId: 'group-1' });
  });

  test('recovers an expired clean-title claim and reconciles with its durable fingerprint', async () => {
    new YouTubeFamilyGroupsStore(process.env.YOUTUBE_FAMILY_GROUPS_PATH!).write({ version: 1, familyGroups: [{
      id: 'group-1', label: '그룹', managerEmail: 'abcde123@gmail.com', subscriptionEndDate: '2027-08-31',
      sellableSeats: 1, enabled: true, createdAt: now, updatedAt: now,
    }] });
    const legacyModel = buildYouTubeSharingNoKeepProductModel({ ...body, name: '유튜브 프리미엄' });
    const legacyFingerprint = fingerprintYouTubeProductRegistration('group-1', legacyModel);
    const store = new YouTubeProductRegistrationsStore(process.env.YOUTUBE_PRODUCT_REGISTRATIONS_PATH!, { allowUnsafeIsolatedClaim: true });
    const legacyClaim = store.claim({ idempotencyKey: 'request-key-legacy-recovery', requestFingerprint: legacyFingerprint, familyGroupId: 'group-1', actor: 'admin', reasonCode: 'legacy-create', at: now });
    if (legacyClaim.kind !== 'claimed') throw new Error('expected legacy claim');
    const registerProduct = vi.fn();
    const reconcileProductRegistration = vi.fn(async () => ({ status: 'registered' as const, productUsid: 'product-legacy-recovered' }));
    const app = createYouTubeInvitationsApp({ registerProduct, reconcileProductRegistration, now: () => new Date('2026-08-11T00:02:00.000Z') });

    const response = await post(app, 'request-key-legacy-recovery', { ...body, name: '유튜브 프리미엄' });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ replayed: true, productUsid: 'product-legacy-recovered' });
    expect(registerProduct).not.toHaveBeenCalled();
    expect(reconcileProductRegistration).toHaveBeenCalledWith({
      attemptId: legacyClaim.record.attemptId,
      requestFingerprint: legacyFingerprint,
      familyGroupId: 'group-1',
    });
  });

  test('settles an expired submitting lease as uncertain when lookup cannot prove registration', async () => {
    const registerProduct = vi.fn();
    const reconcileProductRegistration = vi.fn(async () => ({ status: 'uncertain' as const }));
    const app = createYouTubeInvitationsApp({ registerProduct, reconcileProductRegistration, now: () => new Date('2026-08-11T00:02:00.000Z') });
    const model = buildYouTubeSharingNoKeepProductModel({ ...body, name: '유튜브' });
    new YouTubeProductRegistrationsStore(process.env.YOUTUBE_PRODUCT_REGISTRATIONS_PATH!, { allowUnsafeIsolatedClaim: true }).claim({ idempotencyKey: 'request-key-stale-unknown', requestFingerprint: fingerprintYouTubeProductRegistration('group-1', model), familyGroupId: 'group-1', actor: 'admin', reasonCode: 'create', at: now });
    const response = await post(app, 'request-key-stale-unknown');
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'YOUTUBE_PRODUCT_REGISTRATION_UNCERTAIN' });
    expect(registerProduct).not.toHaveBeenCalled();
    expect(new YouTubeProductRegistrationsStore(process.env.YOUTUBE_PRODUCT_REGISTRATIONS_PATH!).list()[0].status).toBe('uncertain');
  });

  test('persists known provider rejection as failed and never retries it', async () => {
    const registerProduct = vi.fn(async () => new Response(JSON.stringify({ succeeded: false, message: 'secret model detail' }), { status: 400, headers: { 'content-type': 'application/json' } }));
    const app = createYouTubeInvitationsApp({ registerProduct, actor: () => 'admin:test' });
    const first = await post(app, 'request-key-3000'); expect(first.status).toBe(502); expect(await first.json()).toMatchObject({ code: 'YOUTUBE_PRODUCT_REGISTRATION_FAILED' });
    expect((await post(app, 'request-key-3000')).status).toBe(409); expect(registerProduct).toHaveBeenCalledTimes(1);
  });

  test('validates flag, reason, idempotency, exact body, group, date and capacity before provider or claim', async () => {
    const registerProduct = vi.fn(); const app = createYouTubeInvitationsApp({ registerProduct });
    process.env.YOUTUBE_INVITE_SALES_ENABLED = 'false'; expect((await post(app)).status).toBe(503); process.env.YOUTUBE_INVITE_SALES_ENABLED = 'true';
    expect((await app.request('/products', { method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': 'request-key-4000' }, body: JSON.stringify(body) })).status).toBe(400);
    expect((await post(app, 'bad')).status).toBe(400);
    expect((await post(app, 'request-key-4001', { ...body, extra: true })).status).toBe(400);
    expect((await post(app, 'request-key-4002', { ...body, familyGroupId: 'missing' })).status).toBe(404);
    expect((await post(app, 'request-key-4003', { ...body, endDate: '20260901T0000' })).status).toBe(400);
    new YouTubeInvitationJobsStore(process.env.YOUTUBE_INVITATIONS_PATH!).write({ version: 1, jobs: [{ id: 'youtube-invitation:deal-1', dealUsid: 'deal-1', productUsid: 'occupied', chatRoomUuid: 'chat-1', familyGroupId: 'group-1', buyerName: '구매자', buyerGoogleEmail: null, endDateTime: null, status: 'waiting_for_group_assignment', createdAt: now, updatedAt: now, history: [] }] });
    expect((await post(app, 'request-key-4004')).status).toBe(409); expect(registerProduct).not.toHaveBeenCalled();
  });

  test.each([
    ['endDate', 20270831], ['endDate', true], ['name', 123], ['name', false], ['sellingGuide', 123], ['sellingGuide', true], ['price', '7900'], ['price', false],
  ])('rejects strict product body type for %s=%j before claim or provider', async (field, invalid) => {
    const registerProduct = vi.fn();
    const app = createYouTubeInvitationsApp({ registerProduct });
    const response = await post(app, `strict-type-${field}-${String(invalid)}`, { ...body, [field]: invalid });
    expect(response.status).toBe(400);
    expect(registerProduct).not.toHaveBeenCalled();
    const registrations = await app.request('/products/registrations');
    expect(await registrations.json()).toMatchObject({ registrations: [] });
  });

  test('atomically rejects a concurrent different key while the first provider call is pending', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const registerProduct = vi.fn(async () => { await held; return new Response(JSON.stringify({ succeeded: true, data: 'product-concurrent' }), { status: 200 }); });
    const app = createYouTubeInvitationsApp({ registerProduct });
    const firstPromise = post(app, 'request-key-concurrent-1');
    await vi.waitFor(() => expect(registerProduct).toHaveBeenCalledTimes(1));
    const second = await post(app, 'request-key-concurrent-2');
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ code: 'YOUTUBE_FAMILY_GROUP_NO_CAPACITY' });
    expect(registerProduct).toHaveBeenCalledTimes(1);
    release();
    expect((await firstPromise).status).toBe(201);
  });

  test('rejects an interleaved different raw job after claim while provider is pending', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const registerProduct = vi.fn(async () => {
      await held;
      return new Response(JSON.stringify({ succeeded: true, data: 'product-after-claim' }), { status: 200 });
    });
    const app = createYouTubeInvitationsApp({ registerProduct });
    const pending = post(app, 'request-key-claimed-race');
    await vi.waitFor(() => expect(registerProduct).toHaveBeenCalledTimes(1));

    const jobsStore = new YouTubeInvitationJobsStore(process.env.YOUTUBE_INVITATIONS_PATH!);
    expect(() => jobsStore.write({ version: 1, jobs: [{
      id: 'youtube-invitation:deal-interleaved', dealUsid: 'deal-interleaved', productUsid: 'different-product',
      chatRoomUuid: 'chat-interleaved', familyGroupId: 'group-1', buyerName: '구매자', buyerGoogleEmail: null,
      endDateTime: null, status: 'waiting_for_group_assignment', createdAt: now, updatedAt: now, history: [],
    }] })).toThrow(/capacity invariant/i);
    expect(jobsStore.read().jobs).toEqual([]);

    release();
    expect((await pending).status).toBe(201);
    const registrations = await app.request('/products/registrations');
    expect(await registrations.json()).toMatchObject({
      registrations: [{ familyGroupId: 'group-1', productUsid: 'product-after-claim', status: 'registered' }],
    });
    expect(registerProduct).toHaveBeenCalledTimes(1);
  });

  test('an uncertain reservation blocks a different idempotency key', async () => {
    const registerProduct = vi.fn(async () => { throw new DOMException('timeout', 'TimeoutError'); });
    const app = createYouTubeInvitationsApp({ registerProduct });
    expect((await post(app, 'request-key-uncertain-1')).status).toBe(502);
    const second = await post(app, 'request-key-uncertain-2');
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ code: 'YOUTUBE_FAMILY_GROUP_NO_CAPACITY' });
    expect(registerProduct).toHaveBeenCalledTimes(1);
  });

  test('returns generic unavailable on shared capacity-lock contention without claiming, retrying, or calling the provider', async () => {
    const registerProduct = vi.fn();
    const app = createYouTubeInvitationsApp({ registerProduct });
    const lockPath = process.env.YOUTUBE_CAPACITY_LOCK_PATH!;
    const lockFd = openSync(lockPath, 'wx', 0o600);
    try {
      const response = await post(app, 'request-key-busy-api');
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ ok: false, error: 'youtube store unavailable' });
      expect(registerProduct).not.toHaveBeenCalled();
    } finally { closeSync(lockFd); rmSync(lockPath, { force: true }); }
    expect(new (await import('../src/lib/youtube-product-registrations')).YouTubeProductRegistrationsStore(process.env.YOUTUBE_PRODUCT_REGISTRATIONS_PATH!).list()).toEqual([]);
  });

  test('enforces admin auth and the feature gate through the canonical application root', async () => {
    vi.resetModules();
    process.env.AIO_ADMIN_TOKEN = 'product-admin-token';
    process.env.AIO_ADMIN_ACTOR = 'product-admin';
    process.env.YOUTUBE_INVITE_SALES_ENABLED = 'false';
    const rootApp = (await import('../src/api/index.ts')).default;
    const unauthenticated = await rootApp.request('/youtube/products', { method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': 'request-key-6000', 'x-audit-reason': 'product registration' }, body: JSON.stringify(body) });
    expect(unauthenticated.status).toBe(403);
    const disabled = await rootApp.request('/youtube/products', { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-token': 'product-admin-token', 'Idempotency-Key': 'request-key-6000', 'x-audit-reason': 'product registration' }, body: JSON.stringify(body) });
    expect(disabled.status).toBe(503);
    expect(disabled.headers.get('cache-control')).toBe('no-store');
    const registrations = await rootApp.request('/youtube/products/registrations', { headers: { 'x-admin-token': 'product-admin-token' } });
    expect(registrations.status).toBe(200);
    expect(await registrations.json()).toMatchObject({ enabled: false, registrations: [] });
  });

  test('lists only admin UI allowlisted summaries with validated raw productUsid', async () => {
    const app = createYouTubeInvitationsApp({ registerProduct: async () => new Response(JSON.stringify({ succeeded: true, data: 'product-5' }), { status: 200 }) });
    await post(app, 'request-key-5000');
    const response = await app.request('/products/registrations'); expect(response.status).toBe(200);
    const payload = await response.json() as any;
    expect(payload.registrations[0]).toEqual({
      registrationDisplayId: expect.stringMatching(/^registration-[a-f0-9]{12}$/),
      productUsid: 'product-5',
      productDisplayId: expect.stringMatching(/^product-[a-f0-9]{12}$/),
      familyGroupId: 'group-1', status: 'registered', createdAt: expect.any(String), updatedAt: expect.any(String),
    });
    const text = JSON.stringify(payload);
    expect(text).not.toContain('request-key-5000');
    expect(text).not.toContain('admin:authenticated');
    expect(text).not.toContain('sellingGuide');
    expect(text).not.toContain('manager@example.com');
    expect(text).not.toContain('requestFingerprint');
  });

  test('uses nullable product identifiers for non-registered records without exposing durable keys or actors', async () => {
    const store = new YouTubeProductRegistrationsStore(process.env.YOUTUBE_PRODUCT_REGISTRATIONS_PATH!, { allowUnsafeIsolatedClaim: true });
    store.claim({ idempotencyKey: 'request-key-submitting', requestFingerprint: 'a'.repeat(64), familyGroupId: 'group-1', actor: 'admin', reasonCode: 'create', at: now });
    const payload = await (await createYouTubeInvitationsApp().request('/products/registrations')).json() as any;
    expect(payload.registrations[0]).toEqual({
      familyGroupId: 'group-1', status: 'submitting', productUsid: null,
      registrationDisplayId: expect.stringMatching(/^registration-[a-f0-9]{12}$/), productDisplayId: null,
      createdAt: now, updatedAt: now,
    });
    expect(JSON.stringify(payload)).not.toContain('request-key-submitting');
    expect(JSON.stringify(payload)).not.toContain('"actor"');
  });

  test('hides deleted posts from account management and restores the family-group seat', async () => {
    const store = new YouTubeProductRegistrationsStore(process.env.YOUTUBE_PRODUCT_REGISTRATIONS_PATH!, { allowUnsafeIsolatedClaim: true });
    store.claim({ idempotencyKey: 'request-key-deleted-api', requestFingerprint: 'd'.repeat(64), familyGroupId: 'group-1', actor: 'admin', reasonCode: 'create', at: now });
    store.complete('request-key-deleted-api', 'registered', {
      actor: 'admin', reasonCode: 'registered', productUsid: 'product-deleted-api', at: '2026-08-11T00:00:01.000Z',
    });
    store.markDeletedProducts(['product-deleted-api'], {
      actor: 'admin', reasonCode: 'provider-delete-succeeded', at: '2026-08-11T00:00:02.000Z',
    });
    const app = createYouTubeInvitationsApp();

    const registrations = await (await app.request('/products/registrations')).json() as any;
    expect(registrations.registrations).toEqual([]);
    const groups = await (await app.request('/family-groups')).json() as any;
    expect(groups.familyGroups[0]).toMatchObject({ id: 'group-1', availableSeats: 1 });
  });

  test('reconciles authoritative provider cancellations and restores capacity idempotently', async () => {
    const store = new YouTubeProductRegistrationsStore(process.env.YOUTUBE_PRODUCT_REGISTRATIONS_PATH!, { allowUnsafeIsolatedClaim: true });
    store.claim({ idempotencyKey: 'request-key-provider-cancelled', requestFingerprint: 'e'.repeat(64), familyGroupId: 'group-1', actor: 'admin', reasonCode: 'create', at: now });
    store.complete('request-key-provider-cancelled', 'registered', {
      actor: 'admin', reasonCode: 'registered', productUsid: 'product-provider-cancelled', at: '2026-08-11T00:00:01.000Z',
    });
    new YouTubeInvitationJobsStore(process.env.YOUTUBE_INVITATIONS_PATH!).write({ version: 1, jobs: [{
      id: 'youtube-invitation:deal-provider-cancelled', dealUsid: 'deal-provider-cancelled',
      productUsid: 'product-provider-cancelled', chatRoomUuid: 'chat-provider-cancelled', familyGroupId: 'group-1',
      buyerName: '구매자', buyerGoogleEmail: null, endDateTime: null, status: 'waiting_for_group_assignment',
      createdAt: now, updatedAt: '2026-08-11T00:00:01.000Z', history: [],
    }] });
    const productReconciliationAudit = vi.fn();
    const fetchProviderProductStatuses = vi.fn(async () => ({
      authoritative: true,
      rows: [{ productUsid: 'product-provider-cancelled', status: 'CancelByDepositRejection' }],
    }));
    const app = createYouTubeInvitationsApp({
      actor: () => 'admin:test', fetchProviderProductStatuses, productReconciliationAudit,
      now: () => new Date('2026-08-11T00:00:02.000Z'),
    });
    const request = () => app.request('/products/registrations/reconcile', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-audit-reason': 'operator cancelled product reconciliation' },
      body: '{}',
    });

    const first = await request();
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({
      ok: true,
      releasedCount: 1,
      adoptedCount: 0,
      unmappedCount: 0,
      familyGroups: [{ id: 'group-1', releasedCount: 1, adoptedCount: 0, availableSeats: 1 }],
    });
    expect(store.list()[0]).toMatchObject({
      status: 'deleted',
      history: expect.arrayContaining([expect.objectContaining({
        from: 'registered', to: 'deleted', actor: 'admin:test', reasonCode: 'provider-terminal-reconciled',
      })]),
    });
    expect(new YouTubeInvitationJobsStore(process.env.YOUTUBE_INVITATIONS_PATH!).read().jobs[0]).toMatchObject({
      status: 'ended',
      history: [expect.objectContaining({ from: 'waiting_for_group_assignment', to: 'ended', actor: 'admin:test' })],
    });
    expect(productReconciliationAudit).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'success', releasedCount: 1, adoptedCount: 0, familyGroupIds: ['group-1'],
    }));

    const replay = await request();
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({
      ok: true, releasedCount: 0, adoptedCount: 0, unmappedCount: 0, familyGroups: [],
    });
    expect(store.list()[0].history).toHaveLength(3);
  });

  test('adopts provider-live account-checking and using products missing from the local journal', async () => {
    new YouTubeFamilyGroupsStore(process.env.YOUTUBE_FAMILY_GROUPS_PATH!).write({ version: 1, familyGroups: [{
      id: 'group-1', label: '그룹', managerEmail: 'manager@example.com', subscriptionEndDate: '2027-08-31',
      sellableSeats: 3, enabled: true, createdAt: now, updatedAt: now,
    }] });
    const store = new YouTubeProductRegistrationsStore(process.env.YOUTUBE_PRODUCT_REGISTRATIONS_PATH!, { allowUnsafeIsolatedClaim: true });
    store.claim({ idempotencyKey: 'request-key-known-live-product', requestFingerprint: 'a'.repeat(64), familyGroupId: 'group-1', actor: 'admin', reasonCode: 'create', at: now });
    store.complete('request-key-known-live-product', 'registered', {
      actor: 'admin', reasonCode: 'registered', productUsid: 'product-known-using', at: '2026-08-11T00:00:01.000Z',
    });
    const app = createYouTubeInvitationsApp({
      actor: () => 'admin:test',
      fetchProviderProductStatuses: async () => ({ authoritative: true, rows: [
        { productUsid: 'product-known-using', status: 'Using', endDateTime: '27. 08. 31' },
        { productUsid: 'product-missing-delivered', status: 'Delivered', endDateTime: '2027-08-31' },
        { productUsid: 'product-missing-using', status: 'Using', endDateTime: '20270831T2359' },
      ] }),
      now: () => new Date('2026-08-11T00:00:02.000Z'),
    });
    const request = () => app.request('/products/registrations/reconcile', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-audit-reason': 'operator live product reconciliation' },
      body: '{}',
    });

    const first = await request();
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({
      ok: true,
      releasedCount: 0,
      adoptedCount: 2,
      unmappedCount: 0,
      familyGroups: [{ id: 'group-1', releasedCount: 0, adoptedCount: 2, availableSeats: 0 }],
    });
    expect(store.list()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        status: 'registered', productUsid: 'product-missing-using', familyGroupId: 'group-1',
        history: expect.arrayContaining([expect.objectContaining({ reasonCode: 'provider-live-reconciled' })]),
      }),
      expect.objectContaining({
        status: 'registered', productUsid: 'product-missing-delivered', familyGroupId: 'group-1',
        history: expect.arrayContaining([expect.objectContaining({ reasonCode: 'provider-live-reconciled' })]),
      }),
    ]));
    expect((await (await app.request('/family-groups')).json() as any).familyGroups[0]).toMatchObject({
      sellableSeats: 3, availableSeats: 0,
    });

    const replay = await request();
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({
      ok: true, releasedCount: 0, adoptedCount: 0, unmappedCount: 0, familyGroups: [],
    });
    expect(store.list()).toHaveLength(3);
  });

  test('does not guess a family group when a live provider product end date is ambiguous', async () => {
    new YouTubeFamilyGroupsStore(process.env.YOUTUBE_FAMILY_GROUPS_PATH!).write({ version: 1, familyGroups: [
      { id: 'group-1', label: '그룹 1', managerEmail: 'one@example.com', subscriptionEndDate: '2027-08-31', sellableSeats: 2, enabled: true, createdAt: now, updatedAt: now },
      { id: 'group-2', label: '그룹 2', managerEmail: 'two@example.com', subscriptionEndDate: '2027-08-31', sellableSeats: 2, enabled: true, createdAt: now, updatedAt: now },
    ] });
    const app = createYouTubeInvitationsApp({
      fetchProviderProductStatuses: async () => ({ authoritative: true, rows: [
        { productUsid: 'product-ambiguous-live', status: 'Delivered', endDateTime: '2027-08-31' },
      ] }),
    });
    const response = await app.request('/products/registrations/reconcile', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-audit-reason': 'operator ambiguous reconciliation' },
      body: '{}',
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true, releasedCount: 0, adoptedCount: 0, unmappedCount: 1, familyGroups: [],
    });
    expect(new YouTubeProductRegistrationsStore(process.env.YOUTUBE_PRODUCT_REGISTRATIONS_PATH!).list()).toEqual([]);
  });

  test('does not release capacity when provider history is unavailable or the request is not exact', async () => {
    const store = new YouTubeProductRegistrationsStore(process.env.YOUTUBE_PRODUCT_REGISTRATIONS_PATH!, { allowUnsafeIsolatedClaim: true });
    store.claim({ idempotencyKey: 'request-key-reconcile-guard', requestFingerprint: 'f'.repeat(64), familyGroupId: 'group-1', actor: 'admin', reasonCode: 'create', at: now });
    store.complete('request-key-reconcile-guard', 'registered', {
      actor: 'admin', reasonCode: 'registered', productUsid: 'product-reconcile-guard', at: '2026-08-11T00:00:01.000Z',
    });
    const app = createYouTubeInvitationsApp({
      fetchProviderProductStatuses: async () => ({ authoritative: false, rows: [] }),
    });
    const invalid = await app.request('/products/registrations/reconcile', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-audit-reason': 'operator reconciliation' },
      body: JSON.stringify({ productUsid: 'product-reconcile-guard' }),
    });
    expect(invalid.status).toBe(400);
    const unavailable = await app.request('/products/registrations/reconcile', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-audit-reason': 'operator reconciliation' }, body: '{}',
    });
    expect(unavailable.status).toBe(502);
    expect(await unavailable.json()).toMatchObject({ code: 'YOUTUBE_PROVIDER_STATUS_UNKNOWN' });
    expect(store.list()[0].status).toBe('registered');
  });
});
