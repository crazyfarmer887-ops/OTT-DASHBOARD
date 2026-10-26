import { monitorNba, nbaMonitorRuntime } from '../src/monitoring/nba-monitor';
if (process.env.NBA_MONITOR_ENABLED !== 'true') process.exit(0);
if (!process.env.SELLER_ALERT_TELEGRAM_LINKID_THREAD_ID) throw new Error('NBA_LINKID_TOPIC_REQUIRED');
try {
  await monitorNba(nbaMonitorRuntime);
  const state = nbaMonitorRuntime.read();
  console.log(JSON.stringify({ checked: Object.keys(state.targets).length, results: Object.values(state.targets).map(t => ({ checkedAt: t.checkedAt, result: t.result })) }));
} catch {
  console.error('NBA_MONITOR_SOURCE_OR_STATE_ERROR'); process.exitCode = 1;
}
