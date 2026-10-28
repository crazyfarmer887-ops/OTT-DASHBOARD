import { existsSync, readFileSync } from 'node:fs';
const directory = '/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data';
export const everyviewSpotifyConfigPath = () => process.env.EVERYVIEW_SPOTIFY_CONFIG_PATH || `${directory}/everyview-spotify-config.json`;
export const everyviewSpotifyStatusPath = () => process.env.EVERYVIEW_SPOTIFY_STATUS_PATH || `${directory}/everyview-spotify-status.json`;
const configPath = everyviewSpotifyConfigPath, statusPath = everyviewSpotifyStatusPath;

export interface EveryviewSpotifyConfig {
  version: 1; enabled: boolean; sellerUserSeq: number; partyIds: number[];
  heldOrders: string[];
  historicalBuyerAt: Record<string, string>;
  acknowledgementsAfter?: string;
}
export function readEveryviewSpotifyConfig(): EveryviewSpotifyConfig | null {
  if (!existsSync(configPath())) return null;
  const c = JSON.parse(readFileSync(configPath(), 'utf8')) as EveryviewSpotifyConfig;
  const key = /^everyview:[1-9]\d*:[1-9]\d*$/;
  if (c.version !== 1 || typeof c.enabled !== 'boolean' || !Number.isSafeInteger(c.sellerUserSeq) || c.sellerUserSeq < 1
    || !Array.isArray(c.partyIds) || !c.partyIds.length || c.partyIds.some(x => !Number.isSafeInteger(x) || x < 1)
    || new Set(c.partyIds).size !== c.partyIds.length || !Array.isArray(c.heldOrders) || c.heldOrders.some(x => !key.test(x))
    || !c.historicalBuyerAt || typeof c.historicalBuyerAt !== 'object'
    || (c.acknowledgementsAfter !== undefined && !Number.isFinite(Date.parse(c.acknowledgementsAfter)))
    || Object.entries(c.historicalBuyerAt).some(([k, v]) => !key.test(k) || !Number.isFinite(Date.parse(v))))
    throw new Error('Everyview Spotify configuration invalid');
  return c;
}

export interface EveryviewSpotifyStatus { enabled: boolean; state: string; checkedAt?: string; held?: number; historical?: number; parties?: number; awaitingPartner?: number; workerHealthy: boolean }

export function getEveryviewSpotifyStatus(): EveryviewSpotifyStatus {
  const config = readEveryviewSpotifyConfig();
  if (!existsSync(statusPath())) return { enabled: config?.enabled ?? false, state: 'waiting', workerHealthy: false };
  const s = JSON.parse(readFileSync(statusPath(), 'utf8')) as { state: string; checkedAt: string; held?: number; historical?: number; parties?: number; awaitingPartner?: number };
  return { enabled: config?.enabled ?? false, state: s.state, checkedAt: s.checkedAt,
    held: s.held || 0, historical: s.historical || 0, parties: s.parties || 0,
    awaitingPartner: s.awaitingPartner || 0,
    workerHealthy: ['checked', 'needs_mapping', 'awaiting_partner'].includes(s.state) && Date.now() - Date.parse(s.checkedAt) < 120_000 };
}

