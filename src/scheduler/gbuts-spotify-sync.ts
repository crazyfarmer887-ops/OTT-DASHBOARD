import { createSingleFlightRunner } from './poll-daemon';
import { loadGbutsSession } from '../lib/gbuts-session';
import { loadSafeModeConfig } from '../api/safe-mode';
import { readGbutsSpotifyMessageJournal, sendGbutsText, syncGbutsSpotifyMessages,
  writeGbutsSpotifyMessageJournal } from './gbuts-spotify-messages';
import {
  extractGbutsSpotifyCredentials, gbutsSpotifyOrderKey, isActiveGbutsSpotifyMember,
  type GbutsChatMessage, type GbutsSpotifyMember, type SpotifyCredentials,
} from '../lib/gbuts-spotify';

const NOTION_VERSION = '2025-09-03';
export const SPOTIFY_NOTION_DATA_SOURCE_ID = '560bff3e-13e1-4c84-8352-0a91899d045c';
export const GBUTS_SPOTIFY_POST_SEQ = 15557;

export interface SpotifyNotionRow {
  id: string;
  orderKey: string;
  email: string;
  emailHistory: string[];
  password: string;
  invited: boolean;
  cancelled: boolean;
}

interface GbutsChatRoom {
  roomId: number;
  members: unknown[];
  messages: GbutsChatMessage[];
}

export interface GbutsSpotifySyncDependencies {
  listMembers(postSeq: number): Promise<GbutsSpotifyMember[]>;
  openPrivateRoom(postSeq: number, userSeq: number): Promise<number>;
  getChat(roomId: number): Promise<GbutsChatRoom>;
  listRows(): Promise<SpotifyNotionRow[]>;
  getRow(id: string): Promise<SpotifyNotionRow | null>;
  createRow(orderKey: string, credentials: SpotifyCredentials): Promise<SpotifyNotionRow>;
  claimRow?(row: SpotifyNotionRow, orderKey: string): Promise<SpotifyNotionRow>;
  replaceCredentials(row: SpotifyNotionRow, credentials: SpotifyCredentials): Promise<SpotifyNotionRow>;
  cancelRow(row: SpotifyNotionRow): Promise<SpotifyNotionRow>;
}

export async function syncGbutsSpotifyCredentials(deps: GbutsSpotifySyncDependencies, postSeq: number): Promise<{
  members: number; created: number; updated: number; cancelled: number; waitingForCredentials: number; conflicts: number;
}> {
  const [members, rows] = await Promise.all([deps.listMembers(postSeq), deps.listRows()]);
  const active = members.filter(isActiveGbutsSpotifyMember);
  const credentialsByOrder = new Map<string, SpotifyCredentials | null>();
  const credentialCounts = new Map<string, number>();
  for (const member of active) {
    const orderKey = gbutsSpotifyOrderKey(postSeq, member);
    const roomId = await deps.openPrivateRoom(postSeq, member.userSeq);
    const chat = await deps.getChat(roomId);
    const credentials = extractGbutsSpotifyCredentials(chat.messages, member.userSeq);
    credentialsByOrder.set(orderKey, credentials);
    if (credentials) {
      const fingerprint = JSON.stringify([credentials.email, credentials.password]);
      credentialCounts.set(fingerprint, (credentialCounts.get(fingerprint) || 0) + 1);
    }
  }
  let created = 0;
  let updated = 0;
  let cancelled = 0;
  let waitingForCredentials = 0;
  let conflicts = 0;
  for (const member of active) {
    const orderKey = gbutsSpotifyOrderKey(postSeq, member);
    const matches = rows.filter((row) => row.orderKey === orderKey);
    if (matches.length > 1 || active.filter((candidate) => gbutsSpotifyOrderKey(postSeq, candidate) === orderKey).length > 1) {
      conflicts += 1;
      continue;
    }
    const credentials = credentialsByOrder.get(orderKey);
    if (!credentials) { waitingForCredentials += 1; continue; }
    if (matches.length === 0) {
      const manualMatches = rows.filter((row) => !row.orderKey && !row.cancelled
        && row.email === credentials.email && row.password === credentials.password);
      const fingerprint = JSON.stringify([credentials.email, credentials.password]);
      if (manualMatches.length > 1) { conflicts += 1; continue; }
      if (manualMatches.length === 1) {
        if (credentialCounts.get(fingerprint) !== 1 || !deps.claimRow) { conflicts += 1; continue; }
        const manual = manualMatches[0];
        const current = await deps.getRow(manual.id);
        const freshRows = await deps.listRows();
        if (!current || current.orderKey || current.email !== manual.email
          || current.password !== manual.password || current.invited !== manual.invited
          || current.cancelled || freshRows.some((row) => row.orderKey === orderKey)
          || freshRows.filter((row) => !row.orderKey && !row.cancelled
            && row.email === credentials.email && row.password === credentials.password).length !== 1) {
          conflicts += 1;
          continue;
        }
        const claimed = await deps.claimRow(current, orderKey);
        if (claimed.orderKey !== orderKey || claimed.email !== credentials.email
          || claimed.password !== credentials.password || claimed.invited !== current.invited)
          throw new Error('Spotify Notion manual row claim invalid');
        rows.splice(rows.indexOf(manual), 1, claimed);
        continue;
      }
      // Re-read before creating: concurrent runs or a manually inserted row may have claimed this order.
      if ((await deps.listRows()).some((row) => row.orderKey === orderKey)) { conflicts += 1; continue; }
      const row = await deps.createRow(orderKey, credentials);
      if (row.orderKey !== orderKey || row.email !== credentials.email || row.password !== credentials.password || row.invited)
        throw new Error('Spotify Notion create response invalid');
      rows.push(row);
      created += 1;
      continue;
    }
    const current = await deps.getRow(matches[0].id);
    if (!current || current.orderKey !== orderKey || current.email !== matches[0].email
      || current.password !== matches[0].password || current.invited !== matches[0].invited
      || current.cancelled !== matches[0].cancelled || current.cancelled) {
      conflicts += 1;
      continue;
    }
    if (current.email === credentials.email && current.password === credentials.password) continue;
    if (current.invited && current.email === credentials.email) {
      // A password-only change after an invitation does not prove the invite needs repeating.
      conflicts += 1;
      continue;
    }
    const replacement = await deps.replaceCredentials(current, credentials);
    if (replacement.orderKey !== orderKey || replacement.email !== credentials.email
      || replacement.password !== credentials.password || replacement.invited) {
      throw new Error('Spotify Notion replacement response invalid');
    }
    rows.splice(rows.indexOf(matches[0]), 1, replacement);
    updated += 1;
  }
  for (const member of members.filter((item) => item.cancelStatus === 'REFUNDED')) {
    const orderKey = gbutsSpotifyOrderKey(postSeq, member);
    const matches = rows.filter((row) => row.orderKey === orderKey);
    if (matches.length !== 1 || matches[0].cancelled) continue;
    const current = await deps.getRow(matches[0].id);
    if (!current || current.orderKey !== orderKey || current.email !== matches[0].email || current.cancelled) {
      conflicts += 1;
      continue;
    }
    const result = await deps.cancelRow(current);
    if (!result.cancelled || result.invited || result.password) throw new Error('Spotify Notion refund response invalid');
    cancelled += 1;
  }
  return { members: active.length, created, updated, cancelled, waitingForCredentials, conflicts };
}

function requiredInteger(value: unknown, name: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new Error(`${name} invalid`);
  return Number(value);
}

function richTextValue(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return value.map((part) => String(part?.plain_text ?? part?.text?.content ?? '')).join('');
}

function parseNotionRow(value: unknown): SpotifyNotionRow | null {
  if (!value || typeof value !== 'object') return null;
  const page = value as Record<string, any>;
  if (typeof page.id !== 'string' || page.archived || page.in_trash) return null;
  const title = page.properties?.['Spotify account']?.title;
  if (!Array.isArray(title)) return null;
  const emailParts = title.flatMap((part: any) => String(part?.plain_text ?? part?.text?.content ?? '')
    .split('↓').map((segment) => ({ email: segment.trim(), struck: part?.annotations?.strikethrough === true })))
    .filter((item: { email: string }) => item.email && item.email.includes('@'));
  const active = emailParts.filter((item: { struck: boolean }) => !item.struck);
  const email = active.length === 1 ? active[0].email.toLowerCase() : '';
  const emailHistory = emailParts.filter((item: { struck: boolean }) => item.struck)
    .map((item: { email: string }) => item.email.toLowerCase());
  return {
    id: page.id,
    orderKey: richTextValue(page.properties?.['GButs order ID']?.rich_text).trim(),
    email,
    emailHistory,
    password: richTextValue(page.properties?.Password?.rich_text),
    invited: page.properties?.Invited?.checkbox === true,
    cancelled: active.length === 0 && emailParts.length > 0,
  };
}

function notionTitle(history: readonly string[], email: string, cancelled = false) {
  return [
    ...history.flatMap((old, index) => [
      ...(index ? [{ text: { content: '\n\n↓\n\n' } }] : []),
      { text: { content: old }, annotations: { strikethrough: true } },
    ]),
    ...(history.length ? [{ text: { content: '\n\n↓\n\n' } }] : []),
    { text: { content: email }, ...(cancelled ? { annotations: { strikethrough: true } } : {}) },
  ];
}

export function createGbutsSpotifyNotionClient(token: string, dataSourceId = SPOTIFY_NOTION_DATA_SOURCE_ID,
  transport: typeof fetch = fetch) {
  const headers = { Authorization: `Bearer ${token}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' };
  const listRows = async (): Promise<SpotifyNotionRow[]> => {
    const rows: SpotifyNotionRow[] = [];
    let cursor: string | undefined;
    do {
      const response = await transport(`https://api.notion.com/v1/data_sources/${encodeURIComponent(dataSourceId)}/query`, {
        method: 'POST', headers, signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({ page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }),
      });
      if (!response.ok) throw new Error(`Spotify Notion query failed: HTTP ${response.status}`);
      const payload = await response.json() as { results?: unknown[]; has_more?: boolean; next_cursor?: string };
      if (!Array.isArray(payload.results)) throw new Error('Spotify Notion query response invalid');
      rows.push(...payload.results.map(parseNotionRow).filter((row): row is SpotifyNotionRow => row !== null));
      if (rows.length > 1000) throw new Error('Spotify Notion query exceeds 1000 rows');
      cursor = payload.has_more ? payload.next_cursor : undefined;
      if (payload.has_more && !cursor) throw new Error('Spotify Notion query cursor missing');
    } while (cursor);
    return rows;
  };
  return {
    listRows,
    async getRow(id: string): Promise<SpotifyNotionRow | null> {
      const response = await transport(`https://api.notion.com/v1/pages/${encodeURIComponent(id)}`, {
        headers, signal: AbortSignal.timeout(15_000),
      });
      return response.ok ? parseNotionRow(await response.json()) : null;
    },
    async createRow(orderKey: string, credentials: SpotifyCredentials): Promise<SpotifyNotionRow> {
      const response = await transport('https://api.notion.com/v1/pages', {
        method: 'POST', headers, signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({ parent: { type: 'data_source_id', data_source_id: dataSourceId }, properties: {
          'Spotify account': { title: notionTitle([], credentials.email) },
          Password: { rich_text: [{ text: { content: credentials.password } }] },
          Invited: { checkbox: false },
          'GButs order ID': { rich_text: [{ text: { content: orderKey } }] },
        } }),
      });
      if (!response.ok) throw new Error(`Spotify Notion create failed: HTTP ${response.status}`);
      const row = parseNotionRow(await response.json());
      if (!row) throw new Error('Spotify Notion create response invalid');
      return row;
    },
    async claimRow(row: SpotifyNotionRow, orderKey: string): Promise<SpotifyNotionRow> {
      const response = await transport(`https://api.notion.com/v1/pages/${encodeURIComponent(row.id)}`, {
        method: 'PATCH', headers, signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({ properties: {
          'GButs order ID': { rich_text: [{ text: { content: orderKey } }] },
        } }),
      });
      if (!response.ok) throw new Error(`Spotify Notion order claim failed: HTTP ${response.status}`);
      const claimed = parseNotionRow(await response.json());
      if (!claimed) throw new Error('Spotify Notion order claim response invalid');
      return claimed;
    },
    async replaceCredentials(row: SpotifyNotionRow, credentials: SpotifyCredentials): Promise<SpotifyNotionRow> {
      const history = row.email === credentials.email ? row.emailHistory : [...row.emailHistory, row.email];
      const response = await transport(`https://api.notion.com/v1/pages/${encodeURIComponent(row.id)}`, {
        method: 'PATCH', headers, signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({ properties: {
          'Spotify account': { title: notionTitle(history, credentials.email) },
          Password: { rich_text: [{ text: { content: credentials.password } }] },
          Invited: { checkbox: false },
        } }),
      });
      if (!response.ok) throw new Error(`Spotify Notion update failed: HTTP ${response.status}`);
      const updated = parseNotionRow(await response.json());
      if (!updated) throw new Error('Spotify Notion update response invalid');
      return updated;
    },
    async cancelRow(row: SpotifyNotionRow): Promise<SpotifyNotionRow> {
      const response = await transport(`https://api.notion.com/v1/pages/${encodeURIComponent(row.id)}`, {
        method: 'PATCH', headers, signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({ properties: {
          'Spotify account': { title: notionTitle(row.emailHistory, row.email, true) },
          Password: { rich_text: [] }, Invited: { checkbox: false },
        } }),
      });
      if (!response.ok) throw new Error(`Spotify Notion refund update failed: HTTP ${response.status}`);
      const updated = parseNotionRow(await response.json());
      if (!updated) throw new Error('Spotify Notion refund update response invalid');
      return updated;
    },
  };
}

export function createGbutsSpotifySellerClient(token: string, transport: typeof fetch = fetch) {
  const request = async (path: string, init?: RequestInit): Promise<any> => {
    const response = await transport(`https://api.gbuts.com${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', api_key: `Bearer ${token}`, ...init?.headers },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`GButs seller request failed: HTTP ${response.status}`);
    const payload = await response.json() as { response?: unknown; error?: unknown };
    if (payload.error || payload.response === undefined) throw new Error('GButs seller response invalid');
    return payload.response;
  };
  return {
    async listMembers(postSeq: number): Promise<GbutsSpotifyMember[]> {
      const rows = await request(`/api/seller/subscribe/share/${requiredInteger(postSeq, 'postSeq')}/member`);
      if (!Array.isArray(rows)) throw new Error('GButs seller members invalid');
      return rows.map((item: Record<string, unknown>) => ({
        seq: requiredInteger(item.seq, 'member seq'),
        userSeq: requiredInteger(item.userSeq, 'userSeq'),
        productId: requiredInteger(item.productId, 'productId'),
        status: String(item.status ?? ''),
        cancelStatus: item.cancelStatus == null ? null : String(item.cancelStatus),
      }));
    },
    async openPrivateRoom(postSeq: number, userSeq: number): Promise<number> {
      const room = await request('/api/room/chat', { method: 'POST', body: JSON.stringify({
        roomType: 'PERSONAL', typeSeq: postSeq, type: 'SUBSCRIPTION', userSeq,
      }) });
      return requiredInteger(room.roomId, 'roomId');
    },
    async getChat(roomId: number): Promise<GbutsChatRoom> {
      const chat = await request(`/api/rooms/${requiredInteger(roomId, 'roomId')}/chat`);
      if (!chat || !Array.isArray(chat.messages) || !Array.isArray(chat.members))
        throw new Error('GButs chat response invalid');
      return { roomId, members: chat.members, messages: chat.messages.map((item: Record<string, unknown>) => ({
        senderSeq: Number(item.senderSeq), message: String(item.message ?? ''),
        messageType: String(item.messageType ?? ''), createdAt: String(item.createdAt ?? ''),
      })) };
    },
    async sellerAccountSeq(): Promise<number> {
      const account = await request('/api/account/me');
      return requiredInteger(account.seq, 'seller account seq');
    },
  };
}

export function startGbutsSpotifySync(): void {
  if (process.env.GBUTS_SPOTIFY_SYNC_ENABLED !== 'true') return;
  const notionToken = process.env.NOTION_API_TOKEN?.trim();
  if (!notionToken) {
    console.error('[GbutsSpotifySync] Notion connection unavailable');
    return;
  }
  const notion = createGbutsSpotifyNotionClient(notionToken,
    process.env.NOTION_SPOTIFY_DATA_SOURCE_ID?.trim() || SPOTIFY_NOTION_DATA_SOURCE_ID);
  const postSeq = Number(process.env.GBUTS_SPOTIFY_POST_SEQ || GBUTS_SPOTIFY_POST_SEQ);
  const intervalMs = Math.max(30_000, Number(process.env.GBUTS_SPOTIFY_SYNC_INTERVAL_MS) || 60_000);
  const run = createSingleFlightRunner(async () => {
    try {
      if (loadSafeModeConfig().enabled) return;
      const gbutsToken = loadGbutsSession()?.token || process.env.GBUTS_API_TOKEN?.trim();
      if (!gbutsToken) return;
      const deps = { ...notion, ...createGbutsSpotifySellerClient(gbutsToken) };
      const result = await syncGbutsSpotifyCredentials(deps, postSeq);
      if (result.created || result.updated || result.cancelled || result.conflicts)
        console.log('[GbutsSpotifySync] sync', result);
      if (process.env.GBUTS_SPOTIFY_AUTO_MESSAGE_ENABLED === 'true') {
        const messages = await syncGbutsSpotifyMessages({ ...deps, sendText: sendGbutsText,
          readJournal: readGbutsSpotifyMessageJournal,
          writeJournal: writeGbutsSpotifyMessageJournal }, postSeq);
        if (messages.guidesAttempted || messages.invitedRepliesAttempted || messages.confirmed)
          console.log('[GbutsSpotifySync] messages', messages);
      }
    } catch (error) {
      console.error('[GbutsSpotifySync] sync failed', error instanceof Error ? error.message : 'unknown error');
    }
  });
  setTimeout(() => { void run(); setInterval(() => { void run(); }, intervalMs); }, 10_000);
}
