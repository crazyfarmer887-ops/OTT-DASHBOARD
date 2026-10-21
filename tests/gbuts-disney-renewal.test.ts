import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createCipheriv, createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renewDueGbutsDisneyListings, DISNEY_RENEWAL_INTERVAL } from '../src/scheduler/gbuts-disney-renewal';
import { emptyGbutsOttStore } from '../src/lib/gbuts-ott';
import { readGbutsOttStore, writeGbutsOttStore } from '../src/lib/gbuts-ott-store';
import { allocateDisneyProfilesForSync } from '../src/lib/gbuts-disney-profiles';
import { syncGbutsOtt } from '../src/scheduler/gbuts-ott-sync';
import { fixtureListing, fixtureOrder } from './fixtures/gbuts-ott';
let directory='';
beforeEach(()=>{ vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-21T14:00:00Z')); directory=mkdtempSync(join(tmpdir(),'disney-renewal-')); });
afterEach(()=>{ vi.useRealTimers(); rmSync(directory,{recursive:true,force:true}); });
function encrypted(value:string){const key=Buffer.alloc(16);const ascii=Buffer.from(createHash('sha512').update('kkmouke0917').digest('hex'));for(let i=0;i<ascii.length;i++)key[i%16]^=ascii[i];const c=createCipheriv('aes-128-ecb',key,null);return Buffer.concat([c.update(value,'utf8'),c.final()]).toString('hex');}
function fixture(sold=2) {
  const path=join(directory,'store.json'); const initial=emptyGbutsOttStore();
  const listing=fixtureListing({serviceType:'디즈니플러스',deliveryMode:'disney-numbered-password',capacity:5,dailyPrice:150,title:'old cached title'});
  initial.listings[listing.id]=listing;
  initial.renewals={[listing.accountEmail]:{accountEmail:listing.accountEmail,capacity:5,listingId:listing.id,enabled:true,nextAt:new Date().toISOString()}};
  const member=(n:number)=>({seq:n,userSeq:10+n,nickname:`buyer${n}`,status:'APPLY',cancelStatus:null as string|null,createdAt:'2026-10-21 12:00:00',subscriptionEndsAt:'2026-12-01'});
  const rosters=new Map([[100,Array.from({length:sold},(_,i)=>member(i+1))]]);
  for(let n=1;n<=sold;n++) initial.orders[`100:${n}`]=fixtureOrder({key:`100:${n}`,memberSeq:n,userSeq:10+n,profileNumber:n,profileName:String(n),roomId:`room-${n}`,accessUrl:`https://example.com/${n}`,delivery:'confirmed',deliveryMessage:'already delivered',attemptedAt:'2026-10-21T03:00:00Z'});
  const posts:any[]=[{seq:100,category1:{seq:6},subscriptionType:'SHARE',memberLimit:5,memberCount:sold,status:'ON_SALE',subscriptionEndsAt:'2026-12-01 23:59:59',price:150,priceType:'DAY',title:JSON.stringify({ko:'[디즈니플러스] 1개월 / TV도 가능 / 연장도 가능'}),description:'성인 인증은 직접 진행해주세요.'}];
  writeGbutsOttStore(initial,path);
  const creds={id:'current@example.com',password:'current-password',emailAccessUrl:'https://tinyhost.shop/current@example.com'};
  const client={
    getPost:vi.fn(async(seq:number)=>structuredClone(posts.find(p=>p.seq===seq))),
    listOttMembers:vi.fn(async(seq:number)=>structuredClone(rosters.get(seq)||[])),
    latestPostSeq:vi.fn(async()=>Math.max(...posts.map(p=>p.seq))),
    listPostsAfter:vi.fn(async(after:number)=>structuredClone(posts.filter(p=>p.seq>after))),
    closePost:vi.fn(async(seq:number)=>{posts.find(p=>p.seq===seq).status='CLOSED';}),
    createPost:vi.fn(async(l:any,c:any)=>{const seq=100+posts.length;posts.push({seq,category1:{seq:6},subscriptionType:'SHARE',memberLimit:l.capacity,memberCount:0,status:'ON_SALE',subscriptionEndsAt:l.endDate+' 23:59:59',price:l.dailyPrice,priceType:'DAY',title:JSON.stringify({ko:`[디즈니플러스] ${l.title}`}),description:l.description,subscriptionPrincipal:encrypted(c.id),subscriptionCredential:encrypted(c.password)});rosters.set(seq,[]);return seq;}),
  };
  const management={services:[{serviceType:'디즈니플러스',accounts:[{email:listing.accountEmail,serviceType:'디즈니플러스',totalSlots:5,members:[],expiryDate:'2026-12-31',generatedAccount:{paymentStatus:'paid'}}]}],onSaleByKeepAcct:{}};
  const deps={readStore:()=>readGbutsOttStore(path),writeStore:(s:any)=>writeGbutsOttStore(s,path),manualMembers:()=>[],listingCredentials:vi.fn(async()=>creds),management:vi.fn(async()=>management),access:vi.fn(async(o:any)=>`https://example.com/${o.key}`),refreshAccess:vi.fn(async()=>{})};
  const replacementId=`disney-hourly-100-${Date.now()}`;
  const run=()=>renewDueGbutsDisneyListings(deps,client as any);
  const advance=()=>vi.setSystemTime(new Date(Date.now()+DISNEY_RENEWAL_INTERVAL));
  return {path,initial,listing,replacementId,member,rosters,posts,client,deps,creds,management,run,advance,store:()=>readGbutsOttStore(path)};
}
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
