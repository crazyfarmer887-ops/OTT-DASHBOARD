import { afterEach, expect, test, vi } from 'vitest';
import { emptyGbutsOttStore } from '../src/lib/gbuts-ott';
vi.mock('../src/lib/gbuts-ott-store', () => ({
  readGbutsOttStore: () => emptyGbutsOttStore(), writeGbutsOttStore: vi.fn(),
  withGbutsOttInventory: (work: () => Promise<unknown>) => work(),
}));
vi.mock('../src/lib/gbuts-session', () => ({ loadGbutsSession: () => ({ token: 'fixture' }) }));
vi.mock('../src/lib/gbuts-ott-client', () => ({ createGbutsOttSellerClient: () => ({}) }));
vi.mock('../src/api/safe-mode', () => ({ loadSafeModeConfig: () => ({ enabled: false }) }));
import { startGbutsOttSync } from '../src/scheduler/gbuts-ott-sync';
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
