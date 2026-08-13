import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  ensureYouTubeInvitationJob,
  YouTubeCapacityInvariantError,
  YouTubeFamilyGroupsStore,
  YouTubeInvitationJobsStore,
  type YouTubeFamilyGroupsStoreData,
} from '../src/lib/youtube-invitations';
import { YouTubeProductRegistrationsStore } from '../src/lib/youtube-product-registrations';

const now = '2026-08-11T00:00:00.000Z';
let root = '';
const savedEnv = { ...process.env };

function groups(seats = 1): YouTubeFamilyGroupsStoreData {
  return { version: 1, familyGroups: [{
    id: 'group-1', label: '그룹', managerEmail: 'manager@example.com', subscriptionEndDate: null,
    sellableSeats: seats, enabled: true, createdAt: now, updatedAt: now,
  }] };
}

function job(productUsid: string, dealUsid = `deal-${productUsid}`) {
  return ensureYouTubeInvitationJob([], {
    dealUsid, productUsid, chatRoomUuid: `chat-${productUsid}`, familyGroupId: 'group-1',
    buyerName: '구매자', buyerGoogleEmail: null, endDateTime: null,
  }, now).job;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'youtube-capacity-invariant-'));
  process.env.YOUTUBE_FAMILY_GROUPS_PATH = join(root, 'groups.json');
  process.env.YOUTUBE_INVITATIONS_PATH = join(root, 'jobs.json');
  process.env.YOUTUBE_PRODUCT_REGISTRATIONS_PATH = join(root, 'journal.json');
  process.env.YOUTUBE_CAPACITY_LOCK_PATH = join(root, 'capacity.lock');
  new YouTubeFamilyGroupsStore(process.env.YOUTUBE_FAMILY_GROUPS_PATH).write(groups());
  new YouTubeInvitationJobsStore(process.env.YOUTUBE_INVITATIONS_PATH).write({ version: 1, jobs: [] });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  for (const key of ['YOUTUBE_FAMILY_GROUPS_PATH', 'YOUTUBE_INVITATIONS_PATH', 'YOUTUBE_PRODUCT_REGISTRATIONS_PATH', 'YOUTUBE_CAPACITY_LOCK_PATH']) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

function reserve(key: string, outcome: 'registered' | 'uncertain' | 'failed', productUsid?: string) {
  const store = new YouTubeProductRegistrationsStore(process.env.YOUTUBE_PRODUCT_REGISTRATIONS_PATH!, { allowUnsafeIsolatedClaim: true });
  store.claim({ idempotencyKey: key, requestFingerprint: key[0].repeat(64), familyGroupId: 'group-1', actor: 'test', reasonCode: 'reserve', at: now });
  store.complete(key, outcome, {
    actor: 'test', reasonCode: 'complete', productUsid,
    at: '2026-08-11T00:00:01.000Z',
  });
}

describe('YouTube cross-store capacity invariant', () => {
  test('rejects an empty jobs write when a journal reservation references an unknown group without changing jobs', () => {
    const jobs = new YouTubeInvitationJobsStore(process.env.YOUTUBE_INVITATIONS_PATH!);
    jobs.write({ version: 1, jobs: [job('product-a')] });
    const journal = new YouTubeProductRegistrationsStore(process.env.YOUTUBE_PRODUCT_REGISTRATIONS_PATH!, { allowUnsafeIsolatedClaim: true });
    journal.claim({
      idempotencyKey: 'unknown-group-reservation',
      requestFingerprint: 'a'.repeat(64),
      familyGroupId: 'unknown-group',
      actor: 'test',
      reasonCode: 'reserve',
      at: now,
    });
    const before = readFileSync(jobs.filePath, 'utf8');

    expect(() => jobs.write({ version: 1, jobs: [] }))
      .toThrow(new YouTubeCapacityInvariantError());
    expect(readFileSync(jobs.filePath, 'utf8')).toBe(before);
  });

  test('rejects a different raw job after a registered reservation without changing jobs', () => {
    reserve('aaaaaaaa-reservation', 'registered', 'product-a');
    const store = new YouTubeInvitationJobsStore(process.env.YOUTUBE_INVITATIONS_PATH!);
    const before = readFileSync(store.filePath, 'utf8');

    expect(() => store.write({ version: 1, jobs: [job('product-b')] }))
      .toThrow(YouTubeCapacityInvariantError);
    expect(readFileSync(store.filePath, 'utf8')).toBe(before);
  });

  test('accepts a raw job for the same product as a registered reservation', () => {
    reserve('bbbbbbbb-reservation', 'registered', 'PRODUCT-A');
    const store = new YouTubeInvitationJobsStore(process.env.YOUTUBE_INVITATIONS_PATH!);

    store.write({ version: 1, jobs: [job('product-a')] });

    expect(store.read().jobs).toHaveLength(1);
  });

  test('rejects a direct family-group seat reduction below latest occupancy', () => {
    const store = new YouTubeFamilyGroupsStore(process.env.YOUTUBE_FAMILY_GROUPS_PATH!);
    store.write(groups(2));
    new YouTubeInvitationJobsStore(process.env.YOUTUBE_INVITATIONS_PATH!).write({
      version: 1,
      jobs: [job('product-a'), job('product-b')],
    });
    const before = readFileSync(store.filePath, 'utf8');

    expect(() => store.write(groups(1))).toThrow(YouTubeCapacityInvariantError);
    expect(readFileSync(store.filePath, 'utf8')).toBe(before);
  });

  test('failed journal rows release capacity while uncertain rows reserve it', () => {
    reserve('cccccccc-reservation', 'failed');
    const jobs = new YouTubeInvitationJobsStore(process.env.YOUTUBE_INVITATIONS_PATH!);
    jobs.write({ version: 1, jobs: [job('product-b')] });
    jobs.write({ version: 1, jobs: [] });
    reserve('dddddddd-reservation', 'uncertain');

    expect(() => jobs.write({ version: 1, jobs: [job('product-c')] }))
      .toThrow(YouTubeCapacityInvariantError);
  });
});
