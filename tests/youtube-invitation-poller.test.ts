import { describe, expect, test, vi } from 'vitest';
import {
  applyYouTubeInvitationTransition,
  ensureYouTubeInvitationJob,
  type YouTubeFamilyGroup,
  type YouTubeInvitationJob,
} from '../src/lib/youtube-invitations';
import type { YouTubeProductRegistrationRecord } from '../src/lib/youtube-product-registrations';
import {
  observeYouTubeInvitationPollSources,
  reconcileYouTubeInvitationProviderDeals,
  type YouTubeInvitationProviderDeal,
} from '../src/lib/youtube-invitation-poller';

const at = '2026-08-11T12:00:00.000Z';
const group: YouTubeFamilyGroup = {
  id: 'group-1', label: '운영 그룹', managerEmail: 'manager@example.com', subscriptionEndDate: null,
  sellableSeats: 5, enabled: true, createdAt: at, updatedAt: at,
};
const registration: YouTubeProductRegistrationRecord = {
  idempotencyKey: 'registration-1', requestFingerprint: 'a'.repeat(64), familyGroupId: group.id,
  status: 'registered', productUsid: 'product-1', actor: 'admin', createdAt: at, updatedAt: at,
  history: [
    { from: null, to: 'submitting', actor: 'admin', reasonCode: 'create', at },
    { from: 'submitting', to: 'registered', actor: 'admin', reasonCode: 'provider-succeeded', at },
  ],
};
const deal = (overrides: Partial<YouTubeInvitationProviderDeal> = {}): YouTubeInvitationProviderDeal => ({
  dealUsid: 'deal-1', productUsid: 'product-1', chatRoomUuid: 'chat-1', borrowerName: '구매자',
  endDateTime: '2027-08-11T12:00:00.000Z', dealStatus: 'Delivering', ...overrides,
});

function harness(initialJobs: YouTubeInvitationJob[] = [], env: NodeJS.ProcessEnv = {
  YOUTUBE_INVITE_SALES_ENABLED: 'true',
  YOUTUBE_INVITE_PROVIDER_AUTOMATION_ENABLED: 'true',
}) {
  let jobs = initialJobs;
  const write = vi.fn((data: { version: 1; jobs: YouTubeInvitationJob[] }) => { jobs = data.jobs; });
  const readGroups = vi.fn(() => ({ version: 1 as const, familyGroups: [group] }));
  const readJobs = vi.fn(() => ({ version: 1 as const, jobs }));
  const readRegistrations = vi.fn(() => [registration]);
  const withLock = vi.fn(<T>(operation: () => T) => operation());
  const log = vi.fn();
  const deps = {
    env,
    now: () => at,
    logger: log,
    withLock,
    familyGroupsStore: { read: readGroups },
    invitationJobsStore: { read: readJobs, write },
    productRegistrationsStore: { listForCapacityValidation: readRegistrations },
  };
  return { deps, write, readGroups, readJobs, readRegistrations, withLock, log, jobs: () => jobs };
}

function waitingJob(status: 'invite_sent' | 'delivery_completion_pending' | 'delivered_waiting_inspection' | 'active' = 'invite_sent') {
  let job = ensureYouTubeInvitationJob([], {
    dealUsid: 'deal-1', productUsid: 'product-1', chatRoomUuid: 'chat-1', familyGroupId: 'group-1',
    buyerName: '구매자', buyerGoogleEmail: 'buyer@example.com', endDateTime: null,
  }, at).job;
  for (const next of ['waiting_for_buyer_email', 'email_candidate_found', 'email_confirmed', 'invite_sent'] as const) {
    job = applyYouTubeInvitationTransition(job, next, { actor: 'test', reason: 'advance', at });
  }
  if (status === 'delivery_completion_pending') job = applyYouTubeInvitationTransition(job, status, { actor: 'test', reason: 'advance', at });
  if (status === 'delivered_waiting_inspection' || status === 'active') {
    job = applyYouTubeInvitationTransition(job, 'delivered_waiting_inspection', { actor: 'test', reason: 'advance', at });
  }
  if (status === 'active') {
    job = { ...job, status: 'active', history: [...job.history, { from: 'delivered_waiting_inspection', to: 'active', actor: 'provider', reason: 'poll', at }] };
  }
  return job;
}

describe('YouTube invitation poll reconciler', () => {
  test('flags off performs no store reads, lock, writes, or logs', () => {
    for (const env of [
      {},
      { YOUTUBE_INVITE_SALES_ENABLED: 'true' },
      { YOUTUBE_INVITE_PROVIDER_AUTOMATION_ENABLED: 'true' },
    ]) {
      const h = harness([], env as NodeJS.ProcessEnv);
      expect(reconcileYouTubeInvitationProviderDeals([deal()], h.deps)).toMatchObject({ enabled: false });
      expect(h.withLock).not.toHaveBeenCalled();
      expect(h.readGroups).not.toHaveBeenCalled();
      expect(h.readJobs).not.toHaveBeenCalled();
      expect(h.readRegistrations).not.toHaveBeenCalled();
      expect(h.write).not.toHaveBeenCalled();
      expect(h.log).not.toHaveBeenCalled();
    }
  });

  test('ingests an exact registered product and advances it to waiting_for_buyer_email atomically', () => {
    const h = harness();
    const result = reconcileYouTubeInvitationProviderDeals([deal()], h.deps);
    expect(result).toMatchObject({ enabled: true, observed: 1, created: 1, transitioned: 0, conflicts: 0, changed: true });
    expect(h.withLock).toHaveBeenCalledOnce();
    expect(h.write).toHaveBeenCalledOnce();
    expect(h.jobs()).toHaveLength(1);
    expect(h.jobs()[0]).toMatchObject({
      dealUsid: 'deal-1', productUsid: 'product-1', chatRoomUuid: 'chat-1', familyGroupId: 'group-1',
      buyerName: '구매자', endDateTime: '2027-08-11T12:00:00.000Z', status: 'waiting_for_buyer_email',
    });
    expect(h.jobs()[0].history).toHaveLength(1);
  });

  test('Delivered advances only invite sent or completion pending and Using advances only delivered waiting', () => {
    for (const start of ['invite_sent', 'delivery_completion_pending'] as const) {
      const h = harness([waitingJob(start)]);
      expect(reconcileYouTubeInvitationProviderDeals([deal({ dealStatus: 'Delivered' })], h.deps))
        .toMatchObject({ transitioned: 1, conflicts: 0, changed: true });
      expect(h.jobs()[0].status).toBe('delivered_waiting_inspection');
    }
    const using = harness([waitingJob('delivered_waiting_inspection')]);
    expect(reconcileYouTubeInvitationProviderDeals([deal({ dealStatus: 'Using' })], using.deps))
      .toMatchObject({ transitioned: 1, conflicts: 0, changed: true });
    expect(using.jobs()[0].status).toBe('active');
  });

  test('Using after a missed Delivered poll reports a conflict and stays pending', () => {
    const h = harness([waitingJob('delivery_completion_pending')]);
    expect(reconcileYouTubeInvitationProviderDeals([deal({ dealStatus: 'Using' })], h.deps))
      .toMatchObject({ transitioned: 0, conflicts: 1, changed: false });
    expect(h.jobs()[0].status).toBe('delivery_completion_pending');
    expect(h.write).not.toHaveBeenCalled();
  });

  test('reconciles an existing exact identity without requiring ingest-only profile fields', () => {
    const h = harness([waitingJob()]);
    expect(reconcileYouTubeInvitationProviderDeals([{
      dealUsid: 'deal-1', productUsid: 'product-1', dealStatus: 'Delivered',
    }], h.deps)).toMatchObject({ transitioned: 1, conflicts: 0, changed: true });
    expect(h.jobs()[0].status).toBe('delivered_waiting_inspection');
  });

  test('terminal statuses end through the domain, Delivering is a no-op, and unknown status fails closed', () => {
    const terminal = harness([waitingJob()]);
    expect(reconcileYouTubeInvitationProviderDeals([deal({ dealStatus: 'NormalFinished' })], terminal.deps))
      .toMatchObject({ transitioned: 1, conflicts: 0 });
    expect(terminal.jobs()[0].status).toBe('ended');

    const delivering = harness([waitingJob()]);
    expect(reconcileYouTubeInvitationProviderDeals([deal()], delivering.deps))
      .toMatchObject({ transitioned: 0, conflicts: 0, unchanged: 1, changed: false });
    expect(delivering.write).not.toHaveBeenCalled();

    const unknown = harness([waitingJob()]);
    expect(reconcileYouTubeInvitationProviderDeals([deal({ dealStatus: 'UsingSoon' })], unknown.deps))
      .toMatchObject({ transitioned: 0, conflicts: 1, changed: false });
    expect(unknown.write).not.toHaveBeenCalled();
  });

  test('duplicate active protection and repeated observations are idempotent', () => {
    const active = waitingJob('active');
    const duplicate = { ...active, id: 'youtube-invitation:deal-2', dealUsid: 'deal-2', productUsid: 'product-2' };
    const h = harness([active, duplicate]);
    expect(reconcileYouTubeInvitationProviderDeals([deal({ dealStatus: 'Using' })], h.deps))
      .toMatchObject({ conflicts: 1, changed: false });
    expect(h.write).not.toHaveBeenCalled();

    const first = harness();
    reconcileYouTubeInvitationProviderDeals([deal()], first.deps);
    first.write.mockClear();
    expect(reconcileYouTubeInvitationProviderDeals([deal()], first.deps))
      .toMatchObject({ created: 0, transitioned: 0, changed: false });
    expect(first.write).not.toHaveBeenCalled();
  });

  test('rejects malformed ingest fields and non-exact identities without writing', () => {
    for (const snapshot of [
      deal({ dealUsid: ' deal-1' }),
      deal({ dealUsid: 'DEAL-1' }),
      deal({ productUsid: 'PRODUCT-1' }),
      deal({ chatRoomUuid: undefined, uuid: undefined }),
      deal({ borrowerName: ' ' }),
      deal({ endDateTime: '2027-08-11T12:00:00Z' }),
    ]) {
      const h = harness();
      expect(reconcileYouTubeInvitationProviderDeals([snapshot], h.deps)).toMatchObject({ created: 0, conflicts: 1, changed: false });
      expect(h.write).not.toHaveBeenCalled();
    }
  });

  test('rejects a normalized deal identity collision without removing or changing any existing job', () => {
    const collision = { ...waitingJob(), dealUsid: 'DEAL-1' };
    const unrelated = {
      ...waitingJob(),
      id: 'youtube-invitation:unrelated',
      dealUsid: 'unrelated',
      productUsid: 'product-2',
    };
    const initial = [collision, unrelated];
    const h = harness(initial);

    expect(reconcileYouTubeInvitationProviderDeals([deal()], h.deps)).toMatchObject({
      created: 0,
      transitioned: 0,
      conflicts: 1,
      changed: false,
    });
    expect(h.jobs()).toEqual(initial);
    expect(h.write).not.toHaveBeenCalled();
  });

  test('reconciles only when both provider sources are authoritative', () => {
    const reconcile = vi.fn();
    expect(observeYouTubeInvitationPollSources([deal()], [deal({ dealStatus: 'Using' })], false, true, reconcile))
      .toEqual({ skipped: true });
    expect(observeYouTubeInvitationPollSources([deal()], [deal({ dealStatus: 'Using' })], true, false, reconcile))
      .toEqual({ skipped: true });
    expect(reconcile).not.toHaveBeenCalled();
    expect(observeYouTubeInvitationPollSources([deal()], [deal({ dealStatus: 'Using' })], true, true, reconcile))
      .toEqual({ skipped: false });
    expect(reconcile).toHaveBeenCalledWith([deal(), deal({ dealStatus: 'Using' })]);
  });

  test('logs counts only and never raw provider identifiers or payload fields', () => {
    const h = harness();
    reconcileYouTubeInvitationProviderDeals([deal()], h.deps);
    const logs = JSON.stringify(h.log.mock.calls);
    expect(logs).toContain('created=1');
    for (const secret of ['deal-1', 'product-1', 'chat-1', '구매자']) expect(logs).not.toContain(secret);
  });
});
