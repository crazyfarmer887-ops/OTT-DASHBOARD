import { existsSync, readFileSync } from 'node:fs';
import { sendSellerAlert } from '../alerts/telegram';
import { loadGbutsSession } from '../lib/gbuts-session';
import { spotifyPostSeqs } from '../lib/gbuts-spotify-listings';
import { createEveryviewSpotifyClient, everyviewSpotifyOrderKey } from '../lib/everyview-spotify';
import { loadEveryviewCookieHeader } from '../lib/everyview-api';
import { readEveryviewSpotifyConfig } from '../lib/everyview-spotify-store';
import { writeJsonAtomic } from '../lib/graytag-sales-session';
import { loadSafeModeConfig } from '../api/safe-mode';
import { createGbutsSpotifyNotionClient, createGbutsSpotifySellerClient } from './gbuts-spotify-sync';
import { readGbutsSpotifyMessageJournal } from './gbuts-spotify-messages';
import { everyviewOrderEligibility } from './everyview-spotify-sync';
import { createSingleFlightRunner } from './poll-daemon';
import { collectSpotifyDeliveryScan, flushSpotifyDeliveryAlerts, reconcileSpotifyDeliveryIncidents,
  type SpotifyDeliveryMonitorJournal, type SpotifyDeliveryReadSource } from './spotify-delivery-monitor';

const root = '/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data';
export const spotifyDeliveryMonitorPath = () => process.env.SPOTIFY_DELIVERY_MONITOR_STATE_PATH || `${root}/spotify-delivery-monitor.json`;
export function readSpotifyDeliveryMonitor(): SpotifyDeliveryMonitorJournal {
  if (!existsSync(spotifyDeliveryMonitorPath())) return { version: 1, activatedAt: new Date().toISOString(), incidents: {} };
  const j = JSON.parse(readFileSync(spotifyDeliveryMonitorPath(), 'utf8')) as SpotifyDeliveryMonitorJournal;
  if (j.version !== 1 || !Number.isFinite(Date.parse(j.activatedAt)) || !j.incidents || typeof j.incidents !== 'object'
    || Array.isArray(j.incidents) || Object.entries(j.incidents).some(([key, i]) => !i || i.issue?.key !== key
      || typeof i.issue.scope !== 'string' || !Number.isFinite(i.firstSeenAt) || !Number.isFinite(i.lastSeenAt)
      || !Number.isSafeInteger(i.observations) || i.observations < 1)) throw Error('Spotify delivery monitor journal invalid');
  return j;
}
const write = (j: SpotifyDeliveryMonitorJournal) => writeJsonAtomic(spotifyDeliveryMonitorPath(), j);
function uncertainOrders(path?: string): Set<string> {
  return new Set(Object.entries(readGbutsSpotifyMessageJournal(path).records)
    .filter(([key, r]) => r.state === 'attempted' && /:(?:registered-)?invited:/.test(key))
    .map(([key]) => key.replace(/:(?:registered-)?invited:[^:]+$/, '')));
}

/** Server read-only preflight is also available without enabling Telegram dispatch. */
export async function collectProductionSpotifyDeliveryScan(activatedAt: string) {
  const sources: SpotifyDeliveryReadSource[] = [];
  if (process.env.GBUTS_SPOTIFY_SYNC_ENABLED === 'true') {
    const token = loadGbutsSession()?.token || process.env.GBUTS_API_TOKEN || '';
    const p = createGbutsSpotifySellerClient(token);
    sources.push({ ...p, platform: 'gbuts', posts: async () => {
      if (!token || process.env.GBUTS_SPOTIFY_AUTO_MESSAGE_ENABLED !== 'true') throw Error('Automatic delivery unavailable');
      return spotifyPostSeqs();
    }, uncertainOrders: () => uncertainOrders() });
  }
  const config = readEveryviewSpotifyConfig();
  if (config?.enabled) {
    const p = createEveryviewSpotifyClient(loadEveryviewCookieHeader() || '', config.sellerUserSeq,
      () => { throw Error('Delivery monitor forbids buyer SEND'); });
    sources.push({ ...p, platform: 'everyview', posts: async () => config.partyIds,
      uncertainOrders: () => uncertainOrders(`${root}/everyview-spotify-messages.json`),
      eligibility: (post, member, messages, rows) => everyviewOrderEligibility(config,
        everyviewSpotifyOrderKey(post, member), member.userSeq, messages, rows) });
  }
  const notion = createGbutsSpotifyNotionClient(process.env.NOTION_API_TOKEN || '', process.env.NOTION_SPOTIFY_DATA_SOURCE_ID || undefined);
  return { ...await collectSpotifyDeliveryScan({ listRows: notion.listRows, sources, activatedAt }),
    monitoredPlatforms: sources.map(s => s.platform) };
}

const sendAlert = (input: Parameters<typeof sendSellerAlert>[0]) => sendSellerAlert({ ...input,
  fetchImpl: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(10_000) }) });

export async function runSpotifyDeliveryMonitorOnce() {
  if (process.env.SPOTIFY_DELIVERY_ALERTS_ENABLED !== 'true' || loadSafeModeConfig().enabled) return;
  let journal = readSpotifyDeliveryMonitor();
  // Persist activation before any network request, so restarts never move the baseline.
  write(journal);
  const scan = await collectProductionSpotifyDeliveryScan(journal.activatedAt);
  if (process.env.SPOTIFY_DELIVERY_ALERTS_ENABLED !== 'true' || loadSafeModeConfig().enabled) return;
  journal.incidents = Object.fromEntries(Object.entries(journal.incidents).filter(([, i]) =>
    i.issue.platform ? scan.monitoredPlatforms.includes(i.issue.platform) : scan.monitoredPlatforms.length > 0));
  journal = reconcileSpotifyDeliveryIncidents(journal, scan, Date.now()); write(journal);
  const sent = await flushSpotifyDeliveryAlerts({ read: readSpotifyDeliveryMonitor, write,
    send: sendAlert, nowMs: Date.now() });
  console.log('[SpotifyDeliveryMonitor] completed', { issues: scan.issues.length, alerts: sent });
}

export function startSpotifyDeliveryMonitor(): void {
  if (process.env.SPOTIFY_DELIVERY_ALERTS_ENABLED !== 'true') return;
  const run = createSingleFlightRunner(async () => {
    try { await runSpotifyDeliveryMonitorOnce(); }
    catch {
      console.error('[SpotifyDeliveryMonitor] check failed');
      if (!loadSafeModeConfig().enabled) await sendAlert({ key: 'spotify-delivery-monitor-unavailable',
        title: 'Spotify 자동 전달 감시 확인 필요', body: '에브리뷰·벗츠 전달 누락 감시를 완료하지 못했습니다. 서버 연결과 감시 기록을 확인해주세요.',
        category: 'system', severity: 'warning', throttleMs: 30 * 24 * 60 * 60_000 });
    }
  });
  setTimeout(() => { void run(); setInterval(() => { void run(); }, 60_000); }, 20_000);
}
