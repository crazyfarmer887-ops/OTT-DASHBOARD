import { afterEach, describe, expect, test } from 'vitest';
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  applyYouTubeInvitationTransition,
  calculateYouTubeFamilyGroupAvailableCapacity,
  ensureYouTubeInvitationJob,
  findDuplicateActiveYouTubeInvitation,
  reconcileYouTubeInvitationProviderStatus,
  resumeFailedYouTubeInvitation,
  YouTubeFamilyGroupsStore,
  YouTubeInvitationJobsStore,
  YouTubeInvitationsStoreCorruptionError,
  type YouTubeFamilyGroupsStoreData,
  type YouTubeInvitationJobInput,
  type YouTubeInvitationJobsStoreData,
} from '../src/lib/youtube-invitations';

const tempDirs: string[] = [];
const now = '2026-08-11T10:00:00.000Z';
const isolatedFamilyGroupsStore = (path: string) => new (YouTubeFamilyGroupsStore)(path, { capacityValidation: false });
const isolatedInvitationJobsStore = (path: string) => new (YouTubeInvitationJobsStore)(path, { capacityValidation: false });

function jobInput(overrides: Partial<YouTubeInvitationJobInput> = {}): YouTubeInvitationJobInput {
  return {
    dealUsid: 'deal-1',
    productUsid: 'product-1',
    chatRoomUuid: 'chat-1',
    familyGroupId: 'group-1',
    buyerName: '구매자',
    buyerGoogleEmail: null,
    endDateTime: '2026-09-11T10:00:00.000Z',
    ...overrides,
  };
}

function familyGroupsData(): YouTubeFamilyGroupsStoreData {
  return {
    version: 1,
    familyGroups: [{
      id: 'group-1',
      label: '기본 가족 그룹',
      managerEmail: 'manager@example.com',
      subscriptionEndDate: null,
      sellableSeats: 5,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    }],
  };
}

function jobsData(): YouTubeInvitationJobsStoreData {
  return { version: 1, jobs: [ensureYouTubeInvitationJob([], jobInput(), now).job] };
}

function activeJob(overrides: Partial<YouTubeInvitationJobInput> = {}) {
  const context = { actor: 'workflow', reason: 'valid transition', at: now };
  let job = ensureYouTubeInvitationJob([], jobInput({ buyerGoogleEmail: 'buyer@example.com', ...overrides }), now).job;
  for (const status of [
    'waiting_for_buyer_email',
    'email_candidate_found',
    'email_confirmed',
    'invite_sent',
    'delivered_waiting_inspection',
  ] as const) {
    job = applyYouTubeInvitationTransition(job, status, context);
  }
  return reconcileYouTubeInvitationProviderStatus(job, 'Using', context, [job]);
}

function expectJobsDataToBeRejected(data: YouTubeInvitationJobsStoreData): void {
  const root = mkdtempSync(join(tmpdir(), 'youtube-invitations-'));
  tempDirs.push(root);
  const directory = join(root, 'private-store');
  const filePath = join(directory, 'state.json');
  const store = isolatedInvitationJobsStore(filePath);

  expect(() => store.write(data)).toThrow(YouTubeInvitationsStoreCorruptionError);

  mkdirSync(directory, { mode: 0o700 });
  writeFileSync(filePath, JSON.stringify(data), { mode: 0o600 });
  expect(() => store.read()).toThrow(YouTubeInvitationsStoreCorruptionError);
}

function expectFamilyGroupsDataToBeRejected(data: YouTubeFamilyGroupsStoreData): void {
  const root = mkdtempSync(join(tmpdir(), 'youtube-invitations-'));
  tempDirs.push(root);
  const directory = join(root, 'private-store');
  const filePath = join(directory, 'groups.json');
  const store = isolatedFamilyGroupsStore(filePath);
  expect(() => store.write(data)).toThrow(YouTubeInvitationsStoreCorruptionError);
  mkdirSync(directory, { mode: 0o700 });
  writeFileSync(filePath, JSON.stringify(data), { mode: 0o600 });
  expect(() => store.read()).toThrow(YouTubeInvitationsStoreCorruptionError);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('YouTube invitations', () => {
  test('family and invitation store writes participate in the shared capacity lock', () => {
    const root = mkdtempSync(join(tmpdir(), 'youtube-capacity-lock-'));
    tempDirs.push(root);
    const previous = process.env.YOUTUBE_CAPACITY_LOCK_PATH;
    process.env.YOUTUBE_CAPACITY_LOCK_PATH = join(root, 'capacity.lock');
    const groups = isolatedFamilyGroupsStore(join(root, 'groups.json'));
    const jobs = isolatedInvitationJobsStore(join(root, 'jobs.json'));
    groups.write(familyGroupsData());
    jobs.write(jobsData());
    const lockFd = openSync(process.env.YOUTUBE_CAPACITY_LOCK_PATH, 'wx', 0o600);
    try {
      expect(() => groups.write(familyGroupsData())).toThrow(/busy|unavailable/i);
      expect(() => jobs.write(jobsData())).toThrow(/busy|unavailable/i);
      expect(groups.read()).toEqual(familyGroupsData());
      expect(jobs.read()).toEqual(jobsData());
    } finally {
      closeSync(lockFd);
      rmSync(process.env.YOUTUBE_CAPACITY_LOCK_PATH, { force: true });
      if (previous === undefined) delete process.env.YOUTUBE_CAPACITY_LOCK_PATH;
      else process.env.YOUTUBE_CAPACITY_LOCK_PATH = previous;
    }
  });
  test('creates at most one job for the same dealUsid', () => {
    const first = ensureYouTubeInvitationJob([], jobInput(), now);
    const second = ensureYouTubeInvitationJob(first.jobs, jobInput({ buyerName: '변경된 이름' }), '2026-08-11T10:01:00.000Z');

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.jobs).toHaveLength(1);
    expect(second.job).toBe(first.job);
    expect(first.job).toMatchObject({
      id: 'youtube-invitation:deal-1',
      dealUsid: 'deal-1',
      status: 'waiting_for_group_assignment',
      createdAt: now,
      updatedAt: now,
      history: [],
    });
  });

  test('normalizes dealUsid before id generation and idempotency checks', () => {
    const first = ensureYouTubeInvitationJob([], jobInput({ dealUsid: ' Deal-ABC ' }), now);
    const second = ensureYouTubeInvitationJob(first.jobs, jobInput({ dealUsid: 'deal-abc' }), now);

    expect(first.job.dealUsid).toBe('deal-abc');
    expect(first.job.id).toBe('youtube-invitation:deal-abc');
    expect(second.created).toBe(false);
    expect(second.job).toBe(first.job);
    expect(() => ensureYouTubeInvitationJob([], jobInput({ dealUsid: '   ' }), now))
      .toThrow(/dealUsid.*empty/i);
  });

  test('requires a nonblank product identity for new invitation jobs', () => {
    expect(() => ensureYouTubeInvitationJob([], jobInput({ productUsid: '   ' }), now))
      .toThrow(/productUsid.*empty/i);
  });

  test('normalizes waiting assignment to an empty group id and accepts a null end date', () => {
    const job = ensureYouTubeInvitationJob([], jobInput({ familyGroupId: '   ', endDateTime: null }), now).job;
    expect(job.familyGroupId).toBe('');
    expect(job.endDateTime).toBeNull();
    expect(() => ensureYouTubeInvitationJob([], { ...jobInput(), familyGroupId: null } as never, now))
      .toThrow(/familyGroupId/i);
  });

  test('rejects an illegal status transition', () => {
    const job = ensureYouTubeInvitationJob([], jobInput(), now).job;

    expect(() => applyYouTubeInvitationTransition(job, 'active', {
      actor: 'operator',
      reason: 'skip required checks',
      at: '2026-08-11T10:02:00.000Z',
    })).toThrow(/illegal YouTube invitation transition/i);
    expect(job.status).toBe('waiting_for_group_assignment');
    expect(job.history).toEqual([]);
  });

  test('records an email candidate without treating it as confirmation', () => {
    const created = ensureYouTubeInvitationJob([], jobInput(), now).job;
    const waitingForEmail = applyYouTubeInvitationTransition(created, 'waiting_for_buyer_email', {
      actor: 'system',
      reason: 'family group assigned',
      at: '2026-08-11T10:01:00.000Z',
    });
    const candidate = applyYouTubeInvitationTransition(waitingForEmail, 'email_candidate_found', {
      actor: 'email-detector',
      reason: 'candidate parsed from chat',
      at: '2026-08-11T10:02:00.000Z',
    });

    expect(candidate.status).toBe('email_candidate_found');
    expect(candidate.status).not.toBe('email_confirmed');
    expect(candidate.history.at(-1)).toEqual({
      from: 'waiting_for_buyer_email',
      to: 'email_candidate_found',
      actor: 'email-detector',
      reason: 'candidate parsed from chat',
      at: '2026-08-11T10:02:00.000Z',
    });
    expect(created.history).toEqual([]);
  });

  test('detects a duplicate active invitation by normalized group and buyer email', () => {
    const existing = {
      ...ensureYouTubeInvitationJob([], jobInput({ buyerGoogleEmail: 'Buyer@Example.com' }), now).job,
      status: 'active' as const,
    };

    expect(findDuplicateActiveYouTubeInvitation([existing], {
      familyGroupId: ' GROUP-1 ',
      buyerGoogleEmail: ' buyer@example.COM ',
      excludeJobId: 'different-job',
    })).toBe(existing);
    expect(findDuplicateActiveYouTubeInvitation([existing], {
      familyGroupId: 'group-2',
      buyerGoogleEmail: 'buyer@example.com',
    })).toBeNull();
  });

  test('dedupes jobs by dealUsid and recruiting products by productUsid when calculating capacity', () => {
    const familyGroup = {
      id: 'group-1',
      label: '기본 그룹',
      managerEmail: 'manager@example.com',
      subscriptionEndDate: null,
      sellableSeats: 5,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };
    const base = ensureYouTubeInvitationJob([], jobInput(), now).job;
    const jobs = [
      { ...base, dealUsid: 'deal-a', status: 'invite_sent' as const },
      { ...base, id: 'duplicate-row', dealUsid: ' DEAL-A ', status: 'active' as const },
      { ...base, id: 'ended-row', dealUsid: 'deal-ended', status: 'ended' as const },
      { ...base, id: 'other-group', dealUsid: 'deal-other', familyGroupId: 'group-2', status: 'active' as const },
    ];
    const recruitingProducts = [
      { familyGroupId: 'group-1', productUsid: 'product-a' },
      { familyGroupId: ' GROUP-1 ', productUsid: ' PRODUCT-A ' },
      { familyGroupId: 'group-2', productUsid: 'product-other' },
    ];

    expect(calculateYouTubeFamilyGroupAvailableCapacity({ familyGroup, invitationJobs: jobs, recruitingProducts }))
      .toBe(3);
  });

  test('counts the same normalized product only once across jobs and recruiting products', () => {
    const familyGroup = {
      ...familyGroupsData().familyGroups[0],
      sellableSeats: 2,
    };
    const job = {
      ...ensureYouTubeInvitationJob([], jobInput({ productUsid: ' Product-Same ' }), now).job,
      status: 'invite_sent' as const,
    };

    expect(calculateYouTubeFamilyGroupAvailableCapacity({
      familyGroup,
      invitationJobs: [job],
      recruitingProducts: [{ familyGroupId: ' GROUP-1 ', productUsid: 'product-same' }],
    })).toBe(1);

    expect(calculateYouTubeFamilyGroupAvailableCapacity({
      familyGroup: { ...familyGroup, sellableSeats: 3 },
      invitationJobs: [job],
      recruitingProducts: [{ familyGroupId: 'group-1', productUsid: 'product-distinct' }],
    })).toBe(1);
  });

  test('capacity never becomes negative', () => {
    const familyGroup = {
      id: 'group-1', label: '기본 그룹', managerEmail: 'manager@example.com',
      subscriptionEndDate: null, sellableSeats: 1, enabled: true, createdAt: now, updatedAt: now,
    };
    const base = ensureYouTubeInvitationJob([], jobInput(), now).job;
    const invitationJobs = [
      { ...base, dealUsid: 'deal-a', status: 'active' as const },
      { ...base, id: 'job-b', dealUsid: 'deal-b', status: 'invite_sent' as const },
    ];

    expect(calculateYouTubeFamilyGroupAvailableCapacity({
      familyGroup,
      invitationJobs,
      recruitingProducts: [{ familyGroupId: 'group-1', productUsid: 'product-a' }],
    })).toBe(0);
  });

  test('disabled family groups have no available capacity', () => {
    const familyGroup = { ...familyGroupsData().familyGroups[0], enabled: false };
    expect(calculateYouTubeFamilyGroupAvailableCapacity({
      familyGroup,
      invitationJobs: [],
      recruitingProducts: [],
    })).toBe(0);
  });

  test('keeps invite_sent non-active', () => {
    const confirmed = {
      ...ensureYouTubeInvitationJob([], jobInput({ buyerGoogleEmail: 'buyer@example.com' }), now).job,
      status: 'email_confirmed' as const,
    };
    const sent = applyYouTubeInvitationTransition(confirmed, 'invite_sent', {
      actor: 'provider-client',
      reason: 'provider accepted invitation request',
      at: '2026-08-11T10:03:00.000Z',
    });

    expect(sent.status).toBe('invite_sent');
    expect(sent.status).not.toBe('active');
  });

  test('maps provider Delivered to inspection instead of active', () => {
    const sent = {
      ...ensureYouTubeInvitationJob([], jobInput({ buyerGoogleEmail: 'buyer@example.com' }), now).job,
      status: 'invite_sent' as const,
    };

    const reconciled = reconcileYouTubeInvitationProviderStatus(sent, 'Delivered', {
      actor: 'provider-reconciler',
      reason: 'provider status poll',
      at: '2026-08-11T10:04:00.000Z',
    }, [sent]);

    expect(reconciled.status).toBe('delivered_waiting_inspection');
    expect(reconciled.status).not.toBe('active');
  });

  test('transitions to active only when provider reconciliation reports Using', () => {
    const delivered = {
      ...ensureYouTubeInvitationJob([], jobInput({ buyerGoogleEmail: 'buyer@example.com' }), now).job,
      status: 'delivered_waiting_inspection' as const,
    };

    const reconciled = reconcileYouTubeInvitationProviderStatus(delivered, 'Using', {
      actor: 'provider-reconciler',
      reason: 'provider membership is in use',
      at: '2026-08-11T10:05:00.000Z',
    }, [delivered]);

    expect(reconciled.status).toBe('active');
    expect(reconciled.history.at(-1)?.actor).toBe('provider-reconciler');
  });

  test('rejects duplicate activation by normalized group and email while allowing self reconciliation', () => {
    const context = {
      actor: 'provider-reconciler',
      reason: 'provider membership is in use',
      at: '2026-08-11T10:05:00.000Z',
    };
    const first = {
      ...ensureYouTubeInvitationJob([], jobInput({
        dealUsid: 'deal-1',
        familyGroupId: ' Group-1 ',
        buyerGoogleEmail: ' Buyer@Example.com ',
      }), now).job,
      status: 'delivered_waiting_inspection' as const,
    };
    const second = {
      ...ensureYouTubeInvitationJob([], jobInput({
        dealUsid: 'deal-2',
        familyGroupId: 'group-1',
        buyerGoogleEmail: 'buyer@example.COM',
      }), now).job,
      status: 'delivered_waiting_inspection' as const,
    };

    const active = reconcileYouTubeInvitationProviderStatus(first, 'Using', context, [first, second]);
    expect(reconcileYouTubeInvitationProviderStatus(active, 'Using', context, [active, second])).toBe(active);

    let error: unknown;
    try {
      reconcileYouTubeInvitationProviderStatus(second, 'Using', context, [active, second]);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/duplicate active YouTube invitation/i);
    expect((error as Error).message).not.toContain('group-1');
    expect((error as Error).message).not.toContain('buyer@example.com');
  });

  test('checks duplicate active rows before returning an active Using reconciliation idempotently', () => {
    const context = { actor: 'provider-reconciler', reason: 'poll', at: now };
    const active = { ...ensureYouTubeInvitationJob([], jobInput({ buyerGoogleEmail: 'buyer@example.com' }), now).job, status: 'active' as const };
    const duplicate = { ...active, id: 'other-job', dealUsid: 'other-deal' };
    expect(() => reconcileYouTubeInvitationProviderStatus(active, 'Using', context, [active, duplicate]))
      .toThrow(/duplicate active YouTube invitation/i);
    expect(reconcileYouTubeInvitationProviderStatus(active, 'Using', context, [active])).toBe(active);
  });

  test.each([
    ['blank family group', { familyGroupId: '   ', buyerGoogleEmail: 'buyer@example.com' }],
    ['missing buyer email', { familyGroupId: 'group-1', buyerGoogleEmail: null }],
    ['malformed buyer email', { familyGroupId: 'group-1', buyerGoogleEmail: 'not-an-email' }],
    ['leading-dot buyer email', { familyGroupId: 'group-1', buyerGoogleEmail: '.buyer@example.com' }],
    ['consecutive-dot buyer email', { familyGroupId: 'group-1', buyerGoogleEmail: 'buyer..x@example.com' }],
    ['trailing-dot buyer local part', { familyGroupId: 'group-1', buyerGoogleEmail: 'buyer.@example.com' }],
  ])('rejects Using activation with %s before idempotency or duplicate checks', (_label, identifiers) => {
    const context = { actor: 'provider-reconciler', reason: 'poll', at: now };
    const malformed = {
      ...ensureYouTubeInvitationJob([], jobInput(), now).job,
      ...identifiers,
      status: 'active' as const,
    };
    const duplicate = {
      ...ensureYouTubeInvitationJob([], jobInput({ dealUsid: 'deal-2', buyerGoogleEmail: 'buyer@example.com' }), now).job,
      id: 'youtube-invitation:deal-2',
      status: 'active' as const,
    };

    let error: unknown;
    try {
      reconcileYouTubeInvitationProviderStatus(malformed, 'Using', context, [malformed, duplicate]);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('YouTube invitation activation identifiers are invalid');
    expect((error as Error).message).not.toContain(String(identifiers.familyGroupId));
    expect((error as Error).message).not.toContain(String(identifiers.buyerGoogleEmail));
  });

  test('rejects a direct transition to active even from inspection state', () => {
    const delivered = {
      ...ensureYouTubeInvitationJob([], jobInput({ buyerGoogleEmail: 'buyer@example.com' }), now).job,
      status: 'delivered_waiting_inspection' as const,
    };

    expect(() => applyYouTubeInvitationTransition(delivered, 'active', {
      actor: 'operator',
      reason: 'manual activation',
      at: '2026-08-11T10:05:00.000Z',
    })).toThrow(/illegal YouTube invitation transition/i);
  });

  test.each([
    ['family groups', 'groups.json', () => familyGroupsData(), (path: string) => isolatedFamilyGroupsStore(path)],
    ['invitation jobs', 'jobs.json', () => jobsData(), (path: string) => isolatedInvitationJobsStore(path)],
  ])('atomically roundtrips the separate %s store with private modes', (_label, filename, makeData, makeStore) => {
    const root = mkdtempSync(join(tmpdir(), 'youtube-invitations-'));
    tempDirs.push(root);
    const directory = join(root, 'private-store');
    const filePath = join(directory, filename);
    const store = makeStore(filePath);
    const data = makeData();
    store.write(data as never);
    expect(store.read()).toEqual(data);
    expect(statSync(directory).mode & 0o777).toBe(0o700);
    expect(statSync(filePath).mode & 0o777).toBe(0o600);
    expect(readdirSync(directory)).toEqual([filename]);
  });

  test('rejects normalized duplicate deal identities on invitation job read and write', () => {
    const data = jobsData();
    data.jobs.push({ ...data.jobs[0], dealUsid: ' DEAL-1 ' });
    expectJobsDataToBeRejected(data);
  });

  test('rejects active stored jobs without normalized activation identifiers', () => {
    for (const identifiers of [
      { familyGroupId: '   ', buyerGoogleEmail: 'buyer@example.com' },
      { familyGroupId: 'group-1', buyerGoogleEmail: null },
      { familyGroupId: 'group-1', buyerGoogleEmail: 'not-an-email' },
    ]) {
      const job = { ...activeJob(), ...identifiers };
      expectJobsDataToBeRejected({ version: 1, jobs: [job] });
    }
  });

  test('rejects duplicate normalized active group and buyer composites with valid histories', () => {
    const first = activeJob({ dealUsid: 'deal-active-1', productUsid: 'product-active-1' });
    const second = activeJob({
      dealUsid: 'deal-active-2',
      productUsid: 'product-active-2',
      familyGroupId: ' GROUP-1 ',
      buyerGoogleEmail: ' Buyer@Example.COM ',
    });
    expectJobsDataToBeRejected({ version: 1, jobs: [first, second] });
  });

  test('rejects blank invitation job ids on read and write', () => {
    const data = jobsData();
    data.jobs[0].id = '   ';
    expectJobsDataToBeRejected(data);
  });

  test('rejects normalized duplicate invitation job ids on read and write', () => {
    const data = jobsData();
    data.jobs.push({ ...data.jobs[0], dealUsid: ' DEAL-1 ' });
    expectJobsDataToBeRejected(data);
  });

  test('rejects invitation job ids that do not match the normalized deal identity on read and write', () => {
    const data = jobsData();
    data.jobs[0].dealUsid = ' Deal-1 ';
    data.jobs[0].id = 'youtube-invitation:other-deal';
    expectJobsDataToBeRejected(data);
  });

  test.each([
    ['family groups', 'groups.json', () => familyGroupsData(), (path: string) => isolatedFamilyGroupsStore(path)],
    ['invitation jobs', 'jobs.json', () => jobsData(), (path: string) => isolatedInvitationJobsStore(path)],
  ])('repairs loose directory and file permissions before reading the %s store', (_label, filename, makeData, makeStore) => {
    const root = mkdtempSync(join(tmpdir(), 'youtube-invitations-'));
    tempDirs.push(root);
    const directory = join(root, 'private-store');
    const filePath = join(directory, filename);
    const store = makeStore(filePath);
    const data = makeData();
    store.write(data as never);
    chmodSync(filePath, 0o644);
    chmodSync(directory, 0o755);

    expect(store.read()).toEqual(data);
    expect(statSync(directory).mode & 0o777).toBe(0o700);
    expect(statSync(filePath).mode & 0o777).toBe(0o600);
  });

  test('anchors every store read operation to the verified directory descriptor', () => {
    const source = readFileSync(join(process.cwd(), 'src/lib/youtube-invitations.ts'), 'utf8');
    const readStart = source.indexOf('function readPrivateRegularFile');
    const readEnd = source.indexOf('function readAtomicStore');
    const readImplementation = source.slice(readStart, readEnd);
    const directoryOpenStart = source.indexOf('function openVerifiedPrivateDirectory');
    const directoryOpenEnd = source.indexOf('function writeAtomicStore');
    const directoryOpenImplementation = source.slice(directoryOpenStart, directoryOpenEnd);

    expect(readImplementation).toContain('openVerifiedPrivateDirectory(directory, false)');
    expect(directoryOpenImplementation).toContain('openedDirectoryStat.dev !== directoryStat.dev');
    expect(directoryOpenImplementation).toContain('openedDirectoryStat.ino !== directoryStat.ino');
    expect(readImplementation).toContain('`/proc/self/fd/${directoryDescriptor}/${targetName}`');
    expect(readImplementation).toContain('lstatSync(targetPath)');
    expect(readImplementation).toContain('openSync(targetPath');
    expect(readImplementation).not.toContain('lstatSync(filePath)');
    expect(readImplementation).not.toContain('openSync(filePath');
    expect(directoryOpenImplementation).toContain("typeof constants.O_NOFOLLOW !== 'number'");
  });

  test('rejects a symlinked store file without reading its target', () => {
    if (process.platform === 'win32') return;
    const root = mkdtempSync(join(tmpdir(), 'youtube-invitations-'));
    tempDirs.push(root);
    const directory = join(root, 'private-store');
    const targetPath = join(root, 'target.json');
    const filePath = join(directory, 'jobs.json');
    mkdirSync(directory, { mode: 0o700 });
    writeFileSync(targetPath, JSON.stringify(jobsData()), { mode: 0o600 });
    symlinkSync(targetPath, filePath);

    expect(() => isolatedInvitationJobsStore(filePath).read())
      .toThrow(YouTubeInvitationsStoreCorruptionError);
    expect(readFileSync(targetPath, 'utf8')).toBe(JSON.stringify(jobsData()));
  });

  test('rejects a symlinked read ancestor without reading or changing its target', () => {
    if (process.platform === 'win32') return;
    const root = mkdtempSync(join(tmpdir(), 'youtube-invitations-'));
    tempDirs.push(root);
    const targetDirectory = join(root, 'attacker-target');
    const targetPrivateDirectory = join(targetDirectory, 'private');
    const targetPath = join(targetPrivateDirectory, 'jobs.json');
    const linkedAncestor = join(root, 'linked-ancestor');
    mkdirSync(targetPrivateDirectory, { recursive: true, mode: 0o755 });
    const contents = JSON.stringify(jobsData());
    writeFileSync(targetPath, contents, { mode: 0o644 });
    symlinkSync(targetDirectory, linkedAncestor, 'dir');

    expect(() => isolatedInvitationJobsStore(join(linkedAncestor, 'private', 'jobs.json')).read())
      .toThrow(YouTubeInvitationsStoreCorruptionError);
    expect(readFileSync(targetPath, 'utf8')).toBe(contents);
    expect(statSync(targetDirectory).mode & 0o777).toBe(0o755);
    expect(statSync(targetPrivateDirectory).mode & 0o777).toBe(0o755);
    expect(statSync(targetPath).mode & 0o777).toBe(0o644);
  });

  test('rejects a symlinked store directory without writing to or chmodding its target', () => {
    if (process.platform === 'win32') return;
    const root = mkdtempSync(join(tmpdir(), 'youtube-invitations-'));
    tempDirs.push(root);
    const targetDirectory = join(root, 'attacker-target');
    const storeDirectory = join(root, 'private-store');
    const filePath = join(storeDirectory, 'jobs.json');
    mkdirSync(targetDirectory, { mode: 0o755 });
    symlinkSync(targetDirectory, storeDirectory, 'dir');

    expect(() => isolatedInvitationJobsStore(filePath).write(jobsData()))
      .toThrow(YouTubeInvitationsStoreCorruptionError);
    expect(existsSync(join(targetDirectory, 'jobs.json'))).toBe(false);
    expect(statSync(targetDirectory).mode & 0o777).toBe(0o755);
    expect(readdirSync(targetDirectory)).toEqual([]);
  });

  test('rejects a symlinked ancestor before creating descendants and leaves its target untouched', () => {
    if (process.platform === 'win32') return;
    const root = mkdtempSync(join(tmpdir(), 'youtube-invitations-'));
    tempDirs.push(root);
    const targetDirectory = join(root, 'attacker-target');
    const linkedAncestor = join(root, 'linked-ancestor');
    mkdirSync(targetDirectory, { mode: 0o755 });
    symlinkSync(targetDirectory, linkedAncestor, 'dir');

    expect(() => isolatedInvitationJobsStore(join(linkedAncestor, 'private', 'jobs.json')).write(jobsData()))
      .toThrow(YouTubeInvitationsStoreCorruptionError);
    expect(readdirSync(targetDirectory)).toEqual([]);
    expect(statSync(targetDirectory).mode & 0o777).toBe(0o755);
  });

  test('rejects duplicate group ids and invalid exact family group fields', () => {
    const duplicate = familyGroupsData();
    duplicate.familyGroups.push({ ...duplicate.familyGroups[0], id: ' GROUP-1 ' });
    expectFamilyGroupsDataToBeRejected(duplicate);

    for (const invalidGroup of [
      { ...familyGroupsData().familyGroups[0], label: '   ' },
      { ...familyGroupsData().familyGroups[0], managerEmail: '' },
      { ...familyGroupsData().familyGroups[0], sellableSeats: 0 },
      { ...familyGroupsData().familyGroups[0], sellableSeats: 1.5 },
      { ...familyGroupsData().familyGroups[0], subscriptionEndDate: 123 as never },
      { ...familyGroupsData().familyGroups[0], managerEmail: 'not-an-email' },
      { ...familyGroupsData().familyGroups[0], subscriptionEndDate: '2026-02-30' },
      { ...familyGroupsData().familyGroups[0], sellableSeats: 21 },
      { ...familyGroupsData().familyGroups[0], createdAt: 'yesterday' },
      { ...familyGroupsData().familyGroups[0], updatedAt: '2026-08-11' },
    ]) {
      expectFamilyGroupsDataToBeRejected({ version: 1, familyGroups: [invalidGroup] });
    }
  });

  test.each([
    ['groups malformed JSON', '{not-json', (path: string) => isolatedFamilyGroupsStore(path)],
    ['groups schema-invalid JSON', JSON.stringify({ version: 1, familyGroups: [{}] }), (path: string) => isolatedFamilyGroupsStore(path)],
    ['jobs malformed JSON', '{not-json', (path: string) => isolatedInvitationJobsStore(path)],
    ['jobs schema-invalid JSON', JSON.stringify({ version: 1, jobs: [{}] }), (path: string) => isolatedInvitationJobsStore(path)],
    ['combined data as groups', JSON.stringify({ ...familyGroupsData(), jobs: [] }), (path: string) => isolatedFamilyGroupsStore(path)],
    ['combined data as jobs', JSON.stringify({ ...jobsData(), familyGroups: [] }), (path: string) => isolatedInvitationJobsStore(path)],
  ])('fails closed for %s without changing the source file', (_label, contents, makeStore) => {
    const root = mkdtempSync(join(tmpdir(), 'youtube-invitations-'));
    tempDirs.push(root);
    const directory = join(root, 'private-store');
    const filePath = join(directory, 'state.json');
    mkdirSync(directory, { mode: 0o700 });
    writeFileSync(filePath, contents, { mode: 0o600 });
    const store = makeStore(filePath);
    expect(() => store.read()).toThrow(YouTubeInvitationsStoreCorruptionError);
    expect(readFileSync(filePath, 'utf8')).toBe(contents);
  });

  test('securely initializes only a missing invitation jobs store and preserves an existing corrupt file', () => {
    const root = mkdtempSync(join(tmpdir(), 'youtube-invitations-init-'));
    tempDirs.push(root);
    const filePath = join(root, 'private-store', 'jobs.json');
    const store = isolatedInvitationJobsStore(filePath);

    expect(store.readOrInitializeEmpty()).toEqual({ version: 1, jobs: [] });
    expect(store.read()).toEqual({ version: 1, jobs: [] });
    expect(statSync(filePath).mode & 0o777).toBe(0o600);

    const corrupt = '{not-json';
    writeFileSync(filePath, corrupt, 'utf8');
    expect(() => store.readOrInitializeEmpty()).toThrow(YouTubeInvitationsStoreCorruptionError);
    expect(readFileSync(filePath, 'utf8')).toBe(corrupt);
  });

  test('accepts an optional initial null history marker only for the initial status', () => {
    const data = jobsData();
    data.jobs[0].history = [
      { from: null, to: 'waiting_for_group_assignment', actor: 'system', reason: 'created', at: now },
    ];
    const root = mkdtempSync(join(tmpdir(), 'youtube-invitations-'));
    tempDirs.push(root);
    const store = isolatedInvitationJobsStore(join(root, 'private-store', 'jobs.json'));
    store.write(data);
    expect(store.read()).toEqual(data);
  });

  test('rejects history entries with unknown keys on read and write', () => {
    const data = jobsData();
    data.jobs[0].history = [{
      from: null,
      to: 'waiting_for_group_assignment',
      actor: 'system',
      reason: 'created',
      at: now,
      unexpected: true,
    } as never];
    expectJobsDataToBeRejected(data);
  });

  test('rejects blank stable invitation and audit fields on read and write', () => {
    for (const field of ['productUsid', 'chatRoomUuid', 'buyerName', 'createdAt', 'updatedAt'] as const) {
      const data = jobsData();
      data.jobs[0][field] = '   ';
      expectJobsDataToBeRejected(data);
    }

    for (const field of ['actor', 'reason', 'at'] as const) {
      const data = jobsData();
      data.jobs[0].history = [{
        from: null,
        to: 'waiting_for_group_assignment',
        actor: 'system',
        reason: 'created',
        at: now,
        [field]: '   ',
      }];
      expectJobsDataToBeRejected(data);
    }
  });

  test('rejects malformed invitation ISO timestamps on read and write', () => {
    for (const field of ['createdAt', 'updatedAt'] as const) {
      for (const malformed of ['2026-08-11', '2026-08-11T10:00:00Z', 'not-a-date']) {
        const data = jobsData();
        data.jobs[0][field] = malformed;
        expectJobsDataToBeRejected(data);
      }
    }

    for (const malformed of ['2026-09-11', '2026-09-11T10:00:00Z', 'not-a-date']) {
      const data = jobsData();
      data.jobs[0].endDateTime = malformed;
      expectJobsDataToBeRejected(data);
    }

    for (const malformed of ['2026-08-11', '2026-08-11T10:00:00Z', 'not-a-date']) {
      const data = jobsData();
      data.jobs[0].history = [
        { from: null, to: 'waiting_for_group_assignment', actor: 'system', reason: 'created', at: malformed },
      ];
      expectJobsDataToBeRejected(data);
    }
  });

  test('accepts null endDateTime and canonical ISO job timestamps', () => {
    const data = jobsData();
    data.jobs[0].endDateTime = null;
    data.jobs[0].history = [
      { from: null, to: 'waiting_for_group_assignment', actor: 'system', reason: 'created', at: now },
    ];
    const root = mkdtempSync(join(tmpdir(), 'youtube-invitations-'));
    tempDirs.push(root);
    const store = isolatedInvitationJobsStore(join(root, 'private-store', 'jobs.json'));
    store.write(data);
    expect(store.read()).toEqual(data);
  });

  test('rejects malformed buyer emails and blank nullable dates on read and write', () => {
    for (const buyerGoogleEmail of [
      '',
      'not-an-email',
      'buyer@localhost',
      'buyer @example.com',
      'Buyer@example.com',
      ' buyer@example.com ',
      '.buyer@example.com',
      'buyer..x@example.com',
      'buyer.@example.com',
    ]) {
      const data = jobsData();
      data.jobs[0].buyerGoogleEmail = buyerGoogleEmail;
      expectJobsDataToBeRejected(data);
    }
    const data = jobsData();
    data.jobs[0].endDateTime = '   ';
    expectJobsDataToBeRejected(data);
  });

  test('roundtrips a canonical buyer email on store read and write', () => {
    const data = jobsData();
    data.jobs[0].buyerGoogleEmail = 'buyer@example.com';
    const root = mkdtempSync(join(tmpdir(), 'youtube-invitations-'));
    tempDirs.push(root);
    const store = isolatedInvitationJobsStore(join(root, 'private-store', 'jobs.json'));
    store.write(data);
    expect(store.read()).toEqual(data);
  });

  test('rejects blank family group audit dates and blank nullable subscription dates', () => {
    for (const field of ['createdAt', 'updatedAt', 'subscriptionEndDate'] as const) {
      const data = familyGroupsData();
      data.familyGroups[0][field] = '   ';
      expectFamilyGroupsDataToBeRejected(data);
    }
  });

  test.each([
    '.manager@example.com',
    'manager..x@example.com',
    'manager.@example.com',
  ])('rejects non-dot-atom manager email %s on read and write', (managerEmail) => {
    const data = familyGroupsData();
    data.familyGroups[0].managerEmail = managerEmail;
    expectFamilyGroupsDataToBeRejected(data);
  });

  test('accepts apostrophes and basic custom domains in manager emails', () => {
    const data = familyGroupsData();
    data.familyGroups[0].managerEmail = "manager.o'connor@custom-domain.example";
    const root = mkdtempSync(join(tmpdir(), 'youtube-invitations-'));
    tempDirs.push(root);
    const store = isolatedFamilyGroupsStore(join(root, 'private-store', 'groups.json'));
    store.write(data);
    expect(store.read()).toEqual(data);
  });

  test('rejects null history sources outside the optional initial marker', () => {
    const data = jobsData();
    data.jobs[0].status = 'waiting_for_buyer_email';
    data.jobs[0].history = [
      { from: 'waiting_for_group_assignment', to: 'waiting_for_buyer_email', actor: 'system', reason: 'assigned', at: now },
      { from: null, to: 'waiting_for_buyer_email', actor: 'system', reason: 'invalid marker', at: now },
    ];
    expectJobsDataToBeRejected(data);
  });

  test('rejects a disconnected history chain on read and write', () => {
    const data = jobsData();
    data.jobs[0].status = 'email_confirmed';
    data.jobs[0].history = [
      { from: 'waiting_for_group_assignment', to: 'waiting_for_buyer_email', actor: 'system', reason: 'assigned', at: now },
      { from: 'email_candidate_found', to: 'email_confirmed', actor: 'system', reason: 'disconnected', at: now },
    ];
    expectJobsDataToBeRejected(data);
  });

  test('rejects a semantically illegal history edge on read and write', () => {
    const data = jobsData();
    data.jobs[0].status = 'active';
    data.jobs[0].history = [
      { from: 'waiting_for_group_assignment', to: 'active', actor: 'forger', reason: 'skip checks', at: now },
    ];
    expectJobsDataToBeRejected(data);
  });

  test('rejects history whose final status does not match the job on read and write', () => {
    const data = jobsData();
    data.jobs[0].status = 'email_candidate_found';
    data.jobs[0].history = [
      { from: 'waiting_for_group_assignment', to: 'waiting_for_buyer_email', actor: 'system', reason: 'assigned', at: now },
    ];
    expectJobsDataToBeRejected(data);
  });

  test('rejects a non-initial job with empty history on read and write', () => {
    const data = jobsData();
    data.jobs[0].status = 'active';
    expectJobsDataToBeRejected(data);
  });

  test('persists provider activation, terminal, and failed-recovery history edges', () => {
    const context = { actor: 'workflow', reason: 'valid transition', at: now };
    let terminalJob = ensureYouTubeInvitationJob([], jobInput({
      familyGroupId: 'group-1',
      buyerGoogleEmail: 'buyer@example.com',
    }), now).job;
    for (const status of ['waiting_for_buyer_email', 'email_candidate_found', 'email_confirmed', 'invite_sent', 'delivered_waiting_inspection'] as const) {
      terminalJob = applyYouTubeInvitationTransition(terminalJob, status, context);
    }
    terminalJob = reconcileYouTubeInvitationProviderStatus(terminalJob, 'Using', context, [terminalJob]);
    terminalJob = reconcileYouTubeInvitationProviderStatus(terminalJob, 'NormalFinished', context, [terminalJob]);
    let recoveredJob = ensureYouTubeInvitationJob([], jobInput({ dealUsid: 'deal-recovered' }), now).job;
    recoveredJob = applyYouTubeInvitationTransition(recoveredJob, 'failed', context);
    recoveredJob = resumeFailedYouTubeInvitation(recoveredJob, context);
    let failedThenEnded = ensureYouTubeInvitationJob([], jobInput({ dealUsid: 'deal-failed-ended' }), now).job;
    failedThenEnded = applyYouTubeInvitationTransition(failedThenEnded, 'failed', context);
    failedThenEnded = reconcileYouTubeInvitationProviderStatus(failedThenEnded, 'Cancelled', context, [failedThenEnded]);
    const root = mkdtempSync(join(tmpdir(), 'youtube-invitations-'));
    tempDirs.push(root);
    const store = isolatedInvitationJobsStore(join(root, 'private-store', 'jobs.json'));
    const data = { version: 1 as const, jobs: [terminalJob, recoveredJob, failedThenEnded] };
    store.write(data);
    expect(store.read()).toEqual(data);
  });

  test('supports the complete normal workflow without allowing manual activation', () => {
    let job = ensureYouTubeInvitationJob([], jobInput(), now).job;
    const steps = [
      'waiting_for_buyer_email',
      'email_candidate_found',
      'email_confirmed',
      'invite_sent',
      'delivery_completion_pending',
      'delivered_waiting_inspection',
    ] as const;

    for (const [index, status] of steps.entries()) {
      job = applyYouTubeInvitationTransition(job, status, {
        actor: 'workflow',
        reason: `step-${index}`,
        at: `2026-08-11T10:0${index + 1}:00.000Z`,
      });
    }

    expect(job.status).toBe('delivered_waiting_inspection');
    expect(job.history.map(({ to }) => to)).toEqual(steps);
    expect(() => applyYouTubeInvitationTransition(job, 'active', {
      actor: 'operator',
      reason: 'manual activation',
      at: '2026-08-11T10:07:00.000Z',
    })).toThrow(/illegal YouTube invitation transition/i);
  });

  test('recovers a failure to the exact last safe status', () => {
    let candidate = ensureYouTubeInvitationJob([], jobInput(), now).job;
    candidate = applyYouTubeInvitationTransition(candidate, 'waiting_for_buyer_email', {
      actor: 'workflow', reason: 'assigned', at: '2026-08-11T10:01:00.000Z',
    });
    candidate = applyYouTubeInvitationTransition(candidate, 'email_candidate_found', {
      actor: 'workflow', reason: 'candidate found', at: '2026-08-11T10:02:00.000Z',
    });
    const failed = applyYouTubeInvitationTransition(candidate, 'failed', {
      actor: 'workflow',
      reason: 'candidate rejected',
      at: '2026-08-11T10:03:00.000Z',
    });
    const restarted = resumeFailedYouTubeInvitation(failed, {
      actor: 'operator',
      reason: 'retry from last safe status',
      at: '2026-08-11T10:04:00.000Z',
    });

    expect(restarted.status).toBe('email_candidate_found');
    expect(restarted.history.at(-1)).toMatchObject({ from: 'failed', to: 'email_candidate_found' });
    expect(() => applyYouTubeInvitationTransition(failed, 'waiting_for_group_assignment', {
      actor: 'operator', reason: 'arbitrary target', at: now,
    })).toThrow(/illegal YouTube invitation transition/i);
  });

  test('rejects failed recovery without a well-formed failed history edge', () => {
    const base = ensureYouTubeInvitationJob([], jobInput(), now).job;
    expect(() => resumeFailedYouTubeInvitation({ ...base, status: 'failed' }, {
      actor: 'operator', reason: 'retry', at: now,
    })).toThrow(/failed history/i);
    expect(() => resumeFailedYouTubeInvitation(base, {
      actor: 'operator', reason: 'retry', at: now,
    })).toThrow(/not failed/i);
  });

  test('accepts provider Delivered only from sent or completion-pending and is idempotent', () => {
    const context = { actor: 'provider-reconciler', reason: 'provider poll', at: '2026-08-11T10:04:00.000Z' };
    for (const status of ['invite_sent', 'delivery_completion_pending'] as const) {
      const job = { ...ensureYouTubeInvitationJob([], jobInput(), now).job, status };
      const delivered = reconcileYouTubeInvitationProviderStatus(job, 'Delivered', context, [job]);
      const repeated = reconcileYouTubeInvitationProviderStatus(delivered, 'Delivered', context, [delivered]);
      expect(delivered.status).toBe('delivered_waiting_inspection');
      expect(repeated).toBe(delivered);
      expect(repeated.history).toHaveLength(delivered.history.length);
    }

    const confirmed = { ...ensureYouTubeInvitationJob([], jobInput(), now).job, status: 'email_confirmed' as const };
    expect(() => reconcileYouTubeInvitationProviderStatus(confirmed, 'Delivered', context, [confirmed]))
      .toThrow(/illegal YouTube provider transition/i);
  });

  test('provider cancellation ends every live state and repeated cancellation adds no history', () => {
    const context = { actor: 'provider-reconciler', reason: 'provider cancellation', at: '2026-08-11T10:06:00.000Z' };
    const liveStatuses = [
      'waiting_for_group_assignment', 'waiting_for_buyer_email', 'email_candidate_found',
      'email_confirmed', 'invite_sent', 'delivery_completion_pending',
      'delivered_waiting_inspection', 'active', 'failed',
    ] as const;

    for (const status of liveStatuses) {
      const job = { ...ensureYouTubeInvitationJob([], jobInput(), now).job, status };
      const ended = reconcileYouTubeInvitationProviderStatus(job, 'Cancelled', context, [job]);
      const repeated = reconcileYouTubeInvitationProviderStatus(ended, 'Cancelled', context, [ended]);
      expect(ended.status).toBe('ended');
      expect(repeated).toBe(ended);
      expect(repeated.history).toHaveLength(ended.history.length);
    }
  });

  test.each([
    'Cancelled',
    'CancelByDepositRejection',
    'CancelByInspectionRejection',
    'CancelByNoShow',
    'CancelByLendingRejection',
    'FinishedByBorrowerRequest',
    'FinishedByLenderRequest',
    'NormalFinished',
  ])('ends safely for exact provider terminal status %s', (providerStatus) => {
    const active = {
      ...ensureYouTubeInvitationJob([], jobInput({ buyerGoogleEmail: 'buyer@example.com' }), now).job,
      status: 'active' as const,
    };

    const reconciled = reconcileYouTubeInvitationProviderStatus(active, providerStatus, {
      actor: 'provider-reconciler',
      reason: 'provider cancelled the deal',
      at: '2026-08-11T10:06:00.000Z',
    }, [active]);

    expect(reconciled.status).toBe('ended');
    expect(reconciled.history.at(-1)).toMatchObject({ from: 'active', to: 'ended' });
  });

  test.each(['CancelAnything', 'CancellationUnknown'])('rejects unknown provider terminal-like status %s', (providerStatus) => {
    const active = {
      ...ensureYouTubeInvitationJob([], jobInput({ buyerGoogleEmail: 'buyer@example.com' }), now).job,
      status: 'active' as const,
    };

    expect(() => reconcileYouTubeInvitationProviderStatus(active, providerStatus, {
      actor: 'provider-reconciler',
      reason: 'provider status poll',
      at: '2026-08-11T10:06:00.000Z',
    }, [active])).toThrow(/unsupported YouTube provider status/i);
  });
});
