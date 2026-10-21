import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { allocateDisneyProfilesForSync } from '../src/lib/gbuts-disney-profiles';
import { emptyGbutsOttStore, hasGbutsOttProfileLease } from '../src/lib/gbuts-ott';
import { buildGbutsDisneyDeliveryText } from '../src/lib/gbuts-ott-templates';
import { readGbutsOttStore, writeGbutsOttStore } from '../src/lib/gbuts-ott-store';
import { buildPartyAccessPublicPayload, createPartyAccessLinkRecord } from '../src/lib/party-access';
import { fixtureListing, fixtureOrder } from './fixtures/gbuts-ott';
import { syncGbutsOtt } from '../src/scheduler/gbuts-ott-sync';
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
test('the real poller sends each private buyer a stable numbered password-only guide and does not repeat it', async () => {
 const f=fixture();let store=f.store;const chats=new Map<string,any[]>();
 const members=[2,1].map(n=>({seq:n,userSeq:n+10,productId:String(n),nickname:`buyer${n}`,status:'APPLY',cancelStatus:null,createdAt:`2026-10-21 10:0${n}:00`,subscriptionEndsAt:'2026-12-01'}));
 const client={getPost:async()=>({seq:100,category1:{seq:6},memberLimit:6,memberCount:2,status:'ON_SALE',subscriptionEndsAt:'2026-12-01'}),listOttMembers:async()=>members,sellerAccountSeq:async()=>99,openPrivateRoom:async (_:number,u:number)=>String(u),getChat:async(r:string)=>({messages:chats.get(r)||[]})};
 const access=vi.fn(async(o:any,_l:any,p:string)=>{expect(p).toBe(String(o.memberSeq));return `https://example.com/access/${o.key}`;});
 const deps={management:async()=>f.management,manualMembers:()=>[],access,refreshAccess:async()=>{},readStore:()=>structuredClone(store),writeStore:(s:typeof store)=>{store=structuredClone(s);}};
 const send=vi.fn(async(r:string,_s:number,message:string)=>{chats.set(r,[...(chats.get(r)||[]),{senderSeq:99,messageType:'TEXT',message}]);});
 expect(await syncGbutsOtt(deps,client as any,send)).toMatchObject({attempted:2,confirmed:2});
 await syncGbutsOtt(deps,client as any,send);
 expect(send).toHaveBeenCalledTimes(2);
 for(const n of [1,2]) {const text=chats.get(String(n+10))![0].message;expect(text).toContain(`${n}번 프로필을 새로`);expect(text).toContain('비밀번호 로그인만');expect(text).not.toContain('이메일 PIN');}
});
test('public account payload suppresses mail access for numbered Disney but preserves legacy Disney', () => {
 const record=createPartyAccessLinkRecord({token:'test',serviceType:'디즈니플러스',accountEmail:'account@example.com',fallbackPassword:'test-password',emailAccessUrl:'https://email-verify.one/email/mail/private',profileName:'6',member:{kind:'gbuts',memberId:'100:6',memberName:'buyer',status:'active',endDateTime:'2026-12-01',verifiedAt:new Date().toISOString()}});
 const payload=buildPartyAccessPublicPayload(record);
 expect(payload).toMatchObject({ok:true,presentation:'gbuts-disney-numbered',emailAccessUrl:'',profileName:'6'});
 const legacy=buildPartyAccessPublicPayload({...record,profileName:'감귤'});
 expect(legacy.presentation).toBeUndefined();expect(legacy.emailAccessUrl).toContain('/email/mail/');
 expect(buildGbutsDisneyDeliveryText('https://example.com/access',6)).not.toContain('이메일 PIN');
});
