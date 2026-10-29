import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {mkdtempSync,rmSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createNetflixPortalApp,type NetflixPortalDependencies} from '../src/api/netflix-portal';
import {ensureNetflixPortal,readNetflixPortalStore,writeNetflixPortalStore,verifyPortalPin,netflixPortalNotice,portalDelivered,type NetflixPortalStore} from '../src/lib/netflix-portal';
import {emptyGbutsOttStore} from '../src/lib/gbuts-ott';
import {fixtureListing,fixtureOrder} from './fixtures/gbuts-ott';
import {syncNetflixPortalOnboarding} from '../src/scheduler/netflix-portal-onboarding';
import {splitGbutsChatText,GbutsChatDeliveryError} from '../src/lib/gbuts-chat-delivery';
import {netflixPortalHtml,netflixPortalCsp} from '../src/lib/netflix-portal-page';
import {NETFLIX_PORTAL_GUIDE_ASSET} from '../src/lib/gbuts-netflix-guide';
beforeEach(()=>{vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date('2026-10-29T00:00:00Z'));});afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();});
function fixture(){
 const inventory=emptyGbutsOttStore(),listing=fixtureListing({capacity:5,emailCodeProvider:'aaryan'});inventory.listings[listing.id]=listing;
 const order=fixtureOrder({roomId:'fixture-room',profileName:'1',profileNumber:1,delivery:'confirmed',purchasedAt:'2026-10-28T00:00:00Z'});inventory.orders[order.key]=order;
 const portal:NetflixPortalStore={version:1,enabled:true,onboardingEnabled:true,activatedAt:'2026-10-29T00:00:00Z',sessionSecret:'a'.repeat(64),records:{}};
 const record=ensureNetflixPortal(portal,inventory,order,new Date().toISOString()),messages:any[]=[];
 const client={getPost:async()=>({category1:{seq:5},memberLimit:5,subscriptionEndsAt:listing.endDate}),listOttMembers:async()=>[{seq:order.memberSeq,userSeq:order.userSeq,status:order.status,cancelStatus:order.cancelStatus,subscriptionEndsAt:order.endDate}],openPrivateRoom:async()=>order.roomId,
  getChat:async()=>({members:[{seq:99},{seq:order.userSeq}],messages}),sellerAccountSeq:async()=>99};
 const query=vi.fn(async(email:string,kind:any)=>({email,kind,code:kind==='login'?'1234':'123456',receivedAt:new Date(Date.now()-60_000).toISOString(),botMessageId:1}));
 const alert=vi.fn(async()=>({}));const deps:NetflixPortalDependencies={read:()=>portal,inventory:()=>inventory,client:()=>client as any,credentials:async()=>({id:listing.accountEmail,password:'fixture-private'}),query,alert,allowedEmail:()=>true,allowed:()=>true,now:()=>new Date()};
 const app=createNetflixPortalApp(deps),request=(path='',body?:unknown,cookie='',origin='https://email-verify.one')=>app.request(`/${record.token}${path}`,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json',Origin:origin}:{}),Cookie:cookie},body:body?JSON.stringify(body):undefined});
 const unlock=async()=>{const r=await request('/unlock',{pin:record.pin});expect(r.status).toBe(200);return r.headers.get('set-cookie')!.split(';')[0];};
 return {inventory,listing,order,portal,record,messages,client,query,alert,deps,app,request,unlock};
}
test('per-buyer PIN unlock uses scoped secure cookie and shows exact fresh 4/6-digit supplier codes',async()=>{
 const f=fixture();expect(await(await f.request()).json()).toEqual({unlocked:false});
 const cookie=await f.unlock();expect(cookie).toContain('netflix_portal=');
 const status=await f.request('',undefined,cookie);expect((await status.json()).email).toBe(f.listing.accountEmail);
 for(const kind of ['login','account']){const r=await f.request('/code',{kind},cookie);expect(r.status).toBe(200);const d=await r.json();expect(d.code).toBe(kind==='login'?'1234':'123456');expect(JSON.stringify(d)).not.toContain('fixture-private');}
 expect(f.alert).not.toHaveBeenCalled();expect(f.query).toHaveBeenCalledTimes(2);
});
test('wrong PIN, foreign Origin, unauthed queries, invalid kinds and cross-token sessions cannot invoke supplier',async()=>{
 const f=fixture();expect((await f.request('/unlock',{pin:f.record.pin==='000000'?'111111':'000000'})).status).toBe(403);
 expect((await f.request('/unlock',{pin:f.record.pin},'','https://attacker.example')).status).toBe(403);
 expect((await f.request('/code',{kind:'login'})).status).toBe(403);const cookie=await f.unlock();
 expect((await f.request('/code',{kind:'reset'},cookie)).status).toBe(400);
 const other={...f.order,key:'100:2',memberSeq:2,userSeq:20,roomId:'other-room',profileNumber:2,profileName:'2'};f.inventory.orders[other.key]=other;
 const r=ensureNetflixPortal(f.portal,f.inventory,other,new Date().toISOString());
 const response=await f.app.request(`/${r.token}/code`,{method:'POST',headers:{Origin:'https://email-verify.one','Content-Type':'application/json',Cookie:cookie},body:'{"kind":"login"}'});expect(response.status).toBe(403);expect(f.query).not.toHaveBeenCalled();
});
test('sessions expire, PIN guessing is throttled, invalid tokens and oversized requests fail closed',async()=>{
 const f=fixture(),cookie=await f.unlock();vi.advanceTimersByTime(31*60_000);expect((await f.request('/code',{kind:'login'},cookie)).status).toBe(403);
 for(let i=0;i<10;i++)await f.request('/unlock',{pin:'not-a-pin'});expect((await f.request('/unlock',{pin:f.record.pin})).status).toBe(429);
 expect((await f.request('/unlock',{pin:'1'.repeat(2000)})).status).toBe(413);expect((await f.app.request('/bad')).status).toBe(404);expect(f.query).not.toHaveBeenCalled();
});
test('refund, account reassignment, revocation or a private-room mismatch prevents code disclosure',async()=>{
 for(const change of ['refund','account','revoke','room']){const f=fixture(),cookie=await f.unlock();
  f.query.mockImplementationOnce(async(email,kind)=>{if(change==='refund')f.order.cancelStatus='REFUNDED';if(change==='account')f.listing.accountEmail='other@example.com';if(change==='revoke')f.record.revokedAt=new Date().toISOString();if(change==='room')f.order.roomId='wrong-room';return {email,kind,code:'1234',receivedAt:new Date().toISOString(),botMessageId:1};});
  const r=await f.request('/code',{kind:'login'},cookie);expect(r.status,change).toBe(503);expect(JSON.stringify(await r.json())).not.toContain('1234');}
});
test('stale/wrong-email/ambiguous provider data is rejected and errors are reported without credentials or code',async()=>{
 for(const patch of [{email:'other@example.com'},{receivedAt:'2020-01-01T00:00:00Z'},{code:'123456'},{kind:'account'}]){const f=fixture(),cookie=await f.unlock();f.query.mockResolvedValueOnce({email:f.listing.accountEmail,kind:'login',code:'1234',receivedAt:new Date().toISOString(),botMessageId:1,...patch} as any);
  expect((await f.request('/code',{kind:'login'},cookie)).status).toBe(503);expect(f.alert).toHaveBeenCalledTimes(1);expect(JSON.stringify(f.alert.mock.calls)).not.toMatch(/1234|fixture-private/);}
});
test('identical concurrent requests coalesce and a different kind waits without issuing another bot query',async()=>{
 const f=fixture(),cookie=await f.unlock();let done!:(v:any)=>void;f.query.mockImplementationOnce(()=>new Promise(r=>{done=r;}));
 const one=f.request('/code',{kind:'login'},cookie),two=f.request('/code',{kind:'login'},cookie);await vi.waitFor(()=>expect(f.query).toHaveBeenCalledTimes(1));
 const busy=await f.request('/code',{kind:'account'},cookie);expect(busy.status).toBe(409);
 done({email:f.listing.accountEmail,kind:'login',code:'1234',receivedAt:new Date().toISOString(),botMessageId:1});expect((await one).status).toBe(200);expect((await two).status).toBe(200);expect(f.query).toHaveBeenCalledTimes(1);expect(f.alert).not.toHaveBeenCalled();
});
test('two buyers sharing the same account never share another buyer’s cached challenge',async()=>{
 const f=fixture(),firstCookie=await f.unlock();
 expect((await f.request('/code',{kind:'login'},firstCookie)).status).toBe(200);
 const other={...f.order,key:'100:2',memberSeq:2,userSeq:20,roomId:'other-room',profileNumber:2,profileName:'2'};
 f.inventory.orders[other.key]=other;const r=ensureNetflixPortal(f.portal,f.inventory,other,new Date().toISOString());
 f.client.listOttMembers=async()=>[f.order,other].map(o=>({seq:o.memberSeq,userSeq:o.userSeq,status:o.status,cancelStatus:o.cancelStatus,subscriptionEndsAt:o.endDate}));
 f.client.openPrivateRoom=async(_post:number,user:number)=>user===20?'other-room':'fixture-room';
 f.client.getChat=async(room:string)=>({members:[{seq:99},{seq:room==='other-room'?20:10}],messages:f.messages});
 const request=(path:string,body:unknown,cookie='')=>f.app.request(`/${r.token}${path}`,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://email-verify.one',Cookie:cookie},body:JSON.stringify(body)});
 const unlocked=await request('/unlock',{pin:r.pin});expect(unlocked.status).toBe(200);
 const secondCookie=unlocked.headers.get('set-cookie')!.split(';')[0];
 expect((await request('/code',{kind:'login'},secondCookie)).status).toBe(429);
 expect(f.query).toHaveBeenCalledTimes(1);
 vi.advanceTimersByTime(31_000);expect((await request('/code',{kind:'login'},secondCookie)).status).toBe(200);
 expect(f.query).toHaveBeenCalledTimes(2);
});
test('a still valid supplier code older than two minutes remains accessible',async()=>{
 const f=fixture(),cookie=await f.unlock();
 f.query.mockResolvedValueOnce({email:f.listing.accountEmail,kind:'login',code:'1234',receivedAt:new Date(Date.now()-121_000).toISOString(),botMessageId:1});
 const response=await f.request('/code',{kind:'login'},cookie);expect(response.status).toBe(200);
 expect((await response.json()).code).toBe('1234');
});
function onboarding(){const f=fixture();const sendText=vi.fn(async(_room:string,seller:number,text:string)=>{for(const message of splitGbutsChatText(text))f.messages.push({senderSeq:seller,messageType:'TEXT',message,createdAt:new Date().toISOString()});});
 const sendImage=vi.fn(async(_room:string,seller:number,url:string)=>{f.messages.push({senderSeq:seller,messageType:'IMAGE',images:[url],message:'',createdAt:new Date().toISOString()});});const deps={...f.deps,write:vi.fn(),sendText,sendImage};return {...f,deps,sendText,sendImage};}
test('legacy buyers get exactly one notice then image; success and subsequent scans are silent',async()=>{
 const f=onboarding();await syncNetflixPortalOnboarding(f.deps);await syncNetflixPortalOnboarding(f.deps);
 expect(f.record.text.state).toBe('confirmed');expect(f.record.image.state).toBe('confirmed');expect(f.sendText).toHaveBeenCalledTimes(1);expect(f.sendImage).toHaveBeenCalledTimes(1);expect(f.query).not.toHaveBeenCalled();expect(f.alert).not.toHaveBeenCalled();
 const text=f.sendText.mock.calls[0][2];expect(text).toContain(f.record.pin);expect(text).toContain(f.record.token);expect(text).not.toContain('fixture-private');
});
test('an older guide image never substitutes for the image sent after this portal notice',async()=>{
 const f=onboarding();f.messages.push({senderSeq:99,messageType:'IMAGE',images:[NETFLIX_PORTAL_GUIDE_ASSET.url],message:'',createdAt:'2026-10-28T00:00:00Z'});
 await syncNetflixPortalOnboarding(f.deps);expect(f.sendText).toHaveBeenCalledTimes(1);expect(f.sendImage).toHaveBeenCalledTimes(1);expect(f.record.image.state).toBe('confirmed');
});
test('new buyers wait for account delivery; unknown sends never repeat; definite pre-SEND failure can retry',async()=>{
 const fresh=onboarding();fresh.order.purchasedAt=new Date().toISOString();await syncNetflixPortalOnboarding(fresh.deps);expect(fresh.sendText).not.toHaveBeenCalled();
 for(const retryable of [false,true]){const f=onboarding();f.sendText.mockImplementationOnce(async()=>{throw retryable?new GbutsChatDeliveryError('fixture',false):new Error('unknown');});await syncNetflixPortalOnboarding(f.deps);await syncNetflixPortalOnboarding(f.deps);
  expect(f.sendText).toHaveBeenCalledTimes(retryable?2:1);expect(f.sendImage).toHaveBeenCalledTimes(retryable?1:0);}
});
test('portal verification can be enabled without sending notices to either legacy or new buyers',async()=>{
 const f=onboarding();f.portal.onboardingEnabled=false;await syncNetflixPortalOnboarding(f.deps);
 expect(f.sendText).not.toHaveBeenCalled();expect(f.sendImage).not.toHaveBeenCalled();expect(f.record.text.state).toBe('ready');
 f.portal.onboardingEnabled=true;await syncNetflixPortalOnboarding(f.deps);expect(f.sendText).toHaveBeenCalledTimes(1);expect(f.sendImage).toHaveBeenCalledTimes(1);
});
test('retryable pre-send outages stay quiet once, alert on repeated failure, and delayed new account delivery alerts',async()=>{
 const f=onboarding();f.sendText.mockImplementationOnce(async()=>{throw new GbutsChatDeliveryError('fixture',false);}).mockImplementationOnce(async()=>{throw new GbutsChatDeliveryError('fixture',false);});
 await syncNetflixPortalOnboarding(f.deps);expect(f.alert).not.toHaveBeenCalled();await syncNetflixPortalOnboarding(f.deps);expect(f.alert).toHaveBeenCalledTimes(1);
 const g=onboarding();g.order.purchasedAt=new Date().toISOString();vi.advanceTimersByTime(11*60_000);await syncNetflixPortalOnboarding(g.deps);expect(g.alert).toHaveBeenCalledTimes(1);expect(g.sendText).not.toHaveBeenCalled();
});
test('private registry reload preserves capabilities; changed bindings revoke old links and page has no external assets',()=>{
 const f=fixture(),dir=mkdtempSync(join(tmpdir(),'netflix-portal-'));try{const path=join(dir,'portal.json');vi.stubEnv('GBUTS_NETFLIX_PORTAL_PATH',path);writeNetflixPortalStore(f.portal);const reloaded=readNetflixPortalStore()!;expect(verifyPortalPin(f.record.pin,reloaded.records[f.record.tokenHash])).toBe(true);
  f.order.profileNumber=2;f.order.profileName='2';const next=ensureNetflixPortal(reloaded,f.inventory,f.order,new Date().toISOString());expect(next.token).not.toBe(f.record.token);expect(reloaded.records[f.record.tokenHash].revokedAt).toBeTruthy();chmodSync(path,0o644);expect(()=>readNetflixPortalStore()).toThrow();
 }finally{rmSync(dir,{recursive:true,force:true});}
 const html=netflixPortalHtml(f.record.token,'fixture-nonce');expect(html).toContain('4자리 로그인 코드');expect(html).toContain('6자리 인증 코드');expect(html).not.toContain('fixture-private');expect(html).not.toMatch(/<script src|<img|AIO_ADMIN/);expect(netflixPortalCsp('x')).toContain("frame-ancestors 'none'");expect(netflixPortalHtml('<script>','x')).not.toContain('<script>');
 expect(netflixPortalNotice(f.record)).not.toContain('비밀번호 :');
});
test('legacy delivery is suppressed only while the confirmed portal matches the assigned buyer, account and profile',()=>{
 const f=fixture(),dir=mkdtempSync(join(tmpdir(),'netflix-delivered-'));
 try {
  vi.stubEnv('GBUTS_NETFLIX_PORTAL_PATH',join(dir,'portal.json'));
  f.record.text.state='confirmed';f.record.image.state='confirmed';writeNetflixPortalStore(f.portal);
  expect(portalDelivered(f.order.key,f.inventory)).toBe(true);
  f.order.profileNumber=2;expect(portalDelivered(f.order.key,f.inventory)).toBe(false);
  f.order.profileNumber=1;f.listing.accountEmail='replacement@example.com';expect(portalDelivered(f.order.key,f.inventory)).toBe(false);
  f.listing.accountEmail=f.record.accountEmail;f.order.roomId='other-buyer-room';expect(portalDelivered(f.order.key,f.inventory)).toBe(false);
 } finally {rmSync(dir,{recursive:true,force:true});}
});

test('supplier codes beyond fifteen minutes remain rejected',async()=>{const f=fixture(),cookie=await f.unlock();f.query.mockResolvedValueOnce({email:f.listing.accountEmail,kind:'login',code:'1234',receivedAt:new Date(Date.now()-901_000).toISOString(),botMessageId:1});expect((await f.request('/code',{kind:'login'},cookie)).status).toBe(503);});
