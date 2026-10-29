import { describe, expect, it } from 'vitest';
import { disneyEveryviewAccountKey } from '../src/lib/gbuts-disney-everyview';
import { emptyGbutsOttStore } from '../src/lib/gbuts-ott';
import { inspectDisneyPublicationReadiness, type DisneyReadinessDependencies } from '../src/lib/everyview-disney-readiness';

const request={accountEmail:'disney@example.com',accountEndDate:'2027-01-24',profileNumber:6 as const,title:'디즈니 30일',description:'30일 이용'};
const key=disneyEveryviewAccountKey(request.accountEmail),now=new Date('2026-10-29T00:00:00Z'),at=now.toISOString();
function fixture(){
  const store=emptyGbutsOttStore();store.disneyEveryview={[key]:{partyIds:[123],accountCapacity:6,snapshots:{'123':{source:'everyview:123',complete:true,verifiedAt:at,advertisedVacancies:1,claims:[{id:'reserved',state:'pending',kind:'advertised',profileNumber:6}]}}}};
  const deps:DisneyReadinessDependencies={flags:()=>({inventory:true,cutoff:true,recovery:true}),owner:()=>true,healthy:()=>true,notificationReady:async()=>true,profileDeliveryPrepared:async()=>true,
    intents:()=>({version:1,enabled:true,accounts:{[key]:{accountEmail:request.accountEmail,accountEndDate:request.accountEndDate,profileNumber:6}}}),
    inventoryConfig:()=>({version:1,enabled:true,parties:[{partyId:123,accountEmail:request.accountEmail,profileNumber:6}]}),
    inventoryStatus:()=>({version:1,state:'checked',checkedAt:at,watch:{version:1,parties:{'123':{accountHash:key,observedAt:at,visibleEmptySlots:1,members:{}}}}}),
    cutoffConfig:()=>({version:1,enabled:true,parties:[{partyId:123,accountEmail:request.accountEmail,accountEndDate:request.accountEndDate,usageDays:30,enabled:true}]}),
    journal:()=>({version:1,records:{[key]:{state:'created',accountHash:key,accountEndDate:request.accountEndDate,profileNumber:6,partyId:123,attemptedAt:at}}}),
    store:()=>store,now:()=>now};return {deps,store};
}
describe('Disney publication runtime readiness',()=>{
  it('requires live workers and verified private bindings before enabling publication',async()=>{
    const {deps}=fixture(),r=await inspectDisneyPublicationReadiness(request,deps);
    expect(r).toMatchObject({syncReady:true,cutoffReady:true,profileDeliveryReady:true,diagnostics:{owner:true,workerFlags:true,
      intentValid:true,monitorConfigsBound:true,freshInventory:true,hiddenCreateVerified:false,previsibilityMonitoringVerified:false,
      cutoffWorkerHealthVerified:true,profileDeliveryVerified:true}});
    expect(JSON.stringify(r)).not.toContain(request.accountEmail);expect(JSON.stringify(r)).not.toContain(key);
  });
  it('treats an unverified worker or mismatched account as unready',async()=>{
    const f=fixture();f.deps.flags=()=>({inventory:true,cutoff:false,recovery:true});
    f.deps.journal=()=>({version:1,records:{[key]:{state:'attempted',accountHash:key,accountEndDate:request.accountEndDate,profileNumber:6,attemptedAt:at}}});
    expect(await inspectDisneyPublicationReadiness(request,f.deps)).toMatchObject({syncReady:false,diagnostics:{workerFlags:false,monitorConfigsBound:false,freshInventory:false}});
    f.deps.intents=()=>({version:1,enabled:true,accounts:{[key]:{accountEmail:'different@example.com',accountEndDate:request.accountEndDate,profileNumber:6}}});
    expect((await inspectDisneyPublicationReadiness(request,f.deps)).diagnostics.intentValid).toBe(false);
  });
  it('does not treat a stale or failed observation as an active inventory monitor',async()=>{
    const f=fixture();f.deps.now=()=>new Date(now.getTime()+121_000);
    expect((await inspectDisneyPublicationReadiness(request,f.deps)).diagnostics.freshInventory).toBe(false);
    f.deps.now=()=>now;const status=f.deps.inventoryStatus();status.state='held';f.deps.inventoryStatus=()=>status;
    expect((await inspectDisneyPublicationReadiness(request,f.deps)).diagnostics.freshInventory).toBe(false);
  });
  it('leaves all readiness false if a private file is absent or unreadable',async()=>{
    const f=fixture();f.deps.intents=()=>{throw Error('PRIVATE_FILE_REQUIRED');};
    expect(await inspectDisneyPublicationReadiness(request,f.deps)).toMatchObject({syncReady:false,cutoffReady:false,profileDeliveryReady:false,diagnostics:{intentValid:false}});
  });
});
