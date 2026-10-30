import { existsSync,readFileSync,statSync } from 'node:fs';
import { sendSellerAlert } from '../alerts/telegram';
import { fetchEveryviewHostParties,fetchEveryviewPartyDetail,loadEveryviewCookieHeader } from '../lib/everyview-api';
import { disneyEveryviewAccountKey } from '../lib/gbuts-disney-everyview';
import { readGbutsOttStore,withGbutsOttInventory,writeGbutsOttStore } from '../lib/gbuts-ott-store';
import { writeJsonAtomic } from '../lib/graytag-sales-session';
import { markDisneyWorker } from '../lib/everyview-disney-worker-health';
import type { GbutsOttStore } from '../lib/gbuts-ott';
import { readEveryviewDisneyCutoffConfig,type EveryviewDisneyCutoffConfig } from './everyview-disney-cutoff';
import { readEveryviewDisneyInventoryConfig,type EveryviewDisneyInventoryConfig } from './everyview-disney-inventory-runtime';
import { readEveryviewDisneyPublishJournal,additionalInfo,type EveryviewDisneyPublishJournal } from './everyview-disney-publish';
import { identifyCorrelatedDisneySubmission,confirmDisneyCorrelatedSubmission,type DisneyCorrelatedStore } from '../lib/everyview-disney-correlated-intent';
import { correlatedOwnedPartyReader,correlatedSavedTitleReader } from '../lib/everyview-disney-correlation-reader';
import { readEveryviewDisneyPublicationProof } from '../lib/everyview-disney-publish-evidence';
import type { GbutsOttRuntimeDependencies } from './gbuts-ott-sync';
import { isAioDashboardMainProcess } from '../lib/aio-main-process';

/** Durable private intent, written before any attempted external submission. */
export interface DisneyRecoveryIntent { accountEmail:string;accountEndDate:string;profileNumber:6 }
export interface DisneyRecoveryIntents { version:1;enabled:boolean;accounts:Record<string,DisneyRecoveryIntent> }
export interface DisneyRecoveryDeps {
  intents():DisneyRecoveryIntents|null; journal():EveryviewDisneyPublishJournal;
  cutoff():EveryviewDisneyCutoffConfig|null; inventoryConfig():EveryviewDisneyInventoryConfig|null;
  writeCutoff(c:EveryviewDisneyCutoffConfig):void; writeInventoryConfig(c:EveryviewDisneyInventoryConfig):void;
  withInventory<T>(work:()=>Promise<T>):Promise<T>;readInventory():GbutsOttStore;writeInventory(store:GbutsOttStore):void;
  verifyBinding(partyId:number,intent:DisneyRecoveryIntent):Promise<boolean>;
  /** GET-only diagnostic; it must not infer identity or create/retry a party. */
  inspectUnknownSubmission():Promise<void>;
  /** Optional provider read-only correlation; must verify exact title, account and terms. */
  resolveCorrelated?(store:DisneyCorrelatedStore,accountHash:string,intent:DisneyRecoveryIntent):Promise<number|null>;
  safeToRun():boolean;alert(code:string):Promise<unknown>;now():Date;
}
const hash=(s:string)=>disneyEveryviewAccountKey(s), id=(n:unknown)=>Number.isSafeInteger(n)&&Number(n)>0;
const norm=(s:string)=>s.trim().toLowerCase();
const intentsPath=()=>process.env.EVERYVIEW_DISNEY_INTENTS_PATH||'/home/ubuntu/.config/gbuts/everyview-disney-intents.json';
const cutoffPath=()=>process.env.EVERYVIEW_DISNEY_CUTOFF_CONFIG_PATH||'/home/ubuntu/.config/gbuts/everyview-disney-cutoff.json';
const inventoryPath=()=>process.env.EVERYVIEW_DISNEY_INVENTORY_CONFIG_PATH||'/home/ubuntu/.config/gbuts/everyview-disney-inventory.json';
const privateJson=(p:string):unknown=>{if(statSync(p).mode&0o077)throw Error('PRIVATE_FILE_REQUIRED');return JSON.parse(readFileSync(p,'utf8'));};
export function readDisneyRecoveryIntents():DisneyRecoveryIntents|null {
  const p=intentsPath();if(!existsSync(p))return null;const c=privateJson(p) as DisneyRecoveryIntents;
  if(!c||c.version!==1||typeof c.enabled!=='boolean'||!c.accounts||typeof c.accounts!=='object'||Array.isArray(c.accounts)
    ||Object.entries(c.accounts).some(([k,v])=>!v||typeof v.accountEmail!=='string'||!(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.accountEmail))
      ||hash(v.accountEmail)!==k||v.profileNumber!==6||typeof v.accountEndDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v.accountEndDate)
      ||!Number.isFinite(Date.parse(v.accountEndDate))||new Date(v.accountEndDate).toISOString().slice(0,10)!==v.accountEndDate))
    throw Error('RECOVERY_INTENTS_INVALID');
  return c;
}

/** Read-only provider capabilities: official create form does not prove hidden creation. */
export function maySubmitWithoutUnmonitoredExposure(proof:{hiddenOnCreateVerified:boolean;monitorArmedBeforeVisibility:boolean}):boolean {
  return proof.hiddenOnCreateVerified===true&&proof.monitorArmedBeforeVisibility===true;
}

/**
 * Runs only in the AIO process under its inventory lock. An attempted create
 * without a persisted provider ID cannot be identified safely from timing or
 * a similar listing: inspect read-only and leave it held, never re-submit.
 * Known IDs are verified against the owned provider account, then missing
 * monitoring entries are added idempotently; no provider writes occur here.
 * This reduces restart recovery time but cannot prevent the exposure window
 * if the provider creates visible listings before returning an ID.
 */
export async function recoverDisneyMonitoring(deps:DisneyRecoveryDeps):Promise<'paused'|'checked'|'held'> {
  if(!deps.safeToRun())return 'paused';
  const explicit=deps.intents();if(explicit&&!explicit.enabled)return 'paused';
  const startupStore=deps.readInventory() as DisneyCorrelatedStore;
  const accounts:Record<string,DisneyRecoveryIntent>={...(explicit?.accounts||{})};
  for(const [key,record] of Object.entries(startupStore.everyviewDisneyIntents||{})){
    const emails=[...new Set(Object.values(startupStore.listings).filter(l=>l.serviceType==='디즈니플러스'&&hash(l.accountEmail)===key).map(l=>norm(l.accountEmail)))];
    if(!accounts[key]&&emails.length===1)accounts[key]={accountEmail:emails[0],accountEndDate:record.accountEndDate,profileNumber:6};
  }
  const intents:DisneyRecoveryIntents={version:1,enabled:true,accounts};
  if(!Object.keys(accounts).length)return 'paused';
  const original=JSON.stringify(explicit);const j=deps.journal();let held=false,unknown=false;
  // A crash after the single atomic inventory write but before the legacy
  // journal write must still be recoverable without issuing a second POST.
  for(const [key,record] of Object.entries(startupStore.everyviewDisneyIntents||{}))if(!j.records[key]){
    if(record.state==='prepared')continue;
    j.records[key]={state:record.state==='confirmed'?'confirmed':'attempted',accountHash:key,accountEndDate:record.accountEndDate,
      profileNumber:6,attemptedAt:record.attemptedAt||record.preparedAt,...(record.partyId?{partyId:record.partyId}:{}),
      ...(record.state==='confirmed'&&record.confirmedAt?{confirmedAt:record.confirmedAt}:{})};
  }
  for(const [accountHash,record] of Object.entries(j.records)) {
    if(record.partyId && startupStore.retiredEveryviewPartyIds?.includes(record.partyId)) continue;
    const intent=intents.accounts[accountHash];
    if(!intent||hash(intent.accountEmail)!==accountHash||record.accountHash!==accountHash
      ||record.accountEndDate!==intent.accountEndDate||record.profileNumber!==6){held=true;continue;}
    let partyId=record.partyId;
    const correlated=startupStore.everyviewDisneyIntents?.[accountHash];
    if(!id(partyId)&&correlated?.state==='confirmed'&&id(correlated.partyId))partyId=correlated.partyId;
    if(correlated?.state==='attempted'){
      const verified=deps.resolveCorrelated?await deps.resolveCorrelated(startupStore,accountHash,intent).catch(()=>null):null;
      if(!id(verified)||(id(partyId)&&partyId!==verified)){unknown=true;held=true;continue;}
      partyId=verified;
    }
    if(!id(partyId)){unknown=true;held=true;continue;}
    const recoveredId=partyId;
    if(!await deps.verifyBinding(recoveredId,intent).catch(()=>false)){held=true;continue;}
    const verifiedAt=deps.now().getTime();
    const success=await deps.withInventory(async()=>{
      const verificationAge=deps.now().getTime()-verifiedAt;
      if(!deps.safeToRun()||JSON.stringify(deps.intents())!==original||!Number.isFinite(verificationAge)
        ||verificationAge<0||verificationAge>30_000)return false;
      const cutoff=deps.cutoff(),config=deps.inventoryConfig(),store=deps.readInventory();
      if(!cutoff?.enabled||!config?.enabled)return false;
      const mapping=store.disneyEveryview?.[accountHash];
      if(!mapping||mapping.accountCapacity!==6||!Array.isArray(mapping.partyIds)
        ||(mapping.partyIds.length!==0&&(mapping.partyIds.length!==1||mapping.partyIds[0]!==recoveredId)))return false;
      const liveCorrelated=(store as DisneyCorrelatedStore).everyviewDisneyIntents?.[accountHash];
      if(correlated&&(!liveCorrelated||liveCorrelated.requestCode!==correlated.requestCode||liveCorrelated.title!==correlated.title
        ||(liveCorrelated.state==='confirmed'&&liveCorrelated.partyId!==recoveredId)))return false;
      const oldCutoff=cutoff.parties.filter(p=>p.partyId===recoveredId), oldInventory=config.parties.filter(p=>p.partyId===recoveredId);
      if(oldCutoff.length>1||oldInventory.length>1
        ||oldCutoff.some(p=>norm(p.accountEmail)!==norm(intent.accountEmail)||p.accountEndDate!==intent.accountEndDate||p.usageDays!==30||!p.enabled)
        ||oldInventory.some(p=>norm(p.accountEmail)!==norm(intent.accountEmail)||p.profileNumber!==6)
        ||config.parties.some(p=>p.partyId!==recoveredId&&norm(p.accountEmail)===norm(intent.accountEmail)&&p.profileNumber===6))return false;
      if(mapping.partyIds.length===0){
        if(liveCorrelated?.state==='attempted')deps.writeInventory(confirmDisneyCorrelatedSubmission(store as DisneyCorrelatedStore,accountHash,recoveredId,deps.now()));
        else {mapping.partyIds=[recoveredId];mapping.snapshots[String(recoveredId)]={source:`everyview:${recoveredId}`,complete:false,verifiedAt:deps.now().toISOString(),
          advertisedVacancies:1,claims:[{id:`dedicated_${recoveredId}_6`,kind:'advertised',state:'unknown',profileNumber:6}]};deps.writeInventory(store);}
      }
      if(!deps.safeToRun()||JSON.stringify(deps.intents())!==original)return false;
      if(!oldCutoff.length){cutoff.parties.push({partyId:recoveredId,accountEmail:intent.accountEmail,accountEndDate:intent.accountEndDate,usageDays:30,enabled:true});deps.writeCutoff(cutoff);}
      if(!oldInventory.length){config.parties.push({partyId:recoveredId,accountEmail:intent.accountEmail,profileNumber:6});deps.writeInventoryConfig(config);}
      const verifyCutoff=deps.cutoff(),verifyInventory=deps.inventoryConfig();
      return !!verifyCutoff?.enabled&&!!verifyInventory?.enabled
        &&verifyCutoff.parties.some(p=>p.partyId===recoveredId&&norm(p.accountEmail)===norm(intent.accountEmail)&&p.accountEndDate===intent.accountEndDate&&p.usageDays===30&&p.enabled)
        &&verifyInventory.parties.some(p=>p.partyId===recoveredId&&norm(p.accountEmail)===norm(intent.accountEmail)&&p.profileNumber===6);
    }).catch(()=>false);
    if(!success)held=true;
  }
  if(unknown)await deps.inspectUnknownSubmission().catch(()=>undefined);
  if(held)await deps.alert(unknown?'SUBMISSION_UNCONFIRMED':'MONITOR_REGISTRATION_UNCONFIRMED').catch(()=>undefined);
  return held?'held':'checked';
}

export function disneyMonitoringRecoveryDependencies(gbuts?:GbutsOttRuntimeDependencies):DisneyRecoveryDeps {
  const now=()=>new Date();
  const safeToRun=()=>{
    if(!isAioDashboardMainProcess()||process.env.EVERYVIEW_DISNEY_RECOVERY_ENABLED!=='true'||process.env.EVERYVIEW_DISNEY_CUTOFF_ENABLED!=='true'
      ||process.env.EVERYVIEW_DISNEY_INVENTORY_ENABLED!=='true')return false;
    const p=process.env.SAFE_MODE_PATH||'/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data/safe-mode.json';
    if(!existsSync(p))return true;const data=JSON.parse(readFileSync(p,'utf8')) as {enabled?:unknown};
    if(!data||typeof data.enabled!=='boolean')throw Error('SAFE_MODE_INVALID');return !data.enabled;
  };
  return {intents:readDisneyRecoveryIntents,journal:readEveryviewDisneyPublishJournal,
    cutoff:readEveryviewDisneyCutoffConfig,inventoryConfig:readEveryviewDisneyInventoryConfig,
    writeCutoff:c=>writeJsonAtomic(cutoffPath(),c),writeInventoryConfig:c=>writeJsonAtomic(inventoryPath(),c),
    withInventory:withGbutsOttInventory,readInventory:readGbutsOttStore,writeInventory:writeGbutsOttStore,
    verifyBinding:async(partyId,intent)=>{const cookie=loadEveryviewCookieHeader();if(!cookie)return false;
      const matches=(await fetchEveryviewHostParties(cookie)).filter(p=>p.partyType==='free'&&p.partyId===partyId);
      if(matches.length!==1)return false;const d=await fetchEveryviewPartyDetail(cookie,partyId);
      return !!d.hostName&&/디즈니|disney/i.test(d.serviceName||'')&&d.loginInfo.length===1&&d.loginInfo[0].shareType==='ACCOUNT'
        &&norm(d.loginInfo[0].accountId||'')===norm(intent.accountEmail)&&/(?<!\d)6\s*번\s*프로필/.test(d.loginInfo[0].additionalInfo||'');},
    // Official create API exposes no persisted correlation token. A GET can
    // establish connectivity but cannot turn a similar-looking party into the
    // unique result of our submitted request.
    inspectUnknownSubmission:async()=>{const cookie=loadEveryviewCookieHeader();if(cookie)await fetchEveryviewHostParties(cookie);},
    resolveCorrelated:async(store,key,intent)=>{
      const cookie=loadEveryviewCookieHeader();if(!cookie||!gbuts?.listingCredentials)return null;
      const listings=Object.values(store.listings).filter(l=>l.serviceType==='디즈니플러스'&&hash(l.accountEmail)===key
        &&l.state==='registered'&&l.deliveryMode==='disney-numbered-password'&&!l.replacedBy&&l.postSeq);
      if(listings.length!==1)return null;
      const credentials=await gbuts.listingCredentials(listings[0]);
      const notice=additionalInfo(credentials);if(!notice||norm(credentials.id)!==norm(intent.accountEmail))return null;
      const snapshot=await correlatedOwnedPartyReader(()=>cookie)(),savedTitle=correlatedSavedTitleReader(()=>cookie);
      const result=await identifyCorrelatedDisneySubmission({store,key,accountEmail:intent.accountEmail,current:snapshot,now:now(),
        verify:async partyId=>{const [title,proof]=await Promise.all([savedTitle(partyId),readEveryviewDisneyPublicationProof(cookie,partyId,intent.accountEmail,
          {additionalInfo:notice,password:credentials.password})]);return title&&proof?{title,proof}:null;}});
      return result.state==='confirmed'?result.partyId:null;
    },
    safeToRun,alert:code=>sendSellerAlert({category:'system',attention:'action-required',key:`everyview-disney-recovery:${code}`,
      title:'에브리뷰 디즈니 판매 연결 확인 필요',body:'발행 결과 또는 자리·기간 감시 연결을 확정하지 못했습니다. 자동 재발행하지 않습니다.',
      nextAction:'에브리뷰 판매글과 계정별 감시 설정을 확인해주세요.',throttleMs:30*60_000}),now};
}
export function startDisneyMonitoringRecovery(deps:DisneyRecoveryDeps,intervalMs=30_000):()=>void {
  let running=false,stopped=false;markDisneyWorker('recovery','starting');const run=()=>{if(running)return;running=true;void recoverDisneyMonitoring(deps)
    .then(state=>{if(!stopped)markDisneyWorker('recovery',state);})
    .catch(()=>{if(!stopped)markDisneyWorker('recovery','error');return deps.alert('RECOVERY_FAILED').catch(()=>undefined);}).finally(()=>{running=false;});};
  const first=setTimeout(run,1_000),timer=setInterval(run,intervalMs);first.unref();timer.unref();
  return()=>{stopped=true;clearTimeout(first);clearInterval(timer);markDisneyWorker('recovery','stopped');};
}
export function startDisneyMonitoringRecoveryFromEnv(factory=disneyMonitoringRecoveryDependencies):(()=>void)|undefined {
  if(process.env.EVERYVIEW_DISNEY_RECOVERY_ENABLED!=='true')return undefined;
  return startDisneyMonitoringRecovery(factory());
}
