import { monitorNba, nbaMonitorRuntime } from '../src/monitoring/nba-monitor';
import { sendSellerAlert } from '../src/alerts/telegram';
if (process.env.NBA_MONITOR_ENABLED !== 'true') process.exit(0);
if (!process.env.SELLER_ALERT_TELEGRAM_LINKID_THREAD_ID) throw new Error('NBA_LINKID_TOPIC_REQUIRED');
try {
  await monitorNba(nbaMonitorRuntime);
  const state = nbaMonitorRuntime.read();
  console.log(JSON.stringify({ checked: Object.keys(state.targets).length, results: Object.values(state.targets).map(t => ({ checkedAt: t.checkedAt, result: t.result })) }));
} catch {
  await sendSellerAlert({ provider: 'linkid', category: 'system', key: 'nba-monitor-source', title: 'NBA 자동 점검 연결 확인 필요',
    body: 'NBA 점검 대상 계정 정보를 읽지 못했습니다. 링키드 연결과 서버 점검 기록을 확인해주세요.',
    actionUrl: 'https://email-verify.one/dashboard/linkid', throttleMs: 24 * 3600000 });
  console.error('NBA_MONITOR_SOURCE_OR_STATE_ERROR'); process.exitCode = 1;
}
