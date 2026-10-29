import { applyDedicatedEveryviewDisneySeat, type EveryviewDedicatedSeatEvidence } from '../lib/everyview-disney-inventory-bridge';
import type { GbutsOttStore } from '../lib/gbuts-ott';
import type { EveryviewDisneyWatchState } from './everyview-disney-observation';

export interface DisneyDedicatedBridgeConfig {
  enabled: boolean;
  bindings: Array<{ partyId: number; accountEmail: string; profileNumber: number }>;
}
export interface DisneyDedicatedBridgeDeps {
  config(): DisneyDedicatedBridgeConfig | null;
  readWatch(): EveryviewDisneyWatchState;
  /** Must serialize with all GButs inventory reads and writes. */
  withInventory<T>(fn: () => Promise<T>): Promise<T>;
  readInventory(): GbutsOttStore;
  writeInventory(store: GbutsOttStore): void;
  /** Seller identity, capacity and ad visibility must be provider-verified. */
  evidence(binding: DisneyDedicatedBridgeConfig['bindings'][number], watch: EveryviewDisneyWatchState): Promise<EveryviewDedicatedSeatEvidence | undefined>;
  safeToRun(): boolean;
  alert(code: 'SNAPSHOT_INCOMPLETE'|'BINDING_UNVERIFIED'): Promise<unknown>;
  now(): Date;
}

/**
 * Prepares fail-closed snapshots only. This does not publish, change
 * recruitment, infer a refund, or turn a missing mapping into a new one.
 * Its runtime is deliberately not registered until the real evidence reader
 * and both platforms' publication controls have been verified.
 */
export async function runDisneyDedicatedBridge(deps: DisneyDedicatedBridgeDeps): Promise<'paused'|'checked'|'held'> {
  const config = deps.config();
  if (!config?.enabled || !deps.safeToRun()) return 'paused';
  const bindings = config.bindings;
  if (!Array.isArray(bindings) || !bindings.length || bindings.some(x => !x || typeof x.accountEmail !== 'string')
    || new Set(bindings.map(x => x.partyId)).size !== bindings.length
    || new Set(bindings.map(x => `${x.accountEmail.trim().toLowerCase()}:${x.profileNumber}`)).size !== bindings.length) {
    await deps.alert('BINDING_UNVERIFIED').catch(() => undefined); return 'held';
  }
  const watch = deps.readWatch();
  // Failed evidence collection is recorded as incomplete; previous reservations
  // remain held and are never re-created as empty seats.
  const evidence: Array<EveryviewDedicatedSeatEvidence | undefined> = [];
  for (const binding of bindings) {
    try { evidence.push(await deps.evidence(binding, watch)); } catch { evidence.push(undefined); }
  }
  try {
    const result = await deps.withInventory(async (): Promise<'paused'|'checked'|'held'> => {
      if (!deps.safeToRun() || JSON.stringify(deps.config()) !== JSON.stringify(config)) return 'paused';
      const at = deps.now();
      let store = deps.readInventory(), complete = true;
      for (let i=0;i<bindings.length;i++) {
        const binding=bindings[i], applied=applyDedicatedEveryviewDisneySeat({ store, ...binding, watch, evidence:evidence[i], now:at });
        store=applied.store; complete &&= applied.complete;
      }
      if (!deps.safeToRun() || JSON.stringify(deps.config()) !== JSON.stringify(config)) return 'paused';
      deps.writeInventory(store);
      return complete ? 'checked' : 'held';
    });
    if (result === 'held') await deps.alert('SNAPSHOT_INCOMPLETE').catch(() => undefined);
    return result;
  } catch {
    await deps.alert('BINDING_UNVERIFIED').catch(() => undefined); return 'held';
  }
}
