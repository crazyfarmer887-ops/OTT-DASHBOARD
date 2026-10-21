import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { allocateDisneyProfilesForSync } from '../src/lib/gbuts-disney-profiles';
import { emptyGbutsOttStore, hasGbutsOttProfileLease } from '../src/lib/gbuts-ott';
import { buildGbutsDisneyDeliveryText } from '../src/lib/gbuts-ott-templates';
import { readGbutsOttStore, writeGbutsOttStore } from '../src/lib/gbuts-ott-store';
import { buildPartyAccessPublicPayload, createPartyAccessLinkRecord, redactPartyAccessPayloadForConsent } from '../src/lib/party-access';
import { fixtureListing, fixtureOrder } from './fixtures/gbuts-ott';
import { tinyhostMailboxUrl, safeTinyhostEmailAccessUrl } from '../src/lib/disney-mailbox';
import { normalizeGeneratedAccountPatch, buildGeneratedAccount } from '../src/lib/generated-accounts';
import { resolveGbutsOttDirectCredentials } from '../src/lib/gbuts-ott-credentials';
import { syncGbutsOtt } from '../src/scheduler/gbuts-ott-sync';
import { syncGbutsDirectCredentials } from '../src/scheduler/gbuts-ott-direct-delivery';
import { GbutsChatDeliveryError } from '../src/lib/gbuts-chat-delivery';
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-21T06:00:00Z')); });
afterEach(() => vi.useRealTimers());
function fixture() {
 const store=emptyGbutsOttStore();
 store.listings['request-1']=fixtureListing({serviceType:'디즈니플러스',capacity:6,deliveryMode:'disney-numbered-password'});
 const management={services:[{serviceType:'디즈니플러스',accounts:[{email:'account@example.com',serviceType:'디즈니플러스',totalSlots:6,members:[],expiryDate:'2026-12-31',generatedAccount:{paymentStatus:'paid'}}]}],onSaleByKeepAcct:{}};
 return {store,management};
}
test('six buyers keep stable purchase-order numbers through restart, refund and reuse; duplicate leases deny access', () => {
 const f=fixture();
 for(const n of [6,3,1,5,2,4]) f.store.orders[`100:${n}`]=fixtureOrder({key:`100:${n}`,memberSeq:n,userSeq:n+10,purchasedAt:`2026-10-21 10:0${n}:00`});
 expect(allocateDisneyProfilesForSync(f.store,f.management,[]).size).toBe(0);
 for(const n of [1,2,3,4,5,6]) expect(f.store.orders[`100:${n}`].profileNumber).toBe(n);
 const dir=mkdtempSync(join(tmpdir(),'disney-delivery-'));
 try { const p=join(dir,'store.json'); writeGbutsOttStore(f.store,p); expect(readGbutsOttStore(p)).toEqual(f.store); } finally {rmSync(dir,{recursive:true,force:true});}
 f.store.orders['100:1'].status='MISSING';
 expect(allocateDisneyProfilesForSync(f.store,f.management,[]).size).toBe(0);
 expect(f.store.orders['100:1'].profileNumber).toBe(1);
 f.store.orders['100:2'].cancelStatus='REFUNDED';
 f.store.orders['100:7']=fixtureOrder({key:'100:7',memberSeq:7,userSeq:17,purchasedAt:'2026-10-21T03:00:00Z'});
 expect(allocateDisneyProfilesForSync(f.store,f.management,[]).size).toBe(0);
 expect(f.store.orders['100:7'].profileNumber).toBe(2);
 expect(hasGbutsOttProfileLease(f.store,f.store.orders['100:2'])).toBe(false);
 expect(hasGbutsOttProfileLease(f.store,f.store.orders['100:7'],'2')).toBe(true);
 f.store.orders['100:6'].profileName='2';f.store.orders['100:6'].profileNumber=2;
 expect(hasGbutsOttProfileLease(f.store,f.store.orders['100:7'],'2')).toBe(false);
 expect(allocateDisneyProfilesForSync(f.store,f.management,[]).size).toBe(1);
});
test('existing external occupants or an invalid purchase timestamp block all new allocation', () => {
 const f=fixture();f.store.orders['100:1']=fixtureOrder();
 expect(allocateDisneyProfilesForSync(f.store,f.management,[{serviceType:'디즈니플러스',accountEmail:'account@example.com',status:'active',endDate:'2026-12-01'}]).size).toBe(1);
 expect(f.store.orders['100:1'].profileNumber).toBeUndefined();
 f.store.orders['100:1'].purchasedAt='invalid';
 expect(allocateDisneyProfilesForSync(f.store,f.management,[]).size).toBe(1);
 expect(f.store.orders['100:1'].profileNumber).toBeUndefined();
});
test('five-place Disney sales use the actual capacity in buyer guidance', () => {
 expect(buildGbutsDisneyDeliveryText('https://example.com/access',5,5)).toContain('1~5번');
 expect(()=>buildGbutsDisneyDeliveryText('https://example.com/access',6,5)).toThrow();
 expect(buildGbutsDisneyDeliveryText('https://example.com/access',6)).toContain('1~6번');
});
test('the real poller sends each private buyer a stable numbered password-only guide and does not repeat it', async () => {
 const f=fixture();let store=f.store;const chats=new Map<string,any[]>();
 const members=[2,1].map(n=>({seq:n,userSeq:n+10,productId:String(n),nickname:`buyer${n}`,status:'APPLY',cancelStatus:null,createdAt:`2026-10-21 10:0${n}:00`,subscriptionEndsAt:'2026-12-01'}));
 const client={getPost:async()=>({seq:100,category1:{seq:6},memberLimit:6,memberCount:2,status:'ON_SALE',subscriptionEndsAt:'2026-12-01'}),listOttMembers:async()=>members,sellerAccountSeq:async()=>99,openPrivateRoom:async (_:number,u:number)=>String(u),getChat:async(r:string)=>({messages:chats.get(r)||[]})};
 const access=vi.fn(async(o:any,_l:any,p:string)=>{expect(p).toBe(String(o.memberSeq));return `https://example.com/access/${o.key}`;});
 const credentials=vi.fn(async()=>({id:'current@example.com',password:'current-password'}));
 const deps={credentials,management:async()=>f.management,manualMembers:()=>[],access,refreshAccess:async()=>{},readStore:()=>structuredClone(store),writeStore:(s:typeof store)=>{store=structuredClone(s);}};
 const send=vi.fn(async(r:string,_s:number,message:string)=>{chats.set(r,[...(chats.get(r)||[]),{senderSeq:99,messageType:'TEXT',message,createdAt:new Date().toISOString()}]);});
 expect(await syncGbutsOtt(deps,client as any,send)).toMatchObject({attempted:2,confirmed:2});
 await syncGbutsOtt(deps,client as any,send);
 expect(send).toHaveBeenCalledTimes(4);
 for(const n of [1,2]) {const text=chats.get(String(n+10))![0].message;expect(text).toContain(`${n}번 프로필을 새로`);expect(text).toContain('비밀번호 로그인입니다');expect(text).not.toContain('이메일 PIN');}
 expect(chats.get('11')![0].message).toContain('이어서 이 1:1 채팅으로 바로');
 for(const room of ['11','12']) expect(chats.get(room)![1].message).toBe('ID : current@example.com\nPW : current-password');
 chats.get('11')!.push({senderSeq:11,messageType:'TEXT',message:' ! ',createdAt:new Date().toISOString()});
 await syncGbutsOtt(deps,client as any,send);
 await syncGbutsOtt(deps,client as any,send);
 expect(send).toHaveBeenCalledTimes(5);expect(send.mock.calls.at(-1)).toEqual(['11',99,'ID : current@example.com\nPW : current-password']);
 expect(store.orders['100:1'].directDelivery?.state).toBe('confirmed');
 expect(chats.get('12')).toHaveLength(2);expect(JSON.stringify(store)).not.toContain('current-password');
 vi.setSystemTime(new Date('2026-10-21T06:01:00Z'));
 credentials.mockResolvedValue({id:'updated@example.com',password:'updated-password'});
 chats.get('11')!.push({senderSeq:11,messageType:'TEXT',message:'!',createdAt:new Date().toISOString()});
 await syncGbutsOtt(deps,client as any,send);
 expect(send.mock.calls.at(-1)).toEqual(['11',99,'ID : updated@example.com\nPW : updated-password']);
 expect(send).toHaveBeenCalledTimes(6);
});

test.each(['pre-send', 'uncertain'])('automatic Disney credentials survive %s failures and restart without a buyer prompt', async mode => {
 const f=fixture();let store=f.store;
 store.orders['100:1']=fixtureOrder({profileName:'1',profileNumber:1,delivery:'confirmed',roomId:'room',purchasedAt:'2026-10-21 10:00:00'});
 let messages:any[]=[];
 const credentials=vi.fn(async()=>({id:'latest@example.com',password:'latest-private-password'}));
 const client={openPrivateRoom:async()=> 'room',getChat:async()=>({messages})};
 const write=(next:typeof store)=>{store=structuredClone(next);};
 const send=vi.fn(async()=>{throw mode==='pre-send'?new GbutsChatDeliveryError('offline',false):new Error('unknown');});
 const run=()=>syncGbutsDirectCredentials(store,Object.values(store.orders),99,{credentials} as any,client as any,write,send);
 await run();
 expect(store.orders['100:1'].directDelivery?.state).toBe(mode==='pre-send'?'ready':'attempted');
 expect(JSON.stringify(store)).not.toContain('latest-private-password');
 if(mode==='pre-send') {
   send.mockImplementation(async()=>{messages=[{senderSeq:99,messageType:'TEXT',message:'ID : latest@example.com\nPW : latest-private-password',createdAt:new Date().toISOString()}];});
   await run();
   expect(send).toHaveBeenCalledTimes(2);
 } else {
   await run(); expect(send).toHaveBeenCalledTimes(1);
   messages=[{senderSeq:99,messageType:'TEXT',message:'ID : latest@example.com\nPW : latest-private-password',createdAt:new Date().toISOString()}];
   await run(); expect(send).toHaveBeenCalledTimes(1);
 }
 expect(store.orders['100:1'].directDelivery?.state).toBe('confirmed');
 await run(); expect(send).toHaveBeenCalledTimes(mode==='pre-send'?2:1);
});

test.each(['refund', 'wrong-room', 'duplicate-profile', 'unconfirmed-guide'])('automatic Disney credentials do not bypass %s checks', async mode => {
 const f=fixture();const order=fixtureOrder({profileName:'1',profileNumber:1,delivery:'confirmed',roomId:'room',purchasedAt:'2026-10-21 10:00:00'});
 f.store.orders[order.key]=order;
 if(mode==='refund') order.cancelStatus='REFUNDED';
 if(mode==='duplicate-profile') f.store.orders['100:2']=fixtureOrder({key:'100:2',memberSeq:2,profileName:'1',profileNumber:1});
 if(mode==='unconfirmed-guide') order.delivery='attempted';
 const credentials=vi.fn(async()=>({id:'test@example.com',password:'private-password'}));const send=vi.fn();
 await syncGbutsDirectCredentials(f.store,[order],99,{credentials} as any,{openPrivateRoom:async()=>mode==='wrong-room'?'other-room':'room',getChat:async()=>({messages:[]})} as any,()=>{},send);
 expect(credentials).not.toHaveBeenCalled();expect(send).not.toHaveBeenCalled();
});
test('public account payload suppresses mail access for numbered Disney but preserves legacy Disney', () => {
 const record=createPartyAccessLinkRecord({token:'test',serviceType:'디즈니플러스',accountEmail:'account@example.com',fallbackPassword:'test-password',emailAccessUrl:'https://email-verify.one/email/mail/private',profileName:'6',member:{kind:'gbuts',memberId:'100:6',memberName:'buyer',status:'active',endDateTime:'2026-12-01',verifiedAt:new Date().toISOString()}});
 const payload=buildPartyAccessPublicPayload(record);
 expect(payload).toMatchObject({ok:true,presentation:'gbuts-disney-numbered',emailAccessUrl:'',profileName:'6'});
 const legacy=buildPartyAccessPublicPayload({...record,profileName:'감귤'});
 expect(legacy.presentation).toBeUndefined();expect(legacy.emailAccessUrl).toContain('/email/mail/');
 expect(buildGbutsDisneyDeliveryText('https://example.com/access',6)).not.toContain('이메일 PIN');
});

 test('the production credential resolver verifies a numbered Disney buyer and blocks a refunded one', () => {
 const f=fixture();const order=fixtureOrder({profileNumber:6,profileName:'6'});f.store.orders[order.key]=order;
 const record=createPartyAccessLinkRecord({token:'test-direct',serviceType:'디즈니플러스',accountEmail:'account@example.com',fallbackPassword:'latest-password',profileName:'6',member:{kind:'gbuts',memberId:order.key,memberName:'buyer',status:'active',endDateTime:'2026-12-01',verifiedAt:new Date().toISOString()}});
 const data={accessRecords:{[record.tokenHash]:record},inventory:f.store,maintenance:{},generated:{}};
 expect(resolveGbutsOttDirectCredentials(order,f.store.listings['request-1'],data)).toEqual({id:'account@example.com',password:'latest-password'});
 order.cancelStatus='REFUNDED';
 expect(()=>resolveGbutsOttDirectCredentials(order,f.store.listings['request-1'],data)).toThrow('구매자의 계정 배정');
});

 test('Tinyhost is explicitly enabled per Disney account, follows its address, and remains redacted before consent', () => {
 const account={...buildGeneratedAccount({serviceType:'디즈니플러스',alias:{email:'mailbox@example.com'},password:'private-password',pin:'',memo:''}),emailAccessProvider:'tinyhost' as const};
 const record=createPartyAccessLinkRecord({token:'test-mailbox',serviceType:'디즈니플러스',accountEmail:account.email,profileName:'1',member:{kind:'gbuts',memberId:'100:1',memberName:'buyer',status:'active',endDateTime:'2026-12-01',verifiedAt:new Date().toISOString()}});
 const payload=buildPartyAccessPublicPayload(record,{}, {[account.id]:account});
 expect(payload.emailAccessUrl).toBe('https://tinyhost.shop/mailbox@example.com');
 expect(redactPartyAccessPayloadForConsent(payload).emailAccessUrl).toBeUndefined();
 expect(buildPartyAccessPublicPayload({...record,accountEmail:'other@example.com'}, {}, {[account.id]:account}).emailAccessUrl).toBe('');
 expect(buildPartyAccessPublicPayload({...record,serviceType:'넷플릭스'}, {}, {[account.id]:account}).emailAccessUrl).not.toContain('tinyhost');
 expect(normalizeGeneratedAccountPatch({emailAccessProvider:'tinyhost'})).toEqual({emailAccessProvider:'tinyhost'});
 expect(normalizeGeneratedAccountPatch({emailAccessProvider:null})).toEqual({emailAccessProvider:null});
 expect(()=>normalizeGeneratedAccountPatch({emailAccessProvider:'other'} as any)).toThrow();
 expect(tinyhostMailboxUrl('mailbox@example.com')).toBe(payload.emailAccessUrl);
 expect(tinyhostMailboxUrl('x@example.com/other')).toBe('');
 for(const value of ['https://tinyhost.shop/other@example.com','https://tinyhost.shop.evil.test/mailbox@example.com','http://tinyhost.shop/mailbox@example.com','https://tinyhost.shop/mailbox@example.com?x=1','https://user:pw@tinyhost.shop/mailbox@example.com','javascript:alert(1)']) expect(safeTinyhostEmailAccessUrl(value,account.email)).toBe('');
 expect(safeTinyhostEmailAccessUrl(payload.emailAccessUrl,account.email)).toBe(payload.emailAccessUrl);
});
