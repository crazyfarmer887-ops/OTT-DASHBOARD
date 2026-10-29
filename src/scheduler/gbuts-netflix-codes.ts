import { createHash } from 'node:crypto';
import { portalDelivered } from '../lib/netflix-portal';
import { gbutsOrderListing } from '../lib/gbuts-ott';
import { existsSync, readFileSync } from 'node:fs';
import { loadSafeModeConfig } from '../api/safe-mode';
import { writeJsonAtomic } from '../lib/graytag-sales-session';
import { createGbutsOttSellerClient } from '../lib/gbuts-ott-client';
import { loadGbutsSession } from '../lib/gbuts-session';
import { readGbutsOttStore } from '../lib/gbuts-ott-store';
import { deliverableOttOrder, hasGbutsOttProfileLease, ottDate, type GbutsOttOrder, type GbutsOttListing, type GbutsOttStore } from '../lib/gbuts-ott';
import { GbutsChatDeliveryError } from '../lib/gbuts-chat-delivery';
import { sendGbutsText } from './gbuts-spotify-messages';
import { netflixCodeRequestKind, type NetflixCode, type NetflixCodeKind } from '../lib/aaryan-netflix-code';
import { requestAaryanNetflixCode } from '../lib/aaryan-telegram';
import type { GbutsOttRuntimeDependencies } from './gbuts-ott-sync';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const ms = (s: string) => Date.parse(/(?:Z|[+-]\d\d:\d\d)$/.test(s) ? s : s.replace(' ','T')+'+09:00');
type Receipt = { orderKey: string; requestAt: string; roomHash: string; state: 'ready' | 'querying' | 'attempted' | 'confirmed' | 'blocked';
  kind: NetflixCodeKind | 'ambiguous'; purpose?: 'clarification' | 'code'; at: string; attempts: number; retryAt?: string;
  textHash?: string; codeHash?: string; botMessageId?: number; error?: string };
export type NetflixCodeJournal = { version: 1; receipts: Record<string, Receipt> };
const path = () => process.env.GBUTS_NETFLIX_CODES_PATH || '/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data/gbuts-netflix-codes.json';
export function readNetflixCodeJournal(): NetflixCodeJournal {
  if (!existsSync(path())) return { version: 1, receipts: {} };
  const s = JSON.parse(readFileSync(path(),'utf8'));
  if (s?.version !== 1 || !s.receipts || Array.isArray(s.receipts)) throw Error('CODE_JOURNAL_INVALID');
  for (const [key,r] of Object.entries(s.receipts) as Array<[string,Receipt]>) if (!/^[a-f0-9]{64}$/.test(key) || !['ready','querying','attempted','confirmed','blocked'].includes(r.state)
    || !['login','account','ambiguous'].includes(r.kind) || !Number.isFinite(ms(r.requestAt)) || !r.orderKey || !r.roomHash
    || !Number.isSafeInteger(r.attempts) || r.attempts<0 || (r.state==='attempted' && !r.textHash)) throw Error('CODE_JOURNAL_INVALID');
  return s;
}
export function writeNetflixCodeJournal(s: NetflixCodeJournal) { writeJsonAtomic(path(),s); }
type Client = ReturnType<typeof createGbutsOttSellerClient>;
export type NetflixCodeDependencies = { store(): GbutsOttStore; client: Client; sellerSeq: number; credentials: NonNullable<GbutsOttRuntimeDependencies['credentials']>;
  query(email: string,kind: NetflixCodeKind,requestedAt: string): Promise<NetflixCode>; send: typeof sendGbutsText;
  allowed?(): boolean; read(): NetflixCodeJournal; write(s: NetflixCodeJournal): void; now(): Date };
function bound(store: GbutsOttStore, key: string, now = new Date()): {order: GbutsOttOrder;listing: GbutsOttListing} | undefined {
  const order = store.orders[key]; const listing = order && gbutsOrderListing(store,order);
  if (!listing || listing.serviceType!=='넷플릭스' || listing.emailCodeProvider!=='aaryan' || !deliverableOttOrder(order,now)
    || !hasGbutsOttProfileLease(store,order,undefined,now) || order.delivery!=='confirmed' || !order.roomId || !order.profileNumber || portalDelivered(key,store)) return;
  return {order,listing};
}
async function verifiedChat(deps: NetflixCodeDependencies, key: string) {
  if (deps.allowed && !deps.allowed()) return;
  const binding=bound(deps.store(),key,deps.now());if(!binding)return;
  const {order}=binding;
  const [post,members]=await Promise.all([deps.client.getPost(order.postSeq),deps.client.listOttMembers(order.postSeq)]);
  const original=deps.store().listings[order.listingId];
  if(post.category1.seq!==5 || post.memberLimit!==original.capacity || ottDate(post.subscriptionEndsAt)!==original.endDate) return;
  const exact=members.filter(m=>m.seq===order.memberSeq&&m.userSeq===order.userSeq);
  if(exact.length!==1 || !deliverableOttOrder({...exact[0],endDate:ottDate(exact[0].subscriptionEndsAt)},deps.now())) return;
  if(await deps.client.openPrivateRoom(order.postSeq,order.userSeq)!==order.roomId)return;
  const {messages}=await deps.client.getChat(order.roomId);
  return {...binding,messages};
}
function latestRequest(messages: Awaited<ReturnType<Client['getChat']>>['messages'], order: GbutsOttOrder, now: Date) {
  const latest=messages.filter(m=>m.messageType==='TEXT'&&Number.isFinite(ms(m.createdAt))).sort((a,b)=>ms(a.createdAt)-ms(b.createdAt)).at(-1);
  if(!latest || latest.senderSeq!==order.userSeq || latest.message.length>1000 || ms(latest.createdAt)>now.getTime()+30_000
    || now.getTime()-ms(latest.createdAt)>24*60*60_000 || ms(latest.createdAt)<ms(order.purchasedAt||`${order.startDate}T00:00:00+09:00`))return;
  const kind=netflixCodeRequestKind(latest.message);if(!kind)return;
  return {kind,at:new Date(ms(latest.createdAt)).toISOString(),key:hash(JSON.stringify([order.key,order.roomId,latest.senderSeq,latest.createdAt,latest.message]))};
}
/** Fresh buyer/source validation before lookup and before SEND. No code is written to disk. */
export async function processNetflixCodeRequest(key: string,deps: NetflixCodeDependencies): Promise<void> {
  const initial=await verifiedChat(deps,key);if(!initial)return;const {order}=initial;const journal=deps.read();
  for(const r of Object.values(journal.receipts).filter(r=>r.roomHash===hash(order.roomId!)&&r.state==='attempted')){
    if(initial.messages.some(m=>m.senderSeq===deps.sellerSeq&&m.messageType==='TEXT'&&ms(m.createdAt)>=Math.floor(ms(r.at)/1000)*1000&&hash(m.message.trim())===r.textHash)){
      r.state='confirmed';delete r.error;deps.write(journal);
    }else return;
  }
  const request=latestRequest(initial.messages,order,deps.now());if(!request)return;
  let r=journal.receipts[request.key];if(r&&['confirmed','blocked','attempted'].includes(r.state))return;
  if(r?.state==='querying'&&deps.now().getTime()-ms(r.at)<120_000)return;
  if(r?.retryAt&&ms(r.retryAt)>deps.now().getTime())return;
  if(!r){r=journal.receipts[request.key]={orderKey:key,requestAt:request.at,roomHash:hash(order.roomId!),kind:request.kind,state:'ready',at:deps.now().toISOString(),attempts:0};deps.write(journal);}
  try {
    let text: string; let codeExpiresAt: number | undefined;
    if(request.kind==='ambiguous'){
      text='어떤 인증 화면인지 알려주세요. 4자리 로그인 코드가 필요하면 “4자리 로그인 코드”, 6자리 계정 인증 코드가 필요하면 “6자리 인증 코드”라고 남겨주세요.';r.purpose='clarification';
    }else{
      if(r.attempts>=3){r.state='blocked';r.error='새 인증코드를 요청한 뒤 다시 문의해주세요.';deps.write(journal);return;}
      const credentials=await deps.credentials(initial.order,initial.listing);r.state='querying';r.at=deps.now().toISOString();r.attempts++;deps.write(journal);
      const code=await deps.query(credentials.id,request.kind,request.at);
      // The adapter has already checked the bot/reply/email/age. Recheck our immutable request binding too.
      if(code.email.toLowerCase()!==credentials.id.toLowerCase()||code.kind!==request.kind||!new RegExp(`^\\d{${code.kind==='login'?4:6}}$`).test(code.code)
        || ms(code.receivedAt)>deps.now().getTime()+60_000 || deps.now().getTime()-ms(code.receivedAt)>15*60_000 || ms(code.receivedAt)<ms(request.at)-120_000)throw Error('CODE_BINDING_MISMATCH');
      const fingerprint=hash(`${code.email.toLowerCase()}:${code.kind}:${code.receivedAt}:${code.code}`);
      if(Object.values(journal.receipts).some(other=>other!==r&&other.codeHash===fingerprint&&['attempted','confirmed'].includes(other.state)))throw Error('CODE_ALREADY_DELIVERED');
      const fresh=await verifiedChat(deps,key);const current=fresh&&latestRequest(fresh.messages,fresh.order,deps.now());
      if(!fresh||current?.key!==request.key||(await deps.credentials(fresh.order,fresh.listing)).id.toLowerCase()!==code.email.toLowerCase())throw Error('BUYER_CHANGED');
      text=`${code.kind==='login'?'넷플릭스 4자리 로그인 코드':'넷플릭스 6자리 계정 인증 코드'}: ${code.code}\n이메일 수신 시각: ${new Date(code.receivedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})}\n요청하신 인증 화면에 입력해 주세요. 코드가 만료되면 넷플릭스에서 새 코드를 요청한 뒤 이 채팅으로 다시 알려주세요.`;
      codeExpiresAt=ms(code.receivedAt)+15*60_000;
      r.codeHash=fingerprint;r.botMessageId=code.botMessageId;r.purpose='code';
    }
    // Clarification also needs a fresh exact requester and no intervening human reply.
    const final=await verifiedChat(deps,key);if(!final||latestRequest(final.messages,final.order,deps.now())?.key!==request.key)throw Error('BUYER_CHANGED');
    if(codeExpiresAt!==undefined && deps.now().getTime()>=codeExpiresAt)throw Error('CODE_EXPIRED_BEFORE_SEND');
    r.textHash=hash(text.trim());r.state='attempted';r.at=deps.now().toISOString();delete r.error;deps.write(journal);
    await deps.send(order.roomId!,deps.sellerSeq,text);
    const saved=(await deps.client.getChat(order.roomId!)).messages.some(m=>m.senderSeq===deps.sellerSeq&&m.messageType==='TEXT'&&hash(m.message.trim())===r!.textHash&&ms(m.createdAt)>=Math.floor(ms(r!.at)/1000)*1000);
    if(saved)r.state='confirmed';else r.error='채팅 전달 결과 확인 중';deps.write(journal);
  }catch(error){
    if(r.state==='attempted'){
      if(error instanceof GbutsChatDeliveryError&&!error.submitted){r.state=error.retryable?'ready':'blocked';r.retryAt=new Date(deps.now().getTime()+120_000).toISOString();delete r.textHash;}
      r.error='채팅 전달 결과 확인 필요';
    }else{r.state='ready';r.retryAt=new Date(deps.now().getTime()+120_000).toISOString();r.error='최신 인증 코드 또는 구매자 연결 확인 필요';}
    deps.write(journal);
  }
}
export function startGbutsNetflixCodes(credentials: NonNullable<GbutsOttRuntimeDependencies['credentials']>): (()=>void)|undefined {
  if(process.env.GBUTS_OTT_SYNC_ENABLED!=='true')return;let running=false;
  const run=async()=>{if(running||loadSafeModeConfig().enabled)return;running=true;
    try{const token=loadGbutsSession()?.token||process.env.GBUTS_API_TOKEN?.trim();if(!token)return;const client=createGbutsOttSellerClient(token);
      const store=readGbutsOttStore();const keys=Object.keys(store.orders).filter(key=>!!bound(store,key));if(!keys.length)return;
      const sellerSeq=await client.sellerAccountSeq();for(const key of keys)await processNetflixCodeRequest(key,{store:readGbutsOttStore,client,sellerSeq,credentials,
        query:requestAaryanNetflixCode,send:sendGbutsText,allowed:()=>process.env.GBUTS_OTT_SYNC_ENABLED==='true'&&!loadSafeModeConfig().enabled,read:readNetflixCodeJournal,write:writeNetflixCodeJournal,now:()=>new Date()});
    }catch{console.error('[GbutsNetflixCodes] 연결 확인 필요');}finally{running=false;}};
  const initial=setTimeout(()=>void run(),4000);const interval=setInterval(()=>void run(),15000);initial.unref();interval.unref();return()=>{clearTimeout(initial);clearInterval(interval);};
}
