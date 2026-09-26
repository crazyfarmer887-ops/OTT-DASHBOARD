import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { isYouTubeInvitationSellerDeal } from '../api/youtube-auto-reply';
import { loadSafeModeConfig } from '../api/safe-mode';
import { normalizeYouTubeInvitationEmail } from '../lib/youtube-invitations';
import { writeJsonAtomic } from '../lib/graytag-sales-session';
import { createSingleFlightRunner, runWithExclusivePollLock } from './poll-daemon';

const NOTION_VERSION = '2025-09-03';
const DEFAULT_DATA_SOURCE_ID = '52e0fe4e-5f56-4fa1-8547-f2e89142b0db';
const DEFAULT_SLOT_LEDGER_DATA_SOURCE_ID = '0162c5cb-60f8-414c-beeb-9ec78dd9a383';
const DEFAULT_SLOT_SUMMARY_BLOCK_ID = '3e5ff936-cc9b-8037-b082-c540e7640d9f';
const DEFAULT_JOURNAL_PATH = '/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data/notion-invitation-deliveries.json';
const DEFAULT_LOCK_PATH = '/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data/notion-invitation-deliveries.lock';
const DEFAULT_INTERVAL_MS = 60_000;

export interface NotionInvitationRow {
  id: string;
  email: string;
  emailHistory?: string[];
  cancelled?: boolean;
  refundMarked?: boolean;
  newInviteMarked?: boolean;
  inviteRemoved?: boolean;
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

/** A struck address without a refund label is waiting for a replacement address. */
export function isPendingNewInviteRow(row: NotionInvitationRow): boolean {
  return row.cancelled === true && row.refundMarked !== true && !normalizeYouTubeInvitationEmail(row.email)
    && Boolean(row.emailHistory?.length);
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
  /** Null means the ledger could not be read, so new rows must fail closed. */
  readSlotCapacity?(): Promise<number | null>;
  getRow(id: string): Promise<NotionInvitationRow | null>;
  createRow(email: string, dealUsid: string, cancelled?: boolean): Promise<NotionInvitationRow>;
  bindRow(id: string, dealUsid: string): Promise<NotionInvitationRow>;
  updateRowEmail(row: NotionInvitationRow, email: string): Promise<NotionInvitationRow>;
  cancelRow(row: NotionInvitationRow): Promise<NotionInvitationRow>;
  listDeals(): Promise<NotionDeliveryDeal[] | null>;
  buyerEmails(chatRoomUuid: string): Promise<string[] | null>;
}

function emailHash(email: string): string {
  return createHash('sha256').update(email).digest('hex');
}

function sameRow(left: NotionInvitationRow | null, right: NotionInvitationRow): boolean {
  return Boolean(left && left.id === right.id && left.invited && !left.cancelled && !right.cancelled
    && left.dealUsid === right.dealUsid
    && normalizeYouTubeInvitationEmail(left.email) === normalizeYouTubeInvitationEmail(right.email));
}

/** Add only emails explicitly supplied by a buyer for one identifiable order. */
export async function syncNotionBuyerEmails(deps: NotionEmailSyncDependencies): Promise<{
  created: number; bound: number; updated: number; cancelled: number; capacityBlocked: number;
}> {
  const rows = await deps.listRows();
  const capacity = deps.readSlotCapacity ? await deps.readSlotCapacity().catch(() => null) : Number.POSITIVE_INFINITY;
  const deals = await deps.listDeals();
  if (!deals) throw new Error('YouTube seller deals unavailable');
  const active = deals.filter((deal) => deal.dealStatus === 'Delivering' && isYouTubeInvitationSellerDeal(deal));
  const cancelledDeals = deals.filter((deal) => /^Cancel/i.test(deal.dealStatus) && isYouTubeInvitationSellerDeal(deal));
  const emailByDeal = new Map<string, string>();
  for (const deal of active) {
    const emails = await deps.buyerEmails(deal.chatRoomUuid);
    if (emails?.length !== 1) continue;
    const email = normalizeYouTubeInvitationEmail(emails[0]);
    if (email) emailByDeal.set(deal.dealUsid, email);
  }
  let created = 0;
  let bound = 0;
  let updated = 0;
  let cancelled = 0;
  let capacityBlocked = 0;
  const canCreate = async (dealUsid: string, email: string): Promise<boolean> => {
    if (capacity === null || (deps.readSlotCapacity && (!Number.isSafeInteger(capacity) || capacity < 0))) {
      capacityBlocked += 1;
      return false;
    }
    if (!Number.isFinite(capacity)) return true;
    // Re-read before every insertion so edits in Notion and other writers are reflected.
    const latest = await deps.listRows();
    // Keep rows just created in this run even if a Notion query is briefly stale.
    const observed = [...new Map([...rows, ...latest].map((row) => [row.id, row])).values()];
    if (observed.some((row) => row.dealUsid === dealUsid
      || (!row.dealUsid && !row.cancelled && normalizeYouTubeInvitationEmail(row.email) === email))) return false;
    if (occupiedNotionSlots(observed) >= capacity) { capacityBlocked += 1; return false; }
    return true;
  };
  for (const deal of active) {
    const email = emailByDeal.get(deal.dealUsid);
    if (!email) continue;
    const assigned = rows.filter((row) => row.dealUsid === deal.dealUsid);
    if (assigned.length > 0) {
      if (assigned.length !== 1 || (assigned[0].cancelled && !isPendingNewInviteRow(assigned[0]))
        || normalizeYouTubeInvitationEmail(assigned[0].email) === email) continue;
      const current = await deps.getRow(assigned[0].id);
      const previousEmail = normalizeYouTubeInvitationEmail(current?.email)
        || (current && isPendingNewInviteRow(current)
          ? normalizeYouTubeInvitationEmail(current.emailHistory?.at(-1)) : null);
      if (!current || (current.cancelled && !isPendingNewInviteRow(current))
        || current.dealUsid !== deal.dealUsid || !previousEmail || previousEmail === email) continue;
      // An old check cannot confirm a newly supplied address. Reset it atomically.
      const replacement = await deps.updateRowEmail(current, email);
      if (replacement.dealUsid !== deal.dealUsid || replacement.email !== email || replacement.invited
        || replacement.cancelled || !replacement.emailHistory?.includes(previousEmail)) {
        throw new Error('Notion email replacement response invalid');
      }
      rows.splice(rows.indexOf(assigned[0]), 1, replacement);
      updated += 1;
      continue;
    }
    const candidateDeals = active.filter((other) => emailByDeal.get(other.dealUsid) === email);
    const manualRows = rows.filter((row) => !row.dealUsid && !row.cancelled && normalizeYouTubeInvitationEmail(row.email) === email);
    if (candidateDeals.length === 1 && manualRows.length === 1) {
      const current = await deps.getRow(manualRows[0].id);
      if (!current || current.dealUsid || normalizeYouTubeInvitationEmail(current.email) !== email) continue;
      const updated = await deps.bindRow(manualRows[0].id, deal.dealUsid);
      if (updated.dealUsid !== deal.dealUsid || normalizeYouTubeInvitationEmail(updated.email) !== email
        || updated.invited) {
        throw new Error('Notion row changed while linking an order');
      }
      rows.splice(rows.indexOf(manualRows[0]), 1, updated);
      bound += 1;
      continue;
    }
    if (manualRows.length > 0) continue;
    if (!await canCreate(deal.dealUsid, email)) continue;
    const added = await deps.createRow(email, deal.dealUsid);
    rows.push(added);
    created += 1;
  }
  for (const deal of cancelledDeals) {
    const assigned = rows.filter((row) => row.dealUsid === deal.dealUsid);
    if (assigned.length > 1) continue;
    if (assigned.length === 1) {
      if (assigned[0].cancelled && assigned[0].refundMarked && !assigned[0].invited) continue;
      const current = await deps.getRow(assigned[0].id);
      if (!current || current.dealUsid !== deal.dealUsid
        || (current.cancelled && current.refundMarked && !current.invited)
        || (!normalizeYouTubeInvitationEmail(current.email) && !current.emailHistory?.length)) continue;
      const struck = await deps.cancelRow(current);
      if (!struck.cancelled || !struck.refundMarked || struck.invited || struck.email
        || struck.dealUsid !== deal.dealUsid) {
        throw new Error('Notion cancellation response invalid');
      }
      rows.splice(rows.indexOf(assigned[0]), 1, struck);
      cancelled += 1;
      continue;
    }
    const emails = await deps.buyerEmails(deal.chatRoomUuid);
    if (emails?.length !== 1) continue;
    const email = normalizeYouTubeInvitationEmail(emails[0]);
    if (!email) continue;
    if (!await canCreate(deal.dealUsid, email)) continue;
    const struck = await deps.createRow(email, deal.dealUsid, true);
    if (!struck.cancelled || !struck.refundMarked || struck.invited || struck.email
      || struck.dealUsid !== deal.dealUsid) {
      throw new Error('Notion cancelled page response invalid');
    }
    rows.push(struck);
    created += 1;
    cancelled += 1;
  }
  return { created, bound, updated, cancelled, capacityBlocked };
}

/** A refund holds its place until the vendor confirms that the invite was removed. */
export function occupiedNotionSlots(rows: readonly NotionInvitationRow[]): number {
  return rows.filter((row) => !row.refundMarked || !row.inviteRemoved).length;
}

export function formatNotionSlotSummary(capacity: number, occupied: number): string {
  if (!Number.isSafeInteger(capacity) || capacity < 0 || !Number.isSafeInteger(occupied) || occupied < 0)
    throw new Error('Notion slot summary counts invalid');
  return `Available slots: ${Math.max(0, capacity - occupied)}  |  Current slots: ${occupied}/${capacity}`;
}

export function createNotionSlotSummaryClient(token: string, blockId: string, transport: typeof fetch = fetch) {
  const url = `https://api.notion.com/v1/blocks/${encodeURIComponent(blockId)}`;
  const headers = notionHeaders(token);
  return {
    async update(capacity: number, occupied: number): Promise<boolean> {
      const summary = formatNotionSlotSummary(capacity, occupied);
      const current = await transport(url, { headers, signal: AbortSignal.timeout(15_000) });
      if (!current.ok) throw new Error(`Notion slot summary read failed: HTTP ${current.status}`);
      const block = await current.json() as Record<string, any>;
      if (block.id !== blockId || block.type !== 'paragraph' || block.archived === true || block.in_trash === true
        || !Array.isArray(block.paragraph?.rich_text)) throw new Error('Notion slot summary block invalid');
      const existing = block.paragraph.rich_text.map((part: any) => String(part?.plain_text ?? part?.text?.content ?? '')).join('');
      if (existing === summary) return false;
      const response = await transport(url, {
        method: 'PATCH', headers, signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({ paragraph: { rich_text: [{ text: { content: summary } }] } }),
      });
      if (!response.ok) throw new Error(`Notion slot summary update failed: HTTP ${response.status}`);
      const updated = await response.json() as Record<string, any>;
      if (updated.id !== blockId || updated.type !== 'paragraph'
        || updated.paragraph?.rich_text?.map((part: any) => String(part?.plain_text ?? part?.text?.content ?? '')).join('') !== summary)
        throw new Error('Notion slot summary update response invalid');
      return true;
    },
  };
}

export interface NotionSlotLedgerEntry {
  change: number;
  reason: string;
  effectiveDate: string;
}

export function calculateNotionSlotCapacity(entries: readonly NotionSlotLedgerEntry[], today: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today) || entries.length === 0) throw new Error('Notion slot ledger invalid');
  let capacity = 0;
  for (const entry of entries) {
    if (!Number.isSafeInteger(entry.change) || entry.change === 0 || !entry.reason.trim()
      || !/^\d{4}-\d{2}-\d{2}$/.test(entry.effectiveDate)) throw new Error('Notion slot ledger entry invalid');
    if (entry.effectiveDate <= today) capacity += entry.change;
  }
  if (!Number.isSafeInteger(capacity) || capacity < 0 || capacity > 10_000) throw new Error('Notion slot capacity invalid');
  return capacity;
}

export function createNotionSlotLedgerClient(token: string, dataSourceId: string, transport: typeof fetch = fetch) {
  return {
    async readSlotCapacity(today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date())): Promise<number> {
      const entries: NotionSlotLedgerEntry[] = [];
      let cursor: string | undefined;
      do {
        const response = await transport(`https://api.notion.com/v1/data_sources/${encodeURIComponent(dataSourceId)}/query`, {
          method: 'POST', headers: notionHeaders(token), signal: AbortSignal.timeout(15_000),
          body: JSON.stringify({ page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }),
        });
        if (!response.ok) throw new Error(`Notion slot ledger query failed: HTTP ${response.status}`);
        const payload = await response.json() as { results?: unknown[]; has_more?: boolean; next_cursor?: string };
        if (!Array.isArray(payload.results)) throw new Error('Notion slot ledger response invalid');
        for (const value of payload.results) {
          const page = value as Record<string, any>;
          if (page.archived === true || page.in_trash === true) continue;
          const title = page.properties?.['Change / reason']?.title;
          const reason = Array.isArray(title) ? title.map((part: any) => String(part?.plain_text ?? part?.text?.content ?? '')).join('') : '';
          entries.push({ change: page.properties?.['Slot change']?.number,
            effectiveDate: page.properties?.['Effective date']?.date?.start ?? '', reason });
        }
        if (entries.length > 1000) throw new Error('Notion slot ledger exceeds 1000 rows');
        cursor = payload.has_more ? payload.next_cursor : undefined;
        if (payload.has_more && !cursor) throw new Error('Notion slot ledger cursor missing');
      } while (cursor);
      return calculateNotionSlotCapacity(entries, today);
    },
  };
}

export function resolveUniqueDeliveryMatches(
  rows: readonly NotionInvitationRow[],
  deals: readonly NotionDeliveryDeal[],
  emailsByRoom: ReadonlyMap<string, readonly string[] | null>,
): Map<string, NotionDeliveryDeal> {
  const validRows = rows.filter((row) => row.invited && !row.cancelled && normalizeYouTubeInvitationEmail(row.email));
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
    && !row.cancelled
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
  const parts = Array.isArray(title) ? title : [];
  const visibleTitle = parts.map((part: any) => String(part?.plain_text ?? part?.text?.content ?? '')).join('');
  // Notion may merge adjacent unstyled arrow and email fragments in its response.
  // Keep reading the original right-arrow format after switching to a down arrow.
  const emails = parts.flatMap((part: any) => String(part?.plain_text ?? part?.text?.content ?? '')
    .split(/[→↓]/).map((segment) => ({
      email: normalizeYouTubeInvitationEmail(segment.replace(/\s*\((?:new invite|refund)\)\s*$/i, '')),
      struck: part?.annotations?.strikethrough === true,
    }))).filter((part: { email: string | null; struck: boolean }) => Boolean(part.email));
  const active = emails.filter((part: { email: string | null; struck: boolean }) => !part.struck);
  const cancelled = active.length === 0 && emails.length > 0;
  const email = active.length === 1 ? active[0].email! : '';
  const emailHistory = emails.filter((part: { email: string | null; struck: boolean }) => part.struck)
    .map((part: { email: string | null; struck: boolean }) => part.email!);
  const dealParts = page.properties?.['Deal USID']?.rich_text;
  const dealUsid = Array.isArray(dealParts)
    ? dealParts.map((part: any) => part?.plain_text ?? part?.text?.content ?? '').join('').trim() : '';
  const refundMarked = cancelled && /\(refund\)\s*$/i.test(visibleTitle);
  const newInviteMarked = !cancelled && /\(new invite\)\s*$/i.test(visibleTitle);
  return { id: page.id, email, emailHistory, cancelled, refundMarked, newInviteMarked,
    inviteRemoved: page.properties?.['Invite removed']?.checkbox === true,
    invited: page.properties?.Invited?.checkbox === true, dealUsid };
}

function emailTitle(emailHistory: readonly string[], currentEmail: string, cancelled = false) {
  const emails = [...emailHistory, ...(currentEmail ? [currentEmail] : [])];
  if (emails.length === 0 || emails.length > 30 || emails.some((email) => !normalizeYouTubeInvitationEmail(email))) {
    throw new Error('Notion email history invalid');
  }
  return emails.flatMap((email, index) => [
    ...(index ? [{ text: { content: '\n\n↓\n\n' } }] : []),
    { text: { content: email }, annotations: { strikethrough: cancelled || index < emails.length - 1 } },
    ...(index === emails.length - 1 && (cancelled || emailHistory.length > 0)
      ? [{ text: { content: cancelled ? ' (refund)' : ' (new invite)' } }] : []),
  ]);
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
    async createRow(email: string, dealUsid: string, cancelled = false): Promise<NotionInvitationRow> {
      const response = await transport('https://api.notion.com/v1/pages', {
        method: 'POST', headers, signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({ parent: { type: 'data_source_id', data_source_id: dataSourceId },
          properties: {
            'Customer email': { title: emailTitle([], email, cancelled) },
            Invited: { checkbox: false },
            'Invite removed': { checkbox: false },
            'Deal USID': { rich_text: [{ text: { content: dealUsid } }] },
          } }),
      });
      if (!response.ok) throw new Error(`Notion create page failed: HTTP ${response.status}`);
      const row = parseNotionRow(await response.json());
      if (!row || row.dealUsid !== dealUsid || row.invited || row.cancelled !== cancelled
        || (cancelled && !row.refundMarked)
        || (cancelled ? row.emailHistory?.slice(-1)[0] !== email || row.email !== '' : row.email !== email)) {
        throw new Error('Notion created page response invalid');
      }
      return row;
    },
    async bindRow(id: string, dealUsid: string): Promise<NotionInvitationRow> {
      const response = await transport(`https://api.notion.com/v1/pages/${encodeURIComponent(id)}`, {
        method: 'PATCH', headers, signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({ properties: {
          'Deal USID': { rich_text: [{ text: { content: dealUsid } }] },
          Invited: { checkbox: false },
          'Invite removed': { checkbox: false },
        } }),
      });
      if (!response.ok) throw new Error(`Notion update page failed: HTTP ${response.status}`);
      const row = parseNotionRow(await response.json());
      if (!row || row.dealUsid !== dealUsid || row.invited) throw new Error('Notion updated page response invalid');
      return row;
    },
    async updateRowEmail(row: NotionInvitationRow, email: string): Promise<NotionInvitationRow> {
      const oldEmail = normalizeYouTubeInvitationEmail(row.email);
      const pending = isPendingNewInviteRow(row);
      const history = [...(row.emailHistory ?? []), ...(oldEmail ? [oldEmail] : [])];
      if ((!oldEmail && !pending) || (row.cancelled && !pending) || history.includes(email))
        throw new Error('Notion email replacement invalid');
      const response = await transport(`https://api.notion.com/v1/pages/${encodeURIComponent(row.id)}`, {
        method: 'PATCH', headers, signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({ properties: {
          'Customer email': { title: emailTitle(history, email) },
          Invited: { checkbox: false },
          'Invite removed': { checkbox: false },
        } }),
      });
      if (!response.ok) throw new Error(`Notion replace email failed: HTTP ${response.status}`);
      const replacement = parseNotionRow(await response.json());
      if (!replacement || replacement.email !== email || replacement.invited || replacement.cancelled
        || !replacement.newInviteMarked
        || replacement.emailHistory?.length !== history.length) {
        throw new Error('Notion replaced email response invalid');
      }
      return replacement;
    },
    async cancelRow(row: NotionInvitationRow): Promise<NotionInvitationRow> {
      const email = normalizeYouTubeInvitationEmail(row.email);
      const history = [...(row.emailHistory ?? []), ...(email ? [email] : [])];
      if (history.length === 0 || (row.cancelled && row.refundMarked && !row.invited))
        throw new Error('Notion cancellation invalid');
      const response = await transport(`https://api.notion.com/v1/pages/${encodeURIComponent(row.id)}`, {
        method: 'PATCH', headers, signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({ properties: {
          'Customer email': { title: emailTitle(history, '', true) },
          Invited: { checkbox: false },
          'Invite removed': { checkbox: false },
        } }),
      });
      if (!response.ok) throw new Error(`Notion cancel email failed: HTTP ${response.status}`);
      const cancelledRow = parseNotionRow(await response.json());
      if (!cancelledRow || !cancelledRow.cancelled || !cancelledRow.refundMarked
        || cancelledRow.invited || cancelledRow.email
        || cancelledRow.emailHistory?.length !== history.length) {
        throw new Error('Notion cancelled email response invalid');
      }
      return cancelledRow;
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
  const ledgerDataSourceId = process.env.NOTION_SLOT_LEDGER_DATA_SOURCE_ID?.trim() || DEFAULT_SLOT_LEDGER_DATA_SOURCE_ID;
  const summaryBlockId = process.env.NOTION_SLOT_SUMMARY_BLOCK_ID?.trim() || DEFAULT_SLOT_SUMMARY_BLOCK_ID;
  if (!token || !/^[a-f0-9-]{32,36}$/i.test(dataSourceId)) {
    console.error('[NotionInvitationSync] Notion connection is not configured');
    return;
  }
  const client = createNotionInvitationClient(token, dataSourceId);
  const ledger = createNotionSlotLedgerClient(token, ledgerDataSourceId);
  const summary = createNotionSlotSummaryClient(token, summaryBlockId);
  const journalPath = process.env.NOTION_INVITATION_JOURNAL_PATH || DEFAULT_JOURNAL_PATH;
  const lockPath = process.env.NOTION_INVITATION_LOCK_PATH || DEFAULT_LOCK_PATH;
  const intervalMs = Math.max(30_000, Number(process.env.NOTION_INVITATION_INTERVAL_MS) || DEFAULT_INTERVAL_MS);
  const run = createSingleFlightRunner(async () => {
    if (loadSafeModeConfig().enabled) return;
    await runWithExclusivePollLock(lockPath, async () => {
      try {
        if (importEnabled) {
          const imported = await syncNotionBuyerEmails({ ...client, ...ledger, ...dependencies,
            readSlotCapacity: () => ledger.readSlotCapacity().catch((error: unknown) => {
              console.error('[NotionInvitationSync] slot ledger unavailable',
                error instanceof Error ? error.message : 'unknown error');
              return null;
            }),
          });
          if (imported.created || imported.bound || imported.updated || imported.cancelled || imported.capacityBlocked)
            console.log('[NotionInvitationSync] emails', imported);
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
      try {
        const capacity = await ledger.readSlotCapacity();
        const occupied = occupiedNotionSlots(await client.listRows());
        if (await summary.update(capacity, occupied))
          console.log('[NotionInvitationSync] slot summary', { capacity, occupied });
      } catch (error) {
        console.error('[NotionInvitationSync] slot summary failed', error instanceof Error ? error.message : 'unknown error');
      }
    });
  });
  setTimeout(() => { void run(); setInterval(() => { void run(); }, intervalMs); }, 10_000);
}
