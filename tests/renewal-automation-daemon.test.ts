import { describe, expect, test, vi } from 'vitest';
import { renewalDaemonConfig, createSingleFlightRenewalTick } from '../src/scheduler/renewal-automation-daemon';

describe('renewal automation daemon safety config', () => {
  test('defaults disabled and dry-run with a minimum five minute interval', () => {
    expect(renewalDaemonConfig({})).toEqual({ enabled: false, live: false, dryRun: true, intervalMs: 5 * 60 * 1000 });
    expect(renewalDaemonConfig({ RENEWAL_AUTOMATION_ENABLED: 'true', RENEWAL_AUTOMATION_INTERVAL_MS: '1000' })).toEqual({ enabled: false, live: false, dryRun: true, intervalMs: 5 * 60 * 1000 });
  });

  test('manual live API flags never start the daemon without its separate enable flag', () => {
    expect(renewalDaemonConfig({ RENEWAL_AUTOMATION_ENABLED: 'true', RENEWAL_AUTOMATION_LIVE: 'true' }))
      .toEqual({ enabled: false, live: false, dryRun: true, intervalMs: 5 * 60 * 1000 });
  });

  test('daemon live requires daemon, feature, and explicit live flags', () => {
    expect(renewalDaemonConfig({ RENEWAL_AUTOMATION_DAEMON_ENABLED: 'true', RENEWAL_AUTOMATION_LIVE: 'true' }).live).toBe(false);
    expect(renewalDaemonConfig({
      RENEWAL_AUTOMATION_DAEMON_ENABLED: 'true',
      RENEWAL_AUTOMATION_ENABLED: 'true',
      RENEWAL_AUTOMATION_LIVE: 'true',
      RENEWAL_AUTOMATION_INTERVAL_MS: '600000',
    })).toEqual({ enabled: true, live: true, dryRun: false, intervalMs: 600000 });
  });

  test('single flight rejects overlap', async () => {
    let release!: () => void;
    const work = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const run = createSingleFlightRenewalTick(work);
    const first = run();
    await Promise.resolve();
    expect(await run()).toBe(false);
    release();
    expect(await first).toBe(true);
  });
});
