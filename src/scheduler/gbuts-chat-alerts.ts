import { sendSellerAlert } from '../alerts/telegram';
import { loadSafeModeConfig } from '../api/safe-mode';
import { createGbutsOttSellerClient } from '../lib/gbuts-ott-client';
import { loadGbutsSession } from '../lib/gbuts-session';
import { readNetflixPortalStore, portalRecordMatches } from '../lib/netflix-portal';
import { readGbutsOttStore } from '../lib/gbuts-ott-store';
import { netflixCodeRequestKind } from '../lib/aaryan-netflix-code';
import { GBUTS_SPOTIFY_POST_SEQ } from './gbuts-spotify-sync';
import { classifyCodeRequest, processCodeReminder, readCodeReminderJournal, writeCodeReminderJournal,
  type CodeReminderChat } from './gbuts-code-reminder';
import { sendGbutsSingleText } from './gbuts-spotify-messages';
import { readGbutsSpotifyChatAlertJournal, syncGbutsSpotifyChatAlerts, writeGbutsSpotifyChatAlertJournal,
  type GbutsSpotifyChatAlertDependencies } from './gbuts-spotify-chat-alerts';

interface ChatScanDependencies extends Omit<GbutsSpotifyChatAlertDependencies, 'startAt'> {
  listPosts(): Promise<Array<{ seq: number; category1: { seq: number; name?: string }; memberCount: number }>>;
  startAt: string;
  spotifyPostSeq?: number;
  spotifyStartAt?: string;
}
function productName(raw: string | undefined, postSeq: number): string {
  try { const value = JSON.parse(raw || '{}'); if (typeof value.ko === 'string') return value.ko.slice(0, 100); } catch { /* Plain text names are also supported. */ }
  return raw?.slice(0, 100) || `판매글 ${postSeq}`;
}
export function isRoutineNetflixPortalMessage(value:string):boolean {
  const text=value.trim();
  if (/(?:안\s*(?:되|돼|와|왔|나오)|못\s*(?:받|보|들어|하)|오류|실패|환불|교체|만료|문제|도움|error|fail|not\s+work)/i.test(text)) return false;
  return !!netflixCodeRequestKind(text) || /^(?:감사합니다|고맙습니다|감사해요|네|넵|확인했습니다|확인했어요|잘\s*됩니다)[.!~\s]*$/i.test(text);
}
function messageTime(value:string):number {
  const local=/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value);
  return Date.parse(local ? `${value.replace(' ','T')}+09:00` : value);
}
export async function syncGbutsChatAlerts(deps: ChatScanDependencies) {
  if (!Number.isFinite(Date.parse(deps.startAt))) throw new Error('벗츠 채팅 감시 시작 시각을 확인해주세요.');
  const posts = await deps.listPosts();
  if (new Set(posts.map(p => p.seq)).size !== posts.length || posts.some(p => !Number.isSafeInteger(p.seq) || p.seq < 1))
    throw new Error('벗츠 판매글 목록을 확인해주세요.');
  const total = { posts: 0, sent: 0, messages: 0, failed: 0, errors: 0, unavailable: 0 };
  for (const post of posts) {
    try {
      const members = await deps.listMembers(post.seq);
      if (members.length < post.memberCount) throw new Error('벗츠 구매자 목록이 누락되었습니다.');
      const result = await syncGbutsSpotifyChatAlerts({ ...deps, listMembers: async () => members,
        productLabel: productName(post.category1.name, post.seq),
        buyerName: member => member.nickname || String(member.userSeq),
        startAt: post.seq === (deps.spotifyPostSeq || GBUTS_SPOTIFY_POST_SEQ) && deps.spotifyStartAt
          ? deps.spotifyStartAt : deps.startAt,
      }, post.seq);
      total.posts++; total.sent += result.sent; total.messages += result.messages; total.failed += result.failed; total.unavailable += result.unavailable;
    } catch { total.errors++; }
  }
  const journal = deps.readJournal();
  journal.lastScan = { at: deps.now?.() || new Date().toISOString(), ...total }; deps.writeJournal(journal);
  return total;
}

/** One owner for the existing receipt journal; inventory and delivery loops never wait on this scan. */
export function startGbutsChatAlerts(): (() => void) | undefined {
  const configured = process.env.GBUTS_CHAT_ALERT_ENABLED;
  const reminders = process.env.GBUTS_CODE_REMINDER_ENABLED === 'true';
  if (configured !== 'true' && !(configured === undefined && process.env.GBUTS_SPOTIFY_CHAT_ALERT_ENABLED === 'true')) return;
  const allPosts = configured === 'true';
  const startAt = allPosts ? process.env.GBUTS_CHAT_ALERT_START_AT || '' : process.env.GBUTS_SPOTIFY_CHAT_ALERT_START_AT || '';
  if (!Number.isFinite(Date.parse(startAt))) { console.error('[GbutsChatAlerts] 감시 시작 시각 설정 필요'); return; }
  const reminderStartAt = process.env.GBUTS_CODE_REMINDER_START_AT || '';
  if (reminders && (!Number.isFinite(Date.parse(reminderStartAt)) || !process.env.OPENROUTER_API_KEY?.trim())) {
    console.error('[GbutsChatAlerts] 코드 자동 안내 시작 시각 또는 OpenRouter 키 설정 필요');
  }
  const spotifyPostSeq = Number(process.env.GBUTS_SPOTIFY_POST_SEQ || GBUTS_SPOTIFY_POST_SEQ);
  let running = false;
  let inferenceRetryAfter = 0;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      if (loadSafeModeConfig().enabled) return;
      const session = loadGbutsSession(); const token = session?.token || process.env.GBUTS_API_TOKEN?.trim();
      if (!token) return;
      const client = createGbutsOttSellerClient(token);
      const completedPortals = new Map<string,number>();
      try {
        const portal=readNetflixPortalStore();
        if(portal?.enabled){const inventory=readGbutsOttStore();for(const r of Object.values(portal.records)){
          const o=inventory.orders[r.orderKey],confirmed=Date.parse(r.image.confirmedAt||'');
          if(o&&r.text.state==='confirmed'&&r.image.state==='confirmed'&&Number.isFinite(confirmed)&&portalRecordMatches(r,inventory,o))
            completedPortals.set(r.orderKey,Math.floor(confirmed/1000)*1000);
        }}
      } catch { /* Fail open for owner alerts if the portal registry cannot be read. */ }
      const reminderReady = reminders && Number.isFinite(Date.parse(reminderStartAt)) && !!process.env.OPENROUTER_API_KEY?.trim();
      let sellerSeq = 0;
      if (reminderReady) {
        try { sellerSeq = await client.sellerAccountSeq(); }
        catch { console.error('[GbutsChatAlerts] 코드 자동 안내 판매자 확인 실패'); }
      }
      const processBuyerChat = reminderReady && sellerSeq > 0 ? async (chat: CodeReminderChat) => {
        if(completedPortals.has(`${chat.postSeq}:${chat.member.seq}`)) return;
        await processCodeReminder(chat, { ...client, sellerSeq, startAt: reminderStartAt,
          classify: async text => {
            if (Date.now() < inferenceRetryAfter) throw new Error('코드 문의 분류 재시도 대기');
            try { return await classifyCodeRequest(text); }
            catch { inferenceRetryAfter = Date.now() + 5 * 60_000; throw new Error('코드 문의 분류 일시 실패'); }
          },
          readJournal: readCodeReminderJournal, writeJournal: writeCodeReminderJournal, sendText: sendGbutsSingleText,
        });
      } : undefined;
      const result = await syncGbutsChatAlerts({ ...client,
        listPosts: async () => (await client.listPosts()).filter(p => allPosts || p.seq === spotifyPostSeq),
        readJournal: readGbutsSpotifyChatAlertJournal, writeJournal: writeGbutsSpotifyChatAlertJournal,
        sendAlert: sendSellerAlert, accountLabel: session?.sellerLabel || '기본 벗츠 판매 계정', startAt,
        spotifyPostSeq, spotifyStartAt: process.env.GBUTS_SPOTIFY_CHAT_ALERT_START_AT,
        processBuyerChat,
        suppressBuyerMessage: (postSeq,member,entry) => {
          const since=completedPortals.get(`${postSeq}:${member.seq}`),at=messageTime(entry.createdAt);
          return since!==undefined&&Number.isFinite(at)&&at>=since&&isRoutineNetflixPortalMessage(entry.message);
        },
      });
      if (result.sent || result.failed || result.errors) console.log('[GbutsChatAlerts]', result);
    } catch { console.error('[GbutsChatAlerts] 구매자 채팅 확인 실패'); }
    finally { running = false; }
  };
  const initial = setTimeout(() => { void run(); }, 3000);
  const interval = setInterval(() => { void run(); }, Math.max(30000, Number(process.env.GBUTS_CHAT_ALERT_INTERVAL_MS) || 60000));
  initial.unref(); interval.unref();
  return () => { clearTimeout(initial); clearInterval(interval); };
}
