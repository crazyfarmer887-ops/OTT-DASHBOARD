import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, dirname, parse, resolve } from 'node:path';

const DEFAULT_YOUTUBE_CAPACITY_LOCK_PATH = 'data/youtube-capacity.lock';
const heldCapacityLocks = new Set<string>();

interface LockPayload {
  version: 1;
  pid: number;
  processStartTime: string;
  bootId: string;
  nonce: string;
}

export class YouTubeCapacityUnavailableError extends Error {
  constructor() {
    super('YouTube capacity is busy or unavailable');
    this.name = 'YouTubeCapacityUnavailableError';
  }
}

function ownedByCurrentUser(uid: number): boolean {
  return typeof process.getuid !== 'function' || uid === process.getuid();
}

function openVerifiedCapacityDirectory(path: string): number {
  const resolved = resolve(path);
  const root = parse(resolved).root;
  let current = root;
  for (const component of resolved.slice(root.length).split(/[\\/]+/).filter(Boolean)) {
    current = resolve(current, component);
    try {
      const stat = lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('unsafe lock ancestor');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      mkdirSync(current, { mode: 0o700 });
      const created = lstatSync(current);
      if (!created.isDirectory() || created.isSymbolicLink()) throw new Error('unsafe lock ancestor');
    }
  }
  if (typeof constants.O_DIRECTORY !== 'number' || typeof constants.O_NOFOLLOW !== 'number') {
    throw new Error('required secure lock flags unavailable');
  }
  const checked = lstatSync(resolved);
  if (!checked.isDirectory() || checked.isSymbolicLink() || !ownedByCurrentUser(checked.uid)) {
    throw new Error('unsafe lock directory');
  }
  const fd = openSync(resolved, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    const actual = fstatSync(fd);
    if (!actual.isDirectory() || !ownedByCurrentUser(actual.uid)
      || actual.dev !== checked.dev || actual.ino !== checked.ino) throw new Error('unsafe lock directory');
    fchmodSync(fd, 0o700);
    return fd;
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

export type LinuxProcessObservation =
  | { kind: 'alive'; startTime: string }
  | { kind: 'missing' }
  | { kind: 'malformed' }
  | { kind: 'unverifiable' };

function observeLinuxProcess(pid: number): LinuxProcessObservation {
  let stat: string;
  try {
    stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT'
      ? { kind: 'missing' }
      : { kind: 'unverifiable' };
  }
  const close = stat.lastIndexOf(')');
  if (close < 0) return { kind: 'malformed' };
  const fieldsAfterComm = stat.slice(close + 2).trim().split(/\s+/);
  const startTime = fieldsAfterComm[19]; // /proc/<pid>/stat field 22; this slice starts at field 3.
  return typeof startTime === 'string' && /^\d+$/.test(startTime)
    ? { kind: 'alive', startTime }
    : { kind: 'malformed' };
}

function currentProcessStartTime(): string {
  const observation = observeLinuxProcess(process.pid);
  if (observation.kind !== 'alive') throw new Error('process identity unavailable');
  return observation.startTime;
}

function bootId(): string {
  return readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
}

function parseLockPayload(raw: string): LockPayload | undefined {
  try {
    const value = JSON.parse(raw) as Partial<LockPayload>;
    if (value.version !== 1 || !Number.isSafeInteger(value.pid) || value.pid! <= 0
      || typeof value.processStartTime !== 'string' || !/^\d+$/.test(value.processStartTime)
      || typeof value.bootId !== 'string' || !value.bootId
      || typeof value.nonce !== 'string' || !value.nonce) return undefined;
    return value as LockPayload;
  } catch {
    return undefined;
  }
}

export type LinuxLockOwnerClassification = 'live' | 'stale' | 'unverifiable';

export function classifyLinuxLockOwner(
  payload: LockPayload,
  currentBootId: string,
  observe: (pid: number) => LinuxProcessObservation = observeLinuxProcess,
): LinuxLockOwnerClassification {
  if (payload.bootId !== currentBootId) return 'stale';
  const observation = observe(payload.pid);
  if (observation.kind === 'missing') return 'stale';
  if (observation.kind !== 'alive') return 'unverifiable';
  return observation.startTime === payload.processStartTime ? 'live' : 'stale';
}

/** Acquire an owner-verified Linux lock, recovering only provably dead process instances. */
export function acquireCrashSafeFileLock(lockPathValue: string): () => void {
  const lockPath = resolve(lockPathValue);
  const directoryFd = openVerifiedCapacityDirectory(dirname(lockPath));
  const name = basename(lockPath);
  const target = `/proc/self/fd/${directoryFd}/${name}`;
  const payload: LockPayload = {
    version: 1,
    pid: process.pid,
    processStartTime: currentProcessStartTime(),
    bootId: bootId(),
    nonce: randomUUID(),
  };
  let lockFd: number | null = null;
  let lockIdentity: { dev: number; ino: number } | null = null;
  const pending = `/proc/self/fd/${directoryFd}/.${name}.pending.${payload.nonce}`;
  try {
    lockFd = openSync(pending, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    const pendingStat = fstatSync(lockFd);
    if (!pendingStat.isFile() || !ownedByCurrentUser(pendingStat.uid)) throw new Error('unsafe lock file');
    fchmodSync(lockFd, 0o600);
    writeSync(lockFd, `${JSON.stringify(payload)}\n`);
    fsyncSync(lockFd);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        linkSync(pending, target);
        lockIdentity = { dev: pendingStat.dev, ino: pendingStat.ino };
        unlinkSync(pending);
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        let existingFd: number | null = null;
        try {
          existingFd = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW);
          const before = fstatSync(existingFd);
          if (!before.isFile() || !ownedByCurrentUser(before.uid) || (before.mode & 0o077) !== 0) throw new Error('unsafe existing lock');
          const existingPayload = parseLockPayload(readFileSync(existingFd, 'utf8'));
          if (!existingPayload || classifyLinuxLockOwner(existingPayload, bootId()) !== 'stale') {
            throw new Error('lock busy');
          }
          const checked = lstatSync(target);
          if (!checked.isFile() || checked.isSymbolicLink() || !ownedByCurrentUser(checked.uid)
            || checked.dev !== before.dev || checked.ino !== before.ino) throw new Error('lock changed');
          const tombstone = `/proc/self/fd/${directoryFd}/.${name}.stale.${payload.nonce}`;
          renameSync(target, tombstone);
          const moved = lstatSync(tombstone);
          if (!moved.isFile() || moved.dev !== before.dev || moved.ino !== before.ino) throw new Error('stale lock race');
          unlinkSync(tombstone);
        } finally {
          if (existingFd !== null) closeSync(existingFd);
        }
      }
    }
    if (lockFd === null || lockIdentity === null) throw new Error('lock busy');
  } catch (error) {
    try { unlinkSync(pending); } catch { /* not created or already linked */ }
    if (lockFd !== null) closeSync(lockFd);
    closeSync(directoryFd);
    throw error;
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    closeSync(lockFd!);
    try {
      const current = lstatSync(target);
      if (current.isFile() && !current.isSymbolicLink()
        && current.dev === lockIdentity!.dev && current.ino === lockIdentity!.ino) unlinkSync(target);
    } finally {
      closeSync(directoryFd);
    }
  };
}

export function youtubeCapacityLockPath(): string {
  return resolve(process.env.YOUTUBE_CAPACITY_LOCK_PATH || DEFAULT_YOUTUBE_CAPACITY_LOCK_PATH);
}

export function withYouTubeCapacityLock<T>(operation: () => T): T {
  const lockPath = youtubeCapacityLockPath();
  if (heldCapacityLocks.has(lockPath)) {
    const result = operation();
    if (result && typeof (result as { then?: unknown }).then === 'function') throw new YouTubeCapacityUnavailableError();
    return result;
  }

  let release: (() => void) | undefined;
  try {
    release = acquireCrashSafeFileLock(lockPath);
    heldCapacityLocks.add(lockPath);
    const result = operation();
    if (result && typeof (result as { then?: unknown }).then === 'function') throw new YouTubeCapacityUnavailableError();
    return result;
  } catch (error) {
    if (error instanceof YouTubeCapacityUnavailableError) throw error;
    if (heldCapacityLocks.has(lockPath)) throw error;
    throw new YouTubeCapacityUnavailableError();
  } finally {
    heldCapacityLocks.delete(lockPath);
    try { release?.(); } catch { /* fail closed */ }
  }
}
