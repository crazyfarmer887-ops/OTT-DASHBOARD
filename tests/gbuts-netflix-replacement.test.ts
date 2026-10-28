import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { accountGbutsInventory, emptyGbutsOttStore, gbutsOrderListing, hasGbutsOttProfileLease, isGbutsOttBuyerMatch, updateGbutsOttOrders } from '../src/lib/gbuts-ott';
import { availableNetflixProfiles, assertUnclaimedGbutsNetflixProfile } from '../src/lib/gbuts-netflix-profiles';
import { readGbutsOttStore, writeGbutsOttStore } from '../src/lib/gbuts-ott-store';
import { bindSubscriptionRenewal, youtubeOccupied } from '../src/scheduler/gbuts-youtube-renewal';
import { assertSubscriptionRankInventory } from '../src/scheduler/gbuts-rank-adoption';
import { fixtureListing, fixtureManagement, fixtureOrder } from './fixtures/gbuts-ott';
import { createPartyAccessLinkRecord } from '../src/lib/party-access';
import { manualRegisteredAccount } from '../src/lib/generated-accounts';
import { resolveGbutsOttDirectCredentials } from '../src/lib/gbuts-ott-credentials';
import { syncGbutsDirectCredentials } from '../src/scheduler/gbuts-ott-direct-delivery';
import { splitGbutsChatText } from '../src/lib/gbuts-chat-delivery';

let dir:string;
beforeEach(()=>{dir=mkdtempSync(join(tmpdir(),'netflix-replacement-'));vi.stubEnv('GBUTS_OTT_STORE_PATH',join(dir,'store.json'));vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-29T00:00:00Z'));});
afterEach(()=>{vi.unstubAllEnvs();vi.useRealTimers();rmSync(dir,{recursive:true,force:true});});
function fixture(){
  const store=emptyGbutsOttStore(),source=fixtureListing({state:'closed'}),target=fixtureListing({id:'target',postSeq:200,accountEmail:'target@example.com',capacity:4,emailCodeProvider:'emailverify'});
  store.listings[source.id]=source;store.listings[target.id]=target;
  const order=fixtureOrder({delivery:'confirmed',roomId:'fixture-room',profileName:'1',profileNumber:1,
    replacement:{accountEmail:target.accountEmail,sourceAccountEmail:source.accountEmail,sourceProfileNumber:2,assignedAt:new Date().toISOString(),emailCodeProvider:'emailverify'}});
  store.orders[order.key]=order;
  const management=fixtureManagement(); const raw=management.services[0].accounts[0];
  management.services[0].accounts=[{...raw,email:source.accountEmail,members:[],usingCount:0,activeCount:0},{...raw,email:target.accountEmail,members:[],usingCount:0,activeCount:0,generatedAccount:{paymentStatus:'paid'}} as any]; management.onSaleByKeepAcct={};
  const p=bindSubscriptionRenewal({version:1,policies:{}},{seq:200,category1:{seq:5},memberLimit:5,memberCount:0,status:'ON_SALE',subscriptionEndsAt:'2026-12-01 23:59:59',subscriptionType:'SHARE',priceType:'DAY',price:180} as any,true);
  p.posts[0].capacity=4;
  writeGbutsOttStore(store);return {store,source,target,order,management,p};
}
test('one replacement consumes one target place and reduces public quota from five to four without rewriting purchase identity',()=>{
  const f=fixture();expect(f.order.postSeq).toBe(100);expect(f.order.profileNumber).toBe(1);expect(f.order.replacement?.sourceProfileNumber).toBe(2);
  expect(accountGbutsInventory(f.store,'넷플릭스',f.source.accountEmail).currentUsers).toBe(0);
  expect(accountGbutsInventory(f.store,'넷플릭스',f.target.accountEmail)).toMatchObject({currentUsers:1,recruiting:4});
  expect(youtubeOccupied(f.p)).toBe(1);expect(f.p.capacity-youtubeOccupied(f.p)).toBe(4);
  expect(()=>assertSubscriptionRankInventory(f.p,f.management,[])).not.toThrow();
});
test('target profile is protected across marketplaces and another target buyer cannot receive it',()=>{
  const f=fixture();expect(availableNetflixProfiles(f.store,f.management,[],f.target.accountEmail)).toEqual([2,3,4,5]);
  expect(hasGbutsOttProfileLease(f.store,f.order)).toBe(true);
  expect(()=>assertUnclaimedGbutsNetflixProfile(f.store,'넷플릭스',f.target.accountEmail,'1')).toThrow();
  const other=fixtureOrder({key:'200:2',listingId:'target',postSeq:200,memberSeq:2,userSeq:20,profileNumber:1,profileName:'1'});f.store.orders[other.key]=other;
  expect(hasGbutsOttProfileLease(f.store,f.order)).toBe(false);expect(hasGbutsOttProfileLease(f.store,other)).toBe(false);
});
test('public link uses original paid member identity but the replacement account and current profile',()=>{
  const f=fixture(),member={seq:f.order.memberSeq,userSeq:f.order.userSeq,subscriptionEndsAt:f.order.endDate};
  const record={serviceType:'넷플릭스',accountEmail:f.target.accountEmail,profileName:'1',member:{memberId:f.order.key}};
  expect(isGbutsOttBuyerMatch(f.store,record,member)).toBe(true);
  expect(isGbutsOttBuyerMatch(f.store,{...record,accountEmail:f.source.accountEmail},member)).toBe(false);
  expect(isGbutsOttBuyerMatch(f.store,record,{...member,userSeq:20})).toBe(false);
  f.order.cancelStatus='REFUNDED';writeGbutsOttStore(f.store);expect(youtubeOccupied(f.p)).toBe(0);
  expect(accountGbutsInventory(f.store,'넷플릭스',f.target.accountEmail).currentUsers).toBe(0);
});
test('store reload and live original roster refresh preserve the replacement and original expiry',()=>{
  const f=fixture(),s=readGbutsOttStore();
  updateGbutsOttOrders(s,f.source,[{seq:f.order.memberSeq,userSeq:f.order.userSeq,nickname:'buyer',status:'APPLY',cancelStatus:null,createdAt:'2026-10-05 12:00:00',subscriptionEndsAt:'2026-12-01 23:59:59'}],new Date().toISOString());
  expect(s.orders[f.order.key].replacement).toEqual(f.order.replacement);expect(gbutsOrderListing(s,s.orders[f.order.key]).accountEmail).toBe(f.target.accountEmail);
  s.orders[f.order.key].replacement!.sourceAccountEmail='wrong@example.com';writeGbutsOttStore(s);expect(()=>readGbutsOttStore()).toThrow();
});
test('a later explicit credential request resolves the replacement mailbox, never the original account',async()=>{
  const f=fixture();f.order.credentialDeliveryPolicy='netflix-password-v1';
  const record=createPartyAccessLinkRecord({token:'fixture',serviceType:'넷플릭스',accountEmail:f.target.accountEmail,profileName:'1',member:{kind:'gbuts',memberId:f.order.key,memberName:'buyer',status:'active',endDateTime:f.order.endDate,verifiedAt:new Date().toISOString()}});
  const account=manualRegisteredAccount({serviceType:'넷플릭스',email:f.target.accountEmail,password:'fixture-private',pin:'123456',paymentStatus:'paid',emailAccessProvider:'emailverify',expiryDate:'2026-12-01'},'fixture');
  const data={inventory:f.store,generated:{fixture:account},accessRecords:{[record.tokenHash]:record},maintenance:{}};
  const messages:any[]=[{senderSeq:f.order.userSeq,messageType:'TEXT',message:'!',createdAt:new Date().toISOString()}];
  const send=vi.fn(async (_room:string,seller:number,text:string)=>{for(const message of splitGbutsChatText(text))messages.push({senderSeq:seller,messageType:'TEXT',message,createdAt:new Date().toISOString()});});
  await syncGbutsDirectCredentials(f.store,[f.order],99,{credentials:async(o,l)=>resolveGbutsOttDirectCredentials(o,l,data)} as any,{openPrivateRoom:async()=>f.order.roomId,getChat:async()=>({messages})} as any,()=>{},send,{config:()=>null,send:vi.fn()});
  expect(send).toHaveBeenCalledTimes(1);expect(send.mock.calls[0][2]).toContain('target@example.com');expect(send.mock.calls[0][2]).toContain('이메일 PIN : 123456');expect(send.mock.calls[0][2]).not.toContain(f.source.accountEmail);
});
