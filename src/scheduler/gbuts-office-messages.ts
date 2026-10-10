import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { writeJsonAtomic } from '../lib/graytag-sales-session';
import { GbutsChatDeliveryError, gbutsChatContainsText } from '../lib/gbuts-chat-delivery';
import { createGbutsOttSellerClient } from '../lib/gbuts-ott-client';
import { deliverableOttOrder, ottDate } from '../lib/gbuts-ott';
import { loadGbutsSession } from '../lib/gbuts-session';
import { loadSafeModeConfig } from '../api/safe-mode';
import { sendGbutsText } from './gbuts-spotify-messages';

export const OFFICE_BUYER_GUIDE = `구매 감사합니다! 😊
MS Office 365 초대를 받으실 Microsoft 계정 이메일을 이 1:1 채팅에 남겨주세요.

구매 후 24시간 이내로 초대해드립니다. 초대가 지연되면 지연된 기간만큼 무료로 연장해드리고 있으니 조금만 기다려주세요!`;
export const GBUTS_OFFICE_CATEGORY = 530;
const DEFAULT_POST_SEQ = 16285;
const DEFAULT_JOURNAL_PATH = '/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data/gbuts-office-messages.json';
interface OfficeGuideRecord { userSeq: number; roomId: string; textHash: string; state: 'attempted' | 'confirmed' | 'blocked'; error?: string; updatedAt: string }
export interface OfficeGuideJournal { version: 1; records: Record<string, OfficeGuideRecord>; lastSuccess?: string; lastError?: string | null }
export function readOfficeGuideJournal(path = process.env.GBUTS_OFFICE_MESSAGE_JOURNAL_PATH || DEFAULT_JOURNAL_PATH): OfficeGuideJournal {
  if (!existsSync(path)) return { version: 1, records: {} };
  const data = JSON.parse(readFileSync(path, 'utf8'));
  if (data?.version !== 1 || !data.records || typeof data.records !== 'object' || Array.isArray(data.records)
    || Object.entries(data.records).some(([key, record]: [string, any]) => !/^\d+:\d+$/.test(key) || !record
      || !Number.isSafeInteger(record.userSeq) || record.userSeq < 1 || typeof record.roomId !== 'string' || !record.roomId
      || !/^[a-f0-9]{64}$/.test(record.textHash) || !['attempted', 'confirmed', 'blocked'].includes(record.state)
      || !Number.isFinite(Date.parse(record.updatedAt)))) throw new Error('MS Office 안내 기록을 확인하지 못했습니다.');
  return data;
}
export function writeOfficeGuideJournal(journal: OfficeGuideJournal, path = process.env.GBUTS_OFFICE_MESSAGE_JOURNAL_PATH || DEFAULT_JOURNAL_PATH): void {
  writeJsonAtomic(path, journal);
}
type OfficeClient = Pick<ReturnType<typeof createGbutsOttSellerClient>, 'getPost' | 'listOttMembers' | 'sellerAccountSeq' | 'openPrivateRoom' | 'getChat'>;
interface OfficeGuideDependencies {
  postSeq: number; client: OfficeClient; read(): OfficeGuideJournal; write(journal: OfficeGuideJournal): void;
  send: typeof sendGbutsText;
}
export async function syncGbutsOfficeMessages(deps: OfficeGuideDependencies): Promise<{ attempted: number; confirmed: number }> {
  if (!Number.isSafeInteger(deps.postSeq) || deps.postSeq < 1) throw new Error('MS Office 판매글 번호를 확인해주세요.');
  const [post, members] = await Promise.all([deps.client.getPost(deps.postSeq), deps.client.listOttMembers(deps.postSeq)]);
  if (post.seq !== deps.postSeq || post.category1.seq !== GBUTS_OFFICE_CATEGORY
    || !['ON_SALE', 'CLOSED', 'SUSPENDED', 'REFUNDED'].includes(post.status) || members.length < post.memberCount
    || new Set(members.map(m => m.seq)).size !== members.length) throw new Error('MS Office 판매글과 구매자 목록을 확인하지 못했습니다.');
  const journal = deps.read();
  const active = members.filter(m => deliverableOttOrder({ ...m, endDate: ottDate(m.subscriptionEndsAt) }));
  const seller = active.length ? await deps.client.sellerAccountSeq() : 0;
  const textHash = createHash('sha256').update(OFFICE_BUYER_GUIDE).digest('hex');
  let attempted = 0; let confirmed = 0;
  for (const buyer of active) {
    const key = `${deps.postSeq}:${buyer.seq}`; const previous = journal.records[key];
    if (previous && previous.userSeq !== buyer.userSeq) throw new Error('MS Office 구매자 연결이 변경되었습니다.');
    if (previous?.state === 'confirmed' || previous?.state === 'blocked') continue;
    const roomId = await deps.client.openPrivateRoom(deps.postSeq, buyer.userSeq);
    if (previous && (previous.roomId !== roomId || previous.textHash !== textHash)) throw new Error('MS Office 채팅 안내 기록이 다릅니다.');
    const chat = await deps.client.getChat(roomId);
    if (gbutsChatContainsText(chat.messages, seller, OFFICE_BUYER_GUIDE)) {
      journal.records[key] = { userSeq: buyer.userSeq, roomId, textHash, state: 'confirmed', updatedAt: new Date().toISOString() };
      deps.write(journal); confirmed++; continue;
    }
    if (previous) continue;
    journal.records[key] = { userSeq: buyer.userSeq, roomId, textHash, state: 'attempted', updatedAt: new Date().toISOString() };
    deps.write(journal); attempted++;
    try {
      await deps.send(roomId, seller, OFFICE_BUYER_GUIDE);
      if (gbutsChatContainsText((await deps.client.getChat(roomId)).messages, seller, OFFICE_BUYER_GUIDE)) {
        journal.records[key].state = 'confirmed'; deps.write(journal); confirmed++;
      }
    } catch (error) {
      if (error instanceof GbutsChatDeliveryError && !error.submitted) {
        if (error.retryable) delete journal.records[key];
        else { journal.records[key].state = 'blocked'; journal.records[key].error = '채팅 전송 제한으로 안내가 차단되었습니다.'; }
        deps.write(journal);
      }
    }
  }
  journal.lastSuccess = new Date().toISOString();
  const pending = active.map(buyer => journal.records[`${deps.postSeq}:${buyer.seq}`]).filter(record => record && record.state !== 'confirmed');
  journal.lastError = pending.some(record => record.state === 'blocked') ? 'MS Office 안내 전송이 차단된 주문이 있습니다.'
    : pending.length ? 'MS Office 채팅 발송 결과 확인 중' : null; deps.write(journal);
  return { attempted, confirmed };
}
export function startGbutsOfficeMessages(): (() => void) | undefined {
  if (process.env.GBUTS_OFFICE_AUTO_MESSAGE_ENABLED !== 'true') return;
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      if (loadSafeModeConfig().enabled) return;
      const token = loadGbutsSession()?.token || process.env.GBUTS_API_TOKEN?.trim();
      if (!token) throw new Error('벗츠 판매자 연결이 필요합니다.');
      const result = await syncGbutsOfficeMessages({ postSeq: Number(process.env.GBUTS_OFFICE_POST_SEQ || DEFAULT_POST_SEQ),
        client: createGbutsOttSellerClient(token), read: readOfficeGuideJournal, write: writeOfficeGuideJournal, send: sendGbutsText });
      if (result.attempted || result.confirmed) console.log('[GbutsOfficeMessages]', result);
    } catch {
      try { const journal = readOfficeGuideJournal(); journal.lastError = 'MS Office 구매자 안내 확인 실패'; writeOfficeGuideJournal(journal); } catch { /* Preserve corrupt journals. */ }
      console.error('[GbutsOfficeMessages] MS Office 구매자 안내 확인 실패');
    } finally { running = false; }
  };
  const initial = setTimeout(() => { void run(); }, 1000);
  const interval = setInterval(() => { void run(); }, 5000);
  return () => { clearTimeout(initial); clearInterval(interval); };
}
