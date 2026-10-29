import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { registerEveryviewDisneyPublicationRoutes, everyviewDisneyPublicationReadiness } from '../src/api/everyview-disney-publish';
import { disneyEveryviewAccountKey } from '../src/lib/gbuts-disney-everyview';
import { emptyGbutsOttStore } from '../src/lib/gbuts-ott';
import type { EveryviewDisneyPublishDeps } from '../src/scheduler/everyview-disney-publish';

const dirs:string[]=[];
const body={accountEmail:'disney@example.com',accountEndDate:'2027-01-24',title:'디즈니 30일',description:'30일 이용',profileNumber:6};
afterEach(()=>{vi.unstubAllEnvs();for(const d of dirs.splice(0))rmSync(d,{recursive:true,force:true});});
function fixture(isOwner=()=>true){
  const dir=mkdtempSync(join(tmpdir(),'ev-publish-route-'));dirs.push(dir);
  vi.stubEnv('SAFE_MODE_PATH',join(dir,'safe.json'));vi.stubEnv('AIO_ADMIN_TOKEN','private-token');
  const submit=vi.fn(async()=>({ok:true,partyId:123})),recover=vi.fn(async()=>null), key=disneyEveryviewAccountKey(body.accountEmail);
  let attempted=false;const now=new Date('2026-10-29T00:00:00Z');
  const deps:EveryviewDisneyPublishDeps={withInventory:async run=>run(),readInventory:()=>emptyGbutsOttStore(),writeInventory:vi.fn(),
    readJournal:()=>({version:1,records:attempted?{[key]:{state:'attempted',accountHash:key,accountEndDate:body.accountEndDate,profileNumber:6,attemptedAt:now.toISOString()}}:{}}),
    writeJournal:vi.fn(),preflight:async()=>({accountHash:key,accountEndDate:body.accountEndDate,verifiedAt:now.toISOString(),accountCapacity:6,
      committedOtherPlaces:5,profile6Available:true,otherSourcesComplete:true,currentAdvertisementsReserved:true,syncReady:false,cutoffReady:false,
      profileDeliveryReady:false,credentialsValidated:true}),credentials:vi.fn(),submit,verify:vi.fn(),recover,safeToRun:()=>true,now:()=>now};
  const runtime=vi.fn(()=>deps),app=new Hono();registerEveryviewDisneyPublicationRoutes(app,{} as any,runtime as any,isOwner);
  const post=(token='private-token',data:any=body)=>app.request('/everyview/disney/publish',{method:'POST',headers:{'content-type':'application/json',...(token?{'x-admin-token':token}:{})},body:JSON.stringify(data)});
  return {app,post,submit,recover,runtime,dir,setAttempted:()=>{attempted=true;}};
}
describe('Everyview Disney publication admin route',()=>{
  it('rejects requests in a second process before it can access inventory or submit',async()=>{
    const f=fixture(()=>false);vi.stubEnv('EVERYVIEW_DISNEY_PUBLISH_ENABLED','true');
    const response=await f.post();expect(response.status).toBe(423);
    expect(await response.json()).toMatchObject({reason:'AIO_MAIN_PROCESS_REQUIRED'});
    expect(f.runtime).not.toHaveBeenCalled();expect(f.submit).not.toHaveBeenCalled();
  });
  it('requires admin authentication and defaults to disabled without constructing runtime',async()=>{
    const f=fixture();vi.stubEnv('EVERYVIEW_DISNEY_PUBLISH_ENABLED','');
    expect((await f.post('wrong')).status).toBe(403);expect((await f.post('')).status).toBe(403);
    const res=await f.post();expect(res.status).toBe(423);expect(await res.json()).toMatchObject({reason:'PAUSED'});
    expect(f.runtime).not.toHaveBeenCalled();expect(f.submit).not.toHaveBeenCalled();
  });
  it('blocks active or malformed safety mode before inspecting or submitting',async()=>{
    const f=fixture();vi.stubEnv('EVERYVIEW_DISNEY_PUBLISH_ENABLED','true');
    writeFileSync(join(f.dir,'safe.json'),JSON.stringify({enabled:true}));expect((await f.post()).status).toBe(423);
    writeFileSync(join(f.dir,'safe.json'),'{');expect((await f.post()).status).toBe(423);
    expect(f.runtime).not.toHaveBeenCalled();expect(f.submit).not.toHaveBeenCalled();
  });
  it('keeps all unproven workers false and refuses publication without logging private input',async()=>{
    const f=fixture();vi.stubEnv('EVERYVIEW_DISNEY_PUBLISH_ENABLED','true');
    expect(await everyviewDisneyPublicationReadiness()).toEqual({syncReady:false,cutoffReady:false,profileDeliveryReady:false});
    const log=vi.spyOn(console,'log'),err=vi.spyOn(console,'error');
    const response=await f.post();expect(response.status).toBe(409);const result=await response.json();
    expect(result).toMatchObject({state:'held',reason:'PREFLIGHT_UNCONFIRMED'});
    expect(JSON.stringify(result)).not.toContain(body.accountEmail);expect(f.submit).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();expect(err).not.toHaveBeenCalled();log.mockRestore();err.mockRestore();
  });
  it('allows lookup-only recovery for uncertain attempts, never a second POST',async()=>{
    const f=fixture();vi.stubEnv('EVERYVIEW_DISNEY_PUBLISH_ENABLED','true');f.setAttempted();
    const response=await f.post();expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({reason:'SUBMISSION_UNCONFIRMED'});
    expect(f.recover).toHaveBeenCalledOnce();expect(f.submit).not.toHaveBeenCalled();
  });
  it('rejects invalid input and never returns internal errors or private values',async()=>{
    const f=fixture();vi.stubEnv('EVERYVIEW_DISNEY_PUBLISH_ENABLED','true');
    expect((await f.post('private-token',{...body,profileNumber:5})).status).toBe(400);
    expect((await f.post('private-token',{...body,description:'a'.repeat(5000)})).status).toBe(400);
    expect(f.runtime).not.toHaveBeenCalled();
  });
});
