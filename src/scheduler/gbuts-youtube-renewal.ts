import { tryDecodeGbutsSubscriptionCredential } from '../lib/gbuts-subscription-credentials';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { writeJsonAtomic } from '../lib/graytag-sales-session';
import { activeOttOrder, gbutsOrderListing, holdsNetflixProfile, koreaToday, ottDate, ottKey } from '../lib/gbuts-ott';
import { readGbutsOttStore } from '../lib/gbuts-ott-store';
import type { createGbutsOttSellerClient, GbutsOttMember, GbutsOttPost } from '../lib/gbuts-ott-client';
import { OTT_RANK_CHECK_INTERVAL, OTT_RANK_COOLDOWN } from './gbuts-ott-renewal';

/** GButs paid PICK is attached to a post and must not be lost to rank reposting. */
function activePickUntil(post: GbutsOttPost, now: Date): string | undefined {
  if (post.pickedUntil == null || post.pickedUntil === '') return undefined;
  const raw = String(post.pickedUntil).replace(' ', 'T');
  const until = Date.parse(raw + (/(?:Z|[+-]\d\d:\d\d)$/.test(raw) ? '' : '+09:00'));
  if (!Number.isFinite(until)) throw Error('벗츠 PICK 종료 시각 확인 필요');
  return until > now.getTime() ? new Date(until).toISOString() : undefined;
}
export type InvitePayload = { category: 7; countries: string[]; subscriptionType: 'INVITE'; subscriptionPrincipal: ''; subscriptionCredential: '';
  subscriptionStartsAt: string; subscriptionEndsAt: string; price: number; priceType: 'DAY'; memberLimit: number;
  title: string; description: string; noticeBeforeOrder: string; noticeAfterOrder: string };
export type SubscriptionPayload = Omit<InvitePayload,'category'|'subscriptionType'|'subscriptionPrincipal'|'subscriptionCredential'> & {category:number;subscriptionType:'SHARE'|'INVITE';subscriptionPrincipal:''|null;subscriptionCredential:''|null};
type Member = { postSeq: number; seq: number; userSeq: number; status: string; cancelStatus: string | null; endDate: string; createdAt?:string;nickname?:string;observedAt?:string };
export type YouTubeRenewal = { seedPostSeq: number; currentPostSeq: number; capacity: number; categorySeq?:number; subscriptionType?:'SHARE'|'INVITE'; endDate: string; enabled: boolean;
  trigger: 'rank'; rankThreshold: 5; nextAt: string; rankCheckedAt?: string; lastRank?: number | null; lastSuccess?: string; lastError?: string; lastRepostedAt?: string;
  posts: Array<{ seq: number; capacity: number }>; members: Record<string, Member>;
  pending?: { phase: 'closing' | 'publishing'; sourcePostSeq: number; afterSeq: number; payload?: SubscriptionPayload; credentialsHash?: string; postSeq?: number } };
export type YouTubeRenewalStore = { version: 1; policies: Record<string, YouTubeRenewal> };
export type InviteClient = Pick<ReturnType<typeof createGbutsOttSellerClient>, 'getPost' | 'listOttMembers' | 'listOttPublicRanking' | 'sellerAccountSeq' | 'latestPostSeq' | 'listPostsAfter' | 'closePost' | 'createYouTubeInvitePost' | 'listSubscriptionPublicRanking' | 'createSubscriptionPost'>;
const file = () => process.env.GBUTS_YOUTUBE_RENEWALS_PATH || '/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data/gbuts-youtube-renewals.json';
const validDate=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
const positive = (n: unknown): n is number => Number.isSafeInteger(n) && Number(n) > 0;
const localized = (value: unknown): string => { if (typeof value === 'object' && value) return String((value as { ko?: unknown }).ko || '');
  try { return String(JSON.parse(String(value)).ko || ''); } catch { return String(value || ''); } };
export function readYouTubeRenewals(): YouTubeRenewalStore {
  if (!existsSync(file())) return { version: 1, policies: {} };
  return validateYouTubeRenewals(JSON.parse(readFileSync(file(), 'utf8')));
}
export function validateYouTubeRenewals(s: YouTubeRenewalStore): YouTubeRenewalStore {
  if (s?.version !== 1 || !s.policies || typeof s.policies !== 'object' || Array.isArray(s.policies)) throw Error('구독공유 재등록 기록 확인 필요');
  const all = new Set<number>();
  for (const [key, p] of Object.entries(s.policies)) {
    if (key !== String(p.seedPostSeq) || !positive(p.seedPostSeq) || !positive(p.currentPostSeq) || !positive(p.capacity)
      || typeof p.enabled !== 'boolean' || p.trigger !== 'rank' || p.rankThreshold !== 5 || !Number.isFinite(Date.parse(p.nextAt))
      || !validDate(p.endDate) || !Array.isArray(p.posts) || !p.posts.length || !p.members || Array.isArray(p.members)
      || (p.categorySeq!==undefined&&!positive(p.categorySeq)) || (p.subscriptionType!==undefined&&!['SHARE','INVITE'].includes(p.subscriptionType))
      || !p.posts.some(x => x.seq === p.seedPostSeq) || !p.posts.some(x => x.seq === p.currentPostSeq)) throw Error('구독공유 재등록 정책 확인 필요');
    for (const post of p.posts) { if (!positive(post.seq) || !positive(post.capacity) || post.capacity > p.capacity || all.has(post.seq)) throw Error('구독공유 판매글 중복 연결'); all.add(post.seq); }
    for (const [id, m] of Object.entries(p.members)) if (id !== `${m.postSeq}:${m.seq}` || !p.posts.some(x => x.seq === m.postSeq) || !positive(m.seq) || !positive(m.userSeq)
      || (m.observedAt!==undefined&&!Number.isFinite(Date.parse(m.observedAt))) || (m.createdAt!==undefined&&!validDate(ottDate(m.createdAt)))
      || !validDate(m.endDate) || m.endDate > p.endDate || typeof m.status !== 'string' || (m.cancelStatus !== null && typeof m.cancelStatus !== 'string')) throw Error('구독공유 구매자 연결 확인 필요');
    if (p.pending && (p.pending.sourcePostSeq !== p.currentPostSeq || !['closing', 'publishing'].includes(p.pending.phase)
      || !Number.isSafeInteger(p.pending.afterSeq) || p.pending.afterSeq < 0 || (p.pending.phase === 'publishing' && !p.pending.payload))) throw Error('구독공유 미확인 재등록 연결 확인 필요');
    if(p.pending?.credentialsHash!==undefined&&!/^[a-f0-9]{64}$/.test(p.pending.credentialsHash))throw Error('재등록 계정 정보 지문 확인 필요');
    if(p.pending?.postSeq!==undefined&&(!positive(p.pending.postSeq)||p.posts.some(row=>row.seq===p.pending!.postSeq)))throw Error('재등록 결과 연결 확인 필요');
    if (p.pending?.payload && !validPayload(p.pending.payload, p.endDate, p.capacity, p.categorySeq??7, p.subscriptionType??'INVITE')) throw Error('구독공유 재등록 제출 조건 확인 필요');
  }
  return s;
}
export function writeYouTubeRenewals(s: YouTubeRenewalStore): void { writeJsonAtomic(file(), validateYouTubeRenewals(s)); }
function validPayload(p: SubscriptionPayload, endDate: string, capacity: number, category=7, type='INVITE'): boolean {
  return p.category === category && p.subscriptionType === type && (p.subscriptionPrincipal === ''||p.subscriptionPrincipal===null) && (p.subscriptionCredential === ''||p.subscriptionCredential===null)
    && p.priceType === 'DAY' && positive(p.price) && positive(p.memberLimit) && p.memberLimit <= capacity && ottDate(p.subscriptionEndsAt) === endDate
    && typeof p.title==='string' && !!p.title.trim() && p.title.length <= 100 && typeof p.description==='string' && !!p.description.trim() && p.description.length<=5000 && validDate(ottDate(p.subscriptionEndsAt)) && Array.isArray(p.countries) && p.countries.length > 0 && p.countries.every(c=>typeof c==='string'&&c.length>0);
}
function assertSource(post: GbutsOttPost, p: YouTubeRenewal, expectedCapacity: number): void {
  if (post.category1.seq !== (p.categorySeq??7) || post.subscriptionType !== (p.subscriptionType??'INVITE') || post.priceType !== 'DAY' || post.memberLimit !== expectedCapacity
    || ottDate(post.subscriptionEndsAt) !== p.endDate || !['ON_SALE', 'CLOSED'].includes(post.status)) throw Error('구독공유 기존 판매 조건 확인 필요');
}
export function bindSubscriptionRenewal(s: YouTubeRenewalStore, post: GbutsOttPost, enabled: boolean, now = new Date()): YouTubeRenewal {
  const existing = Object.values(s.policies).find(p => p.posts.some(x => x.seq === post.seq) || p.pending?.postSeq === post.seq);
  if (existing) { if (existing.currentPostSeq !== post.seq) throw Error('최근 유튜브 판매글을 선택해주세요.'); existing.enabled = enabled; return existing; }
  if (!positive(post.seq) || !positive(post.memberLimit) || post.status !== 'ON_SALE' || !validDate(ottDate(post.subscriptionEndsAt)) || ottDate(post.subscriptionEndsAt) <= koreaToday(now)) throw Error('현재 유튜브 초대 판매글을 확인해주세요.');
  const p: YouTubeRenewal = { seedPostSeq: post.seq, currentPostSeq: post.seq, capacity: post.memberLimit, endDate: ottDate(post.subscriptionEndsAt), enabled,
    categorySeq:post.category1.seq,subscriptionType:post.subscriptionType, trigger: 'rank', rankThreshold: 5, nextAt: now.toISOString(), lastRepostedAt: now.toISOString(), posts: [{ seq: post.seq, capacity: post.memberLimit }], members: {} };
  if(!positive(post.category1.seq)||!['SHARE','INVITE'].includes(post.subscriptionType))throw Error('구독공유 판매 유형 확인 필요');
  assertSource(post, p, post.memberLimit); s.policies[String(post.seq)] = p; return p;
}
export function bindYouTubeRenewal(s: YouTubeRenewalStore,post:GbutsOttPost,enabled:boolean,now=new Date()):YouTubeRenewal {
  if(post.category1.seq!==7||post.subscriptionType!=='INVITE'||post.memberLimit>5)throw Error('구독공유 초대형 판매글 확인 필요');
  return bindSubscriptionRenewal(s,post,enabled,now);
}
function holds(m: Member, now: Date): boolean { return (m.status === 'APPLY' || m.status === 'MISSING') && m.cancelStatus !== 'REFUNDED' && m.endDate >= koreaToday(now); }
export function youtubeOccupied(p: YouTubeRenewal, now = new Date()): number {
  return Object.values(p.members).filter(m => holds(m, now)).length + subscriptionExternalOccupancy(p, now);
}
export function subscriptionExternalOccupancy(p: YouTubeRenewal, now = new Date()): number {
  if (p.categorySeq !== 5 || p.subscriptionType !== 'SHARE') return 0;
  const store = readGbutsOttStore();
  const listing = Object.values(store.listings).find(l => l.postSeq === p.currentPostSeq);
  if (!listing) return 0;
  const chain = new Set(p.posts.map(x => x.seq));
  return Object.values(store.orders).filter(o => o.replacement && !chain.has(o.postSeq)
    && holdsNetflixProfile(o, gbutsOrderListing(store, o), now)
    && ottKey('넷플릭스', o.replacement.accountEmail) === ottKey(listing.serviceType, listing.accountEmail)).length;
}
function refreshMembers(p: YouTubeRenewal, post: GbutsOttPost, rows: GbutsOttMember[], now: Date): void {
  if (rows.filter(m => activeOttOrder({ ...m, endDate: ottDate(m.subscriptionEndsAt) }, now)).length < post.memberCount) throw Error('구독공유 최종 구매자 목록 확인 중');
  const seen = new Set<string>();
  for (const row of rows) {
    const key = `${post.seq}:${row.seq}`; const old = p.members[key]; const endDate = ottDate(row.subscriptionEndsAt);
    if (seen.has(key) || !positive(row.seq) || !positive(row.userSeq) || (old && old.userSeq !== row.userSeq) || !endDate || endDate > p.endDate || !validDate(ottDate(row.createdAt))) throw Error('구독공유 구매자 식별 또는 기간 확인 필요');
    seen.add(key); p.members[key] = { postSeq: post.seq, seq: row.seq, userSeq: row.userSeq, status: row.status, cancelStatus: row.cancelStatus, endDate,createdAt:row.createdAt,nickname:row.nickname,observedAt:now.toISOString() };
  }
  for (const [key, m] of Object.entries(p.members)) if (m.postSeq === post.seq && !seen.has(key)){m.status = 'MISSING';m.observedAt=now.toISOString();}
}
function payload(post: GbutsOttPost, remaining: number, now: Date): SubscriptionPayload {
  return { category: post.category1.seq, countries: post.countries, subscriptionType: post.subscriptionType, subscriptionPrincipal: post.subscriptionPrincipal==null?null:'', subscriptionCredential: post.subscriptionCredential==null?null:'',
    subscriptionStartsAt: `${koreaToday(now)} 00:00:00`, subscriptionEndsAt: post.subscriptionEndsAt, price: Number(post.price), priceType: 'DAY', memberLimit: remaining,
    title: localized(post.title), description: localized(post.description), noticeBeforeOrder: localized(post.noticeBeforeOrder), noticeAfterOrder: localized(post.noticeAfterOrder) };
}
function matches(post: GbutsOttPost, v: SubscriptionPayload): boolean {
  return post.category1.seq === v.category && post.subscriptionType === v.subscriptionType && post.priceType === v.priceType && Number(post.price) === v.price
    && post.memberLimit === v.memberLimit && post.subscriptionEndsAt === v.subscriptionEndsAt && post.subscriptionStartsAt === v.subscriptionStartsAt
    && localized(post.title) === v.title && localized(post.description) === v.description && localized(post.noticeBeforeOrder) === v.noticeBeforeOrder
    && localized(post.noticeAfterOrder) === v.noticeAfterOrder && JSON.stringify(post.countries) === JSON.stringify(v.countries);
}
export async function renewSubscriptionRankings(client: InviteClient, options: { read?: () => YouTubeRenewalStore; write?: (s: YouTubeRenewalStore) => void; now?: Date; allowed?: () => boolean; adopt?:(policy:YouTubeRenewal,post:GbutsOttPost)=>Promise<void>; clock?:()=>Date; verify?:(policy:YouTubeRenewal)=>Promise<void> } = {}) {
  const s = (options.read || readYouTubeRenewals)(); const write = options.write || writeYouTubeRenewals; const now = options.now || new Date();
  const clock=options.clock||(()=>options.now||new Date());
  const next = new Date(now.getTime() + OTT_RANK_CHECK_INTERVAL).toISOString(); let renewed = 0; let errors = 0;
  const due = Object.values(s.policies).filter(p => (p.enabled || p.pending) && Date.parse(p.nextAt) <= now.getTime());
  const pending = Object.values(s.policies).filter(p => p.pending);
  if (pending.length > 1) throw Error('구독공유 미확인 재등록은 한 건씩 복구해야 합니다.');
  let chosen = pending[0];
  if (!chosen && due.length) {
    try {
      const candidates: YouTubeRenewal[] = [];const seller=await client.sellerAccountSeq();
      const categories=[...new Set(due.map(p=>p.categorySeq??7))];
      for(const category of categories){
      const policies=due.filter(p=>(p.categorySeq??7)===category);
      try{
      const rows=category===7?await client.listOttPublicRanking('유튜브'):await client.listSubscriptionPublicRanking(category);
      const foreign=rows.findIndex(r=>r.sellerSeq!==seller);
      for (const p of policies) {
        const index = rows.findIndex(r => r.seq === p.currentPostSeq); if (index >= 0 && rows[index].sellerSeq !== seller) throw Error('구독공유 판매자 연결 확인 필요');
        p.rankCheckedAt = now.toISOString(); p.lastRank = index < 0 ? null : index + 1; p.nextAt = next; delete p.lastError;
        if (p.endDate <= koreaToday(now)) { p.enabled = false; continue; }
        const rank = index < 0 ? 21 : index + 1;
        if (rank >= 5 && foreign >= 0 && foreign < rank - 1 && (index >= 0 || rows.length === 20)
          && (!p.lastRepostedAt || now.getTime() - Date.parse(p.lastRepostedAt) >= OTT_RANK_COOLDOWN)) candidates.push(p);
      }
      }catch{for(const policy of policies){policy.lastError='구독공유 최신순 목록 확인 실패';policy.nextAt=next;}for(let i=candidates.length-1;i>=0;i--)if(policies.includes(candidates[i]))candidates.splice(i,1);errors++;}
      }
      chosen = candidates.sort((a,b) => (b.lastRank || 21) - (a.lastRank || 21))[0];
    } catch { for (const p of due) { p.lastError = '구독공유 최신순 목록 확인 실패'; p.nextAt = next; } errors++; }
    write(s);
  }
  if (!chosen || !due.includes(chosen)) return { renewed, errors };
  const p = chosen;
  try {
    // Uncertain CREATE is lookup-only, including after an explicit pause.
    if (p.pending?.phase === 'publishing') {
      const frozen = p.pending.payload!;
      const candidates = p.pending.postSeq ? [await client.getPost(p.pending.postSeq)] : await client.listPostsAfter(p.pending.afterSeq);
      const found: GbutsOttPost[] = [];
      for (const candidate of candidates) { const actual = await client.getPost(candidate.seq); if (matches(actual, frozen)&&(!p.pending.credentialsHash||privateFieldsHash(actual)===p.pending.credentialsHash)) found.push(actual); }
      if (found.length !== 1 || !['ON_SALE','CLOSED'].includes(found[0].status)) throw Error('구독공유 제출 결과 조회 확인 중');
      await options.adopt?.(p,found[0]);
      p.currentPostSeq = found[0].seq; p.posts.push({ seq: found[0].seq, capacity: frozen.memberLimit }); delete p.pending;
      p.lastSuccess = clock().toISOString(); p.lastRepostedAt = p.lastSuccess; p.nextAt = next; delete p.lastError; renewed++; write(s);
      return { renewed, errors };
    }
    if (!p.enabled || p.endDate <= koreaToday(now)) { p.enabled = false; delete p.pending; p.nextAt = next; write(s); return { renewed, errors }; }
    let source: GbutsOttPost | undefined;
    for (const entry of p.posts.filter(x => x.seq === p.currentPostSeq || Object.values(p.members).some(m => m.postSeq === x.seq && holds(m, now)))) {
      const [post, members] = await Promise.all([client.getPost(entry.seq), client.listOttMembers(entry.seq)]);
      assertSource(post, p, entry.capacity); refreshMembers(p, post, members, now); if (entry.seq === p.currentPostSeq) source = post;
    }
    write(s); if (!source) throw Error('구독공유 원본 연결 확인 필요');
    const pickedUntil = source.status === 'ON_SALE' ? activePickUntil(source, clock()) : undefined;
    if (pickedUntil) { p.nextAt = pickedUntil; write(s); return { renewed, errors }; }
    if(!p.pending&&source.status!=='ON_SALE'){p.enabled=false;p.nextAt=next;write(s);return {renewed,errors};}
    let remaining = p.capacity - youtubeOccupied(p, now); if (remaining < 0) throw Error('구독공유 정원 초과 확인 필요');
    if (!remaining) { delete p.pending; p.nextAt = next; p.lastSuccess = now.toISOString(); write(s); return { renewed, errors }; }
    if(!validPayload(payload(source,remaining,clock()),p.endDate,p.capacity,p.categorySeq??7,p.subscriptionType??'INVITE'))throw Error('재등록 전 공개 판매 조건 확인 필요');
    privateFieldsHash(source);
    await options.verify?.(p);
    if(options.allowed&&!options.allowed())return {renewed,errors};
    if(!p.pending){const current=await client.getPost(source.seq);assertSource(current,p,source.memberLimit);const picked=activePickUntil(current,clock());if(picked){p.nextAt=picked;write(s);return {renewed,errors};}if(current.status!=='ON_SALE'){p.enabled=false;p.nextAt=next;write(s);return {renewed,errors};}}
    if (!p.pending) { p.pending = { phase: 'closing', sourcePostSeq: source.seq, afterSeq: await client.latestPostSeq() }; write(s); }
    if (source.status === 'ON_SALE') { try { await client.closePost(source.seq); } catch { /* Read closure, never assume failure/success. */ } }
    const [closed, final] = await Promise.all([client.getPost(source.seq), client.listOttMembers(source.seq)]);
    assertSource(closed, p, source.memberLimit); if (closed.status !== 'CLOSED') throw Error('구독공유 모집 종료 확인 중');
    refreshMembers(p, closed, final, now); remaining = p.capacity - youtubeOccupied(p, now); write(s);
    if (remaining < 0) throw Error('구독공유 최종 정원 초과 확인 필요');
    if (!remaining) { delete p.pending; p.nextAt = next; p.lastSuccess = now.toISOString(); write(s); return { renewed, errors }; }
    if(options.allowed&&!options.allowed()){p.nextAt=next;write(s);return {renewed,errors};}
    if(p.endDate<=koreaToday(clock())){p.enabled=false;delete p.pending;p.nextAt=next;write(s);return {renewed,errors};}
    await options.verify?.(p);
    if(options.allowed&&!options.allowed()){p.nextAt=next;write(s);return {renewed,errors};}
    if(p.endDate<=koreaToday(clock())){p.enabled=false;delete p.pending;p.nextAt=next;write(s);return {renewed,errors};}
    const frozen = payload(closed, remaining, clock()); if (!validPayload(frozen, p.endDate, p.capacity,p.categorySeq??7,p.subscriptionType??'INVITE')) throw Error('구독공유 공개 판매 조건 확인 필요');
    p.pending.payload = frozen;p.pending.credentialsHash=privateFieldsHash(closed); p.pending.phase = 'publishing'; write(s);
    // Never replay this mutation, even if no response arrives.
    const privateValues=privateFields(closed);
    p.pending.postSeq = (await (frozen.category===7&&frozen.subscriptionType==='INVITE'&&!privateValues.subscriptionPrincipal&&!privateValues.subscriptionCredential
      ?client.createYouTubeInvitePost({...frozen,category:7,subscriptionType:'INVITE',subscriptionPrincipal:'',subscriptionCredential:''})
      :client.createSubscriptionPost({...frozen,...privateValues}))) || undefined; write(s);
    const recovered=await renewSubscriptionRankings(client, { read: () => s, write, now, allowed: options.allowed, adopt: options.adopt, clock: options.clock, verify: options.verify });
    return {renewed:renewed+recovered.renewed,errors:errors+recovered.errors};
  } catch { p.lastError = '구독공유 재등록 결과 또는 구매자 확인 필요'; p.nextAt = next; write(s); return { renewed, errors: errors + 1 }; }
}

export function privateFields(post:GbutsOttPost):{subscriptionPrincipal:string|null;subscriptionCredential:string|null} {
  const decode=(value:unknown)=>{if(value==null)return null;if(typeof value!=='string')throw Error('계정 정보 형식 확인 필요');
    if(/^(?:[a-f\d]{32})+$/i.test(value)){const decoded=tryDecodeGbutsSubscriptionCredential(value);if(decoded===null)throw Error('계정 정보 읽기 확인 필요');return decoded;}return value;};
  return {subscriptionPrincipal:decode(post.subscriptionPrincipal),subscriptionCredential:decode(post.subscriptionCredential)};
}
export function privateFieldsHash(post:GbutsOttPost):string {return createHash('sha256').update(JSON.stringify(Object.values(privateFields(post)).map(v=>v||''))).digest('hex');}

/** Backwards-compatible entry point for the existing dedicated YouTube journal. */
export function renewYouTubeInvites(client:InviteClient,options:Parameters<typeof renewSubscriptionRankings>[1]={}){return renewSubscriptionRankings(client,options);}
