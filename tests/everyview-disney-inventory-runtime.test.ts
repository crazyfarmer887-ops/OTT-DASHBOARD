import { afterEach,describe,expect,it,vi } from 'vitest';
import { chmodSync,mkdtempSync,readFileSync,rmSync,statSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emptyGbutsOttStore } from '../src/lib/gbuts-ott';
import { disneyEveryviewAccountKey } from '../src/lib/gbuts-disney-everyview';
import { readEveryviewDisneyInventoryConfig,readEveryviewDisneyInventoryStatus,everyviewDisneyInventoryRuntimeDependencies,
  runEveryviewDisneyInventoryRuntime,startEveryviewDisneyInventoryFromEnv,type EveryviewDisneyInventoryStatus } from '../src/scheduler/everyview-disney-inventory-runtime';

const cleanup:string[]=[];
afterEach(()=>{vi.unstubAllEnvs();for(const d of cleanup.splice(0))rmSync(d,{recursive:true,force:true});});
const email='disney@example.com',partyId=10,key=disneyEveryviewAccountKey(email),at=new Date('2026-10-29T00:01:00Z');
const files=()=>{const d=mkdtempSync(join(tmpdir(),'disney-runtime-'));cleanup.push(d);const config=join(d,'config.json'),status=join(d,'status.json');
 vi.stubEnv('EVERYVIEW_DISNEY_INVENTORY_CONFIG_PATH',config);vi.stubEnv('EVERYVIEW_DISNEY_INVENTORY_STATUS_PATH',status);return {config,status};};
const configValue={version:1,enabled:true,parties:[{partyId,accountEmail:email,profileNumber:6}]};

describe('Disney Everyview private runtime files',()=>{
 it('stays off by default and does not instantiate dependencies',()=>{
  const factory=vi.fn();vi.stubEnv('EVERYVIEW_DISNEY_INVENTORY_ENABLED','false');
  expect(startEveryviewDisneyInventoryFromEnv(factory)).toBeUndefined();expect(factory).not.toHaveBeenCalled();
 });
 it('requires private config, validates unique bindings, and writes status mode 0600',()=>{
  const {config,status}=files();expect(readEveryviewDisneyInventoryConfig()).toBeNull();
  writeFileSync(config,JSON.stringify(configValue),{mode:0o600});expect(readEveryviewDisneyInventoryConfig()).toEqual(configValue);
  chmodSync(config,0o644);expect(()=>readEveryviewDisneyInventoryConfig()).toThrow('PRIVATE_FILE_REQUIRED');chmodSync(config,0o600);
  writeFileSync(config,JSON.stringify({...configValue,parties:[...configValue.parties,...configValue.parties]}));
  expect(()=>readEveryviewDisneyInventoryConfig()).toThrow('INVENTORY_CONFIG_INVALID');
  writeFileSync(config,JSON.stringify(configValue));
  const deps=everyviewDisneyInventoryRuntimeDependencies();
  expect(readEveryviewDisneyInventoryStatus()).toMatchObject({state:'waiting'});
  deps.writeStatus({version:1,state:'checked',checkedAt:at.toISOString(),watch:{version:1,parties:{}}});
  expect(statSync(status).mode&0o777).toBe(0o600);
  expect(JSON.parse(readFileSync(status,'utf8'))).toMatchObject({state:'checked'});
 });
 it('rejects a malformed persisted roster instead of discarding claims',()=>{
  const {status}=files();writeFileSync(status,JSON.stringify({version:1,state:'checked',watch:{version:1,parties:{'10':{accountHash:key,
   observedAt:at.toISOString(),visibleEmptySlots:1,members:{'30':{userSeq:20,currentlyVisible:true}}}}}}),{mode:0o600});
  expect(()=>readEveryviewDisneyInventoryStatus()).toThrow('INVENTORY_STATUS_INVALID');
 });
});

describe('Disney Everyview runtime cycle',()=>{
 function fixture(){
  let status:EveryviewDisneyInventoryStatus={version:1,state:'waiting',watch:{version:1,parties:{}}};
  let store={...emptyGbutsOttStore(),disneyEveryview:{[key]:{partyIds:[partyId],accountCapacity:6,snapshots:{}}}};
  const alert=vi.fn(async()=>undefined),now=()=>at;
  const binding=configValue.parties[0],cookie=()=> 'session-private';
  const observe=vi.fn(async()=>({partyId,observedAt:at.toISOString(),members:[],visibleEmptySlots:1}));
  const observation={config:()=>({enabled:true,parties:[binding]}),read:()=>status.watch,
    write:(watch:typeof status.watch)=>{status={...status,watch};},cookie,safeToRun:()=>true,observe,alert,now};
  const evidence=vi.fn(async(_binding:any,watch:any)=>({partyId,accountHash:key,rosterObservedAt:watch.parties['10'].observedAt,
    checkedAt:at.toISOString(),buyerCapacity:1 as const,advertisedVacancies:1 as const}));
  let locked=false;
  const bridge={config:()=>({enabled:true,bindings:[binding]}),readWatch:()=>status.watch,
    withInventory:async<T>(f:()=>Promise<T>)=>{locked=true;try{return await f();}finally{locked=false;}},readInventory:()=>store,
    writeInventory:(next:typeof store)=>{expect(locked).toBe(true);store=next;},evidence,safeToRun:()=>true,alert,now};
  const deps={observation,bridge,readStatus:()=>status,writeStatus:(next:typeof status)=>{status=next;},alert,now};
  return {deps,observe,evidence,alert,getStore:()=>store,getStatus:()=>status};
 }
 it('observes the provider then records the reserved profile under the inventory lock',async()=>{
  const f=fixture();expect(await runEveryviewDisneyInventoryRuntime(f.deps)).toBe('checked');
  expect(f.getStatus()).toMatchObject({state:'checked',checkedAt:at.toISOString()});
  expect(f.getStore().disneyEveryview[key].snapshots['10']).toMatchObject({complete:true,advertisedVacancies:1,claims:[{profileNumber:6}]});
 });
 it('immediately invalidates a prior snapshot when the next provider read fails',async()=>{
  const f=fixture();expect(await runEveryviewDisneyInventoryRuntime(f.deps)).toBe('checked');
  f.observe.mockRejectedValueOnce(new Error('PARTY_READ_UNAVAILABLE'));
  expect(await runEveryviewDisneyInventoryRuntime(f.deps)).toBe('error');
  expect(f.getStatus()).toMatchObject({state:'error',watch:{lastError:'PARTY_READ_UNAVAILABLE'}});
  expect(f.getStore().disneyEveryview[key].snapshots['10']).toMatchObject({complete:false,claims:[{profileNumber:6,state:'unknown'}]});
 });
 it('keeps no new writes when the worker is paused',async()=>{
  const f=fixture();f.deps.observation.safeToRun=()=>false;
  expect(await runEveryviewDisneyInventoryRuntime(f.deps)).toBe('paused');
  expect(f.getStore().disneyEveryview[key].snapshots).toEqual({});
 });
 it('isolates one failed party while all four other accounts keep fresh held snapshots',async()=>{
  let status:EveryviewDisneyInventoryStatus={version:1,state:'waiting',watch:{version:1,parties:{}}};
  const bindings=Array.from({length:5},(_,i)=>({partyId:10+i,accountEmail:`disney${i}@example.com`,profileNumber:6}));
  let store={...emptyGbutsOttStore(),disneyEveryview:Object.fromEntries(bindings.map(b=>[disneyEveryviewAccountKey(b.accountEmail),
    {partyIds:[b.partyId],accountCapacity:6,snapshots:{}}]))};
  const alert=vi.fn(async()=>undefined),now=()=>at;
  const observation={config:()=>({enabled:true,parties:bindings}),read:()=>status.watch,
   write:(watch:typeof status.watch)=>{status={...status,watch};},cookie:()=> 'session-private',safeToRun:()=>true,
   observe:async(_cookie:string,binding:typeof bindings[number])=>{
    if(binding.partyId===12)throw Error('PARTY_READ_UNAVAILABLE');
    return {partyId:binding.partyId,observedAt:at.toISOString(),members:[],visibleEmptySlots:1};},alert,now};
  let locked=false;
  const bridge={config:()=>({enabled:true,bindings}),readWatch:()=>status.watch,
   withInventory:async<T>(f:()=>Promise<T>)=>{locked=true;try{return await f();}finally{locked=false;}},readInventory:()=>store,
   writeInventory:(next:typeof store)=>{expect(locked).toBe(true);store=next;},
   evidence:async(binding:typeof bindings[number],watch:typeof status.watch)=>({partyId:binding.partyId,
    accountHash:disneyEveryviewAccountKey(binding.accountEmail),rosterObservedAt:watch.parties[String(binding.partyId)]?.observedAt,
    checkedAt:at.toISOString(),buyerCapacity:1 as const,advertisedVacancies:1 as const}),safeToRun:()=>true,alert,now};
  const deps={observation,bridge,readStatus:()=>status,writeStatus:(value:typeof status)=>{status=value;},alert,now};
  expect(await runEveryviewDisneyInventoryRuntime(deps)).toBe('error');
  expect(status.partyErrors).toEqual({'12':'PARTY_READ_UNAVAILABLE'});
  for(const b of bindings)expect(store.disneyEveryview[disneyEveryviewAccountKey(b.accountEmail)].snapshots[String(b.partyId)])
    .toMatchObject({complete:b.partyId!==12,claims:[{profileNumber:6,state:b.partyId===12?'unknown':'pending'}]});
 });
});
