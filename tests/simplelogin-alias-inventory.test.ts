import { afterEach, describe, expect, test, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  SimpleLoginAliasInventory,
  SimpleLoginAliasInventoryError,
  type CachedSimpleLoginAlias,
} from '../src/lib/simplelogin-alias-inventory';

const tempDirs: string[] = [];

function testInventory(ttlMs = 600_000) {
  const dir = mkdtempSync(join(tmpdir(), 'simplelogin-inventory-'));
  tempDirs.push(dir);
  return {
    path: join(dir, 'data', 'simplelogin-alias-inventory.json'),
    inventory: new SimpleLoginAliasInventory({
      path: join(dir, 'data', 'simplelogin-alias-inventory.json'),
      ttlMs,
    }),
  };
}

afterEach(() => {
  vi.useRealTimers();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('SimpleLogin alias inventory cache', () => {
  test('uses a fresh persistent cache without calling the remote full-list loader', async () => {
    const now = Date.parse('2026-08-08T10:00:00.000Z');
    const { path, inventory } = testInventory();
    const remote = vi.fn(async (): Promise<CachedSimpleLoginAlias[]> => [
      { id: 1, email: 'first@example.com', note: 'first' },
    ]);

    await inventory.getForCreate(remote, now);
    const reloaded = new SimpleLoginAliasInventory({ path, ttlMs: 600_000 });
    const shouldNotRun = vi.fn(async () => { throw new Error('remote should not run'); });

    await expect(reloaded.getForCreate(shouldNotRun, now + 60_000)).resolves.toEqual([
      { id: 1, email: 'first@example.com', note: 'first' },
    ]);
    expect(shouldNotRun).not.toHaveBeenCalled();
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
      aliases: [{ id: 1, email: 'first@example.com', note: 'first' }],
      fetchedAt: '2026-08-08T10:00:00.000Z',
    });
  });

  test('shares one refresh across concurrent callers', async () => {
    const { inventory } = testInventory();
    let release!: (aliases: CachedSimpleLoginAlias[]) => void;
    const remote = vi.fn(() => new Promise<CachedSimpleLoginAlias[]>((resolve) => { release = resolve; }));

    const first = inventory.getForCreate(remote, 1_000);
    const second = inventory.getForCreate(remote, 1_000);
    expect(remote).toHaveBeenCalledTimes(1);
    release([{ id: 2, email: 'shared@example.com' }]);

    await expect(Promise.all([first, second])).resolves.toEqual([
      [{ id: 2, email: 'shared@example.com' }],
      [{ id: 2, email: 'shared@example.com' }],
    ]);
  });

  test('atomically appends an exact created alias while preserving fetchedAt and prior aliases', async () => {
    const now = Date.parse('2026-08-08T10:00:00.000Z');
    const { path, inventory } = testInventory();
    await inventory.getForCreate(async () => [{ id: 1, email: 'old@example.com' }], now);

    inventory.appendCreated({ id: 7, email: 'Created@Example.com', note: ' exact note ' });

    expect(existsSync(path)).toBe(true);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
      aliases: [
        { id: 1, email: 'old@example.com' },
        { id: 7, email: 'created@example.com', note: 'exact note' },
      ],
      fetchedAt: '2026-08-08T10:00:00.000Z',
    });
    expect(existsSync(`${path}.tmp`)).toBe(false);
  });

  test('fails closed with a structured retriable error when stale-cache refresh is rate limited', async () => {
    const now = Date.parse('2026-08-08T10:00:00.000Z');
    const { inventory } = testInventory(1_000);
    await inventory.getForCreate(async () => [{ id: 1, email: 'known@example.com' }], now);
    const remote = vi.fn(async () => {
      throw new SimpleLoginAliasInventoryError({
        code: 'SIMPLELOGIN_ALIAS_INVENTORY_RATE_LIMITED',
        status: 503,
        retryAfterMs: 12_000,
        message: 'SimpleLogin alias inventory refresh rate limited',
      });
    });

    const error = await inventory.getForCreate(remote, now + 2_000).catch((caught) => caught);

    expect(error).toBeInstanceOf(SimpleLoginAliasInventoryError);
    expect(error).toMatchObject({
      code: 'SIMPLELOGIN_ALIAS_INVENTORY_RATE_LIMITED',
      status: 503,
      retryAfterMs: 12_000,
    });
    expect(remote).toHaveBeenCalledTimes(1);
  });
});
