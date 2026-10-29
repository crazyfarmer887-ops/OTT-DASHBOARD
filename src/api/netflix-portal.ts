import { Hono } from 'hono';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { readNetflixPortalStore, portalHash, portalRecordMatches, verifyPortalPin, type NetflixPortalRecord, type NetflixPortalStore } from '../lib/netflix-portal';
import { readGbutsOttStore } from '../lib/gbuts-ott-store';
import { deliverableOttOrder, gbutsOrderListing, hasGbutsOttProfileLease, ottDate, type GbutsOttStore } from '../lib/gbuts-ott';
import { readAaryanTelegramConfig, requestAaryanNetflixCode } from '../lib/aaryan-telegram';
import type { NetflixCode, NetflixCodeKind } from '../lib/aaryan-netflix-code';
import { createGbutsOttSellerClient } from '../lib/gbuts-ott-client';
import { loadGbutsSession } from '../lib/gbuts-session';
import type { GbutsOttRuntimeDependencies } from '../scheduler/gbuts-ott-sync';
import { loadSafeModeConfig } from './safe-mode';
import { sendSellerAlert, type SellerAlertInput } from '../alerts/telegram';

export interface NetflixPortalDependencies {
  read(): NetflixPortalStore|null; inventory(): GbutsOttStore;
  client(): ReturnType<typeof createGbutsOttSellerClient>;
  credentials: NonNullable<GbutsOttRuntimeDependencies['credentials']>;
  allowedEmail(email:string): boolean; allowed(): boolean;
  query(email:string,kind:NetflixCodeKind,at:string):Promise<NetflixCode>;
  alert(input:SellerAlertInput):Promise<unknown>; now():Date;
  /** Explicit test/preview origin only; production factory always uses email-verify.one. */
  origin?:string;
}
export function netflixPortalDependencies(credentials: NetflixPortalDependencies['credentials']): NetflixPortalDependencies {
  return {read:readNetflixPortalStore,inventory:readGbutsOttStore,credentials,now:()=>new Date(),query:(email,kind,at)=>requestAaryanNetflixCode(email,kind,at,15*60_000),
    client:()=>{const token=loadGbutsSession()?.token||process.env.GBUTS_API_TOKEN;if(!token)throw Error('SELLER_SESSION_REQUIRED');return createGbutsOttSellerClient(token);},
    allowed:()=>process.env.GBUTS_OTT_SYNC_ENABLED==='true'&&!loadSafeModeConfig().enabled,
    allowedEmail:email=>{const c=readAaryanTelegramConfig();return c.allowedEmails.includes(email)&&Date.parse(c.expiresAt)>Date.now();},alert:sendSellerAlert};
}
/** Paid identity remains on the original post even after an individual replacement. */
export async function verifiedNetflixPortalBinding(r:NetflixPortalRecord,deps:NetflixPortalDependencies) {
  const portal=deps.read();
  if(!portal?.enabled||!portal.records[r.tokenHash]||portal.records[r.tokenHash].revokedAt||!deps.allowed()||!deps.allowedEmail(r.accountEmail))throw Error('PORTAL_UNAVAILABLE');
  const store=deps.inventory(),order=store.orders[r.orderKey],original=order&&store.listings[order.listingId];
  if(!order||!original||!portalRecordMatches(r,store,order)||!deliverableOttOrder(order,deps.now())
    ||!hasGbutsOttProfileLease(store,order,undefined,deps.now())||order.delivery!=='confirmed')throw Error('BUYER_INACTIVE');
  const client=deps.client(); const [post,members]=await Promise.all([client.getPost(order.postSeq),client.listOttMembers(order.postSeq)]);
  const found=members.filter(m=>m.seq===order.memberSeq&&m.userSeq===order.userSeq);
  if(post.category1.seq!==5||post.memberLimit!==original.capacity||ottDate(post.subscriptionEndsAt)!==original.endDate
    ||found.length!==1||!deliverableOttOrder({...found[0],endDate:ottDate(found[0].subscriptionEndsAt)},deps.now())
    ||ottDate(found[0].subscriptionEndsAt)!==order.endDate)throw Error('BUYER_INACTIVE');
  if(await client.openPrivateRoom(order.postSeq,order.userSeq)!==order.roomId)throw Error('BUYER_ROOM_CHANGED');
  const room=await client.getChat(order.roomId!),seller=await client.sellerAccountSeq();
  if(room.members.length!==2||!room.members.every((m:any)=>[seller,order.userSeq].includes(m.seq)))throw Error('BUYER_ROOM_CHANGED');
  const credentials=await deps.credentials(order,gbutsOrderListing(store,order));
  if(credentials.id.trim().toLowerCase()!==r.accountEmail)throw Error('BUYER_ACCOUNT_CHANGED');
  const latest=deps.inventory(),current=latest.orders[r.orderKey];
  if(!current||!portalRecordMatches(r,latest,current)||!deliverableOttOrder(current,deps.now())||!hasGbutsOttProfileLease(latest,current))throw Error('BUYER_INACTIVE');
  return {store,order,client,seller,room};
}
const same=(a:string,b:string)=>a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const sign=(secret:string,payload:string)=>createHmac('sha256',secret).update('netflix-portal-v1:'+payload).digest('hex');
function session(secret:string,r:NetflixPortalRecord,now:number){const body=Buffer.from(JSON.stringify({hash:r.tokenHash,exp:now+30*60_000})).toString('base64url');return body+'.'+sign(secret,body);}
function hasSession(cookie:string,secret:string,r:NetflixPortalRecord,now:number):boolean {
  try{const token=cookie.split(';').map(x=>x.trim()).find(x=>x.startsWith('netflix_portal='))?.slice(15)||'';
    const [body,sig]=token.split('.');if(!body||!sig||!same(sig,sign(secret,body)))return false;
    const claims=JSON.parse(Buffer.from(body,'base64url').toString());return claims.hash===r.tokenHash&&Number.isFinite(claims.exp)&&claims.exp>now&&claims.exp<=now+30*60_000;
  }catch{return false;}
}
export function createNetflixPortalApp(deps:NetflixPortalDependencies) {
  const app=new Hono();const failures=new Map<string,{count:number,until:number}>(),queries=new Map<string,number>();
  const flights=new Map<string,Promise<NetflixCode>>(),cached=new Map<string,{code:NetflixCode,at:number}>();let busy=false;
  const limited=(key:string,max:number,window:number,now:number)=>{let v=failures.get(key);if(!v||v.until<=now){v={count:0,until:now+window};failures.set(key,v);}return ++v.count>max;};
  const record=(token:string)=>{if(!/^[A-Za-z0-9_-]{43}$/.test(token))return null;const s=deps.read(),r=s?.records[portalHash(token)];return s?.enabled&&r&&!r.revokedAt?{s,r}:null;};
  const notify=(r:NetflixPortalRecord,code:string)=>deps.alert({key:`netflix-portal:${r.tokenHash.slice(0,16)}:${code}`,provider:'gbuts',category:'system',attention:'action-required',
    title:'넷플릭스 인증 페이지 조회 오류',body:'공급 봇의 최신 인증 조회 또는 구매자 연결을 확인하지 못했습니다. 인증코드·PIN은 알림에 포함하지 않았습니다.',
    nextAction:'벗츠 구매자 채팅과 공급 봇 연결 상태를 확인해주세요.',actionUrl:`https://gbuts.com/seller/chats/${deps.inventory().orders[r.orderKey]?.roomId||''}`,throttleMs:30*60_000});
  app.use('*',async(c,next)=>{c.header('Cache-Control','no-store');c.header('Referrer-Policy','no-referrer');c.header('X-Content-Type-Options','nosniff');c.header('X-Robots-Tag','noindex, nofollow');
    if(c.req.method==='POST'&&(c.req.header('origin')!==(deps.origin||'https://email-verify.one')||!c.req.header('content-type')?.startsWith('application/json')))return c.json({error:'접근 경로를 확인해 주세요.'},403);
    const length=Number(c.req.header('content-length')||0);if(length>1024||(c.req.method==='POST'&&Buffer.byteLength(await c.req.text())>1024))return c.json({error:'요청이 너무 깁니다.'},413);await next();});
  app.get('/:token',async c=>{try{const match=record(c.req.param('token'));if(!match)return c.json({error:'사용할 수 없는 링크입니다.'},404);
    if(!hasSession(c.req.header('cookie')||'',match.s.sessionSecret,match.r,deps.now().getTime()))return c.json({unlocked:false});
    const b=await verifiedNetflixPortalBinding(match.r,deps);return c.json({unlocked:true,email:match.r.accountEmail,profile:b.order.profileNumber,endDate:b.order.endDate});
  }catch{return c.json({error:'이용 기간이나 계정 배정 확인이 필요합니다.'},403);}});
  app.post('/:token/unlock',async c=>{try{const match=record(c.req.param('token'));if(!match)return c.json({error:'사용할 수 없는 링크입니다.'},404);
    const now=deps.now().getTime(),ip=c.req.header('x-real-ip')||'unknown';
    if(limited('pin:'+match.r.tokenHash,10,15*60_000,now)||limited('ip:'+ip,30,15*60_000,now))return c.json({error:'PIN 확인 횟수를 초과했습니다. 15분 후 다시 시도해 주세요.'},429);
    const body=await c.req.json();if(!verifyPortalPin(body.pin,match.r))return c.json({error:'PIN이 맞지 않습니다. 1:1 채팅의 6자리를 확인해 주세요.'},403);
    const b=await verifiedNetflixPortalBinding(match.r,deps);
    c.header('Set-Cookie',`netflix_portal=${session(match.s.sessionSecret,match.r,now)}; Path=/api/netflix-portal/${match.r.token}; Max-Age=1800; HttpOnly; Secure; SameSite=Strict`);
    return c.json({unlocked:true,email:match.r.accountEmail,profile:b.order.profileNumber,endDate:b.order.endDate});
  }catch{return c.json({error:'이용 기간이나 계정 배정 확인이 필요합니다. 1:1 채팅으로 문의해 주세요.'},403);}});
  app.post('/:token/code',async c=>{let r:NetflixPortalRecord|undefined;try{const match=record(c.req.param('token'));if(!match)return c.json({error:'사용할 수 없는 링크입니다.'},404);r=match.r;
    const now=deps.now().getTime();if(!hasSession(c.req.header('cookie')||'',match.s.sessionSecret,r,now))return c.json({error:'PIN을 다시 입력해 주세요.'},403);
    const body=await c.req.json();if(!['login','account'].includes(body.kind))return c.json({error:'필요한 코드 종류를 선택해 주세요.'},400);const kind=body.kind as NetflixCodeKind;
    await verifiedNetflixPortalBinding(r,deps);
    // A login challenge can belong to one device even on a shared account.
    // Coalesce retries from the same buyer only, never share a cached code with
    // a different buyer who happens to use the same Netflix account.
    const key=r.tokenHash+':'+kind, accountKey=r.accountEmail+':'+kind;let flight=flights.get(key),code:NetflixCode|undefined;
    const hit=cached.get(key);if(hit&&now-hit.at<15_000)code=hit.code;
    if(!code){if(!flight){if(busy)return c.json({error:'다른 인증 요청을 확인 중입니다. 잠시 후 다시 눌러 주세요.'},409);
      if(now-(queries.get(accountKey)||0)<30_000)return c.json({error:'최신 코드를 확인했습니다. 30초 후 다시 시도해 주세요.'},429);
      queries.set(accountKey,now);busy=true;const at=new Date(now).toISOString();
      flight=deps.query(r.accountEmail,kind,at);flights.set(key,flight);
      void flight.then(value=>{cached.set(key,{code:value,at:deps.now().getTime()});},()=>undefined).finally(()=>{flights.delete(key);busy=false;});}
      code=await flight;}
    await verifiedNetflixPortalBinding(r,deps);
    const received=Date.parse(code.receivedAt),age=deps.now().getTime()-received;
    if(code.email!==r.accountEmail||code.kind!==kind||!new RegExp(`^\\d{${kind==='login'?4:6}}$`).test(code.code)||!Number.isFinite(received)||age< -60_000||age>15*60_000)throw Error('CODE_BINDING_INVALID');
    return c.json({code:code.code,kind,receivedAt:code.receivedAt});
  }catch(error){const known=error instanceof Error?error.message:'';if(known==='AARYAN_BUSY')return c.json({error:'다른 인증 요청을 확인 중입니다. 잠시 후 다시 눌러 주세요.'},409);
    if(r&&!['BUYER_INACTIVE','BUYER_ACCOUNT_CHANGED'].includes(known))await notify(r,'LOOKUP_FAILED').catch(()=>undefined);
    return c.json({error:'최신 코드를 확인하지 못했습니다. 넷플릭스에서 새 코드를 요청한 뒤 다시 확인해 주세요. 계속 안 되면 1:1 채팅으로 문의해 주세요.'},503);}});
  return app;
}
