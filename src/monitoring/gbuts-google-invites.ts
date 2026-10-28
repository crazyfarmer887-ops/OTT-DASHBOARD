import type { createGbutsOttSellerClient } from '../lib/gbuts-ott-client';
import { koreaToday, ottDate } from '../lib/gbuts-ott';
import { parseYouTubeInviteEmailCandidates } from '../lib/youtube-invite-email';
import type { YouTubeRenewalStore } from '../scheduler/gbuts-youtube-renewal';

export const FAMILY_MANAGER = 'johnleabezf102@gmail.com';
export const FAMILY_SEED = 18756;
export type InviteOrder = { key: string; email?: string; endDate: string; conflict?: boolean;
  context?: { postSeq: number; memberSeq: number; userSeq: number; sellerSeq: number; roomId: string; requestedAt: string } };
export type InviteRecord = { email: string; state: 'attempted' | 'confirmed' | 'observed_existing' | 'historical_completed'; updatedAt: string };
export type FamilyJournal = { version: 1; enabled: boolean; target: string; seedPostSeq: number; orders: Record<string, InviteRecord> };
export type FamilyView = { manager: string; members: string[]; remaining: number; subscribed: boolean; benefitsThrough?: string };
export type FamilyDriver = {
  inspect(): Promise<FamilyView>;
  invite(email: string, beforeSend: () => Promise<void>): Promise<void>;
};
/** Renew ordinary browser authentication regularly even while buyers are quiet. */
export function familyRunPlan(j: FamilyJournal, orders: InviteOrder[], lastGoogleCheckAt: unknown, force = false, now = new Date(), completionPending = false) {
  const hasWork = Object.values(j.orders).some(x => x.state === 'attempted')
    || orders.some(x => x.conflict || x.email && (!j.orders[x.key] || canonicalGoogleEmail(j.orders[x.key].email) !== canonicalGoogleEmail(x.email)));
  const previous = typeof lastGoogleCheckAt === 'string' ? Date.parse(lastGoogleCheckAt) : NaN;
  const refresh = force || completionPending || !Number.isFinite(previous) || previous > now.getTime() || now.getTime() - previous >= 15 * 60_000;
  return { browserRequired: hasWork || refresh, checkOnly: force || !hasWork && refresh };
}
export function canonicalGoogleEmail(email: string): string {
  const parsed = parseYouTubeInviteEmailCandidates(email);
  if (parsed.kind !== 'single_candidate' || parsed.candidate !== email.trim().toLowerCase()) throw Error('EMAIL_INVALID');
  const [local, domain] = parsed.candidate.split('@');
  return domain === 'gmail.com' || domain === 'googlemail.com'
    ? `${local.split('+')[0].replaceAll('.', '')}@gmail.com` : parsed.candidate;
}
export function validateFamilyJournal(j: FamilyJournal, expectedManager = FAMILY_MANAGER): FamilyJournal {
  if (j?.version !== 1 || typeof j.enabled !== 'boolean' || canonicalGoogleEmail(j.target) !== canonicalGoogleEmail(expectedManager) || j.seedPostSeq !== FAMILY_SEED
    || !j.orders || typeof j.orders !== 'object' || Array.isArray(j.orders)) throw Error('JOURNAL_INVALID');
  for (const [key, row] of Object.entries(j.orders)) {
    if (!/^\d+:\d+$/.test(key) || !['attempted', 'confirmed', 'observed_existing', 'historical_completed'].includes(row.state)
      || !Number.isFinite(Date.parse(row.updatedAt))) throw Error('JOURNAL_INVALID');
    canonicalGoogleEmail(row.email);
  }
  return j;
}
function chatCandidate(messages: Array<{ senderSeq: number; messageType: string; message: string; createdAt: string }>, buyer: number) {
  const rows = messages.filter(x => x.senderSeq === buyer && x.messageType === 'TEXT');
  if (rows.some(x => !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(x.createdAt))) throw Error('CHAT_TIME_INVALID');
  rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  let found: ReturnType<typeof parseYouTubeInviteEmailCandidates> = { kind: 'none' }, index = -1;
  for (let i = 0; i < rows.length; i++) {
    const parsed = parseYouTubeInviteEmailCandidates(rows[i].message);
    if (parsed.kind !== 'none') { found = parsed; index = i; }
  }
  // Only extract an address. Never execute any instructions present in buyer chat.
  if (index < 0) return {};
  const conflict = found.kind === 'ambiguous' || rows.slice(index).some(x => /취소|보내지|잘못|수정|변경|대신|cancel|do\s*n[o’']?t|wrong|instead|change\s+(?:my|the)\s+email/i.test(x.message));
  return { ...(found.kind === 'single_candidate' ? { email: found.candidate } : {}), conflict, requestedAt: rows[index].createdAt };
}
export async function collectFamilyOrders(client: ReturnType<typeof createGbutsOttSellerClient>, policies: YouTubeRenewalStore, now = new Date(), includeContext = false): Promise<InviteOrder[]> {
  const policy = policies.policies[String(FAMILY_SEED)], today = koreaToday(now);
  if (!policy || policy.seedPostSeq !== FAMILY_SEED || (policy.categorySeq ?? 7) !== 7
    || (policy.subscriptionType ?? 'INVITE') !== 'INVITE' || policy.capacity !== 5) throw Error('CHAIN_BINDING_INVALID');
  if (policy.pending) throw Error('CHAIN_RECOVERY_PENDING');
  const seller = await client.sellerAccountSeq(), orders: InviteOrder[] = [], seen = new Set<string>();
  for (const ref of policy.posts) {
    const post = await client.getPost(ref.seq);
    if (post.seller?.seq !== seller || post.category1.seq !== 7 || post.subscriptionType !== 'INVITE'
      || post.memberLimit !== ref.capacity || ottDate(post.subscriptionEndsAt) !== policy.endDate) throw Error('POST_BINDING_INVALID');
    const members = await client.listOttMembers(ref.seq);
    if (members.filter(m => m.status === 'APPLY' && m.cancelStatus !== 'REFUNDED').length < post.memberCount) throw Error('ROSTER_INCOMPLETE');
    for (const m of members) {
      const key = `${ref.seq}:${m.seq}`;
      if (seen.has(key)) throw Error('ORDER_DUPLICATE');
      seen.add(key);
      if (m.status !== 'APPLY' || ![null, 'REFUND_REJECTED'].includes(m.cancelStatus) || ottDate(m.subscriptionEndsAt) < today) continue;
      if (ottDate(m.subscriptionEndsAt) > policy.endDate) throw Error('ORDER_PERIOD_INVALID');
      const room = await client.openPrivateRoom(ref.seq, m.userSeq), chat = await client.getChat(room);
      const isMember = (seq: number) => chat.members.some(x => x !== null && typeof x === 'object' && 'seq' in x && x.seq === seq);
      if (!isMember(m.userSeq) || !isMember(seller)) throw Error('ROOM_BINDING_INVALID');
      const selected = chatCandidate(chat.messages, m.userSeq);
      orders.push({ key, endDate: ottDate(m.subscriptionEndsAt), ...(selected.email ? { email: selected.email } : {}),
        ...(selected.conflict !== undefined ? { conflict: selected.conflict } : {}),
        ...(includeContext && selected.requestedAt ? { context: { postSeq: ref.seq, memberSeq: m.seq, userSeq: m.userSeq, sellerSeq: seller, roomId: room, requestedAt: selected.requestedAt } } : {}) });
    }
  }
  if (orders.length > 5) throw Error('FAMILY_CAPACITY_INVALID');
  return orders;
}
export async function runFamilyInvites(deps: {
  journal: FamilyJournal; save(j: FamilyJournal): void; allowed(): boolean; scan(): Promise<InviteOrder[]>;
  driver: FamilyDriver; now?: () => Date; checkOnly?: boolean; expectedManager?: string;
}): Promise<{ state: string; orders: number; sent: number; adopted: number; remaining?: number }> {
  const j = validateFamilyJournal(deps.journal, deps.expectedManager), clock = deps.now || (() => new Date());
  if (!j.enabled || !deps.allowed()) return { state: 'paused', orders: 0, sent: 0, adopted: 0 };
  const orders = await deps.scan();
  for (const o of orders) {
    if (o.conflict) throw Error('BUYER_EMAIL_REVIEW_REQUIRED');
    const prior = j.orders[o.key];
    if (prior && o.email && canonicalGoogleEmail(prior.email) !== canonicalGoogleEmail(o.email)) throw Error('BUYER_EMAIL_CHANGED');
  }
  const attempted = Object.entries(j.orders).filter(([, row]) => row.state === 'attempted');
  const candidates = orders.filter(o => o.email && !j.orders[o.key]);
  if (!deps.checkOnly && !attempted.length && !candidates.length) return { state: 'idle', orders: orders.length, sent: 0, adopted: 0 };
  let view = await deps.driver.inspect();
  const assertView = () => {
    if (canonicalGoogleEmail(view.manager) !== canonicalGoogleEmail(j.target) || !Number.isInteger(view.remaining) || view.remaining < 0 || view.remaining > 5
      || view.members.length + view.remaining !== 5 || new Set(view.members.map(canonicalGoogleEmail)).size !== view.members.length) throw Error('FAMILY_IDENTITY_OR_ROSTER_INVALID');
  };
  assertView();
  const contains = (email: string) => view.members.some(x => canonicalGoogleEmail(x) === canonicalGoogleEmail(email));
  let adopted = 0;
  // An uncertain send is resolved only by exact Google membership/pending observation.
  for (const [key, row] of attempted) {
    if (!contains(row.email)) throw Error('INVITATION_UNCERTAIN');
    if (!deps.checkOnly) { j.orders[key] = { ...row, state: 'confirmed', updatedAt: clock().toISOString() }; deps.save(j); adopted++; }
  }
  if (deps.checkOnly) return { state: 'checked', orders: orders.length, sent: 0, adopted: 0, remaining: view.remaining };
  for (const order of candidates) {
    const email = order.email!;
    if (contains(email)) {
      j.orders[order.key] = { email, state: 'observed_existing', updatedAt: clock().toISOString() }; deps.save(j); adopted++; continue;
    }
    if (Object.values(j.orders).some(x => canonicalGoogleEmail(x.email) === canonicalGoogleEmail(email))) throw Error('RECIPIENT_ALREADY_RESERVED');
    if (view.remaining < 1) throw Error('FAMILY_FULL');
    if (!view.subscribed || !view.benefitsThrough || view.benefitsThrough < order.endDate || view.benefitsThrough < koreaToday(clock())) throw Error('FAMILY_BENEFITS_PERIOD_REQUIRED');
    let reserved = false;
    await deps.driver.invite(email, async () => {
      if (reserved || !deps.allowed()) throw Error('SEND_BLOCKED');
      const fresh = (await deps.scan()).find(x => x.key === order.key);
      if (!fresh?.email || fresh.conflict || canonicalGoogleEmail(fresh.email) !== canonicalGoogleEmail(email) || fresh.endDate !== order.endDate) throw Error('BUYER_RECHECK_FAILED');
      if (!deps.allowed()) throw Error('SEND_BLOCKED');
      j.orders[order.key] = { email, state: 'attempted', updatedAt: clock().toISOString() };
      deps.save(j); reserved = true;
    });
    if (!reserved) throw Error('SEND_RESERVATION_MISSING');
    view = await deps.driver.inspect(); assertView();
    if (!contains(email)) throw Error('INVITATION_UNCERTAIN');
    j.orders[order.key] = { email, state: 'confirmed', updatedAt: clock().toISOString() }; deps.save(j);
    return { state: 'invited', orders: orders.length, sent: 1, adopted, remaining: view.remaining };
  }
  return { state: 'idle', orders: orders.length, sent: 0, adopted, remaining: view.remaining };
}
