import { describe,expect,it,vi } from 'vitest';
import { emptyGbutsOttStore } from '../src/lib/gbuts-ott';
import { disneyEveryviewAccountKey } from '../src/lib/gbuts-disney-everyview';
import { buildDisneyCorrelatedTitle,prepareDisneyCorrelatedIntent,beginDisneyCorrelatedSubmission,
 identifyCorrelatedDisneySubmission,confirmDisneyCorrelatedSubmission,type DisneyCorrelatedStore } from '../src/lib/everyview-disney-correlated-intent';
import type { EveryviewDisneyPublishPreflight,EveryviewDisneyPublicationProof } from '../src/scheduler/everyview-disney-publish';
const email='disney@example.com',key=disneyEveryviewAccountKey(email),now=new Date('2026-10-29T00:01:00Z'),code='ABCDEF123456';
const old={partyId:7,partyType:'free' as const,title:'old title',serviceCode:'disney_plus',serviceName:'디즈니+'};
const baseline={parties:[old],checkedAt:now.toISOString(),complete:true};
const preflight:EveryviewDisneyPublishPreflight={accountHash:key,accountEndDate:'2027-01-24',verifiedAt:now.toISOString(),
 accountCapacity:6,committedOtherPlaces:5,profile6Available:true,otherSourcesComplete:true,currentAdvertisementsReserved:true,
 syncReady:true,cutoffReady:true,profileDeliveryReady:true,credentialsValidated:true};
const prep=(store:DisneyCorrelatedStore=emptyGbutsOttStore())=>prepareDisneyCorrelatedIntent({store,accountEmail:email,accountEndDate:'2027-01-24',
 baseTitle:'디즈니 3개월',code,baseline,preflight,now});
const proof:EveryviewDisneyPublicationProof={partyId:9,owned:true,serviceCode:'disney_plus',accountEmail:email,shareType:'ACCOUNT',periodTermType:'ROLLING',
 usageDays:30,totalUsageFee:2910,oneDayUsageFee:97,monthUsageFee:2910,shareEndDate:null,buyerCapacity:1,profileNumber:6,emailAccessVerified:true};
const attempted=()=>beginDisneyCorrelatedSubmission(prep().store,key,now);
const page=(title:string,extra:any[]=[])=>( {complete:true,checkedAt:now.toISOString(),parties:[old,{...old,partyId:9,title},...extra]} );

describe('durable Disney request correlation',()=>{
 it('stores a random title code, baseline and desired monitors with the account reservation in one store snapshot',()=>{
  const result=prep(),i=result.intent;
  expect(i).toMatchObject({state:'prepared',requestCode:code,baselinePartyIds:[7],monitors:{cutoffDays:30,profileNumber:6,enabled:true}});
  expect(i.title).toBe('디즈니 3개월 [ABCDEF123456]');
  expect(result.store.disneyEveryview![key]).toMatchObject({accountCapacity:6,partyIds:[]});
  expect(JSON.stringify(result.store)).not.toContain(email);
  expect(buildDisneyCorrelatedTitle('디즈니 3개월').code).toMatch(/^[A-F0-9]{12}$/);
 });
 it('rejects existing title markers, duplicate baseline IDs, incomplete lists, and stale sources',()=>{
  for(const b of [ {...baseline,complete:false},{...baseline,checkedAt:'2020-01-01T00:00:00Z'},
    {...baseline,parties:[{...old,title:`복제 [${code}]`}]},{...baseline,parties:[old,old]} ])
   expect(()=>prepareDisneyCorrelatedIntent({store:emptyGbutsOttStore(),accountEmail:email,accountEndDate:'2027-01-24',baseTitle:'디즈니 3개월',code,baseline:b,preflight,now})).toThrow();
 });
 it('persists attempted state first and never authorizes a second submission',()=>{
  const store=attempted();expect(store.everyviewDisneyIntents![key]).toMatchObject({state:'attempted',attemptedAt:now.toISOString()});
  expect(()=>beginDisneyCorrelatedSubmission(store,key,now)).toThrow('SUBMISSION_NOT_AUTHORIZED');
 });
 it('finds one exact new marker only after account, all terms and buyer email access are confirmed',async()=>{
  const store=attempted(),title=store.everyviewDisneyIntents![key].title,verify=vi.fn(async()=>({title,proof}));
  const result=await identifyCorrelatedDisneySubmission({store,key,accountEmail:email,current:page(title),now,verify});
  expect(result).toEqual({state:'confirmed',partyId:9});expect(verify).toHaveBeenCalledTimes(1);
  const confirmed=confirmDisneyCorrelatedSubmission(store,key,9,now);
  expect(confirmed.everyviewDisneyIntents![key]).toMatchObject({state:'confirmed',partyId:9});
  expect(confirmed.disneyEveryview![key]).toMatchObject({partyIds:[9],snapshots:{'9':{complete:false,claims:[{profileNumber:6,state:'unknown'}]}}});
 });
 it('never retries or promotes no-result, duplicate, old, incorrect title, incomplete list, or wrong proof',async()=>{
  const store=attempted(),title=store.everyviewDisneyIntents![key].title;
  const verify=vi.fn(async()=>({title,proof}));
  const data=[{...page(title),parties:[old]},page(title,[{...old,partyId:10,title}]),page(`wrong [${code}]`),
   {...page(title),complete:false},{...page(title),parties:[{...old,title}]},page(title)];
  for(let i=0;i<data.length;i++){
   const result=await identifyCorrelatedDisneySubmission({store,key,accountEmail:email,current:data[i],now,
    verify:i===data.length-1?async()=>({title,proof:{...proof,emailAccessVerified:false}}):verify});
   expect(result.state).toBe('held');
  }
  expect(()=>confirmDisneyCorrelatedSubmission(store,key,7,now)).toThrow('CONFIRMATION_NOT_AUTHORIZED');
 });
});
