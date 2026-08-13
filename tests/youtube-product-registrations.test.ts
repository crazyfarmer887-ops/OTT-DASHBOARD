import { describe, expect, test } from 'vitest';
import { chmodSync, closeSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  YouTubeProductRegistrationsStore,
  fingerprintYouTubeProductRegistration,
} from '../src/lib/youtube-product-registrations';

const at = '2026-08-11T00:00:00.000Z';
const model = { tempProductCategory: 'youtube' as const, endDate: '20260831T2359', priceType: 'Normal' as const, price: '7900', name: '상품', sellingGuide: '안내' };

function withTemp(run: (root: string, path: string) => void) {
  const root = mkdtempSync(join(tmpdir(), 'youtube-product-journal-'));
  try { run(root, join(root, 'journal', 'registrations.json')); } finally { rmSync(root, { recursive: true, force: true }); }
}

describe('YouTube product registration journal', () => {
  test('raw claim fails closed unless an isolated test explicitly opts out', () => withTemp((_root, path) => {
    const input = { idempotencyKey: 'request-key-raw-claim', requestFingerprint: 'a'.repeat(64), familyGroupId: 'group-1', actor: 'admin', reasonCode: 'create', at };
    expect(() => new YouTubeProductRegistrationsStore(path).claim(input)).toThrow(/capacity validation/i);
    expect(new YouTubeProductRegistrationsStore(path, { allowUnsafeIsolatedClaim: true }).claim(input).kind).toBe('claimed');
  }));

  test('claims synchronously, registers once, and replays a stable registration', () => withTemp((root, path) => {
    const store = new YouTubeProductRegistrationsStore(path, { allowUnsafeIsolatedClaim: true });
    const fingerprint = fingerprintYouTubeProductRegistration('group-1', model);
    const claim = store.claim({ idempotencyKey: 'request-key-0001', requestFingerprint: fingerprint, familyGroupId: 'group-1', actor: 'admin:test', reasonCode: 'create', at });
    expect(claim.kind).toBe('claimed');
    expect(store.complete('request-key-0001', 'registered', { actor: 'admin:test', reasonCode: 'provider-succeeded', productUsid: 'product-1', at: '2026-08-11T00:00:01.000Z' })).toMatchObject({ status: 'registered', productUsid: 'product-1' });
    expect(store.claim({ idempotencyKey: 'request-key-0001', requestFingerprint: fingerprint, familyGroupId: 'group-1', actor: 'admin:test', reasonCode: 'create', at: '2026-08-11T00:00:02.000Z' })).toMatchObject({ kind: 'replay', record: { productUsid: 'product-1' } });
    const saved = JSON.parse(readFileSync(path, 'utf8'));
    expect(saved.records[0]).toEqual({
      idempotencyKey: 'request-key-0001', requestFingerprint: fingerprint, familyGroupId: 'group-1', attemptId: expect.any(String), leaseExpiresAt: '2026-08-11T00:01:00.000Z', status: 'registered', productUsid: 'product-1', actor: 'admin:test', createdAt: at, updatedAt: '2026-08-11T00:00:01.000Z',
      history: [
        { from: null, to: 'submitting', actor: 'admin:test', reasonCode: 'create', at },
        { from: 'submitting', to: 'registered', actor: 'admin:test', reasonCode: 'provider-succeeded', at: '2026-08-11T00:00:01.000Z' },
      ],
    });
    expect(lstatSync(join(root, 'journal')).mode & 0o777).toBe(0o700);
    expect(lstatSync(path).mode & 0o777).toBe(0o600);
  }));

  test('conflicts on a changed fingerprint and blocks submitting, uncertain, and failed records', () => withTemp((_root, path) => {
    const store = new YouTubeProductRegistrationsStore(path, { allowUnsafeIsolatedClaim: true });
    const fp = fingerprintYouTubeProductRegistration('group-1', model);
    const input = { idempotencyKey: 'request-key-0002', requestFingerprint: fp, familyGroupId: 'group-1', actor: 'admin', reasonCode: 'create', at };
    expect(store.claim(input).kind).toBe('claimed');
    expect(store.claim(input).kind).toBe('blocked');
    expect(store.claim({ ...input, requestFingerprint: 'f'.repeat(64) }).kind).toBe('conflict');
    store.complete(input.idempotencyKey, 'uncertain', { actor: 'admin', reasonCode: 'timeout', at: '2026-08-11T00:00:01.000Z' });
    expect(store.claim(input).kind).toBe('blocked');
  }));

  test('leases a submitting attempt and permits only lookup recovery after expiry', () => withTemp((_root, path) => {
    const store = new YouTubeProductRegistrationsStore(path, { allowUnsafeIsolatedClaim: true });
    const input = { idempotencyKey: 'request-key-leased-1', requestFingerprint: '7'.repeat(64), familyGroupId: 'group-1', actor: 'admin', reasonCode: 'create', at };
    const claimed = store.claim(input);
    expect(claimed).toMatchObject({ kind: 'claimed', record: { status: 'submitting' } });
    if (claimed.kind !== 'claimed') throw new Error('expected claim');
    expect(claimed.record.attemptId).toMatch(/^[0-9a-f-]{36}$/);
    expect(claimed.record.leaseExpiresAt).toBe('2026-08-11T00:01:00.000Z');
    expect(store.claim({ ...input, at: '2026-08-11T00:00:59.999Z' }).kind).toBe('blocked');
    const recovery = store.claim({ ...input, at: '2026-08-11T00:01:00.000Z' });
    expect(recovery).toMatchObject({ kind: 'recovery', record: { attemptId: claimed.record.attemptId, leaseExpiresAt: '2026-08-11T00:02:00.000Z' } });
    expect(store.claim({ ...input, at: '2026-08-11T00:01:01.000Z' }).kind).toBe('blocked');
  }));

  test('rejects completion by an attempt other than the durable claim owner', () => withTemp((_root, path) => {
    const store = new YouTubeProductRegistrationsStore(path, { allowUnsafeIsolatedClaim: true });
    const claim = store.claim({ idempotencyKey: 'request-key-attempt-1', requestFingerprint: '8'.repeat(64), familyGroupId: 'group-1', actor: 'admin', reasonCode: 'create', at });
    if (claim.kind !== 'claimed') throw new Error('expected claim');
    expect(() => store.complete('request-key-attempt-1', 'registered', { attemptId: '00000000-0000-4000-8000-000000000000', actor: 'admin', reasonCode: 'done', productUsid: 'product-1', at: '2026-08-11T00:00:01.000Z' })).toThrow(/completion/i);
    expect(store.complete('request-key-attempt-1', 'registered', { attemptId: claim.record.attemptId, actor: 'admin', reasonCode: 'done', productUsid: 'product-1', at: '2026-08-11T00:00:01.000Z' })).toMatchObject({ status: 'registered' });
  }));

  test('initializes only a missing journal with private modes', () => withTemp((root, path) => {
    const store = new YouTubeProductRegistrationsStore(path, { allowUnsafeIsolatedClaim: true });
    expect(store.list()).toEqual([]);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ version: 1, records: [] });
    expect(lstatSync(join(root, 'journal')).mode & 0o777).toBe(0o700);
    expect(lstatSync(path).mode & 0o777).toBe(0o600);
  }));

  test('serializes missing initialization behind the journal lock so it cannot overwrite a claim', () => withTemp((root, path) => {
    const store = new YouTubeProductRegistrationsStore(path, { allowUnsafeIsolatedClaim: true });
    mkdirSync(join(root, 'journal'), { mode: 0o700 });
    const lockPath = `${path}.lock`;
    const lockFd = openSync(lockPath, 'wx', 0o600);
    try {
      expect(() => store.list()).toThrow(/busy|unavailable/i);
      expect(() => lstatSync(path)).toThrow();
    } finally {
      closeSync(lockFd);
      rmSync(lockPath, { force: true });
    }
    expect(store.claim({ idempotencyKey: 'request-key-init-race', requestFingerprint: '9'.repeat(64), familyGroupId: 'group-1', actor: 'admin', reasonCode: 'create', at }).kind).toBe('claimed');
    expect(store.list()).toMatchObject([{ idempotencyKey: 'request-key-init-race', status: 'submitting' }]);
  }));

  test('fails closed without overwriting corrupt JSON', () => withTemp((root, path) => {
    mkdirSync(join(root, 'journal'), { mode: 0o700 });
    writeFileSync(path, '{broken', { mode: 0o600 });
    const store = new YouTubeProductRegistrationsStore(path, { allowUnsafeIsolatedClaim: true });
    expect(() => store.claim({ idempotencyKey: 'request-key-0003', requestFingerprint: 'a'.repeat(64), familyGroupId: 'group-1', actor: 'admin', reasonCode: 'create', at })).toThrow(/corrupt/i);
    expect(readFileSync(path, 'utf8')).toBe('{broken');
  }));

  test('rejects symlinked ancestors and final files without touching targets', () => withTemp((root, path) => {
    const outside = join(root, 'outside');
    mkdirSync(outside, { mode: 0o755 });
    symlinkSync(outside, join(root, 'journal'));
    const store = new YouTubeProductRegistrationsStore(path, { allowUnsafeIsolatedClaim: true });
    expect(() => store.claim({ idempotencyKey: 'request-key-0004', requestFingerprint: 'a'.repeat(64), familyGroupId: 'group-1', actor: 'admin', reasonCode: 'create', at })).toThrow(/corrupt|unsafe/i);
    expect(() => lstatSync(join(outside, 'registrations.json'))).toThrow();
  }));

  test('repairs owned loose modes on read', () => withTemp((root, path) => {
    const store = new YouTubeProductRegistrationsStore(path, { allowUnsafeIsolatedClaim: true });
    store.claim({ idempotencyKey: 'request-key-0005', requestFingerprint: 'a'.repeat(64), familyGroupId: 'group-1', actor: 'admin', reasonCode: 'create', at });
    chmodSync(join(root, 'journal'), 0o755); chmodSync(path, 0o644);
    expect(store.list()).toHaveLength(1);
    expect(lstatSync(join(root, 'journal')).mode & 0o777).toBe(0o700);
    expect(lstatSync(path).mode & 0o777).toBe(0o600);
  }));

  test('reserves capacity atomically and counts uncertain while failed releases a seat', () => withTemp((_root, path) => {
    const store = new YouTubeProductRegistrationsStore(path, { allowUnsafeIsolatedClaim: true });
    const capacity = { familyCapacity: 1, externalOccupiedProductUsids: new Set<string>(), externalOccupiedFallbackCount: 0 };
    const first = { idempotencyKey: 'request-key-capacity-1', requestFingerprint: 'a'.repeat(64), familyGroupId: 'group-1', actor: 'admin', reasonCode: 'create', at };
    expect(store.claimWithCapacity(first, capacity).kind).toBe('claimed');
    expect(store.claimWithCapacity({ ...first, idempotencyKey: 'request-key-capacity-2', requestFingerprint: 'b'.repeat(64) }, capacity).kind).toBe('no_capacity');
    store.complete(first.idempotencyKey, 'uncertain', { actor: 'admin', reasonCode: 'timeout', at: '2026-08-11T00:00:01.000Z' });
    expect(store.claimWithCapacity({ ...first, idempotencyKey: 'request-key-capacity-3', requestFingerprint: 'c'.repeat(64) }, capacity).kind).toBe('no_capacity');
  }));

  test('cross-dedupes a registered product with external jobs and replays even when full', () => withTemp((_root, path) => {
    const store = new YouTubeProductRegistrationsStore(path, { allowUnsafeIsolatedClaim: true });
    const first = { idempotencyKey: 'request-key-dedupe-1', requestFingerprint: 'd'.repeat(64), familyGroupId: 'group-1', actor: 'admin', reasonCode: 'create', at };
    expect(store.claim(first).kind).toBe('claimed');
    store.complete(first.idempotencyKey, 'registered', { actor: 'admin', reasonCode: 'done', productUsid: 'Product-1', at: '2026-08-11T00:00:01.000Z' });
    const capacity = { familyCapacity: 2, externalOccupiedProductUsids: new Set([' product-1 ']), externalOccupiedFallbackCount: 0 };
    expect(store.claimWithCapacity({ ...first, idempotencyKey: 'request-key-dedupe-2', requestFingerprint: 'e'.repeat(64) }, capacity).kind).toBe('claimed');
    expect(store.claimWithCapacity(first, { ...capacity, familyCapacity: 0 }).kind).toBe('replay');
  }));

  test('failed records release capacity for a different key', () => withTemp((_root, path) => {
    const store = new YouTubeProductRegistrationsStore(path, { allowUnsafeIsolatedClaim: true });
    const capacity = { familyCapacity: 1, externalOccupiedProductUsids: new Set<string>(), externalOccupiedFallbackCount: 0 };
    const first = { idempotencyKey: 'request-key-failed-1', requestFingerprint: '1'.repeat(64), familyGroupId: 'group-1', actor: 'admin', reasonCode: 'create', at };
    expect(store.claimWithCapacity(first, capacity).kind).toBe('claimed');
    store.complete(first.idempotencyKey, 'failed', { actor: 'admin', reasonCode: 'rejected', at: '2026-08-11T00:00:01.000Z' });
    expect(store.claimWithCapacity({ ...first, idempotencyKey: 'request-key-failed-2', requestFingerprint: '2'.repeat(64) }, capacity).kind).toBe('claimed');
  }));

  test('fails busy without mutating when the verified journal lock is contended', () => withTemp((_root, path) => {
    const store = new YouTubeProductRegistrationsStore(path, { allowUnsafeIsolatedClaim: true });
    store.list();
    const lockPath = `${path}.lock`;
    const lockFd = openSync(lockPath, 'wx', 0o600);
    try {
      expect(() => store.claimWithCapacity({ idempotencyKey: 'request-key-busy-1', requestFingerprint: '3'.repeat(64), familyGroupId: 'group-1', actor: 'admin', reasonCode: 'create', at }, { familyCapacity: 1, externalOccupiedProductUsids: new Set(), externalOccupiedFallbackCount: 0 })).toThrow(/busy|unavailable/i);
      expect(store.list()).toEqual([]);
    } finally { closeSync(lockFd); rmSync(lockPath, { force: true }); }
  }));
});
