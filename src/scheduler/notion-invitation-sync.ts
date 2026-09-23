import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { isYouTubeInvitationSellerDeal } from '../api/youtube-auto-reply';
import { loadSafeModeConfig } from '../api/safe-mode';
import { normalizeYouTubeInvitationEmail } from '../lib/youtube-invitations';
import { writeJsonAtomic } from '../lib/graytag-sales-session';
import { createSingleFlightRunner, runWithExclusivePollLock } from './poll-daemon';

const NOTION_VERSION = '2025-09-03';
const DEFAULT_DATA_SOURCE_ID = '52e0fe4e-5f56-4fa1-8547-f2e89142b0db';
const DEFAULT_JOURNAL_PATH = '/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data/notion-invitation-deliveries.json';
const DEFAULT_LOCK_PATH = '/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data/notion-invitation-deliveries.lock';
const DEFAULT_INTERVAL_MS = 60_000;

export interface NotionInvitationRow {
  id: string;
  email: string;
  invited: boolean;
  dealUsid: string;
}

export interface NotionDeliveryDeal {
  dealUsid: string;
  chatRoomUuid: string;
  dealStatus: string;
  productTypeString?: string;
  productName?: string;
}

type DeliveryState = 'attempted' | 'confirmed' | 'rejected';
interface DeliveryRecord {
  emailHash: string;
  dealUsid: string;
  state: DeliveryState;
  updatedAt: string;
}
interface DeliveryJournal { version: 1; records: Record<string, DeliveryRecord> }

export interface NotionInvitationSyncDependencies {
  listCheckedRows(): Promise<NotionInvitationRow[]>;
  getRow(id: string): Promise<NotionInvitationRow | null>;
  listDeals(): Promise<NotionDeliveryDeal[] | null>;
  buyerEmails(chatRoomUuid: string): Promise<string[] | null>;
  providerStatus(dealUsid: string): Promise<string | null>;
  finishDelivery(dealUsid: string): Promise<Response>;
  readJournal(): DeliveryJournal;
  writeJournal(journal: DeliveryJournal): void;
  now?(): string;
}

export interface NotionEmailSyncDependencies {
  listRows(): Promise<NotionInvitationRow[]>;
  getRow(id: string): Promise<NotionInvitationRow | null>;
  createRow(email: string, dealUsid: string): Promise<NotionInvitationRow>;
  bindRow(id: string, dealUsid: string): Promise<NotionInvitationRow>;
  listDeals(): Promise<NotionDeliveryDeal[] | null>;
  buyerEmails(chatRoomUuid: string): Promise<string[] | null>;
}

function emailHash(email: string): string {
  return createHash('sha256').update(email).digest('hex');
}

function sameRow(left: NotionInvitationRow | null, right: NotionInvitationRow): boolean {
  return Boolean(left && left.id === right.id && left.invited
    && left.dealUsid === right.dealUsid
    && normalizeYouTubeInvitationEmail(left.email) === normalizeYouTubeInvitationEmail(right.email));
}

/** Add only emails explicitly supplied by a buyer for one identifiable order. */
export async function syncNotionBuyerEmails(deps: NotionEmailSyncDependencies): Promise<{
  created: number; bound: number;
}> {
  const rows = await deps.listRows();
  const deals = await deps.listDeals();
  if (!deals) throw new Error('YouTube seller deals unavailable');
  const active = deals.filter((deal) => deal.dealStatus === 'Delivering' && isYouTubeInvitationSellerDeal(deal));
  const emailByDeal = new Map<string, string>();
  for (const deal of active) {
    const emails = await deps.buyerEmails(deal.chatRoomUuid);
    if (emails?.length !== 1) continue;
    const email = normalizeYouTubeInvitationEmail(emails[0]);
    if (email) emailByDeal.set(deal.dealUsid, email);
  }
  let created = 0;
  let bound = 0;
  for (const deal of active) {
    const email = emailByDeal.get(deal.dealUsid);
    if (!email) continue;
    const assigned = rows.filter((row) => row.dealUsid === deal.dealUsid);
    if (assigned.length > 0) continue;
    const candidateDeals = active.filter((other) => emailByDeal.get(other.dealUsid) === email);
    const manualRows = rows.filter((row) => !row.dealUsid && normalizeYouTubeInvitationEmail(row.email) === email);
    if (candidateDeals.length === 1 && manualRows.length === 1) {
      const current = await deps.getRow(manualRows[0].id);
      if (!current || current.dealUsid || normalizeYouTubeInvitationEmail(current.email) !== email) continue;
      const updated = await deps.bindRow(manualRows[0].id, deal.dealUsid);
      if (updated.dealUsid !== deal.dealUsid || normalizeYouTubeInvitationEmail(updated.email) !== email) {
        throw new Error('Notion row changed while linking an order');
      }
      rows.splice(rows.indexOf(manualRows[0]), 1, updated);
      bound += 1;
      continue;
    }
    if (manualRows.length > 0) continue;
    const added = await deps.createRow(email, deal.dealUsid);
    rows.push(added);
    created += 1;
  }
  return { created, bound };
}

export function resolveUniqueDeliveryMatches(
  rows: readonly NotionInvitationRow[],
  deals: readonly NotionDeliveryDeal[],
  emailsByRoom: ReadonlyMap<string, readonly string[] | null>,
): Map<string, NotionDeliveryDeal> {
  const validRows = rows.filter((row) => row.invited && normalizeYouTubeInvitationEmail(row.email));
  const rowCounts = new Map<string, number>();
  for (const row of validRows) {
    const email = normalizeYouTubeInvitationEmail(row.email)!;
    if (!row.dealUsid) rowCounts.set(email, (rowCounts.get(email) ?? 0) + 1);
  }
  const matches = new Map<string, NotionDeliveryDeal>();
  for (const row of validRows) {
    const email = normalizeYouTubeInvitationEmail(row.email)!;
    if (!row.dealUsid && rowCounts.get(email) !== 1) continue;
    const candidates = deals.filter((deal) => {
      if (deal.dealStatus !== 'Delivering' || !isYouTubeInvitationSellerDeal(deal)) return false;
      if (row.dealUsid && row.dealUsid !== deal.dealUsid) return false;
      const buyerEmails = emailsByRoom.get(deal.chatRoomUuid);
      return buyerEmails?.length === 1 && normalizeYouTubeInvitationEmail(buyerEmails[0]) === email;
    });
    if (candidates.length === 1) matches.set(row.id, candidates[0]);
  }
  const matchedDealCounts = new Map<string, number>();
  for (const deal of matches.values()) {
    matchedDealCounts.set(deal.dealUsid, (matchedDealCounts.get(deal.dealUsid) ?? 0) + 1);
  }
  for (const [rowId, deal] of matches) {
    if (matchedDealCounts.get(deal.dealUsid) !== 1) matches.delete(rowId);
  }
  return matches;
}

export async function syncNotionInvitationDeliveries(deps: NotionInvitationSyncDependencies): Promise<{
  checked: number; matched: number; attempted: number; confirmed: number;
}> {
  const rows = await deps.listCheckedRows();
  const journal = deps.readJournal();

  // Reconcile attempts first. Never send a second finish request after a timeout or crash.
  for (const record of Object.values(journal.records)) {
    if (record.state !== 'attempted') continue;
    const status = await deps.providerStatus(record.dealUsid);
    if (status === 'Delivered') {
      record.state = 'confirmed';
      record.updatedAt = deps.now?.() ?? new Date().toISOString();
      deps.writeJournal(journal);
    }
  }

  if (rows.length === 0) return { checked: 0, matched: 0, attempted: 0,
    confirmed: Object.values(journal.records).filter((record) => record.state === 'confirmed').length };

  const actionable = rows.filter((row) => !journal.records[row.id]
    && row.invited && normalizeYouTubeInvitationEmail(row.email));
  if (actionable.length === 0) {
    return { checked: rows.length, matched: 0, attempted: 0,
      confirmed: Object.values(journal.records).filter((record) => record.state === 'confirmed').length };
  }
  const deals = await deps.listDeals();
  if (!deals) throw new Error('YouTube seller deals unavailable');
  const delivering = deals.filter((deal) => deal.dealStatus === 'Delivering' && isYouTubeInvitationSellerDeal(deal));
  const emailsByRoom = new Map<string, readonly string[] | null>();
  for (const room of new Set(delivering.map((deal) => deal.chatRoomUuid))) {
    emailsByRoom.set(room, await deps.buyerEmails(room));
  }
  const matches = resolveUniqueDeliveryMatches(actionable, delivering, emailsByRoom);
  let attempted = 0;
  for (const row of actionable) {
    const deal = matches.get(row.id);
    if (!deal || journal.records[row.id]) continue;
    const current = await deps.getRow(row.id);
    if (!sameRow(current, row)) continue;
    const status = await deps.providerStatus(deal.dealUsid);
    if (status !== 'Delivering') continue;

    journal.records[row.id] = {
      emailHash: emailHash(normalizeYouTubeInvitationEmail(row.email)!),
      dealUsid: deal.dealUsid,
      state: 'attempted',
      updatedAt: deps.now?.() ?? new Date().toISOString(),
    };
    deps.writeJournal(journal);
    attempted += 1;
    let response: Response | null = null;
    try { response = await deps.finishDelivery(deal.dealUsid); } catch { /* Outcome unknown: reconcile only. */ }
    if (response && response.ok && !response.redirected) {
      const payload = await response.json().catch(() => null) as { succeeded?: unknown } | null;
      if (payload?.succeeded === false) {
        journal.records[row.id].state = 'rejected';
        journal.records[row.id].updatedAt = deps.now?.() ?? new Date().toISOString();
        deps.writeJournal(journal);
      } else if (payload?.succeeded === true && await deps.providerStatus(deal.dealUsid) === 'Delivered') {
        journal.records[row.id].state = 'confirmed';
        journal.records[row.id].updatedAt = deps.now?.() ?? new Date().toISOString();
        deps.writeJournal(journal);
      }
    }
  }
  return { checked: rows.length, matched: matches.size, attempted,
    confirmed: Object.values(journal.records).filter((record) => record.state === 'confirmed').length };
}

function notionHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json' };
}

function parseNotionRow(value: unknown): NotionInvitationRow | null {
  if (!value || typeof value !== 'object') return null;
  const page = value as Record<string, any>;
  if (typeof page.id !== 'string' || page.archived === true || page.in_trash === true) return null;
  const title = page.properties?.['Customer email']?.title;
  const email = Array.isArray(title) ? title.map((part: any) => part?.plain_text ?? part?.text?.content ?? '').join('') : '';
  const dealParts = page.properties?.['Deal USID']?.rich_text;
  const dealUsid = Array.isArray(dealParts)
    ? dealParts.map((part: any) => part?.plain_text ?? part?.text?.content ?? '').join('').trim() : '';
  return { id: page.id, email, invited: page.properties?.Invited?.checkbox === true, dealUsid };
}

export function createNotionInvitationClient(token: string, dataSourceId: string, transport: typeof fetch = fetch) {
  const headers = notionHeaders(token);
  const query = async (body: Record<string, unknown>): Promise<NotionInvitationRow[]> => {
    const rows: NotionInvitationRow[] = [];
    let cursor: string | undefined;
    do {
      const response = await transport(`https://api.notion.com/v1/data_sources/${encodeURIComponent(dataSourceId)}/query`, {
        method: 'POST', headers,
        body: JSON.stringify({ page_size: 100, ...body, ...(cursor ? { start_cursor: cursor } : {}) }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`Notion query failed: HTTP ${response.status}`);
      const payload = await response.json() as { results?: unknown[]; has_more?: boolean; next_cursor?: string };
      if (!Array.isArray(payload.results)) throw new Error('Notion query response invalid');
      rows.push(...payload.results.map(parseNotionRow).filter((row): row is NotionInvitationRow => row !== null));
      if (rows.length > 1000) throw new Error('Notion invitation query exceeds 1000 rows');
      cursor = payload.has_more ? payload.next_cursor : undefined;
      if (payload.has_more && !cursor) throw new Error('Notion pagination cursor missing');
    } while (cursor);
    return rows;
  };
  return {
    listRows: () => query({}),
    listCheckedRows: () => query({ filter: { property: 'Invited', checkbox: { equals: true } } }),
    async getRow(id: string): Promise<NotionInvitationRow | null> {
      const response = await transport(`https://api.notion.com/v1/pages/${encodeURIComponent(id)}`, {
        headers, signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) return null;
      return parseNotionRow(await response.json());
    },
    async createRow(email: string, dealUsid: string): Promise<NotionInvitationRow> {
      const response = await transport('https://api.notion.com/v1/pages', {
        method: 'POST', headers, signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({ parent: { type: 'data_source_id', data_source_id: dataSourceId },
          properties: {
            'Customer email': { title: [{ text: { content: email } }] },
            Invited: { checkbox: false },
            'Deal USID': { rich_text: [{ text: { content: dealUsid } }] },
          } }),
      });
      if (!response.ok) throw new Error(`Notion create page failed: HTTP ${response.status}`);
      const row = parseNotionRow(await response.json());
      if (!row || normalizeYouTubeInvitationEmail(row.email) !== email || row.dealUsid !== dealUsid) {
        throw new Error('Notion created page response invalid');
      }
      return row;
    },
    async bindRow(id: string, dealUsid: string): Promise<NotionInvitationRow> {
      const response = await transport(`https://api.notion.com/v1/pages/${encodeURIComponent(id)}`, {
        method: 'PATCH', headers, signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({ properties: {
          'Deal USID': { rich_text: [{ text: { content: dealUsid } }] },
        } }),
      });
      if (!response.ok) throw new Error(`Notion update page failed: HTTP ${response.status}`);
      const row = parseNotionRow(await response.json());
      if (!row || row.dealUsid !== dealUsid) throw new Error('Notion updated page response invalid');
      return row;
    },
  };
}

function readJournal(path: string): DeliveryJournal {
  if (!existsSync(path)) return { version: 1, records: {} };
  const value = JSON.parse(readFileSync(path, 'utf8')) as DeliveryJournal;
  if (value?.version !== 1 || !value.records || typeof value.records !== 'object'
    || Array.isArray(value.records)) throw new Error('Notion delivery journal invalid');
  return value;
}

export function startNotionInvitationSync(dependencies: Pick<NotionInvitationSyncDependencies,
  'listDeals' | 'buyerEmails' | 'providerStatus' | 'finishDelivery'>): void {
  const importEnabled = process.env.NOTION_INVITATION_EMAIL_IMPORT_ENABLED === 'true';
  const deliveryEnabled = process.env.NOTION_INVITATION_AUTO_DELIVERY_ENABLED === 'true';
  if (!importEnabled && !deliveryEnabled) return;
  const token = process.env.NOTION_API_TOKEN?.trim();
  const dataSourceId = process.env.NOTION_INVITATION_DATA_SOURCE_ID?.trim() || DEFAULT_DATA_SOURCE_ID;
  if (!token || !/^[a-f0-9-]{32,36}$/i.test(dataSourceId)) {
    console.error('[NotionInvitationSync] Notion connection is not configured');
    return;
  }
  const client = createNotionInvitationClient(token, dataSourceId);
  const journalPath = process.env.NOTION_INVITATION_JOURNAL_PATH || DEFAULT_JOURNAL_PATH;
  const lockPath = process.env.NOTION_INVITATION_LOCK_PATH || DEFAULT_LOCK_PATH;
  const intervalMs = Math.max(30_000, Number(process.env.NOTION_INVITATION_INTERVAL_MS) || DEFAULT_INTERVAL_MS);
  const run = createSingleFlightRunner(async () => {
    if (loadSafeModeConfig().enabled) return;
    await runWithExclusivePollLock(lockPath, async () => {
      try {
        if (importEnabled) {
          const imported = await syncNotionBuyerEmails({ ...client, ...dependencies });
          if (imported.created || imported.bound) console.log('[NotionInvitationSync] emails', imported);
        }
        if (deliveryEnabled) {
          const result = await syncNotionInvitationDeliveries({
            ...client, ...dependencies,
            readJournal: () => readJournal(journalPath),
            writeJournal: (journal) => writeJsonAtomic(journalPath, journal),
          });
          if (result.checked > 0) console.log('[NotionInvitationSync] delivery', result);
        }
      } catch (error) {
        console.error('[NotionInvitationSync] sync failed', error instanceof Error ? error.message : 'unknown error');
      }
    });
  });
  setTimeout(() => { void run(); setInterval(() => { void run(); }, intervalMs); }, 10_000);
}
