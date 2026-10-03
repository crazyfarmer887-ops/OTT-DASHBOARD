import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  fetchNotionDeliveryBuyerEmails,
  fetchNotionDeliveryDeals,
  fetchYouTubeInvitationProviderStatus,
  finishYouTubeInvitationDelivery,
} from '../src/api/index.ts';
import { isYouTubeInvitationSellerDeal } from '../src/api/youtube-auto-reply.ts';
import { writeJsonAtomic } from '../src/lib/graytag-sales-session.ts';
import { normalizeYouTubeInvitationEmail } from '../src/lib/youtube-invitations.ts';
import { createNotionInvitationClient, resolveUniqueDeliveryMatches } from '../src/scheduler/notion-invitation-sync.ts';

const journalPath = process.env.NOTION_INVITATION_JOURNAL_PATH
  || '/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data/notion-invitation-deliveries.json';
const cutoff = Date.parse('2026-09-23T14:40:00Z');
const execute = process.argv.includes('--execute');
const rowIds = process.argv.slice(2).filter((arg) => arg !== '--execute');
if (!rowIds.length || rowIds.some((id) => !/^[a-f0-9-]{36}$/i.test(id))) {
  throw new Error('Pass exact Notion row IDs to recover');
}
const token = process.env.NOTION_API_TOKEN;
const sourceId = process.env.NOTION_INVITATION_DATA_SOURCE_ID;
if (!token || !sourceId) throw new Error('Notion connection unavailable');

type RecordState = { state: string; dealUsid: string; emailHash: string; updatedAt: string; recoveryAttemptedAt?: string };
type Journal = { version: 1; records: Record<string, RecordState> };
const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as Journal;
if (journal.version !== 1) throw new Error('Unexpected journal version');
const client = createNotionInvitationClient(token, sourceId);
const rows = await client.listCheckedRows();
const deals = await fetchNotionDeliveryDeals();
if (!deals) throw new Error('Seller deals unavailable');
const delivering = deals.filter((deal) => deal.dealStatus === 'Delivering' && isYouTubeInvitationSellerDeal(deal));
const emailsByRoom = new Map<string, string[] | null>();
for (const deal of delivering) emailsByRoom.set(deal.chatRoomUuid, await fetchNotionDeliveryBuyerEmails(deal.chatRoomUuid));
const matches = resolveUniqueDeliveryMatches(rows, delivering, emailsByRoom);

for (const rowId of rowIds) {
  const row = rows.find((candidate) => candidate.id === rowId);
  const deal = matches.get(rowId);
  const record = journal.records[rowId];
  const email = normalizeYouTubeInvitationEmail(row?.email);
  const hash = email ? createHash('sha256').update(email).digest('hex') : '';
  if (!row || !deal || !record || record.state !== 'attempted' || record.recoveryAttemptedAt
    || record.dealUsid !== deal.dealUsid || record.emailHash !== hash
    || !(Date.parse(record.updatedAt) < cutoff)) {
    console.log(JSON.stringify({ rowId, result: 'not_eligible' }));
    continue;
  }
  const current = await client.getRow(rowId);
  const status = await fetchYouTubeInvitationProviderStatus(deal.dealUsid);
  if (!current?.invited || current.dealUsid !== deal.dealUsid
    || normalizeYouTubeInvitationEmail(current.email) !== email || status !== 'Delivering') {
    console.log(JSON.stringify({ rowId, result: 'state_changed', providerStatus: status }));
    continue;
  }
  if (!execute) {
    console.log(JSON.stringify({ rowId, result: 'eligible_dry_run' }));
    continue;
  }
  record.recoveryAttemptedAt = new Date().toISOString();
  writeJsonAtomic(journalPath, journal);
  try {
    const response = await finishYouTubeInvitationDelivery(deal.dealUsid);
    const payload = await response.json().catch(() => null) as { succeeded?: unknown } | null;
    const after = await fetchYouTubeInvitationProviderStatus(deal.dealUsid);
    if (after === 'Delivered') {
      record.state = 'confirmed';
      record.updatedAt = new Date().toISOString();
      writeJsonAtomic(journalPath, journal);
    }
    console.log(JSON.stringify({ rowId, result: 'sent', httpStatus: response.status,
      succeeded: payload?.succeeded === true, providerStatus: after }));
  } catch {
    console.log(JSON.stringify({ rowId, result: 'outcome_unknown' }));
  }
}
