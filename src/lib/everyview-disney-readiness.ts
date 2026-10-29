import { disneyEveryviewAccountKey } from './gbuts-disney-everyview';
import { isAioDashboardMainProcess } from './aio-main-process';
import { readDisneyRecoveryIntents, type DisneyRecoveryIntents } from '../scheduler/everyview-disney-startup-recovery';
import { readEveryviewDisneyInventoryConfig, readEveryviewDisneyInventoryStatus,
  type EveryviewDisneyInventoryConfig, type EveryviewDisneyInventoryStatus } from '../scheduler/everyview-disney-inventory-runtime';
import { readEveryviewDisneyCutoffConfig, type EveryviewDisneyCutoffConfig } from '../scheduler/everyview-disney-cutoff';
import { additionalInfo, readEveryviewDisneyPublishJournal, type EveryviewDisneyPublishJournal, type EveryviewDisneyPublishRequest } from '../scheduler/everyview-disney-publish';
import { readGbutsOttStore } from './gbuts-ott-store';
import type { GbutsOttStore } from './gbuts-ott';
import type { GbutsOttRuntimeDependencies } from '../scheduler/gbuts-ott-sync';
import { disneyWorkerHealthy, type DisneyWorkerKind } from './everyview-disney-worker-health';

export interface DisneyReadinessDependencies {
  flags(): { inventory:boolean; cutoff:boolean; recovery:boolean };
  owner(): boolean;
  healthy(kind:DisneyWorkerKind):boolean;
  notificationReady():Promise<boolean>;
  profileDeliveryPrepared(request:EveryviewDisneyPublishRequest):Promise<boolean>;
  intents(): DisneyRecoveryIntents|null;
  inventoryConfig(): EveryviewDisneyInventoryConfig|null;
  inventoryStatus(): EveryviewDisneyInventoryStatus;
  cutoffConfig(): EveryviewDisneyCutoffConfig|null;
  journal(): EveryviewDisneyPublishJournal;
  store(): GbutsOttStore;
  now(): Date;
}
export interface DisneyReadinessInspection {
  syncReady:boolean; cutoffReady:boolean; profileDeliveryReady:boolean;
  /** Metadata only. Neither account IDs nor account hashes leave this function. */
  diagnostics:{ owner:boolean;workerFlags:boolean;intentValid:boolean;monitorConfigsBound:boolean;freshInventory:boolean;
    hiddenCreateVerified:false;previsibilityMonitoringVerified:false;cutoffWorkerHealthVerified:boolean;profileDeliveryVerified:boolean;
    alertVerified:boolean;recoveryWorkerHealthy:boolean;inventoryWorkerHealthy:boolean;boundedRecoveryArmed:boolean };
}
const norm=(s:string)=>s.trim().toLowerCase();
const validAge=(s:string|undefined,now:Date)=>{const n=Date.parse(s||''),t=now.getTime();return Number.isFinite(n)&&Number.isFinite(t)&&n<=t&&t-n<=120_000;};

/**
 * Inspect current flags and private, durable configuration for a requested
 * account. A live, responsive worker and a pre-armed recovery intent can allow
 * publication even though there is a bounded provider exposure window. The
 * provider has no cross-marketplace atomic transaction; do not claim otherwise.
 */
export async function inspectDisneyPublicationReadiness(request:EveryviewDisneyPublishRequest,deps:DisneyReadinessDependencies):Promise<DisneyReadinessInspection> {
  const diagnostics:DisneyReadinessInspection['diagnostics']={owner:false,workerFlags:false,intentValid:false,monitorConfigsBound:false,freshInventory:false,
    hiddenCreateVerified:false,previsibilityMonitoringVerified:false,cutoffWorkerHealthVerified:false,profileDeliveryVerified:false,
    alertVerified:false,recoveryWorkerHealthy:false,inventoryWorkerHealthy:false,boundedRecoveryArmed:false};
  try {
    if(!request || typeof request.accountEmail!=='string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(request.accountEmail)
      || request.profileNumber!==6 || typeof request.accountEndDate!=='string')return {syncReady:false,cutoffReady:false,profileDeliveryReady:false,diagnostics};
    const key=disneyEveryviewAccountKey(request.accountEmail),flags=deps.flags();diagnostics.owner=deps.owner()===true;
    diagnostics.workerFlags=flags.inventory===true&&flags.cutoff===true&&flags.recovery===true;
    const intents=deps.intents(),intent=intents?.accounts?.[key];
    diagnostics.intentValid=!!intents?.enabled&&!!intent&&norm(intent.accountEmail)===norm(request.accountEmail)
      &&intent.accountEndDate===request.accountEndDate&&intent.profileNumber===6;
    const ic=deps.inventoryConfig(),cc=deps.cutoffConfig();
    diagnostics.inventoryWorkerHealthy=deps.healthy('inventory')===true;
    diagnostics.cutoffWorkerHealthVerified=deps.healthy('cutoff')===true;
    diagnostics.recoveryWorkerHealthy=deps.healthy('recovery')===true;
    diagnostics.alertVerified=await deps.notificationReady().catch(()=>false);
    diagnostics.profileDeliveryVerified=await deps.profileDeliveryPrepared(request).catch(()=>false);
    // An enabled empty config pre-arms an idle worker; the recovery intent binds
    // the account until the newly created party ID can be attached.
    const armed=!!ic?.enabled&&!!cc?.enabled&&diagnostics.intentValid&&diagnostics.owner&&diagnostics.workerFlags
      &&diagnostics.inventoryWorkerHealthy&&diagnostics.cutoffWorkerHealthVerified&&diagnostics.recoveryWorkerHealthy&&diagnostics.alertVerified;
    diagnostics.boundedRecoveryArmed=armed;
    const journal=deps.journal(),record=journal.records[key],id=record?.partyId;
    if(!Number.isSafeInteger(id)||Number(id)<1||record?.accountHash!==key||record.accountEndDate!==request.accountEndDate)
      return {syncReady:armed,cutoffReady:armed,profileDeliveryReady:armed&&diagnostics.profileDeliveryVerified,diagnostics};
    const inventoryMatches=ic?.parties.filter(p=>p.partyId===id)||[],cutoffMatches=cc?.parties.filter(p=>p.partyId===id)||[];
    diagnostics.monitorConfigsBound=!!ic?.enabled&&!!cc?.enabled&&inventoryMatches.length===1&&cutoffMatches.length===1
      &&norm(inventoryMatches[0].accountEmail)===norm(request.accountEmail)&&inventoryMatches[0].profileNumber===6
      &&norm(cutoffMatches[0].accountEmail)===norm(request.accountEmail)&&cutoffMatches[0].accountEndDate===request.accountEndDate
      &&cutoffMatches[0].usageDays===30&&cutoffMatches[0].enabled===true;
    const status=deps.inventoryStatus(),watched=status.watch.parties[String(id)],mapping=deps.store().disneyEveryview?.[key],snapshot=mapping?.snapshots?.[String(id)];
    diagnostics.freshInventory=!!status&&status.state==='checked'&&validAge(status.checkedAt,deps.now())
      &&!status.watch.lastError&&!status.partyErrors?.[String(id)]&&!!watched&&watched.accountHash===key&&validAge(watched.observedAt,deps.now())
      &&!!mapping&&mapping.accountCapacity===6&&mapping.partyIds.length===1&&mapping.partyIds[0]===id
      &&!!snapshot&&snapshot.complete===true&&snapshot.source===`everyview:${id}`&&validAge(snapshot.verifiedAt,deps.now());
  } catch { /* Any malformed, missing or publicly accessible private file is unready. */ }
  const ready=diagnostics.boundedRecoveryArmed&&diagnostics.monitorConfigsBound&&diagnostics.freshInventory;
  return {syncReady:ready,cutoffReady:ready,profileDeliveryReady:ready&&diagnostics.profileDeliveryVerified,diagnostics};
}

export function disneyReadinessRuntimeDependencies(gbuts?:GbutsOttRuntimeDependencies):DisneyReadinessDependencies {
  return {flags:()=>({inventory:process.env.EVERYVIEW_DISNEY_INVENTORY_ENABLED==='true',cutoff:process.env.EVERYVIEW_DISNEY_CUTOFF_ENABLED==='true',
    recovery:process.env.EVERYVIEW_DISNEY_RECOVERY_ENABLED==='true'}),owner:isAioDashboardMainProcess,healthy:disneyWorkerHealthy,
    notificationReady:async()=>{const token=process.env.SELLER_ALERT_TELEGRAM_BOT_TOKEN?.trim(),chat=process.env.SELLER_ALERT_TELEGRAM_CHAT_ID?.trim();
      if(!token||!chat||!/^\-?\d+$/.test(chat))return false;
      try{const res=await fetch(`https://api.telegram.org/bot${token}/getChat`,{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({chat_id:chat}),signal:AbortSignal.timeout(8_000)});const body=await res.json() as any;
        return res.ok&&body?.ok===true&&String(body?.result?.id)===chat;}catch{return false;}},
    profileDeliveryPrepared:async request=>{if(!gbuts?.listingCredentials)return false;
      const key=disneyEveryviewAccountKey(request.accountEmail),matches=Object.values(readGbutsOttStore().listings)
        .filter(l=>l.serviceType==='디즈니플러스'&&disneyEveryviewAccountKey(l.accountEmail)===key&&l.state==='registered'
          &&l.deliveryMode==='disney-numbered-password'&&!l.replacedBy&&!!l.postSeq);
      if(matches.length!==1)return false;const c=await gbuts.listingCredentials(matches[0]);
      return norm(c.id)===norm(request.accountEmail)&&!!c.password&&!!additionalInfo(c);},intents:readDisneyRecoveryIntents,
    inventoryConfig:readEveryviewDisneyInventoryConfig,inventoryStatus:readEveryviewDisneyInventoryStatus,
    cutoffConfig:readEveryviewDisneyCutoffConfig,journal:readEveryviewDisneyPublishJournal,store:readGbutsOttStore,now:()=>new Date()};
}
