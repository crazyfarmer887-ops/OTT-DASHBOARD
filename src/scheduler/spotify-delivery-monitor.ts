import { createHash } from 'node:crypto';
import type { SellerAlertInput, SellerAlertResult } from '../alerts/telegram';
import { gbutsChatContainsText } from '../lib/gbuts-chat-delivery';
import { explicitYouTubeBuyerEmails } from '../lib/youtube-buyer-email';
import { extractGbutsSpotifyCredentials, isActiveGbutsSpotifyMember, isSpotifyAccountForBuyer,
  type GbutsChatMessage, type GbutsSpotifyMember } from '../lib/gbuts-spotify';
import { requestedSpotifyNewAccount, spotifyRegisteredAccountInvitedReply, spotifyRegisteredLogin,
  SPOTIFY_INVITED_REPLY, spotifyChatContainsIssuedLogin } from './gbuts-spotify-messages';
import type { SpotifyNotionRow } from './gbuts-spotify-sync';

export type SpotifyPlatform = 'gbuts' | 'everyview';
export type DeliveryIssueCode = 'delivery_missing' | 'delivery_uncertain' | 'invalid_issued'
  | 'notion_missing' | 'notion_unbound' | 'notion_ambiguous' | 'identity_mismatch' | 'source_unavailable';
export interface SpotifyDeliveryIssue {
  key: string; scope: string; code: DeliveryIssueCode; platform?: SpotifyPlatform;
  orderKey?: string; postSeq?: number; memberSeq?: number; notionPageId?: string;
}
export interface SpotifyDeliveryScan { issues: SpotifyDeliveryIssue[]; checkedScopes: string[] }
export interface DeliveryIncident {
  issue: SpotifyDeliveryIssue; firstSeenAt: number; lastSeenAt: number; observations: number;
  notifiedAt?: number; lastAttemptAt?: number;
}
export interface SpotifyDeliveryMonitorJournal {
  version: 1; activatedAt: string; lastScanAt?: string; incidents: Record<string, DeliveryIncident>;
}
export interface SpotifyBuyerDeliverySnapshot {
  platform: SpotifyPlatform; postSeq: number; member: GbutsSpotifyMember; sellerSeq: number;
  messages: readonly GbutsChatMessage[]; rows: readonly SpotifyNotionRow[];
  uncertainDelivery: boolean; activatedAt: string; forceMissingMapping?: boolean;
}
export const deliveryScope = (platform: SpotifyPlatform, post: number) => `${platform}:post:${post}`;
const dateMs = (s: string) => Date.parse(s.includes('T') ? s : s.replace(' ', 'T') + '+09:00');

/** Read-only assessment. Never claims records, creates accounts or sends buyer messages. */
export function assessSpotifyBuyerDelivery(s: SpotifyBuyerDeliverySnapshot): SpotifyDeliveryIssue | null {
  if (!isActiveGbutsSpotifyMember(s.member)) return null;
  const orderKey = `${s.platform === 'everyview' ? 'everyview:' : ''}${s.postSeq}:${s.member.seq}`;
  const base = { key: `order:${orderKey}`, scope: deliveryScope(s.platform, s.postSeq), platform: s.platform,
    orderKey, postSeq: s.postSeq, memberSeq: s.member.seq };
  const matches = s.rows.filter(r => r.orderKey === orderKey);
  if (matches.length > 1) return { ...base, code: 'notion_ambiguous' };
  const row = matches[0];
  const newRequest = requestedSpotifyNewAccount(s.messages, s.member.userSeq);
  const submitted = extractGbutsSpotifyCredentials(s.messages, s.member.userSeq);
  const newRequestCurrent = Boolean(newRequest && (!submitted || dateMs(newRequest) > dateMs(submitted.receivedAt)));
  if (!row) {
    const choices = s.messages.filter(m => m.senderSeq === s.member.userSeq && m.messageType === 'TEXT'
      && /[^\s@]+@[^\s@]+\.[^\s@]+/.test(m.message)).map(m => m.createdAt);
    const requestAt = [newRequest, submitted?.receivedAt, ...choices].filter((x): x is string => Boolean(x))
      .map(dateMs).filter(Number.isFinite).sort((a,b) => b-a)[0];
    if (!s.forceMissingMapping && (!requestAt || requestAt < Date.parse(s.activatedAt))) return null;
    const deliveredManually = s.messages.some(m => m.senderSeq === s.sellerSeq && m.messageType === 'TEXT'
      && dateMs(m.createdAt) >= requestAt && (m.message.trim() === SPOTIFY_INVITED_REPLY
        || /^ID\s*:\s*\S+@\S+\s*\n비밀번호\s*:\s*\S+/i.test(m.message.trim())));
    return deliveredManually ? null : { ...base, code: 'notion_missing' };
  }
  if (row.cancelled || !row.invited) return null; // Partner work in progress is quiet.
  const issueBase = { ...base, notionPageId: row.id };
  const issued = row.registered ? spotifyRegisteredLogin(row) : null;
  if (row.registered && !issued) return { ...issueBase, code: 'invalid_issued' };
  if (newRequestCurrent && !row.registered) return { ...issueBase, code: 'invalid_issued' };
  if (!newRequestCurrent && submitted && !isSpotifyAccountForBuyer(row.email, submitted.email))
    return { ...issueBase, code: 'identity_mismatch' };
  const expected = row.registered && issued ? spotifyRegisteredAccountInvitedReply(issued.email, issued.password)
    : SPOTIFY_INVITED_REPLY;
  if (gbutsChatContainsText([...s.messages], s.sellerSeq, expected)
    || (issued && spotifyChatContainsIssuedLogin(s.messages, s.sellerSeq, issued))) return null;
  if (issued && s.messages.some(m => m.senderSeq === s.sellerSeq && m.messageType === 'TEXT'
    && explicitYouTubeBuyerEmails(m.message).some(email => email.toLowerCase() !== issued.email.toLowerCase()
      && spotifyChatContainsIssuedLogin([m], s.sellerSeq, { email, password: issued.password }))))
    return { ...issueBase, code: 'identity_mismatch' };
  return { ...issueBase, code: s.uncertainDelivery ? 'delivery_uncertain' : 'delivery_missing' };
}

export function unboundSpotifyCompletionIssues(rows: readonly SpotifyNotionRow[], activatedAt: string): SpotifyDeliveryIssue[] {
  // Notion edit timestamps have minute precision. Include the activation minute.
  const cutoff = Math.floor(Date.parse(activatedAt) / 60_000) * 60_000;
  return rows.filter(r => !r.orderKey && !r.cancelled && r.invited && r.updatedAt
    && Date.parse(r.updatedAt) >= cutoff).map(r => ({ key: `unbound:${r.id}`, scope: 'notion',
    code: 'notion_unbound', notionPageId: r.id }));
}

export function reconcileSpotifyDeliveryIncidents(journal: SpotifyDeliveryMonitorJournal, scan: SpotifyDeliveryScan,
  nowMs: number): SpotifyDeliveryMonitorJournal {
  const incidents = { ...journal.incidents };
  const current = new Set(scan.issues.map(i => i.key));
  for (const [key, value] of Object.entries(incidents))
    if (scan.checkedScopes.includes(value.issue.scope) && !current.has(key)) delete incidents[key];
  for (const issue of scan.issues) {
    const old = incidents[issue.key];
    incidents[issue.key] = old?.issue.code === issue.code ? { ...old, issue, lastSeenAt: nowMs,
      observations: old.observations + (nowMs - old.lastSeenAt >= 10_000 ? 1 : 0) }
      : { issue, firstSeenAt: nowMs, lastSeenAt: nowMs, observations: 1 };
  }
  return { ...journal, lastScanAt: new Date(nowMs).toISOString(), incidents };
}

const descriptions: Record<DeliveryIssueCode, string> = {
  delivery_missing: 'Notion에는 처리가 완료되어 있지만 구매자 채팅에서 전달 완료 메시지를 확인하지 못했습니다.',
  delivery_uncertain: '전송을 시도했으나 채팅 저장이 확인되지 않았습니다. 중복 전송 없이 조회 복구가 필요합니다.',
  invalid_issued: 'Notion 완료 표시는 있지만 유효한 발급 정보가 부족해 자동 전달을 보류했습니다.',
  notion_missing: '구매자의 계정 처리 요청에 연결된 Notion 기록이 없습니다.',
  notion_unbound: '새로 완료된 Notion 기록에 에브리뷰/벗츠 주문 연결이 없습니다. 수신자를 확인해야 합니다.',
  notion_ambiguous: '한 구매 요청에 Notion 기록이 여러 개 연결되어 자동 전달을 보류했습니다.',
  identity_mismatch: 'Notion 발급 정보가 구매자 요청 또는 저장된 계정 안내와 일치하지 않습니다. 추정 재전송 없이 확인이 필요합니다.',
  source_unavailable: '구매 내역·Notion·채팅 조회가 반복 실패하여 자동 전달 여부를 확인하지 못하고 있습니다.',
};

export function spotifyDeliveryAlertInput(incident: DeliveryIncident): SellerAlertInput {
  const i = incident.issue;
  const platform = i.platform === 'gbuts' ? '벗츠' : i.platform === 'everyview' ? '에브리뷰' : '에브리뷰·벗츠';
  const actionUrl = i.notionPageId ? `https://www.notion.so/${i.notionPageId.replace(/-/g, '')}`
    : i.platform === 'gbuts' ? 'https://gbuts.com/seller/chats' : 'https://everyview.kr/myParty';
  // Only trusted identifiers/static descriptions enter Telegram, never account/chat/error text.
  return { key: `spotify-delivery-${createHash('sha256').update(`${i.key}:${i.code}:${incident.firstSeenAt}`).digest('hex').slice(0,24)}`,
    title: `${platform} Spotify 자동 전달 확인 필요`,
    body: [descriptions[i.code], i.orderKey ? `주문: ${i.orderKey}` : '',
      i.postSeq ? `판매글/파티: ${i.postSeq}` : '', '계정 정보·비밀번호는 알림에 포함하지 않습니다.'].filter(Boolean).join('\n'),
    provider: i.platform === 'gbuts' ? 'gbuts' : undefined, category: 'system', severity: 'warning',
    actionUrl, throttleMs: 30 * 24 * 60 * 60_000 };
}

export async function flushSpotifyDeliveryAlerts(deps: {
  read(): SpotifyDeliveryMonitorJournal; write(j: SpotifyDeliveryMonitorJournal): void;
  send(input: SellerAlertInput): Promise<SellerAlertResult>; nowMs: number;
}): Promise<number> {
  const journal = deps.read(); let sent = 0;
  for (const incident of Object.values(journal.incidents)) {
    if (incident.notifiedAt || incident.observations < 2 || deps.nowMs - incident.firstSeenAt < 120_000
      || deps.nowMs - incident.lastSeenAt > 10 * 60_000
      || (incident.lastAttemptAt && deps.nowMs - incident.lastAttemptAt < 5 * 60_000)) continue;
    incident.lastAttemptAt = deps.nowMs; deps.write(journal);
    let result: SellerAlertResult;
    try { result = await deps.send(spotifyDeliveryAlertInput(incident)); }
    catch { continue; }
    if (result.sent || result.reason === 'throttled') { incident.notifiedAt = deps.nowMs; deps.write(journal); sent++; }
  }
  return sent;
}

export interface SpotifyDeliveryReadSource {
  platform: SpotifyPlatform;
  posts(): Promise<number[]>;
  sellerAccountSeq(): Promise<number>;
  listMembers(post: number): Promise<GbutsSpotifyMember[]>;
  openPrivateRoom(post: number, userSeq: number): Promise<string>;
  getChat(roomId: string): Promise<{ messages: GbutsChatMessage[] }>;
  uncertainOrders(): Set<string>;
  eligibility?(post: number, member: GbutsSpotifyMember, messages: readonly GbutsChatMessage[],
    rows: readonly SpotifyNotionRow[]): 'active' | 'held' | 'historical';
}

export async function collectSpotifyDeliveryScan(deps: {
  listRows(): Promise<SpotifyNotionRow[]>;
  sources: SpotifyDeliveryReadSource[]; activatedAt: string;
}): Promise<SpotifyDeliveryScan> {
  const issues: SpotifyDeliveryIssue[] = [], checkedScopes: string[] = [];
  let rows: SpotifyNotionRow[];
  try { rows = await deps.listRows(); }
  catch { return { issues: [{ key: 'notion:unavailable', scope: 'notion', code: 'source_unavailable' }], checkedScopes }; }
  checkedScopes.push('notion'); issues.push(...unboundSpotifyCompletionIssues(rows, deps.activatedAt));
  for (const source of deps.sources) {
    const inventory = `${source.platform}:inventory`;
    let posts: number[], sellerSeq: number, uncertain: Set<string>;
    try { posts = [...new Set(await source.posts())]; sellerSeq = await source.sellerAccountSeq(); uncertain = source.uncertainOrders(); }
    catch { issues.push({ key: inventory, scope: inventory, code: 'source_unavailable', platform: source.platform }); continue; }
    checkedScopes.push(inventory);
    const unavailablePosts: number[] = [];
    for (const post of posts) {
      const scope = deliveryScope(source.platform, post); let complete = true;
      try {
        const members = (await source.listMembers(post)).filter(isActiveGbutsSpotifyMember);
        for (const member of members) {
          try {
            if (members.filter(m => m.seq === member.seq || m.userSeq === member.userSeq).length !== 1) {
              issues.push({ key: `${scope}:member:${member.seq}`, scope, code: 'identity_mismatch', platform: source.platform, postSeq: post, memberSeq: member.seq });
              continue;
            }
            const room = await source.openPrivateRoom(post, member.userSeq), chat = await source.getChat(room);
            const eligibility = source.eligibility?.(post, member, chat.messages, rows) || 'active';
            if (eligibility === 'historical') continue;
            const key = `${source.platform === 'everyview' ? 'everyview:' : ''}${post}:${member.seq}`;
            const issue = assessSpotifyBuyerDelivery({ platform: source.platform, postSeq: post, member, sellerSeq,
              messages: chat.messages, rows, activatedAt: deps.activatedAt, uncertainDelivery: uncertain.has(key), forceMissingMapping: eligibility === 'held' });
            if (issue) issues.push(issue);
          } catch { complete = false; break; }
        }
      } catch { complete = false; }
      if (complete) checkedScopes.push(scope);
      else unavailablePosts.push(post);
    }
    if (unavailablePosts.length) issues.push({ key: `${inventory}:unavailable`, scope: inventory, code: 'source_unavailable',
      platform: source.platform, ...(unavailablePosts.length === 1 ? { postSeq: unavailablePosts[0] } : {}) });
  }
  return { issues, checkedScopes };
}
