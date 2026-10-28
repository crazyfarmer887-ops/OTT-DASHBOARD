import { existsSync, readFileSync } from 'node:fs';
import { createEveryviewSpotifyClient, everyviewSpotifyOrderKey } from '../lib/everyview-spotify';
import { loadEveryviewCookieHeader } from '../lib/everyview-api';
import { writeJsonAtomic } from '../lib/graytag-sales-session';
import { loadSafeModeConfig } from '../api/safe-mode';
import { extractGbutsCredentialsWithOpenRouter } from '../api/notion-chat-extraction';
import { createSingleFlightRunner, runWithExclusivePollLock } from './poll-daemon';
import { createGbutsSpotifyNotionClient, syncGbutsSpotifyPosts, type SpotifyNotionRow } from './gbuts-spotify-sync';
import { readGbutsSpotifyMessageJournal, syncGbutsSpotifyMessages, writeGbutsSpotifyMessageJournal } from './gbuts-spotify-messages';
import { getOrCreateSpotifyNewAccountCredentials } from './spotify-new-account-credentials';
import type { GbutsChatMessage, GbutsSpotifyMember } from '../lib/gbuts-spotify';

const directory = '/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data';
export const spotifySyncLockPath = () => process.env.SPOTIFY_NOTION_SYNC_LOCK_PATH || `${directory}/spotify-notion-sync.lock`;
import { readEveryviewSpotifyConfig, everyviewSpotifyConfigPath as configPath, everyviewSpotifyStatusPath as statusPath, type EveryviewSpotifyConfig } from '../lib/everyview-spotify-store';
export type { EveryviewSpotifyConfig } from '../lib/everyview-spotify-store';
const journalPath = () => process.env.EVERYVIEW_SPOTIFY_MESSAGE_JOURNAL_PATH || `${directory}/everyview-spotify-messages.json`;
const accountPath = () => process.env.EVERYVIEW_SPOTIFY_NEW_ACCOUNTS_PATH || `${directory}/everyview-spotify-new-accounts.json`;
const creationPath = () => process.env.EVERYVIEW_SPOTIFY_NOTION_CREATIONS_PATH || `${directory}/everyview-spotify-notion-creations.json`;
type CreationJournal = { version: 1; orders: Record<string, { state: 'attempted' | 'confirmed'; pageId?: string; updatedAt: string }> };

export async function guardEveryviewNotionCreation(key: string, create: () => Promise<SpotifyNotionRow>,
  deps: { listRows(): Promise<SpotifyNotionRow[]>; read(): CreationJournal; write(value: CreationJournal): void }): Promise<SpotifyNotionRow> {
  const existing = (await deps.listRows()).filter(r => r.orderKey === key);
  if (existing.length > 1) throw new Error('Everyview Notion order identity ambiguous');
  const journal = deps.read();
  if (existing.length === 1) {
    journal.orders[key] = { state: 'confirmed', pageId: existing[0].id, updatedAt: new Date().toISOString() };
    deps.write(journal); return existing[0];
  }
  if (journal.orders[key]) throw new Error('Everyview Notion creation uncertain; query recovery required');
  journal.orders[key] = { state: 'attempted', updatedAt: new Date().toISOString() }; deps.write(journal);
  const row = await create();
  if (row.orderKey !== key) throw new Error('Everyview Notion creation identity invalid');
  journal.orders[key] = { state: 'confirmed', pageId: row.id, updatedAt: new Date().toISOString() }; deps.write(journal);
  return row;
}

/** Historical completed conversations are left quiet; an explicit order binding releases a held request. */
export function everyviewOrderEligibility(config: EveryviewSpotifyConfig, key: string, buyer: number,
  messages: readonly GbutsChatMessage[], rows: readonly SpotifyNotionRow[]): 'active' | 'held' | 'historical' {
  if (config.heldOrders.includes(key) && !rows.some(r => r.orderKey === key && !r.cancelled)) return 'held';
  const cutoff = config.historicalBuyerAt[key];
  if (cutoff && !messages.some(m => m.senderSeq === buyer && m.messageType === 'TEXT' && Date.parse(m.createdAt) > Date.parse(cutoff)))
    return 'historical';
  return 'active';
}

export async function runEveryviewSpotifyCycle() {
  const config = readEveryviewSpotifyConfig();
  if (!config?.enabled || loadSafeModeConfig().enabled) {
    const status = { state: 'paused', checkedAt: new Date().toISOString(), held: 0, historical: 0 };
    writeJsonAtomic(statusPath(), status); return status;
  }
  const cookie = loadEveryviewCookieHeader(), token = process.env.NOTION_API_TOKEN?.trim();
  if (!cookie || !token) throw new Error('Everyview Spotify session or Notion connection unavailable');
  const assertSendingAllowed = () => {
    if (loadSafeModeConfig().enabled || JSON.stringify(readEveryviewSpotifyConfig()) !== JSON.stringify(config))
      throw new Error('Everyview Spotify sending paused');
  };
  const provider = createEveryviewSpotifyClient(cookie, config.sellerUserSeq, assertSendingAllowed);
  const notion = createGbutsSpotifyNotionClient(token, process.env.NOTION_SPOTIFY_DATA_SOURCE_ID || undefined,
    fetch, key => {
      if (!/^everyview:[1-9]\d*:[1-9]\d*$/.test(key)) throw new Error('Everyview Spotify credential identity invalid');
      return getOrCreateSpotifyNewAccountCredentials(key.slice('everyview:'.length), accountPath());
    }, 'Everyview order ID');
  const rows = await notion.listRows();
  const eligible = new Map<number, Set<number>>();
  let held = 0, historical = 0;
  for (const partyId of config.partyIds) {
    const selected = new Set<number>();
    for (const member of await provider.listMembers(partyId)) {
      const room = await provider.openPrivateRoom(partyId, member.userSeq), chat = await provider.getChat(room);
      const state = everyviewOrderEligibility(config, everyviewSpotifyOrderKey(partyId, member), member.userSeq, chat.messages, rows);
      if (state === 'active') selected.add(member.seq);
      else if (state === 'held') held++; else historical++;
    }
    eligible.set(partyId, selected);
  }
  const creationDeps = { listRows: notion.listRows,
    read: (): CreationJournal => {
      if (!existsSync(creationPath())) return { version: 1, orders: {} };
      const j = JSON.parse(readFileSync(creationPath(), 'utf8'));
      if (j.version !== 1 || !j.orders || typeof j.orders !== 'object' || Array.isArray(j.orders)
        || Object.entries(j.orders).some(([key, value]) => !/^everyview:[1-9]\d*:[1-9]\d*$/.test(key)
          || !value || !['attempted', 'confirmed'].includes((value as { state: string }).state)))
        throw new Error('Everyview Notion creation journal invalid');
      return j;
    },
    write: (j: CreationJournal) => writeJsonAtomic(creationPath(), j),
  };
  const deps = { ...notion, ...provider, extractCredentials: extractGbutsCredentialsWithOpenRouter,
    createRow: (key: string, credentials: Parameters<typeof notion.createRow>[1]) => {
      assertSendingAllowed();
      return guardEveryviewNotionCreation(key, () => notion.createRow(key, credentials), creationDeps);
    },
    createNewAccountRequestRow: (key: string) => {
      assertSendingAllowed();
      return guardEveryviewNotionCreation(key, () => notion.createNewAccountRequestRow(key), creationDeps);
    },
    listMembers: async (partyId: number): Promise<GbutsSpotifyMember[]> =>
      (await provider.listMembers(partyId)).filter(m => eligible.get(partyId)?.has(m.seq)),
  };
  const send = async (partyId: number, guidesOnly = false) => {
    await syncGbutsSpotifyMessages({ ...deps,
      readJournal: () => readGbutsSpotifyMessageJournal(journalPath()),
      writeJournal: value => writeGbutsSpotifyMessageJournal(value, journalPath()),
    }, partyId, { guidesOnly });
  };
  const result = await syncGbutsSpotifyPosts(deps, config.partyIds,
    partyId => send(partyId), partyId => send(partyId, true));
  const status = { state: result.errors.length ? 'error' : held ? 'needs_mapping' : 'checked', checkedAt: new Date().toISOString(),
    held, historical, parties: result.posts.length, errors: result.errors.map(x => ({ partyId: x.postSeq, error: x.error })) };
  writeJsonAtomic(statusPath(), status);
  return status;
}

export function startEveryviewSpotifySync(): void {
  // Explicit persisted activation only. No historical/manual order is inferred during startup.
  if (!existsSync(configPath())) return;
  const run = createSingleFlightRunner(async () => {
    try {
      await runWithExclusivePollLock(spotifySyncLockPath(), async () => {
        const status = await runEveryviewSpotifyCycle();
        console.log('[EveryviewSpotifySync] completed', { state: status.state, held: status.held, historical: status.historical });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const code = /creation uncertain/i.test(message) ? 'CREATION_UNCERTAIN' : /session|authenticated|owned/i.test(message) ? 'SESSION_REQUIRED'
        : /identity|ambiguous/i.test(message) ? 'IDENTITY_REQUIRED' : /Notion/i.test(message) ? 'NOTION_UNAVAILABLE' : 'SYNC_UNAVAILABLE';
      writeJsonAtomic(statusPath(), { state: 'error', checkedAt: new Date().toISOString(), error: code });
      console.error('[EveryviewSpotifySync] sync failed', code);
    }
  });
  setTimeout(() => { void run(); setInterval(() => { void run(); }, 30_000); }, 15_000);
}
