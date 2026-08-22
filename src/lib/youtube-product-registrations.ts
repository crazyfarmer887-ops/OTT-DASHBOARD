import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync, constants, fchmodSync, fstatSync, fsyncSync, lstatSync, mkdirSync,
  openSync, readFileSync, renameSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, parse, resolve } from 'node:path';
import type { YouTubeSharingNoKeepProductModel } from './graytag-fill';

export type YouTubeProductRegistrationStatus = 'submitting' | 'registered' | 'uncertain' | 'failed';
export interface YouTubeProductRegistrationHistoryEntry {
  from: YouTubeProductRegistrationStatus | null;
  to: YouTubeProductRegistrationStatus;
  actor: string;
  reasonCode: string;
  at: string;
}
export interface YouTubeProductRegistrationRecord {
  idempotencyKey: string;
  requestFingerprint: string;
  familyGroupId: string;
  attemptId: string;
  leaseExpiresAt: string;
  status: YouTubeProductRegistrationStatus;
  productUsid: string | null;
  actor: string;
  createdAt: string;
  updatedAt: string;
  history: YouTubeProductRegistrationHistoryEntry[];
}
export interface YouTubeProductRegistrationsData { version: 1; records: YouTubeProductRegistrationRecord[] }

export class YouTubeProductRegistrationsCorruptionError extends Error {
  constructor(message = 'YouTube product registrations journal is corrupt') {
    super(message); this.name = 'YouTubeProductRegistrationsCorruptionError';
  }
}

const STATUSES = new Set<YouTubeProductRegistrationStatus>(['submitting', 'registered', 'uncertain', 'failed']);
const HEX_64 = /^[a-f0-9]{64}$/;
const SAFE_KEY = /^[A-Za-z0-9._~:+-]{8,128}$/;
const EXACT_RECORD = ['idempotencyKey', 'requestFingerprint', 'familyGroupId', 'attemptId', 'leaseExpiresAt', 'status', 'productUsid', 'actor', 'createdAt', 'updatedAt', 'history'];
const EXACT_HISTORY = ['from', 'to', 'actor', 'reasonCode', 'at'];

function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function exact(value: Record<string, unknown>, keys: string[]) { const actual = Object.keys(value).sort(); const expected = [...keys].sort(); return actual.length === expected.length && actual.every((key, i) => key === expected[i]); }
function text(value: unknown, max = 200): value is string { return typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/.test(value); }
function iso(value: unknown): value is string { if (typeof value !== 'string') return false; const parsed = new Date(value); return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value; }
function status(value: unknown): value is YouTubeProductRegistrationStatus { return typeof value === 'string' && STATUSES.has(value as YouTubeProductRegistrationStatus); }

function validHistory(item: unknown): item is YouTubeProductRegistrationHistoryEntry {
  return record(item) && exact(item, EXACT_HISTORY) && (item.from === null || status(item.from))
    && status(item.to) && text(item.actor, 200) && text(item.reasonCode, 200) && iso(item.at);
}
function validRegistration(item: unknown): item is YouTubeProductRegistrationRecord {
  if (!record(item) || !exact(item, EXACT_RECORD) || !SAFE_KEY.test(String(item.idempotencyKey ?? ''))
    || !HEX_64.test(String(item.requestFingerprint ?? '')) || !text(item.familyGroupId, 200)
    || !text(item.attemptId, 64) || !iso(item.leaseExpiresAt)
    || !status(item.status) || !text(item.actor, 200) || !iso(item.createdAt) || !iso(item.updatedAt)
    || item.updatedAt < item.createdAt
    || !Array.isArray(item.history) || !item.history.every(validHistory)) return false;
  if (item.status === 'registered' ? !text(item.productUsid, 200) : item.productUsid !== null) return false;
  const history = item.history as YouTubeProductRegistrationHistoryEntry[];
  if (history.length < 1 || history[0].from !== null || history[0].to !== 'submitting' || history[0].at !== item.createdAt) return false;
  if (history[0].actor !== item.actor) return false;
  if (item.status === 'submitting') return history.length === 1 && item.updatedAt >= item.createdAt && item.leaseExpiresAt > item.updatedAt;
  return history.length === 2 && history[1].from === 'submitting' && history[1].to === item.status
    && history[1].at === item.updatedAt;
}
function validate(value: unknown): asserts value is YouTubeProductRegistrationsData {
  if (!record(value) || !exact(value, ['version', 'records']) || value.version !== 1 || !Array.isArray(value.records)
    || !value.records.every(validRegistration)) throw new YouTubeProductRegistrationsCorruptionError();
  const rows = value.records as YouTubeProductRegistrationRecord[];
  const keys = rows.map((row) => row.idempotencyKey);
  const products = rows.filter((row) => row.status === 'registered').map((row) => row.productUsid!);
  if (new Set(keys).size !== keys.length || new Set(products).size !== products.length) throw new YouTubeProductRegistrationsCorruptionError();
}

function owned(uid: number) { return typeof process.getuid !== 'function' || uid === process.getuid(); }
function openDirectory(path: string, create: boolean): number {
  const resolved = resolve(path); const root = parse(resolved).root;
  let current = root;
  for (const component of resolved.slice(root.length).split(/[\\/]+/).filter(Boolean)) {
    current = resolve(current, component);
    try { const stat = lstatSync(current); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('unsafe'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || !create) throw error; mkdirSync(current, { mode: 0o700 }); }
  }
  if (typeof constants.O_DIRECTORY !== 'number' || typeof constants.O_NOFOLLOW !== 'number') throw new Error('unsafe');
  const checked = lstatSync(resolved);
  if (!checked.isDirectory() || checked.isSymbolicLink() || !owned(checked.uid)) throw new Error('unsafe');
  const fd = openSync(resolved, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { const actual = fstatSync(fd); if (!actual.isDirectory() || !owned(actual.uid) || actual.dev !== checked.dev || actual.ino !== checked.ino) throw new Error('unsafe'); fchmodSync(fd, 0o700); return fd; }
  catch (error) { closeSync(fd); throw error; }
}

function readStore(path: string, allowMissing: boolean): YouTubeProductRegistrationsData | null {
  let dirFd: number | null = null; let fd: number | null = null;
  try {
    dirFd = openDirectory(dirname(path), allowMissing);
    const target = `/proc/self/fd/${dirFd}/${basename(path)}`;
    let checked;
    try { checked = lstatSync(target); } catch (error) { if (allowMissing && (error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    if (!checked.isFile() || checked.isSymbolicLink() || !owned(checked.uid)) throw new Error('unsafe');
    fd = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    const actual = fstatSync(fd);
    if (!actual.isFile() || !owned(actual.uid) || actual.dev !== checked.dev || actual.ino !== checked.ino) throw new Error('unsafe');
    fchmodSync(fd, 0o600);
    let parsed: unknown; try { parsed = JSON.parse(readFileSync(fd, 'utf8')); } catch { throw new YouTubeProductRegistrationsCorruptionError(); }
    validate(parsed); return parsed;
  } catch (error) {
    if (error instanceof YouTubeProductRegistrationsCorruptionError) throw error;
    throw new YouTubeProductRegistrationsCorruptionError('YouTube product registrations journal path is unsafe');
  } finally { if (fd !== null) closeSync(fd); if (dirFd !== null) closeSync(dirFd); }
}

function writeStore(path: string, data: YouTubeProductRegistrationsData): void {
  validate(data); let dirFd: number | null = null; let fd: number | null = null; let temporary = '';
  try {
    dirFd = openDirectory(dirname(path), true); const base = basename(path); const root = `/proc/self/fd/${dirFd}`;
    try { const existing = lstatSync(`${root}/${base}`); if (existing.isSymbolicLink() || !existing.isFile() || !owned(existing.uid)) throw new Error('unsafe'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    temporary = `.${base}.${process.pid}.${randomUUID()}.tmp`;
    fd = openSync(`${root}/${temporary}`, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    fchmodSync(fd, 0o600); writeFileSync(fd, `${JSON.stringify(data, null, 2)}\n`); fsyncSync(fd); closeSync(fd); fd = null;
    renameSync(`${root}/${temporary}`, `${root}/${base}`); temporary = ''; fsyncSync(dirFd);
  } catch (error) {
    if (error instanceof YouTubeProductRegistrationsCorruptionError) throw error;
    throw new YouTubeProductRegistrationsCorruptionError('YouTube product registrations journal path is unsafe');
  } finally {
    if (fd !== null) closeSync(fd);
    if (dirFd !== null) { if (temporary) try { unlinkSync(`/proc/self/fd/${dirFd}/${temporary}`); } catch {} closeSync(dirFd); }
  }
}

export function fingerprintYouTubeProductRegistration(familyGroupId: string, model: YouTubeSharingNoKeepProductModel): string {
  const canonical = JSON.stringify({ familyGroupId, model: { tempProductCategory: model.tempProductCategory, endDate: model.endDate, priceType: model.priceType, price: model.price, name: model.name, sellingGuide: model.sellingGuide } });
  return createHash('sha256').update(canonical).digest('hex');
}

export type YouTubeProductRegistrationClaim =
  | { kind: 'claimed'; record: YouTubeProductRegistrationRecord }
  | { kind: 'replay'; record: YouTubeProductRegistrationRecord }
  | { kind: 'blocked'; record: YouTubeProductRegistrationRecord }
  | { kind: 'recovery'; record: YouTubeProductRegistrationRecord }
  | { kind: 'conflict'; record: YouTubeProductRegistrationRecord }
  | { kind: 'no_capacity' };

export interface YouTubeProductRegistrationCapacity {
  familyCapacity: number;
  externalOccupiedProductUsids: ReadonlySet<string>;
  externalOccupiedFallbackCount: number;
}

interface YouTubeProductRegistrationClaimInput {
  idempotencyKey: string;
  requestFingerprint: string;
  compatibleRequestFingerprints?: readonly string[];
  familyGroupId: string;
  actor: string;
  reasonCode: string;
  at?: string;
}

export class YouTubeProductRegistrationsBusyError extends Error {
  constructor() { super('YouTube product registrations journal is busy or unavailable'); this.name = 'YouTubeProductRegistrationsBusyError'; }
}

function withJournalLock<T>(path: string, operation: () => T): T {
  let dirFd: number | null = null; let lockFd: number | null = null; let locked = false;
  try {
    dirFd = openDirectory(dirname(path), true);
    const lockTarget = `/proc/self/fd/${dirFd}/${basename(path)}.lock`;
    try {
      lockFd = openSync(lockTarget, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      locked = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new YouTubeProductRegistrationsBusyError();
      throw error;
    }
    const lockStat = fstatSync(lockFd);
    if (!lockStat.isFile() || !owned(lockStat.uid)) throw new Error('unsafe');
    fchmodSync(lockFd, 0o600);
    return operation();
  } catch (error) {
    if (error instanceof YouTubeProductRegistrationsBusyError || error instanceof YouTubeProductRegistrationsCorruptionError || error instanceof TypeError) throw error;
    throw new YouTubeProductRegistrationsCorruptionError('YouTube product registrations journal lock is unsafe');
  } finally {
    if (lockFd !== null) closeSync(lockFd);
    if (dirFd !== null) {
      if (locked) try { unlinkSync(`/proc/self/fd/${dirFd}/${basename(path)}.lock`); } catch {}
      closeSync(dirFd);
    }
  }
}

export class YouTubeProductRegistrationsStore {
  constructor(
    readonly filePath: string,
    private readonly options: { allowUnsafeIsolatedClaim?: boolean } = {},
  ) {}
  /** Read a lock-protected snapshot without creating an absent journal. */
  listForCapacityValidation(): YouTubeProductRegistrationRecord[] {
    return withJournalLock(this.filePath, () => [
      ...(readStore(this.filePath, true)?.records ?? []),
    ]);
  }
  list(): YouTubeProductRegistrationRecord[] {
    let data = readStore(this.filePath, true);
    if (!data) {
      data = withJournalLock(this.filePath, () => {
        const latest = readStore(this.filePath, true);
        if (latest) return latest;
        writeStore(this.filePath, { version: 1, records: [] });
        return readStore(this.filePath, false)!;
      });
    }
    return [...data!.records];
  }
  claim(input: YouTubeProductRegistrationClaimInput): YouTubeProductRegistrationClaim {
    if (!this.options.allowUnsafeIsolatedClaim) {
      throw new TypeError('Raw claim requires coherent capacity validation');
    }
    return this.claimWithCapacity(input, { familyCapacity: Number.MAX_SAFE_INTEGER, externalOccupiedProductUsids: new Set(), externalOccupiedFallbackCount: 0 });
  }
  claimWithCapacity(input: YouTubeProductRegistrationClaimInput, capacity: YouTubeProductRegistrationCapacity): YouTubeProductRegistrationClaim {
    const at = input.at ?? new Date().toISOString();
    const compatibleRequestFingerprints = input.compatibleRequestFingerprints ?? [];
    if (!SAFE_KEY.test(input.idempotencyKey) || !HEX_64.test(input.requestFingerprint)
      || !Array.isArray(compatibleRequestFingerprints) || compatibleRequestFingerprints.length > 10
      || !compatibleRequestFingerprints.every((fingerprint) => HEX_64.test(fingerprint))
      || !text(input.familyGroupId, 200) || !text(input.actor, 200) || !text(input.reasonCode, 200) || !iso(at)) throw new TypeError('Invalid YouTube product registration claim');
    if (!Number.isSafeInteger(capacity.familyCapacity) || capacity.familyCapacity < 0
      || !Number.isSafeInteger(capacity.externalOccupiedFallbackCount) || capacity.externalOccupiedFallbackCount < 0
      || !(capacity.externalOccupiedProductUsids instanceof Set)) throw new TypeError('Invalid YouTube product registration capacity');
    return withJournalLock(this.filePath, () => {
      const data = readStore(this.filePath, true) ?? { version: 1 as const, records: [] };
      const existing = data.records.find((row) => row.idempotencyKey === input.idempotencyKey);
      if (existing) {
        const compatible = existing.requestFingerprint === input.requestFingerprint
          || compatibleRequestFingerprints.includes(existing.requestFingerprint);
        if (!compatible || existing.familyGroupId !== input.familyGroupId) return { kind: 'conflict', record: existing };
        if (existing.status === 'submitting' && existing.leaseExpiresAt <= at) {
          const renewed = { ...existing, leaseExpiresAt: new Date(new Date(at).getTime() + 60_000).toISOString(), updatedAt: at };
          const records = [...data.records]; records[data.records.indexOf(existing)] = renewed;
          writeStore(this.filePath, { version: 1, records });
          return { kind: 'recovery', record: renewed };
        }
        return { kind: existing.status === 'registered' ? 'replay' : 'blocked', record: existing };
      }
      const occupiedProducts = new Set([...capacity.externalOccupiedProductUsids].map((value) => value.trim().toLowerCase()).filter(Boolean));
      let pendingReservations = 0;
      for (const row of data.records) {
        if (row.familyGroupId !== input.familyGroupId) continue;
        if (row.status === 'submitting' || row.status === 'uncertain') pendingReservations += 1;
        else if (row.status === 'registered' && row.productUsid) occupiedProducts.add(row.productUsid.trim().toLowerCase());
      }
      if (occupiedProducts.size + capacity.externalOccupiedFallbackCount + pendingReservations >= capacity.familyCapacity) return { kind: 'no_capacity' };
      const created: YouTubeProductRegistrationRecord = { idempotencyKey: input.idempotencyKey, requestFingerprint: input.requestFingerprint, familyGroupId: input.familyGroupId, attemptId: randomUUID(), leaseExpiresAt: new Date(new Date(at).getTime() + 60_000).toISOString(), status: 'submitting', productUsid: null, actor: input.actor, createdAt: at, updatedAt: at, history: [{ from: null, to: 'submitting', actor: input.actor, reasonCode: input.reasonCode, at }] };
      writeStore(this.filePath, { version: 1, records: [...data.records, created] }); return { kind: 'claimed', record: created };
    });
  }
  complete(idempotencyKey: string, to: Exclude<YouTubeProductRegistrationStatus, 'submitting'>, input: { attemptId?: string; actor: string; reasonCode: string; productUsid?: string; at?: string }): YouTubeProductRegistrationRecord {
    const at = input.at ?? new Date().toISOString();
    return withJournalLock(this.filePath, () => {
      const data = readStore(this.filePath, false)!;
      const index = data.records.findIndex((row) => row.idempotencyKey === idempotencyKey); const current = data.records[index];
      const attemptId = input.attemptId ?? (this.options.allowUnsafeIsolatedClaim ? current?.attemptId : undefined);
      if (!current || current.status !== 'submitting' || attemptId !== current.attemptId || !text(input.actor, 200) || !text(input.reasonCode, 200) || !iso(at) || (to === 'registered' ? !text(input.productUsid, 200) : input.productUsid !== undefined)) throw new TypeError('Invalid YouTube product registration completion');
      const updated: YouTubeProductRegistrationRecord = { ...current, status: to, productUsid: to === 'registered' ? input.productUsid! : null, updatedAt: at, history: [...current.history, { from: 'submitting', to, actor: input.actor, reasonCode: input.reasonCode, at }] };
      const records = [...data.records]; records[index] = updated; writeStore(this.filePath, { version: 1, records }); return updated;
    });
  }
}
