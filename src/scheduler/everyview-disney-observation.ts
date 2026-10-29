import { createHash } from 'node:crypto';
import { collectEveryviewDisneyObservation, type EveryviewDisneyBinding, type EveryviewDisneyObservation } from '../lib/everyview-disney-observation';

export interface EveryviewDisneyWatchConfig { enabled: boolean; parties: EveryviewDisneyBinding[] }
export interface EveryviewDisneyWatchState {
  version: 1;
  lastSuccess?: string;
  lastError?: 'SESSION_REQUIRED' | 'PARTY_READ_UNAVAILABLE' | 'PARTY_BINDING_UNVERIFIED' | 'ROSTER_INCOMPLETE' | 'OBSERVATION_FAILED';
  parties: Record<string, { accountHash: string; observedAt: string; visibleEmptySlots: number;
    members: Record<string, { userSeq: number; firstObservedAt: string; lastObservedAt: string; currentlyVisible: boolean }> }>;
}
export interface EveryviewDisneyWatchDeps {
  config(): EveryviewDisneyWatchConfig | null;
  read(): EveryviewDisneyWatchState;
  write(state: EveryviewDisneyWatchState): void;
  cookie(): string | null;
  safeToRun(): boolean;
  observe(cookie: string, binding: EveryviewDisneyBinding, now: Date): Promise<EveryviewDisneyObservation>;
  alert(reason: EveryviewDisneyWatchState['lastError']): Promise<unknown>;
  now(): Date;
}
const hashAccount = (email: string) => createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
const errorCode = (error: unknown): NonNullable<EveryviewDisneyWatchState['lastError']> => {
  const code = error instanceof Error ? error.message : '';
  return ['SESSION_REQUIRED', 'PARTY_READ_UNAVAILABLE', 'PARTY_BINDING_UNVERIFIED', 'ROSTER_INCOMPLETE'].includes(code)
    ? code as NonNullable<EveryviewDisneyWatchState['lastError']> : 'OBSERVATION_FAILED';
};

/**
 * Atomic observation cycle. Unseen buyers stay in the journal as reserved;
 * absence from a roster alone never proves a refund or frees their seat.
 * This is intentionally read-only on the marketplace: safe recruitment-count
 * semantics have not yet been verified, so it cannot close or edit a party.
 */
export async function runEveryviewDisneyObservation(deps: EveryviewDisneyWatchDeps): Promise<'paused'|'checked'|'error'> {
  const config = deps.config();
  if (!config?.enabled || !deps.safeToRun()) return 'paused';
  // A pre-armed configuration can have no provider IDs before the first POST.
  if (Array.isArray(config.parties) && config.parties.length === 0) return 'paused';
  const previous = deps.read();
  try {
    if (!Array.isArray(config.parties) || !config.parties.length
      || new Set(config.parties.map(p => p.partyId)).size !== config.parties.length) throw Error('BINDING_INVALID');
    const cookie = deps.cookie(); if (!cookie) throw Error('SESSION_REQUIRED');
    const at = deps.now();
    const snapshots: EveryviewDisneyObservation[] = [];
    for (const binding of config.parties) snapshots.push(await deps.observe(cookie, binding, at));
    if (!deps.safeToRun() || JSON.stringify(deps.config()) !== JSON.stringify(config)) return 'paused';
    const next: EveryviewDisneyWatchState = structuredClone(previous);
    for (let i = 0; i < config.parties.length; i++) {
      const binding = config.parties[i], snapshot = snapshots[i], key = String(binding.partyId), accountHash = hashAccount(binding.accountEmail);
      if (snapshot.partyId !== binding.partyId || (next.parties[key] && next.parties[key].accountHash !== accountHash)) throw Error('PARTY_BINDING_UNVERIFIED');
      const prior = next.parties[key]?.members || {};
      const members = Object.fromEntries(Object.entries(prior).map(([k,v]) => [k, { ...v, currentlyVisible: false }]));
      for (const member of snapshot.members) {
        const id = String(member.memberSeq), existing = members[id];
        if (existing && existing.userSeq !== member.userSeq) throw Error('PARTY_BINDING_UNVERIFIED');
        members[id] = { userSeq: member.userSeq, firstObservedAt: existing?.firstObservedAt || snapshot.observedAt,
          lastObservedAt: snapshot.observedAt, currentlyVisible: true };
      }
      next.parties[key] = { accountHash, observedAt: snapshot.observedAt, visibleEmptySlots: snapshot.visibleEmptySlots, members };
    }
    next.lastSuccess = at.toISOString(); delete next.lastError; deps.write(next); return 'checked';
  } catch (error) {
    const code = errorCode(error);
    deps.write({ ...previous, lastError: code });
    if (previous.lastError !== code) await deps.alert(code).catch(() => undefined);
    return 'error';
  }
}

/** Single in-process periodic runner; callers must supply a private journal. */
export function startEveryviewDisneyObservation(deps: Omit<EveryviewDisneyWatchDeps, 'observe'> & { observe?: EveryviewDisneyWatchDeps['observe'] }, intervalMs = 30_000) {
  let running = false;
  const run = () => {
    if (running) return;
    running = true;
    void runEveryviewDisneyObservation({ ...deps, observe: deps.observe || collectEveryviewDisneyObservation }).finally(() => { running = false; });
  };
  const first = setTimeout(run, 5000), timer = setInterval(run, intervalMs);
  first.unref(); timer.unref();
  return () => { clearTimeout(first); clearInterval(timer); };
}
