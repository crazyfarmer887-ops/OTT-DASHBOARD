import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createCipheriv, createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renewDueGbutsOttListings, DISNEY_RENEWAL_INTERVAL } from '../src/scheduler/gbuts-ott-renewal';
import { emptyGbutsOttStore, gbutsOttRenewalKey } from '../src/lib/gbuts-ott';
import { readGbutsOttStore, writeGbutsOttStore } from '../src/lib/gbuts-ott-store';
import { allocateNetflixProfilesForSync } from '../src/lib/gbuts-netflix-profiles';
import { allocateDisneyProfilesForSync } from '../src/lib/gbuts-disney-profiles';
import { syncGbutsOtt } from '../src/scheduler/gbuts-ott-sync';
import { fixtureListing, fixtureOrder } from './fixtures/gbuts-ott';
import { disneyEveryviewAccountKey } from '../src/lib/gbuts-disney-everyview';
let directory='';
beforeEach(()=>{ vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-21T14:00:00Z')); directory=mkdtempSync(join(tmpdir(),'disney-renewal-')); });
afterEach(()=>{ vi.useRealTimers(); rmSync(directory,{recursive:true,force:true}); });
function encrypted(value:string){const key=Buffer.alloc(16);const ascii=Buffer.from(createHash('sha512').update('kkmouke0917').digest('hex'));for(let i=0;i<ascii.length;i++)key[i%16]^=ascii[i];const c=createCipheriv('aes-128-ecb',key,null);return Buffer.concat([c.update(value,'utf8'),c.final()]).toString('hex');}
function fixture(sold=2, serviceType='디즈니플러스') {
  const path=join(directory,'store.json'); const initial=emptyGbutsOttStore();
  const listing=fixtureListing({serviceType,deliveryMode:serviceType === '디즈니플러스' ? 'disney-numbered-password' : undefined,capacity:5,dailyPrice:150,title:'old cached title'});
  initial.listings[listing.id]=listing;
  initial.renewals={[gbutsOttRenewalKey(serviceType,listing.accountEmail)]:{accountEmail:listing.accountEmail,capacity:5,listingId:listing.id,enabled:true,nextAt:new Date().toISOString()}};
  const member=(n:number)=>({seq:n,userSeq:10+n,nickname:`buyer${n}`,status:'APPLY',cancelStatus:null as string|null,createdAt:'2026-10-21 12:00:00',subscriptionEndsAt:'2026-12-01'});
  const rosters=new Map([[100,Array.from({length:sold},(_,i)=>member(i+1))]]);
  for(let n=1;n<=sold;n++) initial.orders[`100:${n}`]=fixtureOrder({key:`100:${n}`,memberSeq:n,userSeq:10+n,profileNumber:n,profileName:String(n),roomId:`room-${n}`,accessUrl:`https://example.com/${n}`,delivery:'confirmed',deliveryMessage:'already delivered',attemptedAt:'2026-10-21T03:00:00Z'});
  const posts:any[]=[{seq:100,category1:{seq:serviceType === '디즈니플러스' ? 6 : 5},subscriptionType:'SHARE',memberLimit:5,memberCount:sold,status:'ON_SALE',subscriptionEndsAt:'2026-12-01 23:59:59',price:150,priceType:'DAY',title:JSON.stringify({ko:`[${serviceType}] 1개월 / TV도 가능 / 연장도 가능`}),description:'성인 인증은 직접 진행해주세요.'}];
  writeGbutsOttStore(initial,path);
  const creds={id:'current@example.com',password:'current-password',emailAccessUrl:'https://tinyhost.shop/current@example.com'};
  const client={
    getPost:vi.fn(async(seq:number)=>structuredClone(posts.find(p=>p.seq===seq))),
    listOttMembers:vi.fn(async(seq:number)=>structuredClone(rosters.get(seq)||[])),
    latestPostSeq:vi.fn(async()=>Math.max(...posts.map(p=>p.seq))),
    listPostsAfter:vi.fn(async(after:number)=>structuredClone(posts.filter(p=>p.seq>after))),
    closePost:vi.fn(async(seq:number)=>{posts.find(p=>p.seq===seq).status='CLOSED';}),
    createPost:vi.fn(async(l:any,c:any)=>{const seq=100+posts.length;posts.push({seq,category1:{seq:serviceType === '디즈니플러스' ? 6 : 5},subscriptionType:'SHARE',memberLimit:l.capacity,memberCount:0,status:'ON_SALE',subscriptionEndsAt:l.endDate+' 23:59:59',price:l.dailyPrice,priceType:'DAY',title:JSON.stringify({ko:`[${serviceType}] ${l.title}`}),description:l.description,noticeBeforeOrder:l.noticeBeforeOrder,noticeAfterOrder:l.noticeAfterOrder,subscriptionPrincipal:encrypted(c.id),subscriptionCredential:encrypted(c.password)});rosters.set(seq,[]);return seq;}),
  };
  const management={services:[{serviceType,accounts:[{email:listing.accountEmail,serviceType,totalSlots:5,members:[],expiryDate:'2026-12-31',generatedAccount:{paymentStatus:'paid'}}]}],onSaleByKeepAcct:{}};
  const deps={readStore:()=>readGbutsOttStore(path),writeStore:(s:any)=>writeGbutsOttStore(s,path),manualMembers:()=>[],listingCredentials:vi.fn(async()=>creds),management:vi.fn(async()=>management),access:vi.fn(async(o:any)=>`https://example.com/${o.key}`),refreshAccess:vi.fn(async()=>{})};
  const replacementId=`${serviceType === '디즈니플러스' ? 'disney-hourly' : 'netflix-rank'}-100-${Date.now()}`;
  const run=()=>renewDueGbutsOttListings(deps,client as any);
  const advance=()=>vi.setSystemTime(new Date(Date.now()+DISNEY_RENEWAL_INTERVAL));
  return {path,initial,listing,replacementId,member,rosters,posts,client,deps,creds,management,run,advance,store:()=>readGbutsOttStore(path)};
}
test('renewal subtracts confirmed Everyview buyers and reservations without changing old buyer profiles',async()=>{
 const f=fixture(2), store=f.store(), key=disneyEveryviewAccountKey(f.listing.accountEmail);
 store.disneyEveryview={[key]:{partyIds:[700],snapshots:{'700':{source:'everyview:700',complete:true,advertisedVacancies:0,verifiedAt:new Date().toISOString(),claims:[{id:'e1',state:'active',profileNumber:4}]}}}};
 f.deps.writeStore(store);
 expect((await f.run()).renewed).toBe(1);
 expect(f.posts[1].memberLimit).toBe(2);
 expect(f.store().orders['100:1'].profileNumber).toBe(1);
 expect(f.store().orders['100:2'].profileNumber).toBe(2);
});
test('renewal never closes or republishes when the linked Everyview snapshot is stale or incomplete',async()=>{
 const f=fixture(2), store=f.store(), key=disneyEveryviewAccountKey(f.listing.accountEmail);
 store.disneyEveryview={[key]:{partyIds:[700],snapshots:{'700':{source:'everyview:700',complete:true,advertisedVacancies:0,verifiedAt:'2026-10-21T13:50:00Z',claims:[]}}}};
 f.deps.writeStore(store);
 expect((await f.run()).errors).toBe(1);
 expect(f.client.closePost).not.toHaveBeenCalled();expect(f.client.createPost).not.toHaveBeenCalled();
});
test('an Everyview reservation intent without a party ID prevents closing or publishing',async()=>{
 const f=fixture(2), store=f.store(), key=disneyEveryviewAccountKey(f.listing.accountEmail);
 store.disneyEveryview={[key]:{partyIds:[],snapshots:{}}};f.deps.writeStore(store);
 expect((await f.run()).errors).toBe(1);
 expect(f.client.closePost).not.toHaveBeenCalled(); expect(f.client.createPost).not.toHaveBeenCalled();
});
test('renewal rechecks freshness after closing the original and refuses to create on a stale snapshot',async()=>{
 const f=fixture(2), store=f.store(), key=disneyEveryviewAccountKey(f.listing.accountEmail);
 store.disneyEveryview={[key]:{partyIds:[700],snapshots:{'700':{source:'everyview:700',complete:true,advertisedVacancies:0,verifiedAt:new Date().toISOString(),claims:[]}}}};
 f.deps.writeStore(store);
 f.client.closePost.mockImplementation(async()=>{f.posts[0].status='CLOSED';vi.setSystemTime(Date.now()+121_000);});
 expect((await f.run()).errors).toBe(1);
 expect(f.client.createPost).not.toHaveBeenCalled();
 expect(f.store().renewals![f.listing.accountEmail].pendingId).toBeTruthy();
});
test('every advertised Everyview place is reserved before GButs renewal and its policy cap is preserved',async()=>{
 const f=fixture(2), store=f.store(), key=disneyEveryviewAccountKey(f.listing.accountEmail);
 store.disneyEveryview={[key]:{partyIds:[700],snapshots:{'700':{source:'everyview:700',complete:true,advertisedVacancies:1,verifiedAt:new Date().toISOString(),claims:[
  {id:'buyer',kind:'buyer',state:'active',profileNumber:4},{id:'advertised-place',kind:'advertised',state:'pending',profileNumber:5}]}}}};
 f.deps.writeStore(store);
 expect((await f.run()).renewed).toBe(1);expect(f.posts[1].memberLimit).toBe(1);
});
test('six-place shared account preserves GButs five-place quota while Everyview reserves profile six',async()=>{
 const f=fixture(2), store=f.store(), key=disneyEveryviewAccountKey(f.listing.accountEmail);
 f.management.services[0].accounts[0].totalSlots=6;
 store.disneyEveryview={[key]:{accountCapacity:6,partyIds:[700],snapshots:{'700':{source:'everyview:700',complete:true,
   advertisedVacancies:1,verifiedAt:new Date().toISOString(),claims:[{id:'reserved-six',kind:'advertised',state:'pending',profileNumber:6}]}}}};
 f.deps.writeStore(store);
 expect((await f.run()).renewed).toBe(1);
 expect(f.posts[1].memberLimit).toBe(3);
 expect(f.store().renewals![f.listing.accountEmail].capacity).toBe(5);
 expect(f.store().orders['100:1'].profileNumber).toBe(1);expect(f.store().orders['100:2'].profileNumber).toBe(2);
});
test('renewal refuses a declared six-seat mapping when the actual account has only five seats',async()=>{
 const f=fixture(2), store=f.store(), key=disneyEveryviewAccountKey(f.listing.accountEmail);
 store.disneyEveryview={[key]:{accountCapacity:6,partyIds:[700],snapshots:{'700':{source:'everyview:700',complete:true,
   advertisedVacancies:1,verifiedAt:new Date().toISOString(),claims:[{id:'reserved-six',kind:'advertised',state:'pending',profileNumber:6}]}}}};
 f.deps.writeStore(store);
 expect((await f.run()).errors).toBe(1);
 expect(f.client.closePost).not.toHaveBeenCalled();expect(f.client.createPost).not.toHaveBeenCalled();
});
test('unaccounted advertised Everyview places stop renewal before any original post is closed',async()=>{
 const f=fixture(2), store=f.store(), key=disneyEveryviewAccountKey(f.listing.accountEmail);
 store.disneyEveryview={[key]:{partyIds:[700],snapshots:{'700':{source:'everyview:700',complete:true,advertisedVacancies:1,verifiedAt:new Date().toISOString(),claims:[]}}}};
 f.deps.writeStore(store);
 expect((await f.run()).errors).toBe(1);expect(f.client.closePost).not.toHaveBeenCalled();expect(f.client.createPost).not.toHaveBeenCalled();
});
test('partial sales retain original orders/rooms/receipts and advertise only remaining capacity; restart continues the chain',async()=>{
  const f=fixture(2); const before=f.store().orders;
  expect(await f.run()).toEqual({renewed:1,checked:1,errors:0});
  expect(f.posts[0].status).toBe('CLOSED'); expect(f.posts[1]).toMatchObject({memberLimit:3,price:150,subscriptionEndsAt:'2026-12-01 23:59:59'});
  const first=f.store(); expect(first.renewals![f.listing.accountEmail].listingId).toBe(f.replacementId);
  expect(first.orders['100:1']).toMatchObject({roomId:before['100:1'].roomId,accessUrl:before['100:1'].accessUrl,deliveryMessage:'already delivered',delivery:'confirmed',profileNumber:1});
  expect(f.client.createPost.mock.calls[0][1]).toEqual(f.creds); expect(f.posts[1].description).toContain('성인 인증'); expect(f.posts[1].title).toContain('TV도 가능');
  expect(JSON.stringify(first)).not.toContain('current-password');
  expect((await f.run()).checked).toBe(0); expect(f.client.createPost).toHaveBeenCalledTimes(1);
  f.rosters.set(101,[f.member(7)]); f.posts[1].memberCount=1;
  f.advance(); expect((await f.run()).renewed).toBe(1); expect(f.posts[2].memberLimit).toBe(2);
  const after=f.store();expect(allocateDisneyProfilesForSync(after,f.management,[]).size).toBe(0);
  expect(after.orders['101:7'].profileNumber).toBe(3); expect(after.orders['100:1'].profileNumber).toBe(1);expect(after.orders['100:2'].profileNumber).toBe(2);
});
test('a buyer racing closure reduces the newly published capacity',async()=>{
 const f=fixture(2);f.client.closePost.mockImplementation(async seq=>{f.posts.find(p=>p.seq===seq).status='CLOSED';f.posts[0].memberCount=3;f.rosters.set(100,[f.member(1),f.member(2),f.member(3)]);});
 expect((await f.run()).renewed).toBe(1);expect(f.posts[1].memberLimit).toBe(2);expect(f.store().orders['100:3']).toBeDefined();
});
test('full accounts create no zero-place posts, including the final racing buyer; verified refunds reopen capacity later',async()=>{
 const f=fixture(5);expect((await f.run()).renewed).toBe(0);expect(f.client.closePost).not.toHaveBeenCalled();expect(f.client.createPost).not.toHaveBeenCalled();
 f.rosters.get(100)![0].cancelStatus='REFUNDED'; f.rosters.get(100)![0].status='CANCEL';f.posts[0].memberCount=4;
 f.advance();expect((await f.run()).renewed).toBe(1);expect(f.posts[1].memberLimit).toBe(1);
 const g=fixture(4);g.client.closePost.mockImplementation(async()=>{g.posts[0].status='CLOSED';g.posts[0].memberCount=5;g.rosters.set(100,Array.from({length:5},(_,i)=>g.member(i+1)));});
 expect((await g.run()).renewed).toBe(0);expect(g.client.createPost).not.toHaveBeenCalled();expect(g.store().orders['100:5']).toBeDefined();
 g.rosters.get(100)![0].cancelStatus='REFUNDED';g.rosters.get(100)![0].status='CANCEL';g.posts[0].memberCount=4;g.client.closePost.mockImplementation(async()=>{});g.advance();
 expect((await g.run()).renewed).toBe(1);expect(g.posts[1].memberLimit).toBe(1);
});
test('unknown CREATE response is read-only reconciled after restart, including account field verification',async()=>{
 const f=fixture();const create=f.client.createPost.getMockImplementation()!;
 f.client.createPost.mockImplementation(async(l,c)=>{await create(l,c);throw new Error('lost response');});
 expect((await f.run()).errors).toBe(1);expect(f.posts).toHaveLength(2);
 vi.setSystemTime(new Date(Date.now()+61_000));expect((await f.run()).renewed).toBe(1);expect(f.client.createPost).toHaveBeenCalledTimes(1);
});
test('unknown pre-submit outcome never creates again or binds another account with the same public title',async()=>{
 const f=fixture(); f.client.createPost.mockRejectedValue(new Error('connection lost'));
 expect((await f.run()).errors).toBe(1);const pending=f.store().listings[f.replacementId];
 f.posts.push({...f.posts[0],seq:999,status:'ON_SALE',memberLimit:pending.capacity,subscriptionPrincipal:encrypted('other@example.com'),subscriptionCredential:encrypted('other-password')});
 vi.setSystemTime(new Date(Date.now()+61_000));expect((await f.run()).errors).toBe(1);expect(f.client.createPost).toHaveBeenCalledTimes(1);expect(f.store().renewals![f.listing.accountEmail].pendingId).toBe(pending.id);
});
test('unconfirmed closure keeps capacity and resumes only after actual closure',async()=>{
 const f=fixture();f.client.closePost.mockRejectedValueOnce(new Error('offline'));
 expect((await f.run()).errors).toBe(1);expect(f.client.createPost).not.toHaveBeenCalled();expect(f.store().listings[f.replacementId].repostPhase).toBe('closing');
 vi.setSystemTime(new Date(Date.now()+61_000));expect((await f.run()).renewed).toBe(1);expect(f.posts[1].memberLimit).toBe(3);
});
test('missing buyer history keeps capacity and another marketplace claim blocks renewal',async()=>{
 const f=fixture();f.rosters.set(100,[f.member(1)]);f.posts[0].memberCount=1;
 expect((await f.run()).renewed).toBe(1);expect(f.posts[1].memberLimit).toBe(3);expect(f.store().orders['100:2'].status).toBe('MISSING');
 const g=fixture();const store=g.store();store.graytagClaims.x={id:'x',serviceType:'디즈니플러스',accountEmail:g.listing.accountEmail,state:'pending',createdAt:new Date().toISOString()};g.deps.writeStore(store);
 expect((await g.run()).errors).toBe(1);expect(g.client.closePost).not.toHaveBeenCalled();
});
test('price/period/configuration changes and incomplete rosters stop publication; expiry disables renewal',async()=>{
 const f=fixture();f.posts[0].price=199;expect((await f.run()).errors).toBe(1);expect(f.client.closePost).not.toHaveBeenCalled();
 const g=fixture();g.rosters.set(100,[]);expect((await g.run()).errors).toBe(1);expect(g.client.closePost).not.toHaveBeenCalled();
 const h=fixture();vi.setSystemTime(new Date('2026-12-01T01:00:00Z'));expect((await h.run()).renewed).toBe(0);expect(h.store().renewals![h.listing.accountEmail].enabled).toBe(false);expect(h.client.createPost).not.toHaveBeenCalled();
});
test('new buyer on a smaller repost receives an account-wide profile number and original buyers are never resent',async()=>{
 const f=fixture(4);await f.run();const store=f.store();const l=store.listings[f.replacementId];
 store.orders['101:7']=fixtureOrder({key:'101:7',listingId:l.id,postSeq:101,memberSeq:7,userSeq:17,purchasedAt:'2026-10-21 23:10:00'});
 expect(allocateDisneyProfilesForSync(store,f.management,[]).size).toBe(0);expect(store.orders['101:7'].profileNumber).toBe(5);f.deps.writeStore(store);
 f.rosters.set(101,[f.member(7)]);f.posts[1].memberCount=1;
 const chats:any[]=[];const send=vi.fn(async(_r:any,_s:any,text:string)=>{chats.push({senderSeq:99,messageType:'TEXT',message:text,createdAt:new Date().toISOString()});});
 const client={...f.client,syncDisneyCredentials:vi.fn(async()=>{}),sellerAccountSeq:async()=>99,openPrivateRoom:async()=> 'new-room',getChat:async()=>({messages:chats})};
 expect((await syncGbutsOtt(f.deps,client as any,send)).attempted).toBe(1);
 expect(send).toHaveBeenCalledTimes(1);expect(send.mock.calls[0][2]).toContain('5번 프로필');expect(send.mock.calls[0][2]).toContain('1~5번');
 expect(f.store().orders['100:1'].roomId).toBe('room-1');expect(f.store().orders['100:1'].delivery).toBe('confirmed');
});
test('refunded history cannot conceal a newly paid buyer missing from the final roster',async()=>{
 const f=fixture(2);f.rosters.get(100)!.push({...f.member(8),status:'CANCEL',cancelStatus:'REFUNDED'});
 f.client.closePost.mockImplementation(async()=>{f.posts[0].status='CLOSED';f.posts[0].memberCount=3;});
 expect((await f.run()).errors).toBe(1);expect(f.client.createPost).not.toHaveBeenCalled();
 f.rosters.get(100)!.push(f.member(3));vi.setSystemTime(new Date(Date.now()+61000));
 expect((await f.run()).renewed).toBe(1);expect(f.posts[1].memberLimit).toBe(2);
});
test('live GrayTag occupants/recruitment block renewal before closing and are checked again before publication',async()=>{
 const f=fixture(); f.management.services[0].accounts[0].members.push({} as never);
 expect((await f.run()).errors).toBe(1);expect(f.client.closePost).not.toHaveBeenCalled();
 const g=fixture();g.client.closePost.mockImplementation(async()=>{g.posts[0].status='CLOSED';g.management.onSaleByKeepAcct[g.listing.accountEmail]=[{}];});
 expect((await g.run()).errors).toBe(1);expect(g.client.createPost).not.toHaveBeenCalled();
});
test('submitted work is reconciled after disabling and password rotation, then current credentials are synchronized',async()=>{
 const f=fixture();const create=f.client.createPost.getMockImplementation()!;
 f.client.createPost.mockImplementation(async(l,c)=>{await create(l,c);throw new Error('lost response');});
 expect((await f.run()).errors).toBe(1);
 const store=f.store();store.renewals![f.listing.accountEmail].enabled=false;f.deps.writeStore(store);
 f.creds.password='rotated-password';
 const sync=vi.fn(async(post:any,c:any)=>{const actual=f.posts.find(p=>p.seq===post.seq);actual.subscriptionPrincipal=encrypted(c.id);actual.subscriptionCredential=encrypted(c.password);});
 Object.assign(f.client,{syncDisneyCredentials:sync});
 vi.setSystemTime(new Date(Date.now()+61000));expect((await f.run()).renewed).toBe(1);expect(sync).toHaveBeenCalledTimes(1);
 expect(f.store().renewals![f.listing.accountEmail].enabled).toBe(false);expect(f.store().listings[f.replacementId].state).toBe('registered');
 f.advance();expect((await f.run()).checked).toBe(0);expect(f.client.createPost).toHaveBeenCalledTimes(1);
});
test('disabling a pending close releases its unpublished reservation without creating a new post',async()=>{
 const f=fixture();f.client.closePost.mockRejectedValue(new Error('offline'));await f.run();
 const store=f.store();store.renewals![f.listing.accountEmail].enabled=false;f.deps.writeStore(store);
 vi.setSystemTime(new Date(Date.now()+61000));expect((await f.run()).errors).toBe(0);expect(f.client.createPost).not.toHaveBeenCalled();
 expect(f.store().listings[f.replacementId].state).toBe('failed');expect(f.store().renewals![f.listing.accountEmail].pendingId).toBeUndefined();
});
test('resuming an unpublished replacement carries edits from the final original title and body',async()=>{
 const f=fixture();f.client.closePost.mockRejectedValueOnce(new Error('offline'));expect((await f.run()).errors).toBe(1);
 f.posts[0].title=JSON.stringify({ko:'[디즈니플러스] 변경한 제목'});f.posts[0].description='수정한 본문';
 vi.setSystemTime(new Date(Date.now()+61000));expect((await f.run()).renewed).toBe(1);
 expect(f.client.createPost.mock.calls[0][0]).toMatchObject({title:'변경한 제목',description:'수정한 본문'});
});

test('fixed terms edit current recruitment without advancing the hourly deadline or changing buyer receipts',async()=>{
 const f=fixture(0); const store=f.store();const policy=store.renewals![f.listing.accountEmail];
 policy.nextAt=new Date(Date.now()+DISNEY_RENEWAL_INTERVAL).toISOString();const nextAt=policy.nextAt;
 policy.saleTerms={dailyPrice:110,title:'벗츠 업자 최저가 보장 아니면 연장'};f.deps.writeStore(store);
 const before=structuredClone(store.orders);
 const update=vi.fn(async(post:any,terms:any)=>{const p=f.posts.find(p=>p.seq===post.seq);p.price=terms.dailyPrice;p.title=JSON.stringify({ko:`[디즈니플러스] ${terms.title}`});});
 Object.assign(f.client,{updateDisneySaleTerms:update});
 expect((await f.run()).errors).toBe(0);expect(f.client.createPost).not.toHaveBeenCalled();
 expect(f.store().renewals![f.listing.accountEmail].nextAt).toBe(nextAt);expect(f.store().orders).toEqual(before);
 expect(f.store().listings[f.listing.id]).toMatchObject({dailyPrice:110,title:policy.saleTerms.title});
 await f.run();expect(update).toHaveBeenCalledTimes(1);
 f.advance();expect((await f.run()).renewed).toBe(1);expect(f.posts[1]).toMatchObject({price:110,memberLimit:5});
 expect(f.posts[1].title).toContain(policy.saleTerms.title);
});
test('lost sale edit response recovers by reading actual conditions and never creates early',async()=>{
 const f=fixture(0); const store=f.store();const policy=store.renewals![f.listing.accountEmail];
 policy.nextAt=new Date(Date.now()+DISNEY_RENEWAL_INTERVAL).toISOString();policy.saleTerms={dailyPrice:110,title:'새 제목'};f.deps.writeStore(store);
 const update=vi.fn(async(post:any,terms:any)=>{f.posts[0].price=terms.dailyPrice;f.posts[0].title=JSON.stringify({ko:`[디즈니플러스] ${terms.title}`});if(update.mock.calls.length===1)throw new Error('lost PUT response');});
 Object.assign(f.client,{updateDisneySaleTerms:update});
 expect((await f.run()).errors).toBe(1);expect(f.store().listings[f.listing.id].dailyPrice).toBe(150);
 await f.run();expect(update).toHaveBeenCalledTimes(1);
 vi.setSystemTime(new Date(Date.now()+61000));expect((await f.run()).errors).toBe(0);
 expect(f.store().listings[f.listing.id].dailyPrice).toBe(110);expect(f.client.createPost).not.toHaveBeenCalled();
});
test('fixed terms preserve closed historical conditions while new replacement uses the configured terms',async()=>{
 const f=fixture(2);f.posts[0].status='CLOSED';const store=f.store();
 store.listings[f.listing.id].state='closed';store.renewals![f.listing.accountEmail].saleTerms={dailyPrice:110,title:'새 제목'};f.deps.writeStore(store);
 const update=vi.fn();Object.assign(f.client,{updateDisneySaleTerms:update});
 expect((await f.run()).renewed).toBe(1);expect(update).not.toHaveBeenCalled();
 expect(f.posts[0].price).toBe(150);expect(f.store().listings[f.listing.id].dailyPrice).toBe(150);
 expect(f.posts[1]).toMatchObject({price:110,memberLimit:3});
});
test('new terms wait for an uncertain CREATE to reconcile at its frozen original price',async()=>{
 const f=fixture();const create=f.client.createPost.getMockImplementation()!;
 f.client.createPost.mockImplementation(async(l,c)=>{await create(l,c);throw new Error('lost CREATE response');});
 expect((await f.run()).errors).toBe(1);
 const store=f.store();store.renewals![f.listing.accountEmail].saleTerms={dailyPrice:110,title:'새 제목'};f.deps.writeStore(store);
 const update=vi.fn(async(post:any,terms:any)=>{const p=f.posts.find(p=>p.seq===post.seq);p.price=terms.dailyPrice;p.title=JSON.stringify({ko:`[디즈니플러스] ${terms.title}`});});Object.assign(f.client,{updateDisneySaleTerms:update});
 vi.setSystemTime(new Date(Date.now()+61000));expect((await f.run()).renewed).toBe(1);expect(update).not.toHaveBeenCalled();
 await f.run();expect(update).toHaveBeenCalledTimes(1);expect(f.posts[1].price).toBe(110);expect(f.client.createPost).toHaveBeenCalledTimes(1);
});

test('a sell-out after a successful but unanswered edit reconciles the closed binding and later refunds reopen at the fixed price',async()=>{
 const f=fixture(0); const store=f.store();store.renewals![f.listing.accountEmail].saleTerms={dailyPrice:110,title:'새 제목'};f.deps.writeStore(store);
 const update=vi.fn(async()=>{f.posts[0].price=110;f.posts[0].title=JSON.stringify({ko:'[디즈니플러스] 새 제목'});f.posts[0].status='CLOSED';f.posts[0].memberCount=5;f.rosters.set(100,Array.from({length:5},(_,i)=>f.member(i+1)));throw new Error('lost edit response');});Object.assign(f.client,{updateDisneySaleTerms:update});
 expect((await f.run()).errors).toBe(1);vi.setSystemTime(new Date(Date.now()+61000));expect((await f.run()).errors).toBe(0);
 expect(f.store().listings[f.listing.id]).toMatchObject({dailyPrice:110,title:'새 제목'});expect(update).toHaveBeenCalledTimes(1);
 f.rosters.get(100)![0].cancelStatus='REFUNDED';f.rosters.get(100)![0].status='CANCEL';f.posts[0].memberCount=4;f.advance();
 expect((await f.run()).renewed).toBe(1);expect(f.posts[1]).toMatchObject({price:110,memberLimit:1});
});

test('joined posts cannot edit price: early fixed-term renewal transfers remaining places and preserves original due time',async()=>{
 const f=fixture(2);const store=f.store();const p=store.renewals![f.listing.accountEmail];p.nextAt=new Date(Date.now()+3600000).toISOString();p.saleTerms={dailyPrice:110,title:'새 제목'};f.deps.writeStore(store);
 const before=structuredClone(store.orders);const update=vi.fn();Object.assign(f.client,{updateDisneySaleTerms:update});
 expect((await f.run()).renewed).toBe(1);expect(update).not.toHaveBeenCalled();expect(f.posts[0].price).toBe(150);
 expect(f.posts[1]).toMatchObject({price:110,memberLimit:3});expect(f.store().renewals![f.listing.accountEmail].nextAt).toBe(p.nextAt);
 expect(f.store().orders['100:1'].directDelivery).toEqual(before['100:1'].directDelivery);expect(f.store().orders['100:1'].roomId).toBe('room-1');
 await f.run();expect(f.client.createPost).toHaveBeenCalledTimes(1);
});
test('full joined posts do not repeatedly attempt price edits or republish before the original deadline',async()=>{
 const f=fixture(5);const store=f.store();const p=store.renewals![f.listing.accountEmail];p.nextAt=new Date(Date.now()+3600000).toISOString();p.saleTerms={dailyPrice:110,title:'새 제목'};f.deps.writeStore(store);
 const update=vi.fn();Object.assign(f.client,{updateDisneySaleTerms:update});
 expect((await f.run()).renewed).toBe(0);expect((await f.run()).checked).toBe(0);expect(update).not.toHaveBeenCalled();expect(f.client.createPost).not.toHaveBeenCalled();
});

test('early terms renewal retains the original deadline across a lost CREATE response and restart',async()=>{
 const f=fixture(2);const store=f.store();const p=store.renewals![f.listing.accountEmail];p.nextAt=new Date(Date.now()+3600000).toISOString();p.saleTerms={dailyPrice:110,title:'새 제목'};f.deps.writeStore(store);
 const create=f.client.createPost.getMockImplementation()!;f.client.createPost.mockImplementation(async(l,c)=>{await create(l,c);throw new Error('lost response');});
 expect((await f.run()).errors).toBe(1);vi.setSystemTime(new Date(Date.now()+61000));expect((await f.run()).renewed).toBe(1);
 expect(f.store().renewals![f.listing.accountEmail].nextAt).toBe(p.nextAt);expect(f.client.createPost).toHaveBeenCalledTimes(1);
});

test('recovery beyond the original early-renewal deadline leaves its scheduled cycle due',async()=>{
 const f=fixture(2);const store=f.store();const p=store.renewals![f.listing.accountEmail];p.nextAt=new Date(Date.now()+3600000).toISOString();p.saleTerms={dailyPrice:110,title:'새 제목'};f.deps.writeStore(store);
 const create=f.client.createPost.getMockImplementation()!;f.client.createPost.mockImplementation(async(l,c)=>{await create(l,c);throw new Error('lost response');});
 expect((await f.run()).errors).toBe(1);vi.setSystemTime(new Date(Date.now()+3660000));expect((await f.run()).renewed).toBe(1);
 expect(f.store().renewals![f.listing.accountEmail].nextAt).toBe(p.nextAt);expect(Date.parse(p.nextAt)).toBeLessThan(Date.now());
});

function ranking(f:ReturnType<typeof fixture>,rows:Array<{seq:number;sellerSeq:number}>,patch:any={}){
 const store=f.store();const policy=store.renewals![f.listing.accountEmail];
 Object.assign(policy,{trigger:'rank',rankThreshold:5,lastRepostedAt:new Date(Date.now()-6*60_000).toISOString()},patch);f.deps.writeStore(store);
 Object.assign(f.client,{listOttPublicRanking:vi.fn(async()=>rows),sellerAccountSeq:vi.fn(async()=>99)});
}
test('rank trigger keeps top-four posts and our own five-post block without hourly churn',async()=>{
 const f=fixture();ranking(f,[{seq:100,sellerSeq:99},{seq:500,sellerSeq:88}]);
 expect((await f.run()).renewed).toBe(0);expect(f.client.closePost).not.toHaveBeenCalled();expect(f.store().renewals![f.listing.accountEmail].lastRank).toBe(1);
 const g=fixture();ranking(g,[1,2,3,4,100].map(seq=>({seq,sellerSeq:99})));
 expect((await g.run()).renewed).toBe(0);expect(g.client.createPost).not.toHaveBeenCalled();
});
test('rank trigger republishes a displaced fifth-place post with its remaining capacity and existing buyer receipts',async()=>{
 const f=fixture(2);ranking(f,[{seq:999,sellerSeq:88},...[1,2,3,100].map(seq=>({seq,sellerSeq:99}))]);
 const before=f.store().orders;expect((await f.run()).renewed).toBe(1);
 expect(f.posts[1].memberLimit).toBe(3);expect(f.store().orders['100:1'].directDelivery).toEqual(before['100:1'].directDelivery);
 expect(f.store().orders['100:1'].roomId).toBe('room-1');expect(Date.parse(f.store().renewals![f.listing.accountEmail].nextAt)-Date.now()).toBe(60000);
});
test('rank trigger checks no more than once a minute and applies a five-minute per-account cooldown',async()=>{
 const f=fixture();const rows=[1,2,3,4,100].map(seq=>({seq,sellerSeq:seq===100?99:88}));ranking(f,rows,{lastRepostedAt:new Date().toISOString()});
 expect((await f.run()).renewed).toBe(0);await f.run();expect((f.client as any).listOttPublicRanking).toHaveBeenCalledTimes(1);
 vi.setSystemTime(new Date(Date.now()+5*60_000));expect((await f.run()).renewed).toBe(1);
});
test('rank query failures, short absent windows and full accounts never close or create',async()=>{
 const f=fixture();ranking(f,[{seq:900,sellerSeq:88}]);(f.client as any).listOttPublicRanking.mockRejectedValue(new Error('offline'));
 await f.run();expect(f.client.closePost).not.toHaveBeenCalled();expect(f.store().renewals![f.listing.accountEmail].lastError).toContain('목록 순위 확인 실패');
 const g=fixture();ranking(g,[{seq:900,sellerSeq:88}]);await g.run();expect(g.client.createPost).not.toHaveBeenCalled();
 const h=fixture(5);ranking(h,[...Array.from({length:4},(_,i)=>({seq:900+i,sellerSeq:88})),{seq:100,sellerSeq:99}]);await h.run();expect(h.client.createPost).not.toHaveBeenCalled();
});
test('only one lowest displaced post is renewed per fresh list, then the next check reads again',async()=>{
 const f=fixture(0);const store=f.store();const second={...f.listing,id:'second',postSeq:200,accountEmail:'second@example.com'};store.listings.second=second;
 store.renewals![second.accountEmail]={accountEmail:second.accountEmail,capacity:5,listingId:second.id,enabled:true,nextAt:new Date().toISOString()};f.deps.writeStore(store);
 f.posts.push({...f.posts[0],seq:200});f.management.services[0].accounts.push({...f.management.services[0].accounts[0],email:second.accountEmail});
 ranking(f,[...Array.from({length:4},(_,i)=>({seq:900+i,sellerSeq:88})),{seq:100,sellerSeq:99},{seq:200,sellerSeq:99}]);
 const saved=f.store();Object.assign(saved.renewals![second.accountEmail],{trigger:'rank',rankThreshold:5,lastRepostedAt:new Date(Date.now()-6*60_000).toISOString()});f.deps.writeStore(saved);
 expect((await f.run()).renewed).toBe(1);expect(f.client.closePost.mock.calls[0][0]).toBe(200);expect(f.client.createPost).toHaveBeenCalledTimes(1);expect(f.posts[0].status).toBe('ON_SALE');
});
test('rank mode recovers an uncertain submitted CREATE even while the public list is unavailable',async()=>{
 const f=fixture();ranking(f,[...Array.from({length:4},(_,i)=>({seq:900+i,sellerSeq:88})),{seq:100,sellerSeq:99}]);
 const create=f.client.createPost.getMockImplementation()!;f.client.createPost.mockImplementation(async(l,c)=>{await create(l,c);throw new Error('lost response');});
 expect((await f.run()).errors).toBe(1);(f.client as any).listOttPublicRanking.mockRejectedValue(new Error('offline'));
 vi.setSystemTime(new Date(Date.now()+61000));expect((await f.run()).renewed).toBe(1);expect(f.client.createPost).toHaveBeenCalledTimes(1);
});

test('a verified complete top-twenty prefix can identify a displaced lower post without scanning history',async()=>{
 const f=fixture(1);ranking(f,Array.from({length:20},(_,i)=>({seq:900+i,sellerSeq:88})));
 expect((await f.run()).renewed).toBe(1);expect(f.posts[1].memberLimit).toBe(4);expect(f.store().renewals![f.listing.accountEmail].lastRank).toBeNull();
});

test('rank mode reopens a closed full chain after a provider-verified refund creates a vacancy',async()=>{
 const f=fixture(5);const store=f.store();store.listings[f.listing.id].state='closed';store.orders['100:1'].status='CANCEL';store.orders['100:1'].cancelStatus='REFUNDED';f.deps.writeStore(store);
 f.posts[0].status='CLOSED';f.posts[0].memberCount=4;f.rosters.get(100)![0].status='CANCEL';f.rosters.get(100)![0].cancelStatus='REFUNDED';
 ranking(f,Array.from({length:20},(_,i)=>({seq:900+i,sellerSeq:88})));
 expect((await f.run()).renewed).toBe(1);expect(f.posts[1].memberLimit).toBe(1);expect(f.client.closePost).not.toHaveBeenCalled();
});
test('rank mode recovers a refund after the final buyer races closure and cancels publication',async()=>{
 const f=fixture(4);ranking(f,[...Array.from({length:4},(_,i)=>({seq:900+i,sellerSeq:88})),{seq:100,sellerSeq:99}]);
 f.client.closePost.mockImplementation(async()=>{f.posts[0].status='CLOSED';f.posts[0].memberCount=5;f.rosters.set(100,Array.from({length:5},(_,i)=>f.member(i+1)));});
 expect((await f.run()).renewed).toBe(0);expect(f.client.createPost).not.toHaveBeenCalled();
 const store=f.store();store.orders['100:1'].status='CANCEL';store.orders['100:1'].cancelStatus='REFUNDED';f.deps.writeStore(store);
 f.rosters.get(100)![0].status='CANCEL';f.rosters.get(100)![0].cancelStatus='REFUNDED';f.posts[0].memberCount=4;
 (f.client as any).listOttPublicRanking.mockResolvedValue(Array.from({length:20},(_,i)=>({seq:900+i,sellerSeq:88})));
 vi.setSystemTime(new Date(Date.now()+6*60000));expect((await f.run()).renewed).toBe(1);expect(f.client.createPost.mock.calls[0][0].capacity).toBe(1);
});


test('Netflix partial renewal preserves old buyer/profile receipts and native merchant notices',async()=>{
 const f=fixture(2,'넷플릭스');
 f.posts[0].title=JSON.stringify({ko:'[넷플릭스] 프리미엄 / 하루 190원 / 1개월 / 비밀번호 로그인'});
 f.posts[0].description='비밀번호 로그인 전용. 링키드 닉네임과 같은 프로필을 사용하세요.';
 f.posts[0].noticeBeforeOrder='닉네임 불일치 프로필은 정리될 수 있습니다.';f.posts[0].noticeAfterOrder='이메일 코드는 제공하지 않습니다.';
 const before=f.store().orders;
 expect(await f.run()).toEqual({renewed:1,checked:1,errors:0});
 expect(f.posts[1]).toMatchObject({category1:{seq:5},memberLimit:3,price:150,subscriptionEndsAt:'2026-12-01 23:59:59'});
 const saved=f.store();expect(saved.orders['100:1']).toMatchObject({roomId:before['100:1'].roomId,profileNumber:1,accessUrl:before['100:1'].accessUrl,delivery:'confirmed',deliveryMessage:'already delivered'});
 expect(saved.listings[f.replacementId]).toMatchObject({description:f.posts[0].description,noticeBeforeOrder:f.posts[0].noticeBeforeOrder,noticeAfterOrder:f.posts[0].noticeAfterOrder});
 expect(JSON.stringify(saved)).not.toContain('current-password');
});

test('Netflix closure-racing sales reduce replacement places and later buyers retain account-wide profile leases',async()=>{
 const f=fixture(2,'넷플릭스');
 f.client.closePost.mockImplementation(async()=>{f.posts[0].status='CLOSED';f.posts[0].memberCount=3;f.rosters.set(100,[f.member(1),f.member(2),f.member(3)]);});
 expect((await f.run()).renewed).toBe(1);expect(f.posts[1].memberLimit).toBe(2);
 const first=f.store();expect(allocateNetflixProfilesForSync(first,f.management,[]).size).toBe(0);f.deps.writeStore(first);
 expect(first.orders['100:3'].profileNumber).toBe(3);
 f.rosters.set(101,[f.member(7)]);f.posts[1].memberCount=1;
 f.client.closePost.mockImplementation(async seq=>{f.posts.find(p=>p.seq===seq).status='CLOSED';});f.advance();
 expect((await f.run()).renewed).toBe(1);expect(f.posts[2].memberLimit).toBe(1);
 const saved=f.store();expect(allocateNetflixProfilesForSync(saved,f.management,[]).size).toBe(0);
 expect(saved.orders['101:7'].profileNumber).toBe(4);expect(saved.orders['100:1'].profileNumber).toBe(1);expect(saved.orders['100:1'].deliveryMessage).toBe('already delivered');
});
test('Netflix unknown CREATE only reconciles the submitted private account and preserves disabled future renewal',async()=>{
 const f=fixture(2,'넷플릭스');const create=f.client.createPost.getMockImplementation()!;
 f.client.createPost.mockImplementation(async(l,c)=>{await create(l,c);throw new Error('lost response');});
 expect((await f.run()).errors).toBe(1);
 const store=f.store();store.renewals![gbutsOttRenewalKey('넷플릭스',f.listing.accountEmail)].enabled=false;f.deps.writeStore(store);
 const syncNetflixCredentials=vi.fn(async(p:any,c:any)=>{const actual=f.posts.find(x=>x.seq===p.seq);actual.subscriptionPrincipal=encrypted(c.id);actual.subscriptionCredential=encrypted(c.password);});
 Object.assign(f.client,{syncNetflixCredentials});f.creds.password='rotated-password';vi.setSystemTime(new Date(Date.now()+61_000));
 expect((await f.run()).renewed).toBe(1);expect(f.client.createPost).toHaveBeenCalledTimes(1);expect(syncNetflixCredentials).toHaveBeenCalledOnce();
 expect(f.store().renewals![gbutsOttRenewalKey('넷플릭스',f.listing.accountEmail)].enabled).toBe(false);
 expect(JSON.stringify(f.store())).not.toContain('rotated-password');
});
test('Netflix full accounts create nothing, verified refunds release places, and missing buyers retain places',async()=>{
 const f=fixture(5,'넷플릭스');expect((await f.run()).renewed).toBe(0);expect(f.client.closePost).not.toHaveBeenCalled();
 f.rosters.get(100)![0].status='CANCEL';f.rosters.get(100)![0].cancelStatus='REFUNDED';f.posts[0].memberCount=4;f.advance();
 expect((await f.run()).renewed).toBe(1);expect(f.posts[1].memberLimit).toBe(1);
 const g=fixture(2,'넷플릭스');g.rosters.set(100,[g.member(1)]);g.posts[0].memberCount=1;
 expect((await g.run()).renewed).toBe(1);expect(g.posts[1].memberLimit).toBe(3);expect(g.store().orders['100:2'].status).toBe('MISSING');
});
test('Netflix ranking failure is isolated from Disney and same-email service policies coexist',async()=>{
 const f=fixture(2);const store=f.store();const n=fixtureListing({id:'netflix-same-email',serviceType:'넷플릭스',postSeq:700,capacity:5});
 store.listings[n.id]=n;const nk=gbutsOttRenewalKey('넷플릭스',n.accountEmail);
 store.renewals![nk]={serviceType:'넷플릭스',accountEmail:n.accountEmail,capacity:5,listingId:n.id,enabled:true,trigger:'rank',rankThreshold:5,nextAt:new Date().toISOString()};
 store.renewals![f.listing.accountEmail].trigger='rank';store.renewals![f.listing.accountEmail].rankThreshold=5;f.deps.writeStore(store);
 Object.assign(f.client,{sellerAccountSeq:vi.fn(async()=>99),listOttPublicRanking:vi.fn(async(service:string)=>{if(service==='넷플릭스')throw new Error('Netflix offline');return [{seq:900,sellerSeq:88},{seq:901,sellerSeq:88},{seq:902,sellerSeq:88},{seq:903,sellerSeq:88},{seq:100,sellerSeq:99}];})});
 expect(await f.run()).toEqual({renewed:1,checked:1,errors:1});expect(f.store().renewals![nk].lastError).toContain('Netflix offline');expect(f.posts[1].category1.seq).toBe(6);
});
test('Netflix rank uses its own latest list, ignores own blocks, applies cooldown and disables at paid expiry',async()=>{
 const f=fixture(0,'넷플릭스');const store=f.store();const k=gbutsOttRenewalKey('넷플릭스',f.listing.accountEmail);Object.assign(store.renewals![k],{trigger:'rank',rankThreshold:5,lastRepostedAt:new Date().toISOString()});f.deps.writeStore(store);
 const rows=Array.from({length:5},(_,i)=>({seq:i===4?100:900+i,sellerSeq:99}));
 Object.assign(f.client,{sellerAccountSeq:vi.fn(async()=>99),listOttPublicRanking:vi.fn(async()=>rows)});
 expect((await f.run()).renewed).toBe(0);expect((f.client as any).listOttPublicRanking).toHaveBeenCalledWith('넷플릭스');
 rows[0].sellerSeq=88;vi.setSystemTime(new Date(Date.now()+61_000));expect((await f.run()).renewed).toBe(0);
 vi.setSystemTime(new Date('2026-12-01T01:00:00Z'));expect((await f.run()).renewed).toBe(0);expect(f.store().renewals![k].enabled).toBe(false);expect(f.client.closePost).not.toHaveBeenCalled();
});

test('expired Netflix history needs no paid credentials and cannot stop a healthy Disney chain',async()=>{
 const f=fixture(0,'넷플릭스');const store=f.store();
 Object.assign(store.listings[f.listing.id],{state:'closed',endDate:'2020-01-01',repostFrom:'retired-original'});
 Object.assign(f.posts[0],{status:'CLOSED',subscriptionEndsAt:'2020-01-01 23:59:59'});
 const disney=fixtureListing({id:'healthy-disney',serviceType:'디즈니플러스',deliveryMode:'disney-numbered-password',postSeq:700,capacity:5,dailyPrice:150});store.listings[disney.id]=disney;f.deps.writeStore(store);
 f.posts.push({...f.posts[0],seq:700,category1:{seq:6},status:'ON_SALE',subscriptionEndsAt:'2026-12-01 23:59:59'});
 f.deps.listingCredentials.mockImplementation(async listing=>{if(listing.serviceType==='넷플릭스')throw new Error('결제된 넷플릭스 계정 정보를 확인해주세요.');return f.creds;});
 const syncDisneyCredentials=vi.fn(async()=>{});const syncNetflixCredentials=vi.fn(async()=>{});Object.assign(f.client,{syncDisneyCredentials,syncNetflixCredentials});
 await expect(syncGbutsOtt(f.deps,f.client as any)).resolves.toEqual({orders:0,attempted:0,confirmed:0});
 expect(syncDisneyCredentials).toHaveBeenCalledOnce();expect(syncNetflixCredentials).not.toHaveBeenCalled();expect(f.deps.listingCredentials).toHaveBeenCalledTimes(1);
});


test('keeps the verified secondary sixth seat outside the five-place GButs renewal quota',async()=>{
 const f=fixture(2);f.management.services[0].accounts[0].totalSlots=6;
 const store=f.store();store.graytagClaims.secondary={id:'secondary',serviceType:'디즈니플러스',accountEmail:f.listing.accountEmail,
 state:'registered',createdAt:new Date().toISOString(),accountId:'secondary',profileNumber:6,endDate:'2026-11-20',
 sourceEveryviewPartyId:707,everyviewRetiredAt:new Date().toISOString(),productUsid:'secondary-product'};
 f.deps.writeStore(store);await f.run();
 expect(f.client.createPost).toHaveBeenCalledOnce();expect(f.client.createPost.mock.calls[0][0].capacity).toBe(3);
 expect(f.store().graytagClaims.secondary.productUsid).toBe('secondary-product');
 const invalid=f.store();invalid.graytagClaims.secondary.state='uncertain';f.deps.writeStore(invalid);f.advance();await f.run();
 expect(f.client.createPost).toHaveBeenCalledTimes(1);
});
