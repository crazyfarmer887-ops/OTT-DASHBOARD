type EnvLike = Record<string, string | undefined>;

export interface RenewalDaemonConfig {
  enabled: boolean;
  live: boolean;
  dryRun: boolean;
  intervalMs: number;
}

export function renewalDaemonConfig(env: EnvLike = process.env): RenewalDaemonConfig {
  const featureEnabled = env.RENEWAL_AUTOMATION_ENABLED === 'true';
  const enabled = featureEnabled && env.RENEWAL_AUTOMATION_DAEMON_ENABLED === 'true';
  const live = enabled && env.RENEWAL_AUTOMATION_LIVE === 'true';
  const rawInterval = Number(env.RENEWAL_AUTOMATION_INTERVAL_MS || 5 * 60 * 1000);
  const intervalMs = Number.isFinite(rawInterval) ? Math.max(5 * 60 * 1000, Math.floor(rawInterval)) : 5 * 60 * 1000;
  return { enabled, live, dryRun: !live, intervalMs };
}

export function createSingleFlightRenewalTick(work: () => Promise<void>): () => Promise<boolean> {
  let running = false;
  return async () => {
    if (running) return false;
    running = true;
    try { await work(); return true; }
    finally { running = false; }
  };
}

export function startRenewalAutomationDaemon(port: number): void {
  const config = renewalDaemonConfig();
  if (!config.enabled) {
    console.log('[RenewalAutomation] 비활성화됨');
    return;
  }
  const token = String(process.env.AIO_ADMIN_TOKEN || '').trim();
  if (!token) {
    console.warn('[RenewalAutomation] AIO_ADMIN_TOKEN 없음 — 시작하지 않음');
    return;
  }
  const run = createSingleFlightRenewalTick(async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/renewal-automation/tick`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ dryRun: config.dryRun }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!response.ok) console.warn(`[RenewalAutomation] tick 실패 HTTP ${response.status}`);
    } catch (error: any) {
      console.warn('[RenewalAutomation] tick 실패:', String(error?.message || 'unknown').slice(0, 120));
    }
  });
  setTimeout(() => { void run(); }, 30_000);
  setInterval(() => { void run(); }, config.intervalMs);
  console.log(`[RenewalAutomation] 시작됨 (${config.dryRun ? 'dry-run' : 'LIVE'}, ${config.intervalMs}ms)`);
}
