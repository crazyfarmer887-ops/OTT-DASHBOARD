import { existsSync, readFileSync } from 'node:fs';
import { writeJsonAtomic } from './graytag-sales-session';
import type { LinkidProfile, LinkidSnapshot } from './linkid-client';
export type LinkidEvent = { key: string; profileIndex: number; kind: 'notice' | 'chat'; title: string; partyId: number; date: string;
  message?: string; buyerName?: string };
export type LinkidAccount = { id: string; label: string; enabled: boolean; connectedAt: string;
  credentials: { sid: string; provider: string; providerId: string }; profiles: LinkidProfile[];
  snapshots: Record<string, LinkidSnapshot>; seen: Record<string, string>; pending: LinkidEvent[];
  lastScanStartedAt?: string; lastSuccess?: string; lastError?: string; retryAfter?: number; profileErrors?: Record<string, string>;
  firstFailureAt?: string; consecutiveFailures?: number };
export type LinkidStore = { version: 1; accounts: LinkidAccount[] };
export function linkidStorePath(): string { return process.env.LINKID_STORE_PATH || '/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data/linkid-accounts.json'; }
export function readLinkidStore(path = linkidStorePath()): LinkidStore {
  if (!existsSync(path)) return { version: 1, accounts: [] };
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  if (raw.version !== 1 || !Array.isArray(raw.accounts) || raw.accounts.some((a: any) =>
    typeof a.id !== 'string' || typeof a.label !== 'string' || typeof a.enabled !== 'boolean' || !Number.isFinite(Date.parse(a.connectedAt))
    || typeof a.credentials?.sid !== 'string' || typeof a.credentials?.provider !== 'string' || typeof a.credentials?.providerId !== 'string'
    || !Array.isArray(a.profiles) || !a.profiles.length || a.profiles.length > 5 || !a.snapshots || !a.seen || !Array.isArray(a.pending)))
    throw new Error('링키드 연결 기록을 읽지 못했습니다. 기존 기록을 보존하고 점검이 필요합니다.');
  return raw;
}
export function writeLinkidStore(store: LinkidStore, path = linkidStorePath()): void { writeJsonAtomic(path, store); }
export function publicLinkidStore(store: LinkidStore) {
  return { enabled: process.env.LINKID_SYNC_ENABLED !== 'false', intervalSeconds: 180,
    accounts: store.accounts.map(({ credentials: _credentials, seen: _seen, pending, ...account }) => ({ ...account,
      pendingAlerts: pending.length, snapshots: Object.fromEntries(Object.entries(account.snapshots).map(([key, value]) => [key, {
        ...value, notices: value.notices.slice(0, 100), rooms: value.rooms.map(room => ({ ...room, messages: room.messages.slice(0, 100) })),
      }])) })) };
}
let queue: Promise<unknown> = Promise.resolve();
export function withLinkidLock<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work); queue = next.catch(() => undefined); return next;
}
