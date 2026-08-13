import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { classifyLinuxLockOwner, withYouTubeCapacityLock } from '../src/lib/youtube-capacity-lock';
import { JsonRenewalJobStore, type RenewalJob } from '../src/renewal/job-store';

const roots: string[] = [];
const previousLockPath = process.env.YOUTUBE_CAPACITY_LOCK_PATH;

function tempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function livePayload(): string {
  const stat = readFileSync(`/proc/${process.pid}/stat`, 'utf8');
  const close = stat.lastIndexOf(')');
  const fieldsAfterComm = stat.slice(close + 2).trim().split(/\s+/);
  return `${JSON.stringify({
    version: 1,
    pid: process.pid,
    processStartTime: fieldsAfterComm[19],
    bootId: readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(),
    nonce: 'test-owner-nonce',
  })}\n`;
}

function deadPayload(currentPayload: string): string {
  const payload = JSON.parse(currentPayload);
  payload.pid = 2_147_483_647;
  payload.processStartTime = '0';
  return `${JSON.stringify(payload)}\n`;
}

function renewalJob(): RenewalJob {
  return {
    id: 'job-1', idempotencyKey: 'renewal:deal-1:20260814T0000', dealUsid: 'deal-1',
    productUsid: 'product-1', chatRoomUuid: 'room-1', service: 'netflix', oldEnd: '20260813T0000',
    newEnd: '20260814T0000', status: 'preview', couponStatus: 'not_started',
    createdAt: '2026-08-14T00:00:00.000Z', updatedAt: '2026-08-14T00:00:00.000Z',
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  if (previousLockPath === undefined) delete process.env.YOUTUBE_CAPACITY_LOCK_PATH;
  else process.env.YOUTUBE_CAPACITY_LOCK_PATH = previousLockPath;
});

describe('crash-safe file lock recovery', () => {
  test('owner classification fails closed when procfs cannot be verified', () => {
    const payload = JSON.parse(livePayload());
    const currentBootId = payload.bootId;
    expect(classifyLinuxLockOwner(payload, currentBootId, () => ({ kind: 'alive', startTime: payload.processStartTime }))).toBe('live');
    expect(classifyLinuxLockOwner(payload, currentBootId, () => ({ kind: 'missing' }))).toBe('stale');
    expect(classifyLinuxLockOwner(payload, currentBootId, () => ({ kind: 'alive', startTime: String(BigInt(payload.processStartTime) + 1n) }))).toBe('stale');
    for (const observation of [{ kind: 'unverifiable' as const }, { kind: 'malformed' as const }]) {
      expect(classifyLinuxLockOwner(payload, currentBootId, () => observation)).toBe('unverifiable');
    }
    expect(classifyLinuxLockOwner(payload, 'different-boot-id', () => ({ kind: 'unverifiable' }))).toBe('stale');
  });

  test('YouTube reclaims a lock left by a dead process', () => {
    const root = tempRoot('youtube-stale-lock-');
    const lockPath = join(root, 'capacity.lock');
    process.env.YOUTUBE_CAPACITY_LOCK_PATH = lockPath;
    const currentPayload = livePayload();
    writeFileSync(lockPath, deadPayload(currentPayload), { mode: 0o600 });

    expect(withYouTubeCapacityLock(() => 'recovered')).toBe('recovered');
  });

  test('YouTube keeps a lock owned by the same live process instance busy', () => {
    const root = tempRoot('youtube-live-lock-');
    const lockPath = join(root, 'capacity.lock');
    process.env.YOUTUBE_CAPACITY_LOCK_PATH = lockPath;
    writeFileSync(lockPath, livePayload(), { mode: 0o600 });

    expect(() => withYouTubeCapacityLock(() => undefined)).toThrow(/busy|unavailable/i);
  });

  test('YouTube reclaims a reused PID whose process start time does not match', () => {
    const root = tempRoot('youtube-reused-pid-lock-');
    const lockPath = join(root, 'capacity.lock');
    process.env.YOUTUBE_CAPACITY_LOCK_PATH = lockPath;
    const payload = JSON.parse(livePayload());
    payload.processStartTime = String(BigInt(payload.processStartTime) + 1n);
    writeFileSync(lockPath, `${JSON.stringify(payload)}\n`, { mode: 0o600 });

    expect(withYouTubeCapacityLock(() => 'recovered')).toBe('recovered');
  });

  test('YouTube fails closed for an unverifiable legacy lock', () => {
    const root = tempRoot('youtube-legacy-lock-');
    const lockPath = join(root, 'capacity.lock');
    process.env.YOUTUBE_CAPACITY_LOCK_PATH = lockPath;
    writeFileSync(lockPath, '', { mode: 0o600 });

    expect(() => withYouTubeCapacityLock(() => undefined)).toThrow(/busy|unavailable/i);
  });

  test('YouTube fails closed for a symlink lock', () => {
    const root = tempRoot('youtube-symlink-lock-');
    const lockPath = join(root, 'capacity.lock');
    const target = join(root, 'target');
    writeFileSync(target, 'do not delete');
    process.env.YOUTUBE_CAPACITY_LOCK_PATH = lockPath;
    symlinkSync(target, lockPath);

    expect(() => withYouTubeCapacityLock(() => undefined)).toThrow(/busy|unavailable/i);
    expect(readFileSync(target, 'utf8')).toBe('do not delete');
  });

  test('renewal store reclaims a lock left by a dead process', () => {
    const root = tempRoot('renewal-stale-lock-');
    const path = join(root, 'jobs.json');
    const lockPath = `${path}.lock`;
    const currentPayload = livePayload();
    writeFileSync(lockPath, deadPayload(currentPayload), { mode: 0o600 });

    expect(new JsonRenewalJobStore(path).put(renewalJob()).id).toBe('job-1');
  });

  test('renewal store keeps a lock owned by the same live process instance busy', () => {
    const root = tempRoot('renewal-live-lock-');
    const path = join(root, 'jobs.json');
    writeFileSync(`${path}.lock`, livePayload(), { mode: 0o600 });

    expect(() => new JsonRenewalJobStore(path).put(renewalJob())).toThrow(/busy/i);
  });

  test('renewal store fails closed for a symlink lock', () => {
    const root = tempRoot('renewal-symlink-lock-');
    const path = join(root, 'jobs.json');
    const target = join(root, 'target');
    writeFileSync(target, 'do not delete');
    symlinkSync(target, `${path}.lock`);

    expect(() => new JsonRenewalJobStore(path).put(renewalJob())).toThrow(/busy/i);
    expect(readFileSync(target, 'utf8')).toBe('do not delete');
  });
});
