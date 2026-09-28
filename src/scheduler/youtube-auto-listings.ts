import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { isYouTubeInvitationSellerDeal } from '../api/youtube-auto-reply';
import { writeJsonAtomic } from '../lib/graytag-sales-session';
import { removeYouTubeListingCode, youtubeListingCodeFromManagerEmail } from '../lib/youtube-listing-code';
import { normalizeYouTubeManagerEmail, type YouTubeFamilyGroup } from '../lib/youtube-invitations';
import { loadSafeModeConfig } from '../api/safe-mode';
import { createSingleFlightRunner, runWithExclusivePollLock } from './poll-daemon';

export const DEFAULT_YOUTUBE_AUTO_LISTING_STATE_PATH =
  '/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data/youtube-auto-listings.json';
export const DEFAULT_YOUTUBE_AUTO_LISTING_LOCK_PATH =
  '/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data/youtube-auto-listings.lock';

const BATCH_SIZE = 5;
const DAILY_PRICE = 150;

type Template = { name: string; sellingGuide: string };
type QueuedManager = { id: string; managerEmail: string; addedAt: string };
type PendingBatch = {
  id: string;
  queueId: string;
  managerEmail: string;
  label: string;
  endDate: string;
  price: number;
  template: Template;
  groupId: string | null;
  productUsids: string[];
  startedAt: string;
};
type CompletedBatch = Pick<PendingBatch, 'label' | 'groupId' | 'productUsids'> & { completedAt: string };

export interface YouTubeAutoListingState {
  version: 1;
  queue: QueuedManager[];
  trackedListingUsids: string[];
  template: Template | null;
  batch: PendingBatch | null;
  lastBatch: CompletedBatch | null;
  lastCheck: { at: string; available: number | null; onSale: number | null; reason: string } | null;
}

export interface SellerProductObservation { authoritative: boolean; rows: readonly unknown[] }
export interface YouTubeAutoListingDependencies {
  readState(): YouTubeAutoListingState;
  writeState(state: YouTubeAutoListingState): void;
  readNotionSlots(): Promise<{ available: number }>;
  listGroups(): Promise<YouTubeFamilyGroup[]>;
  listSellerProducts(): Promise<SellerProductObservation>;
  listProductStatuses(): Promise<{ authoritative: boolean; rows: Array<{ productUsid: string; status: string }> }>;
  createGroup(input: { label: string; managerEmail: string; subscriptionEndDate: string; sellableSeats: number }): Promise<YouTubeFamilyGroup>;
  registerProduct(input: {
    familyGroupId: string; endDate: string; price: number; name: string;
    sellingGuide: string; idempotencyKey: string;
  }): Promise<{ status: 'registered'; productUsid: string } | { status: 'uncertain' }>;
  now?(): Date;
  makeId?(): string;
}

export type AutoListingReason = 'existing_listings_for_sale' | 'notion_slots_below_five'
  | 'no_queued_manager' | 'template_unavailable' | 'ambiguous_template' | 'seller_unavailable'
  | 'registration_uncertain' | 'batch_completed' | 'group_conflict' | 'sale_unconfirmed';

export function emptyYouTubeAutoListingState(): YouTubeAutoListingState {
  return { version: 1, queue: [], trackedListingUsids: [], template: null, batch: null, lastBatch: null, lastCheck: null };
}

export function readYouTubeAutoListingState(path = DEFAULT_YOUTUBE_AUTO_LISTING_STATE_PATH): YouTubeAutoListingState {
  if (!existsSync(path)) return emptyYouTubeAutoListingState();
  const value = JSON.parse(readFileSync(path, 'utf8')) as YouTubeAutoListingState;
  if (value?.version !== 1 || !Array.isArray(value.queue) || !Array.isArray(value.trackedListingUsids) || !('template' in value)
    || !('batch' in value) || !('lastBatch' in value) || !('lastCheck' in value))
    throw new Error('YouTube auto listing state invalid');
  return value;
}

export function writeYouTubeAutoListingState(state: YouTubeAutoListingState,
  path = DEFAULT_YOUTUBE_AUTO_LISTING_STATE_PATH): void {
  writeJsonAtomic(path, state);
}

export function enqueueYouTubeAutoListingManager(
  state: YouTubeAutoListingState, value: string,
  groups: readonly YouTubeFamilyGroup[], now = new Date(),
): YouTubeAutoListingState {
  const managerEmail = normalizeYouTubeManagerEmail(value);
  if (!managerEmail) throw new Error('invalid manager email');
  if (groups.some((group) => group.managerEmail.toLowerCase() === managerEmail)
    || state.queue.some((item) => item.managerEmail === managerEmail)) throw new Error('duplicate manager email');
  return { ...state, queue: [...state.queue, { id: randomUUID(), managerEmail, addedAt: now.toISOString() }] };
}

export function removeQueuedYouTubeAutoListingManager(state: YouTubeAutoListingState, id: string): YouTubeAutoListingState {
  if (state.batch?.queueId === id) throw new Error('manager is in an active batch');
  if (!state.queue.some((item) => item.id === id)) throw new Error('manager not found');
  return { ...state, queue: state.queue.filter((item) => item.id !== id) };
}

function seoulDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul',
    year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function oneYearAfterSeoulDate(now: Date): string {
  const [year, month, day] = seoulDate(now).split('-').map(Number);
  const lastDay = new Date(Date.UTC(year + 1, month, 0)).getUTCDate();
  return `${year + 1}-${String(month).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}

function remainingDays(today: string, endDate: string): number {
  const start = Date.parse(`${today}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  const days = Math.round((end - start) / 86_400_000);
  if (!Number.isSafeInteger(days) || days <= 0) throw new Error('YouTube auto listing end date invalid');
  return days;
}

function nextGroupLabel(groups: readonly YouTubeFamilyGroup[]): string {
  const numbers = groups.map((group) => /^(\d+)호기$/.exec(group.label.trim()))
    .filter((match): match is RegExpExecArray => Boolean(match))
    .map((match) => Number(match[1]));
  const next = Math.max(0, ...numbers) + 1;
  if (!Number.isSafeInteger(next) || next > 10_000) throw new Error('YouTube family group number invalid');
  return `${next}호기`;
}

function onSaleYouTubeProducts(rows: readonly unknown[]): Record<string, unknown>[] {
  return rows.filter((row): row is Record<string, unknown> => row !== null && typeof row === 'object'
    && !Array.isArray(row) && (row as Record<string, unknown>).dealStatus === 'OnSale'
    && isYouTubeInvitationSellerDeal(row as Record<string, unknown>));
}

function templateFrom(rows: readonly Record<string, unknown>[], groups: readonly YouTubeFamilyGroup[]): Template | null {
  if (!rows.length) return null;
  const templates = rows.map((row) => {
    let name = String(row.productName ?? row.name ?? '').trim();
    for (const group of groups) name = removeYouTubeListingCode(name,
      youtubeListingCodeFromManagerEmail(group.managerEmail));
    return { name, sellingGuide: String(row.sellingGuide ?? '').trim() };
  });
  const first = templates[0];
  if (!first.name || !first.sellingGuide || Array.from(first.sellingGuide).length > 300
    || templates.some((item) => item.name !== first.name || item.sellingGuide !== first.sellingGuide)) return null;
  return first;
}

export async function syncYouTubeAutoListings(deps: YouTubeAutoListingDependencies): Promise<{
  reason: AutoListingReason; createdGroup: boolean; registered: number;
}> {
  const state = deps.readState();
  const now = deps.now?.() ?? new Date();
  const [slots, groups, observation] = await Promise.all([
    deps.readNotionSlots(), deps.listGroups(), deps.listSellerProducts(),
  ]);
  const available = slots.available;
  if (!Number.isSafeInteger(available) || available < 0) throw new Error('Notion available slots invalid');
  const onSale = observation.authoritative && Array.isArray(observation.rows)
    ? onSaleYouTubeProducts(observation.rows) : [];
  const finish = (reason: AutoListingReason, createdGroup = false, registered = 0) => {
    state.lastCheck = { at: now.toISOString(), available, onSale: observation.authoritative ? onSale.length : null, reason };
    deps.writeState(state);
    return { reason, createdGroup, registered };
  };
  if (!observation.authoritative || !Array.isArray(observation.rows)) return finish('seller_unavailable');
  if (onSale.length) {
    const template = templateFrom(onSale, groups);
    if (!template) { state.template = null; return finish('ambiguous_template'); }
    state.template = template;
    state.trackedListingUsids = [...new Set([...state.trackedListingUsids,
      ...onSale.map((row) => String(row.productUsid ?? '')).filter((id) => /^[A-Za-z0-9_-]{1,128}$/.test(id))])];
  }
  if (!state.batch && onSale.length) return finish('existing_listings_for_sale');
  if (!state.batch && available < BATCH_SIZE) return finish('notion_slots_below_five');
  if (!state.batch && !state.queue.length) return finish('no_queued_manager');
  if (!state.batch) {
    if (!state.trackedListingUsids.length) return finish('sale_unconfirmed');
    const statuses = await deps.listProductStatuses();
    if (!statuses.authoritative || !Array.isArray(statuses.rows)) return finish('seller_unavailable');
    const byProduct = new Map<string, Set<string>>();
    for (const row of statuses.rows) {
      const values = byProduct.get(row.productUsid) ?? new Set<string>();
      values.add(row.status);
      byProduct.set(row.productUsid, values);
    }
    const soldStatuses = new Set(['Reserved', 'LendingAcceptanceWaiting', 'Delivering',
      'Delivered', 'DeliveredAndCheckPrepaid', 'Using', 'UsingNearExpiration', 'NormalFinished']);
    if (state.trackedListingUsids.some((id) => {
      const values = byProduct.get(id);
      return !values?.size || [...values].some((status) => !soldStatuses.has(status));
    })) return finish('sale_unconfirmed');
  }
  if (!state.batch && !state.template) return finish('template_unavailable');

  if (!state.batch) {
    const manager = state.queue[0];
    if (groups.some((group) => group.managerEmail.toLowerCase() === manager.managerEmail)) return finish('group_conflict');
    state.batch = {
      id: deps.makeId?.() ?? randomUUID(), queueId: manager.id, managerEmail: manager.managerEmail,
      label: nextGroupLabel(groups), endDate: oneYearAfterSeoulDate(now),
      price: remainingDays(seoulDate(now), oneYearAfterSeoulDate(now)) * DAILY_PRICE,
      template: state.template!, groupId: null, productUsids: [], startedAt: now.toISOString(),
    };
    deps.writeState(state);
  }
  const batch = state.batch;
  if (!Number.isSafeInteger(batch.price) || batch.price <= 0) throw new Error('YouTube auto listing batch price invalid');
  if (available < BATCH_SIZE - batch.productUsids.length) return finish('notion_slots_below_five');
  if (onSale.some((row) => !batch.productUsids.includes(String(row.productUsid ?? ''))))
    return finish('existing_listings_for_sale');

  let createdGroup = false;
  if (!batch.groupId) {
    if (groups.some((group) => group.label === batch.label && group.managerEmail.toLowerCase() !== batch.managerEmail))
      return finish('group_conflict');
    const matches = groups.filter((group) => group.managerEmail.toLowerCase() === batch.managerEmail);
    if (matches.length > 1 || matches.length === 1 && (matches[0].label !== batch.label
      || matches[0].subscriptionEndDate !== batch.endDate || matches[0].sellableSeats !== BATCH_SIZE
      || !matches[0].enabled)) return finish('group_conflict');
    const group = matches[0] ?? await deps.createGroup({ label: batch.label,
      managerEmail: batch.managerEmail, subscriptionEndDate: batch.endDate, sellableSeats: BATCH_SIZE });
    if (!group.id || group.managerEmail.toLowerCase() !== batch.managerEmail
      || group.label !== batch.label || group.subscriptionEndDate !== batch.endDate
      || group.sellableSeats !== BATCH_SIZE || !group.enabled) return finish('group_conflict');
    batch.groupId = group.id;
    createdGroup = !matches.length;
    deps.writeState(state);
  }

  let registered = 0;
  for (let index = batch.productUsids.length; index < BATCH_SIZE; index += 1) {
    const idempotencyKey = `yt-auto-${batch.id}-${index + 1}`;
    let result: Awaited<ReturnType<typeof deps.registerProduct>>;
    try {
      result = await deps.registerProduct({ familyGroupId: batch.groupId!,
        endDate: `${batch.endDate.replaceAll('-', '')}T2359`, price: batch.price,
        name: batch.template.name, sellingGuide: batch.template.sellingGuide, idempotencyKey });
    } catch { return finish('registration_uncertain', createdGroup, registered); }
    if (result.status !== 'registered' || !/^[A-Za-z0-9_-]{1,128}$/.test(result.productUsid))
      return finish('registration_uncertain', createdGroup, registered);
    batch.productUsids.push(result.productUsid);
    registered += 1;
    deps.writeState(state);
  }
  state.lastBatch = { label: batch.label, groupId: batch.groupId, productUsids: batch.productUsids,
    completedAt: (deps.now?.() ?? new Date()).toISOString() };
  state.trackedListingUsids = [...batch.productUsids];
  state.queue = state.queue.filter((manager) => manager.id !== batch.queueId);
  state.batch = null;
  return finish('batch_completed', createdGroup, registered);
}

export function startYouTubeAutoListings(deps: Omit<YouTubeAutoListingDependencies, 'readState' | 'writeState'>): void {
  if (process.env.YOUTUBE_AUTO_LISTING_ENABLED !== 'true') return;
  const statePath = process.env.YOUTUBE_AUTO_LISTING_STATE_PATH || DEFAULT_YOUTUBE_AUTO_LISTING_STATE_PATH;
  const lockPath = process.env.YOUTUBE_AUTO_LISTING_LOCK_PATH || DEFAULT_YOUTUBE_AUTO_LISTING_LOCK_PATH;
  const intervalMs = Math.max(60_000, Number(process.env.YOUTUBE_AUTO_LISTING_INTERVAL_MS) || 300_000);
  const run = createSingleFlightRunner(async () => {
    if (loadSafeModeConfig().enabled) return;
    await runWithExclusivePollLock(lockPath, async () => {
      try {
        const result = await syncYouTubeAutoListings({ ...deps,
          readState: () => readYouTubeAutoListingState(statePath),
          writeState: (state) => writeYouTubeAutoListingState(state, statePath),
        });
        if (result.createdGroup || result.registered || result.reason === 'registration_uncertain'
          || result.reason === 'group_conflict') console.log('[YouTubeAutoListings]', result);
      } catch (error) {
        console.error('[YouTubeAutoListings] sync failed', error instanceof Error ? error.message : 'unknown error');
      }
    });
  });
  void run();
  setInterval(() => { void run(); }, intervalMs);
}
