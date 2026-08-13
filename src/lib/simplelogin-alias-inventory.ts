import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import { basename, dirname, join } from 'node:path';

export interface CachedSimpleLoginAlias {
  id: string | number;
  email: string;
  note?: string;
}

interface SimpleLoginAliasInventoryFile {
  aliases: CachedSimpleLoginAlias[];
  fetchedAt: string;
}

export interface SimpleLoginAliasInventoryErrorInput {
  code: string;
  status: number;
  message: string;
  retryAfterMs?: number;
}

export class SimpleLoginAliasInventoryError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryAfterMs?: number;

  constructor(input: SimpleLoginAliasInventoryErrorInput) {
    super(input.message);
    this.name = 'SimpleLoginAliasInventoryError';
    this.code = input.code;
    this.status = input.status;
    this.retryAfterMs = input.retryAfterMs;
  }
}

export interface SimpleLoginAliasInventoryOptions {
  path: string;
  ttlMs?: number;
}

export const DEFAULT_SIMPLELOGIN_ALIAS_INVENTORY_TTL_MS = 10 * 60 * 1_000;

function cleanAlias(value: unknown): CachedSimpleLoginAlias | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  const id = input.id;
  const email = String(input.email || '').trim().toLowerCase();
  if ((typeof id !== 'string' && typeof id !== 'number') || (typeof id === 'string' && !id.trim()) || !email.includes('@')) return null;
  const note = typeof input.note === 'string'
    ? input.note.replace(/[\u0000-\u001f\u007f]/g, '').trim()
    : '';
  return note ? { id, email, note } : { id, email };
}

function cleanAliases(values: unknown): CachedSimpleLoginAlias[] {
  if (!Array.isArray(values)) return [];
  const byEmail = new Map<string, CachedSimpleLoginAlias>();
  for (const value of values) {
    const alias = cleanAlias(value);
    if (alias) byEmail.set(alias.email, alias);
  }
  return Array.from(byEmail.values());
}

function readCache(path: string): SimpleLoginAliasInventoryFile | null {
  try {
    if (!existsSync(path)) return null;
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<SimpleLoginAliasInventoryFile>;
    const fetchedAtMs = Date.parse(String(parsed.fetchedAt || ''));
    if (!Number.isFinite(fetchedAtMs) || !Array.isArray(parsed.aliases)) return null;
    return { aliases: cleanAliases(parsed.aliases), fetchedAt: new Date(fetchedAtMs).toISOString() };
  } catch {
    return null;
  }
}

function writeCacheAtomically(path: string, cache: SimpleLoginAliasInventoryFile): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tempPath = join(dir, `.${basename(path)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
  let fd: number | undefined;
  try {
    fd = openSync(tempPath, 'wx', 0o600);
    writeFileSync(fd, JSON.stringify(cache, null, 2), 'utf8');
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(tempPath, path);
    chmodSync(path, 0o600);
  } catch (error) {
    if (fd !== undefined) closeSync(fd);
    try { unlinkSync(tempPath); } catch { /* best effort */ }
    throw error;
  }
}

export class SimpleLoginAliasInventory {
  private readonly path: string;
  private readonly ttlMs: number;
  private cached: SimpleLoginAliasInventoryFile | null = null;
  private refreshInFlight: Promise<CachedSimpleLoginAlias[]> | null = null;

  constructor(options: SimpleLoginAliasInventoryOptions) {
    this.path = options.path;
    this.ttlMs = options.ttlMs ?? DEFAULT_SIMPLELOGIN_ALIAS_INVENTORY_TTL_MS;
  }

  private current(): SimpleLoginAliasInventoryFile | null {
    if (!this.cached) this.cached = readCache(this.path);
    return this.cached;
  }

  async getForCreate(
    loadFullInventory: () => Promise<CachedSimpleLoginAlias[]>,
    nowMs = Date.now(),
  ): Promise<CachedSimpleLoginAlias[]> {
    const current = this.current();
    if (current && nowMs - Date.parse(current.fetchedAt) <= this.ttlMs) {
      return current.aliases.map((alias) => ({ ...alias }));
    }
    if (this.refreshInFlight) return this.refreshInFlight;

    this.refreshInFlight = (async () => {
      const aliases = cleanAliases(await loadFullInventory());
      const next = { aliases, fetchedAt: new Date(nowMs).toISOString() };
      writeCacheAtomically(this.path, next);
      this.cached = next;
      return aliases.map((alias) => ({ ...alias }));
    })().finally(() => {
      this.refreshInFlight = null;
    });
    return this.refreshInFlight;
  }

  appendCreated(aliasInput: CachedSimpleLoginAlias): void {
    const alias = cleanAlias(aliasInput);
    if (!alias) throw new Error('Cannot cache invalid SimpleLogin alias');
    const current = this.current();
    if (!current) throw new Error('Cannot append SimpleLogin alias without a successful inventory cache');
    const aliases = current.aliases.filter((item) => item.email !== alias.email && String(item.id) !== String(alias.id));
    aliases.push(alias);
    const next = { aliases, fetchedAt: current.fetchedAt };
    writeCacheAtomically(this.path, next);
    this.cached = next;
  }
}
