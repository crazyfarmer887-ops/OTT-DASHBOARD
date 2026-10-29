import { existsSync,readFileSync,statSync } from 'node:fs';
import { sendSellerAlert } from '../alerts/telegram';
import { checkEveryviewSession, loadEveryviewCookieHeader } from '../lib/everyview-api';
import { collectEveryviewDisneyObservation } from '../lib/everyview-disney-observation';
import { everyviewDedicatedEvidenceReader } from '../lib/everyview-disney-evidence';
import { readGbutsOttStore,withGbutsOttInventory,writeGbutsOttStore } from '../lib/gbuts-ott-store';
import { writeJsonAtomic } from '../lib/graytag-sales-session';
import { markDisneyWorker } from '../lib/everyview-disney-worker-health';
import { runEveryviewDisneyObservation,type EveryviewDisneyWatchState,type EveryviewDisneyWatchDeps } from './everyview-disney-observation';
import { runDisneyDedicatedBridge,type DisneyDedicatedBridgeDeps } from './everyview-disney-inventory-bridge';

export interface EveryviewDisneyInventoryParty { partyId:number;accountEmail:string;profileNumber:number }
export interface EveryviewDisneyInventoryConfig { version:1;enabled:boolean;parties:EveryviewDisneyInventoryParty[] }
export interface EveryviewDisneyInventoryStatus {
  version:1;state:'waiting'|'checked'|'held'|'error';checkedAt?:string;watch:EveryviewDisneyWatchState;
  /** Sanitized status only; failure of one party never marks another as healthy. */
  partyErrors?:Record<string,string>;
}
const configPath=()=>process.env.EVERYVIEW_DISNEY_INVENTORY_CONFIG_PATH||'/home/ubuntu/.config/gbuts/everyview-disney-inventory.json';
const statusPath=()=>process.env.EVERYVIEW_DISNEY_INVENTORY_STATUS_PATH||'/home/ubuntu/.config/gbuts/everyview-disney-inventory-status.json';
const privateJson=(path:string):unknown=>{if(statSync(path).mode&0o077)throw Error('PRIVATE_FILE_REQUIRED');return JSON.parse(readFileSync(path,'utf8'));};
const id=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>0;
const validIso=(value:unknown)=>typeof value==='string'&&Number.isFinite(Date.parse(value));

export function readEveryviewDisneyInventoryConfig():EveryviewDisneyInventoryConfig|null {
  const path=configPath();if(!existsSync(path))return null;
  const config=privateJson(path) as EveryviewDisneyInventoryConfig;
  if(!config||config.version!==1||typeof config.enabled!=='boolean'||!Array.isArray(config.parties)
    ||config.parties.some(p=>!p||!id(p.partyId)||typeof p.accountEmail!=='string'
      ||!(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.accountEmail.trim()))||!Number.isInteger(p.profileNumber)||p.profileNumber<1||p.profileNumber>6)
    ||new Set(config.parties.map(p=>p.partyId)).size!==config.parties.length
    ||new Set(config.parties.map(p=>`${p.accountEmail.trim().toLowerCase()}:${p.profileNumber}`)).size!==config.parties.length)
    throw Error('INVENTORY_CONFIG_INVALID');
  return config;
}
export function readEveryviewDisneyInventoryStatus():EveryviewDisneyInventoryStatus {
  const path=statusPath();if(!existsSync(path))return {version:1,state:'waiting',watch:{version:1,parties:{}}};
  const status=privateJson(path) as EveryviewDisneyInventoryStatus,w=status?.watch;
  if(!status||status.version!==1||!['waiting','checked','held','error'].includes(status.state)
    ||(status.checkedAt!==undefined&&!validIso(status.checkedAt))||!w||w.version!==1||!w.parties||typeof w.parties!=='object'||Array.isArray(w.parties)
    ||(status.partyErrors!==undefined&&(!status.partyErrors||typeof status.partyErrors!=='object'||Array.isArray(status.partyErrors)
      ||Object.entries(status.partyErrors).some(([key,value])=>!id(Number(key))||String(Number(key))!==key
        ||typeof value!=='string'||!/^[A-Z_]{1,80}$/.test(value))))
    ||(w.lastSuccess!==undefined&&!validIso(w.lastSuccess))
    ||(w.lastError!==undefined&&!['SESSION_REQUIRED','PARTY_READ_UNAVAILABLE','PARTY_BINDING_UNVERIFIED','ROSTER_INCOMPLETE','OBSERVATION_FAILED'].includes(w.lastError))
    ||Object.entries(w.parties).some(([partyId,p])=>!id(Number(partyId))||String(Number(partyId))!==partyId||!p||!/^[a-f0-9]{64}$/.test(p.accountHash)
      ||!validIso(p.observedAt)||!Number.isSafeInteger(p.visibleEmptySlots)||p.visibleEmptySlots<0||!p.members||typeof p.members!=='object'||Array.isArray(p.members)
      ||Object.entries(p.members).some(([memberId,m])=>!id(Number(memberId))||String(Number(memberId))!==memberId||!m||!id(m.userSeq)
        ||!validIso(m.firstObservedAt)||!validIso(m.lastObservedAt)||typeof m.currentlyVisible!=='boolean')))
    throw Error('INVENTORY_STATUS_INVALID');
  return status;
}
function safeToRun():boolean {
  if(process.env.EVERYVIEW_DISNEY_INVENTORY_ENABLED!=='true')return false;
  const path=process.env.SAFE_MODE_PATH||'/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data/safe-mode.json';
  if(!existsSync(path))return true;
  const s=JSON.parse(readFileSync(path,'utf8')) as {enabled?:unknown};
  if(!s||typeof s.enabled!=='boolean')throw Error('SAFE_MODE_INVALID');return !s.enabled;
}
const alert=async(code:string)=>sendSellerAlert({category:'system',attention:'action-required',key:`everyview-disney-inventory:${code}`,
  title:'에브리뷰 디즈니 자리 동기화 확인 필요',body:'구매자 또는 모집 자리 확인이 불완전해 관련 벗츠 자리 배정과 재등록을 보류합니다.',
  nextAction:'에브리뷰 로그인과 각 파티의 모집 및 구매자 상태를 확인해주세요.',throttleMs:30*60_000});

export interface EveryviewDisneyInventoryRuntimeDeps {
  observation:EveryviewDisneyWatchDeps;
  bridge:DisneyDedicatedBridgeDeps;
  readStatus():EveryviewDisneyInventoryStatus;
  writeStatus(value:EveryviewDisneyInventoryStatus):void;
  alert(code:string):Promise<unknown>;
  now():Date;
  /** Empty pre-armed monitoring must prove a usable session and no omitted mapped parties. */
  idleReady?():Promise<boolean>;
}
export function everyviewDisneyInventoryRuntimeDependencies():EveryviewDisneyInventoryRuntimeDeps {
  const config=readEveryviewDisneyInventoryConfig;
  const readStatus=readEveryviewDisneyInventoryStatus;
  const writeStatus=(value:EveryviewDisneyInventoryStatus)=>writeJsonAtomic(statusPath(),value);
  const getWatch=()=>readStatus().watch;
  const now=()=>new Date();
  const observation:EveryviewDisneyWatchDeps={config:()=>{const c=config();return c?{enabled:c.enabled,parties:c.parties}:null;},
    read:getWatch,write:watch=>writeStatus({...readStatus(),watch}),cookie:loadEveryviewCookieHeader,safeToRun,
    observe:collectEveryviewDisneyObservation,alert:reason=>alert(reason||'OBSERVATION_FAILED'),now};
  const evidence=everyviewDedicatedEvidenceReader(loadEveryviewCookieHeader,now);
  const bridge:DisneyDedicatedBridgeDeps={config:()=>{const c=config();return c?{enabled:c.enabled,bindings:c.parties}:null;},
    readWatch:getWatch,withInventory:withGbutsOttInventory,readInventory:readGbutsOttStore,writeInventory:writeGbutsOttStore,
    evidence:async(binding,watch)=>watch.lastError?undefined:evidence(binding,watch),safeToRun,alert:code=>alert(code),now};
  const idleReady=async()=>{const cookie=loadEveryviewCookieHeader();if(!cookie||!(await checkEveryviewSession(cookie)).valid)return false;
    return withGbutsOttInventory(async()=>!Object.values(readGbutsOttStore().disneyEveryview||{}).some(x=>Array.isArray(x.partyIds)&&x.partyIds.length>0));};
  return {observation,bridge,readStatus,writeStatus,alert,now,idleReady};
}

/** Observe first, then persist even failed observations as incomplete held snapshots. */
export async function runEveryviewDisneyInventoryRuntime(deps:EveryviewDisneyInventoryRuntimeDeps):Promise<'paused'|'checked'|'held'|'error'> {
  try {
    const watchConfig=deps.observation.config(),bridgeConfig=deps.bridge.config();
    if(!watchConfig?.enabled||!bridgeConfig?.enabled||!deps.observation.safeToRun()||!deps.bridge.safeToRun())return 'paused';
    const watchOriginal=JSON.stringify(watchConfig),bridgeOriginal=JSON.stringify(bridgeConfig);
    const active=()=>JSON.stringify(deps.observation.config())===watchOriginal&&JSON.stringify(deps.bridge.config())===bridgeOriginal
      &&deps.observation.safeToRun()&&deps.bridge.safeToRun();
    if(watchConfig.parties.length===0&&bridgeConfig.bindings.length===0){
      if(!deps.idleReady||!await deps.idleReady()||!active())throw Error('IDLE_MONITOR_UNVERIFIED');
      const status=deps.readStatus(),watch={...status.watch};delete watch.lastError;
      deps.writeStatus({...status,state:'checked',watch,partyErrors:{},checkedAt:deps.now().toISOString()});return 'checked';
    }
    if(watchConfig.parties.length!==bridgeConfig.bindings.length
      ||new Set(watchConfig.parties.map(p=>p.partyId)).size!==watchConfig.parties.length
      ||new Set(bridgeConfig.bindings.map(p=>p.partyId)).size!==bridgeConfig.bindings.length
      ||watchConfig.parties.some(p=>!bridgeConfig.bindings.some(b=>b.partyId===p.partyId&&b.accountEmail.trim().toLowerCase()===p.accountEmail.trim().toLowerCase())))
      throw Error('BINDING_INVALID');
    const partyErrors:Record<string,string>={};let state:'checked'|'held'|'error'='checked';
    for(const binding of watchConfig.parties){
      if(!active())return 'paused';
      const bridgeBinding=bridgeConfig.bindings.find(b=>b.partyId===binding.partyId)!;
      // Check and persist one account at a time. A slow/broken party cannot
      // discard the successful independent observations of the other four.
      const observation=await runEveryviewDisneyObservation({...deps.observation,
        config:()=>active()?{enabled:true,parties:[binding]}:null});
      if(observation==='paused'||!active())return 'paused';
      const bridge=await runDisneyDedicatedBridge({...deps.bridge,
        config:()=>active()?{enabled:true,bindings:[bridgeBinding]}:null});
      if(bridge==='paused'||!active())return 'paused';
      if(observation==='error'){
        partyErrors[String(binding.partyId)]=deps.readStatus().watch.lastError||'OBSERVATION_FAILED';state='error';
      }else if(bridge==='held'){
        partyErrors[String(binding.partyId)]='SNAPSHOT_INCOMPLETE';if(state!=='error')state='held';
      }
    }
    const status=deps.readStatus();
    // Retain an aggregate failure for operators even if the final individual
    // account succeeded and cleared the watch's temporary error field.
    const firstError=Object.values(partyErrors).find(x=>['SESSION_REQUIRED','PARTY_READ_UNAVAILABLE','PARTY_BINDING_UNVERIFIED','ROSTER_INCOMPLETE','OBSERVATION_FAILED'].includes(x));
    if(firstError)status.watch.lastError=firstError as EveryviewDisneyWatchState['lastError'];
    deps.writeStatus({...status,state,partyErrors,checkedAt:deps.now().toISOString()});return state;
  } catch {
    await deps.alert('INVENTORY_RUNTIME_FAILED').catch(()=>undefined);
    return 'error';
  }
}

export function startEveryviewDisneyInventory(deps:EveryviewDisneyInventoryRuntimeDeps,intervalMs=30_000):()=>void {
  let running=false,stopped=false;markDisneyWorker('inventory','starting');
  const run=()=>{if(running)return;running=true;void runEveryviewDisneyInventoryRuntime(deps)
    .then(state=>{if(!stopped)markDisneyWorker('inventory',state);})
    .catch(()=>{if(!stopped)markDisneyWorker('inventory','error');return deps.alert('INVENTORY_RUNTIME_FAILED').catch(()=>undefined);}).finally(()=>{running=false;});};
  const first=setTimeout(run,5_000),timer=setInterval(run,intervalMs);first.unref();timer.unref();
  return ()=>{stopped=true;clearTimeout(first);clearInterval(timer);markDisneyWorker('inventory','stopped');};
}
/** Environment flag defaults off; no config or marketplace action is created implicitly. */
export function startEveryviewDisneyInventoryFromEnv(factory=everyviewDisneyInventoryRuntimeDependencies):(()=>void)|undefined {
  if(process.env.EVERYVIEW_DISNEY_INVENTORY_ENABLED!=='true')return undefined;
  return startEveryviewDisneyInventory(factory());
}
