import { existsSync, readFileSync } from 'node:fs';
import { isYouTubeInvitationSellerDeal } from '../api/youtube-auto-reply';
import { loadSafeModeConfig } from '../api/safe-mode';
import { writeJsonAtomic } from '../lib/graytag-sales-session';
import { createSingleFlightRunner, runWithExclusivePollLock } from './poll-daemon';
import type { NotionDeliveryDeal } from './notion-invitation-sync';

const DEFAULT_JOURNAL = '/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data/youtube-buyer-guide.json';
const DEFAULT_LOCK = '/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data/youtube-buyer-guide.lock';

type GuideState = 'baseline' | 'attempted' | 'sent' | 'skipped';
export interface GuideJournal {
  version: 1;
  records: Record<string, { state: GuideState; updatedAt: string }>;
}

export interface BuyerGuideDependencies {
  listDeals(): Promise<NotionDeliveryDeal[] | null>;
  buyerEmails(room: string): Promise<string[] | null>;
  validateChat(room: string): Promise<void>;
  sendGuide(deal: NotionDeliveryDeal): Promise<boolean>;
  readJournal(): GuideJournal | null;
  writeJournal(journal: GuideJournal): void;
  now?(): string;
}

function eligible(deal: NotionDeliveryDeal): boolean {
  return Boolean(deal.dealUsid && deal.chatRoomUuid && deal.dealStatus === 'Delivering'
    && isYouTubeInvitationSellerDeal(deal));
}

export async function syncYouTubeBuyerGuides(deps: BuyerGuideDependencies): Promise<{
  baselined: number; sent: number; skipped: number; attempted: number;
}> {
  const deals = await deps.listDeals();
  if (!deals) throw new Error('YouTube seller deals unavailable');
  const now = () => deps.now?.() ?? new Date().toISOString();
  let journal = deps.readJournal();
  if (!journal) {
    journal = { version: 1, records: {} };
    for (const deal of deals.filter(eligible)) {
      journal.records[deal.dealUsid] = { state: 'baseline', updatedAt: now() };
    }
    deps.writeJournal(journal);
    return { baselined: Object.keys(journal.records).length, sent: 0, skipped: 0, attempted: 0 };
  }
  let sent = 0;
  let skipped = 0;
  let attempted = 0;
  for (const deal of deals.filter(eligible)) {
    if (journal.records[deal.dealUsid]) continue;
    const emails = await deps.buyerEmails(deal.chatRoomUuid);
    if (emails === null) continue;
    if (emails.length > 0) {
      journal.records[deal.dealUsid] = { state: 'skipped', updatedAt: now() };
      deps.writeJournal(journal);
      skipped += 1;
      continue;
    }
    try { await deps.validateChat(deal.chatRoomUuid); } catch { continue; }
    journal.records[deal.dealUsid] = { state: 'attempted', updatedAt: now() };
    deps.writeJournal(journal);
    attempted += 1;
    try {
      if (await deps.sendGuide(deal)) {
        journal.records[deal.dealUsid] = { state: 'sent', updatedAt: now() };
        deps.writeJournal(journal);
        sent += 1;
      }
    } catch { /* A transport error may follow a successful send. Never send twice. */ }
  }
  return { baselined: 0, sent, skipped, attempted };
}

function readJournal(path: string): GuideJournal | null {
  if (!existsSync(path)) return null;
  const value = JSON.parse(readFileSync(path, 'utf8')) as GuideJournal;
  if (value?.version !== 1 || !value.records || typeof value.records !== 'object'
    || Array.isArray(value.records)) throw new Error('YouTube buyer guide journal invalid');
  return value;
}

export function startYouTubeBuyerGuide(dependencies: Pick<BuyerGuideDependencies,
  'listDeals' | 'buyerEmails' | 'validateChat' | 'sendGuide'>): void {
  if (process.env.YOUTUBE_INVITE_AUTO_MESSAGE_ENABLED !== 'true') return;
  const journalPath = process.env.YOUTUBE_BUYER_GUIDE_JOURNAL_PATH || DEFAULT_JOURNAL;
  const lockPath = process.env.YOUTUBE_BUYER_GUIDE_LOCK_PATH || DEFAULT_LOCK;
  const intervalMs = Math.max(30_000, Number(process.env.YOUTUBE_BUYER_GUIDE_INTERVAL_MS) || 60_000);
  const run = createSingleFlightRunner(async () => {
    if (process.env.AUTO_REPLY_ENABLE_SEND !== 'true' || loadSafeModeConfig().enabled) return;
    await runWithExclusivePollLock(lockPath, async () => {
      try {
        const result = await syncYouTubeBuyerGuides({
          ...dependencies,
          readJournal: () => readJournal(journalPath),
          writeJournal: (journal) => writeJsonAtomic(journalPath, journal),
        });
        if (result.baselined || result.sent || result.skipped || result.attempted) {
          console.log('[YouTubeBuyerGuide] sync', result);
        }
      } catch (error) {
        console.error('[YouTubeBuyerGuide] sync failed', error instanceof Error ? error.message : 'unknown error');
      }
    });
  });
  setTimeout(() => { void run(); setInterval(() => { void run(); }, intervalMs); }, 10_000);
}
