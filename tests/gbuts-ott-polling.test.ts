import { afterEach, expect, test, vi } from 'vitest';
import { emptyGbutsOttStore } from '../src/lib/gbuts-ott';
vi.mock('../src/lib/gbuts-ott-store', async importOriginal => ({
  ...await importOriginal<typeof import('../src/lib/gbuts-ott-store')>(),
  readGbutsOttStore: () => emptyGbutsOttStore(), writeGbutsOttStore: vi.fn(),
}));
vi.mock('../src/scheduler/gbuts-ott-renewal', () => ({ renewDueGbutsOttListings: vi.fn(async () => ({ renewed: 0, errors: 0 })) }));
vi.mock('../src/lib/gbuts-session', () => ({ loadGbutsSession: () => ({ token: 'fixture' }) }));
vi.mock('../src/lib/gbuts-ott-client', () => ({ createGbutsOttSellerClient: () => ({}) }));
vi.mock('../src/api/safe-mode', () => ({ loadSafeModeConfig: () => ({ enabled: false }) }));
import { startGbutsOttSync } from '../src/scheduler/gbuts-ott-sync';
import { withGbutsOttInventory } from '../src/lib/gbuts-ott-store';
import { renewDueGbutsOttListings } from '../src/scheduler/gbuts-ott-renewal';
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
test('coalesces slow polls and resumes once work finishes instead of piling queued inventory reads', async () => {
  vi.useFakeTimers(); vi.stubEnv('GBUTS_OTT_SYNC_ENABLED', 'true');
  let finish!: () => void;
  const slow = new Promise<void>(resolve => { finish = resolve; });
  const deps = { management: vi.fn(), manualMembers: () => [], access: vi.fn(), refreshAccess: vi.fn().mockImplementationOnce(() => slow).mockResolvedValue(undefined) };
  const stop = startGbutsOttSync(deps)!;
  await vi.advanceTimersByTimeAsync(1_000); expect(deps.refreshAccess).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(90_000); expect(deps.refreshAccess).toHaveBeenCalledOnce();
  finish(); await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(5_000); expect(deps.refreshAccess).toHaveBeenCalledTimes(2);
  stop(); await vi.advanceTimersByTimeAsync(90_000); expect(deps.refreshAccess).toHaveBeenCalledTimes(2);
});
test('lets queued seat observations refresh before starting the next renewal workload', async () => {
  vi.useFakeTimers(); vi.stubEnv('GBUTS_OTT_SYNC_ENABLED', 'true');
  const events: string[] = [];
  let finish!: () => void;
  const slow = new Promise<void>(resolve => { finish = resolve; });
  vi.mocked(renewDueGbutsOttListings).mockImplementationOnce(async () => { events.push('renewal'); return { renewed: 0, errors: 0 }; });
  const stop = startGbutsOttSync({ management: vi.fn(), manualMembers: () => [], access: vi.fn(), refreshAccess: () => slow })!;
  await vi.advanceTimersByTimeAsync(1000);
  const observation = withGbutsOttInventory(async () => { events.push('observation'); });
  finish(); await vi.advanceTimersByTimeAsync(0); await observation;
  expect(events.slice(0, 2)).toEqual(['observation', 'renewal']);
  stop();
});
