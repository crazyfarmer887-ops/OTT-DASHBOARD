import { describe,expect,it,vi } from 'vitest';
import { maySubmitWithoutUnmonitoredExposure,recoverDisneyMonitoring,type DisneyRecoveryDeps } from '../src/scheduler/everyview-disney-startup-recovery';
import { emptyGbutsOttStore } from '../src/lib/gbuts-ott';
import { disneyEveryviewAccountKey } from '../src/lib/gbuts-disney-everyview';
import type { EveryviewDisneyCutoffConfig } from '../src/scheduler/everyview-disney-cutoff';
import type { EveryviewDisneyInventoryConfig } from '../src/scheduler/everyview-disney-inventory-runtime';
import type { EveryviewDisneyPublishJournal } from '../src/scheduler/everyview-disney-publish';
import { fixtureListing } from './fixtures/gbuts-ott';
import { prepareDisneyCorrelatedIntent,beginDisneyCorrelatedSubmission,type DisneyCorrelatedStore } from '../src/lib/everyview-disney-correlated-intent';

const email='disney@example.com',key=disneyEveryviewAccountKey(email),at=new Date('2026-10-29T00:01:00Z');
const intent={accountEmail:email,accountEndDate:'2027-01-24',profileNumber:6 as const};
function fixture(){
 const intents={version:1 as const,enabled:true,accounts:{[key]:intent}};
 let journal:EveryviewDisneyPublishJournal={version:1,records:{[key]:{state:'created',partyId:123,accountHash:key,
  accountEndDate:intent.accountEndDate,profileNumber:6,attemptedAt:at.toISOString()}}};
 let store={...emptyGbutsOttStore(),disneyEveryview:{[key]:{partyIds:[] as number[],accountCapacity:6,snapshots:{}}}};
 let cutoff:EveryviewDisneyCutoffConfig={version:1,enabled:true,parties:[]};
 let config:EveryviewDisneyInventoryConfig={version:1,enabled:true,parties:[]};
 let locked=false;const writeInventory=vi.fn((next:typeof store)=>{expect(locked).toBe(true);store=next;});
 const writeCutoff=vi.fn((next:EveryviewDisneyCutoffConfig)=>{expect(locked).toBe(true);cutoff=structuredClone(next);});
 const writeInventoryConfig=vi.fn((next:EveryviewDisneyInventoryConfig)=>{expect(locked).toBe(true);config=structuredClone(next);});
 const verifyBinding=vi.fn(async()=>true),inspectUnknownSubmission=vi.fn(async()=>undefined),alert=vi.fn(async()=>undefined);
 const deps:DisneyRecoveryDeps={intents:()=>intents,journal:()=>journal,cutoff:()=>structuredClone(cutoff),inventoryConfig:()=>structuredClone(config),
  writeCutoff,writeInventoryConfig,withInventory:async f=>{locked=true;try{return await f();}finally{locked=false;}},
  readInventory:()=>structuredClone(store),writeInventory,verifyBinding,inspectUnknownSubmission,safeToRun:()=>true,alert,now:()=>at};
 return {deps,alert,verifyBinding,inspectUnknownSubmission,writeCutoff,writeInventoryConfig,writeInventory,
  setJournal:(j:EveryviewDisneyPublishJournal)=>{journal=j;},getStore:()=>store,getCutoff:()=>cutoff,getConfig:()=>config};
}
describe('Disney seller startup recovery',()=>{
 it('blocks submission until hidden creation and previsibility monitoring are independently proven',()=>{
  expect(maySubmitWithoutUnmonitoredExposure({hiddenOnCreateVerified:false,monitorArmedBeforeVisibility:false})).toBe(false);
  expect(maySubmitWithoutUnmonitoredExposure({hiddenOnCreateVerified:true,monitorArmedBeforeVisibility:false})).toBe(false);
  expect(maySubmitWithoutUnmonitoredExposure({hiddenOnCreateVerified:true,monitorArmedBeforeVisibility:true})).toBe(true);
 });
 it('recovers a known provider ID once under the shared lock, holding profile 6 before either monitor is configured',async()=>{
  const f=fixture();expect(await recoverDisneyMonitoring(f.deps)).toBe('checked');
  expect(f.getStore().disneyEveryview[key].snapshots['123']).toMatchObject({complete:false,claims:[{profileNumber:6,state:'unknown'}]});
  expect(f.getCutoff().parties).toEqual([{partyId:123,accountEmail:email,accountEndDate:'2027-01-24',usageDays:30,enabled:true}]);
  expect(f.getConfig().parties).toEqual([{partyId:123,accountEmail:email,profileNumber:6}]);
  const writes=f.writeInventory.mock.invocationCallOrder[0];expect(writes).toBeLessThan(f.writeCutoff.mock.invocationCallOrder[0]);
  expect(await recoverDisneyMonitoring(f.deps)).toBe('checked');
  expect(f.writeInventory).toHaveBeenCalledTimes(1);expect(f.writeCutoff).toHaveBeenCalledTimes(1);expect(f.writeInventoryConfig).toHaveBeenCalledTimes(1);
 });
 it('uses only read-only diagnostics for an uncertain submission without a saved ID',async()=>{
  const f=fixture();f.setJournal({version:1,records:{[key]:{state:'attempted',accountHash:key,accountEndDate:intent.accountEndDate,profileNumber:6,attemptedAt:at.toISOString()}}});
  expect(await recoverDisneyMonitoring(f.deps)).toBe('held');expect(f.inspectUnknownSubmission).toHaveBeenCalledTimes(1);
  expect(f.verifyBinding).not.toHaveBeenCalled();expect(f.writeCutoff).not.toHaveBeenCalled();expect(f.writeInventoryConfig).not.toHaveBeenCalled();
  expect(f.alert).toHaveBeenCalledWith('SUBMISSION_UNCONFIRMED');
 });
 it('restores monitor configs after a crash between the atomic intent and legacy journal writes',async()=>{
  const f=fixture(),base={...emptyGbutsOttStore()};base.listings['request-1']=fixtureListing({serviceType:'디즈니플러스',accountEmail:email,capacity:5,deliveryMode:'disney-numbered-password'});
  const preflight={accountHash:key,accountEndDate:intent.accountEndDate,verifiedAt:at.toISOString(),accountCapacity:6,committedOtherPlaces:5,
   profile6Available:true,otherSourcesComplete:true,currentAdvertisementsReserved:true,syncReady:true,cutoffReady:true,profileDeliveryReady:true,credentialsValidated:true};
  let store:DisneyCorrelatedStore=beginDisneyCorrelatedSubmission(prepareDisneyCorrelatedIntent({store:base,accountEmail:email,accountEndDate:intent.accountEndDate,
   baseTitle:'디즈니 3개월',code:'ABCDEF123456',baseline:{complete:true,checkedAt:at.toISOString(),parties:[]},preflight,now:at}).store,key,at);
  f.setJournal({version:1,records:{}});f.deps.intents=()=>null;f.deps.readInventory=()=>structuredClone(store);
  f.deps.writeInventory=(next)=>{store=structuredClone(next);};f.deps.resolveCorrelated=vi.fn(async()=>123);
  expect(await recoverDisneyMonitoring(f.deps)).toBe('checked');
  expect(store.everyviewDisneyIntents![key]).toMatchObject({state:'confirmed',partyId:123});
  expect(store.disneyEveryview![key].snapshots['123']).toMatchObject({complete:false,claims:[{profileNumber:6}]});
  expect(f.getCutoff().parties).toHaveLength(1);expect(f.getConfig().parties).toHaveLength(1);
 });
 it('never promotes a correlated attempted create unless exact lookup independently confirms it',async()=>{
  const f=fixture();f.deps.resolveCorrelated=vi.fn(async()=>null);
  const store=f.getStore() as DisneyCorrelatedStore;
  store.everyviewDisneyIntents={[key]:{accountHash:key,requestCode:'ABCDEF123456',title:'디즈니 [ABCDEF123456]',accountEndDate:intent.accountEndDate,
   profileNumber:6,baselinePartyIds:[],baselineCheckedAt:at.toISOString(),preparedAt:at.toISOString(),attemptedAt:at.toISOString(),state:'attempted',monitors:{cutoffDays:30,profileNumber:6,enabled:true}}};
  expect(await recoverDisneyMonitoring(f.deps)).toBe('held');expect(f.writeCutoff).not.toHaveBeenCalled();
 });
 it('replays safely after a crash between the two configuration writes',async()=>{
  const f=fixture();f.writeInventoryConfig.mockImplementationOnce(()=>{throw Error('interrupted');});
  expect(await recoverDisneyMonitoring(f.deps)).toBe('held');expect(f.getCutoff().parties).toHaveLength(1);expect(f.getConfig().parties).toHaveLength(0);
  expect(await recoverDisneyMonitoring(f.deps)).toBe('checked');expect(f.getCutoff().parties).toHaveLength(1);expect(f.getConfig().parties).toHaveLength(1);
 });
 it('does not overwrite a different existing mapping or an unverified party',async()=>{
  const f=fixture();f.verifyBinding.mockResolvedValueOnce(false);
  expect(await recoverDisneyMonitoring(f.deps)).toBe('held');expect(f.writeInventory).not.toHaveBeenCalled();
 });
 it('does not touch paused monitoring settings',async()=>{
  const f=fixture();f.deps.safeToRun=()=>false;
  expect(await recoverDisneyMonitoring(f.deps)).toBe('paused');expect(f.writeInventory).not.toHaveBeenCalled();
 });
});


it('never restores monitors for a party explicitly retired after a verified transfer',async()=>{
 const f=fixture();const store=f.getStore();f.deps.readInventory=()=>({...structuredClone(store),retiredEveryviewPartyIds:[123]});
 expect(await recoverDisneyMonitoring(f.deps)).toBe('checked');expect(f.verifyBinding).not.toHaveBeenCalled();
 expect(f.writeCutoff).not.toHaveBeenCalled();expect(f.writeInventoryConfig).not.toHaveBeenCalled();
});
