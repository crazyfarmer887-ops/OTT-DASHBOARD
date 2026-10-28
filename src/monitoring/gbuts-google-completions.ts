import { canonicalGoogleEmail, type FamilyJournal, type FamilyView, type InviteOrder } from './gbuts-google-invites';
import { GbutsChatDeliveryError } from '../lib/gbuts-chat-delivery';
import type { GbutsChatMessage } from '../lib/gbuts-spotify';

export const GOOGLE_INVITE_COMPLETE_TEXT = '유튜브 가족 초대를 보냈습니다. 요청하신 Google 계정의 이메일에서 초대를 확인하고 수락해주세요!';
export type CompletionRecord = { email: string; roomId: string; state: 'attempted' | 'confirmed'; updatedAt: string };
export type FamilyCompletionJournal = { version: 1; orders: Record<string, CompletionRecord> };
const invited = (state: string | undefined) => state === 'confirmed' || state === 'observed_existing';
const timestamp = (s: string) => Date.parse(s.includes('T') ? s : s.replace(' ', 'T') + '+09:00');
export function validateFamilyCompletions(j: FamilyCompletionJournal): FamilyCompletionJournal {
  if (j?.version !== 1 || !j.orders || typeof j.orders !== 'object' || Array.isArray(j.orders)) throw Error('COMPLETION_JOURNAL_INVALID');
  for (const [key, r] of Object.entries(j.orders)) {
    if (!/^\d+:\d+$/.test(key) || !['attempted', 'confirmed'].includes(r.state) || !/^[A-Za-z0-9_-]{1,128}$/.test(r.roomId)
      || !Number.isFinite(Date.parse(r.updatedAt))) throw Error('COMPLETION_JOURNAL_INVALID');
    canonicalGoogleEmail(r.email);
  }
  return j;
}
export function familyCompletionPending(invites: FamilyJournal, orders: InviteOrder[], receipts: FamilyCompletionJournal) {
  return orders.some(o => o.email && !o.conflict && invited(invites.orders[o.key]?.state)
    && canonicalGoogleEmail(invites.orders[o.key].email) === canonicalGoogleEmail(o.email) && !receipts.orders[o.key]);
}
export function savedFamilyAcknowledgement(messages: readonly GbutsChatMessage[], order: InviteOrder): boolean {
  if (!order.context) return false;
  return messages.some(m => m.senderSeq === order.context!.sellerSeq && m.messageType === 'TEXT'
    && timestamp(m.createdAt) >= timestamp(order.context!.requestedAt)
    && (m.message.trim() === GOOGLE_INVITE_COMPLETE_TEXT || /^(?:안녕하세요[.!~]*)?(?:(?:가족)?초대(?:를)?)?(?:보냈습니다|보냈어요|보내드렸습니다|보내드렸어요|초대했습니다)[.!~]*$/.test(m.message.replace(/\s+/g, ''))));
}
/** One guarded completion per verified paid request; uncertain SENDs are query-only. */
export async function syncFamilyCompletions(deps: {
  invites: FamilyJournal; journal: FamilyCompletionJournal; save(j: FamilyCompletionJournal): void;
  scan(): Promise<InviteOrder[]>; allowed(): boolean; view?: FamilyView;
  getChat(roomId: string): Promise<{ members: unknown[]; messages: GbutsChatMessage[] }>;
  sendText(roomId: string, sellerSeq: number, text: string): Promise<void>; now?: () => Date;
}) {
  const journal = validateFamilyCompletions(deps.journal), orders = await deps.scan();
  let sent = 0, confirmed = 0, uncertain = 0, failed = 0;
  for (const order of orders) {
    const invite = deps.invites.orders[order.key];
    if (!order.email || order.conflict || !invited(invite?.state)) continue;
    if (canonicalGoogleEmail(invite.email) !== canonicalGoogleEmail(order.email)) throw Error('COMPLETION_EMAIL_CHANGED');
    const context = order.context; if (!context) throw Error('COMPLETION_CONTEXT_REQUIRED');
    const prior = journal.orders[order.key];
    if (prior && (canonicalGoogleEmail(prior.email) !== canonicalGoogleEmail(order.email) || prior.roomId !== context.roomId)) throw Error('COMPLETION_BINDING_CHANGED');
    if (prior?.state === 'confirmed') continue;
    const chat = await deps.getChat(context.roomId);
    for (const seq of [context.userSeq, context.sellerSeq])
      if (!chat.members.some(x => x && typeof x === 'object' && 'seq' in x && x.seq === seq)) throw Error('COMPLETION_ROOM_CHANGED');
    const saved = () => ({ email: order.email!, roomId: context.roomId, state: 'confirmed' as const, updatedAt: (deps.now?.() || new Date()).toISOString() });
    if (savedFamilyAcknowledgement(chat.messages, order)) { journal.orders[order.key] = saved(); deps.save(journal); confirmed++; continue; }
    if (prior) { uncertain++; continue; }
    const v = deps.view;
    if (!v) continue; // No Google observation means query recovery only.
    if (canonicalGoogleEmail(v.manager) !== canonicalGoogleEmail(deps.invites.target)
      || !v.members.some(e => canonicalGoogleEmail(e) === canonicalGoogleEmail(order.email!))
      || !v.subscribed || !v.benefitsThrough || v.benefitsThrough < order.endDate) throw Error('COMPLETION_GOOGLE_CONFIRMATION_REQUIRED');
    const fresh = (await deps.scan()).find(x => x.key === order.key);
    if (!deps.allowed() || !fresh?.email || fresh.conflict || canonicalGoogleEmail(fresh.email) !== canonicalGoogleEmail(order.email)
      || fresh.endDate !== order.endDate || JSON.stringify(fresh.context) !== JSON.stringify(context)) throw Error('COMPLETION_BUYER_RECHECK_FAILED');
    journal.orders[order.key] = { ...saved(), state: 'attempted' }; deps.save(journal);
    try { await deps.sendText(context.roomId, context.sellerSeq, GOOGLE_INVITE_COMPLETE_TEXT); sent++; }
    catch (e) {
      if (e instanceof GbutsChatDeliveryError && !e.submitted && e.retryable) { delete journal.orders[order.key]; deps.save(journal); failed++; continue; }
    }
    const after = await deps.getChat(context.roomId);
    if (savedFamilyAcknowledgement(after.messages, order)) { journal.orders[order.key] = saved(); deps.save(journal); confirmed++; }
    else uncertain++;
  }
  return { sent, confirmed, uncertain, failed };
}
