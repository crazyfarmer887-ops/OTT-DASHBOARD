import { randomBytes } from 'node:crypto';
import type { GbutsOttStore } from './gbuts-ott';
import type { EveryviewHostPartySummary } from './everyview-api';
import { disneyEveryviewAccountKey } from './gbuts-disney-everyview';
import type { EveryviewDisneyPublicationProof,EveryviewDisneyPublishPreflight } from '../scheduler/everyview-disney-publish';
import { everyviewRollingCutoff } from './everyview-recruitment-safety';

export interface DisneyCorrelatedIntent {
  accountHash:string;requestCode:string;title:string;accountEndDate:string;profileNumber:6;
  baselinePartyIds:number[];baselineCheckedAt:string;preparedAt:string;
  state:'prepared'|'attempted'|'confirmed';attemptedAt?:string;partyId?:number;confirmedAt?:string;
  /** Desired monitors are durable before POST; their individual runtime configs still need reconciliation. */
  monitors:{cutoffDays:30;profileNumber:6;enabled:true};
}
export type DisneyCorrelatedStore=GbutsOttStore&{everyviewDisneyIntents?:Record<string,DisneyCorrelatedIntent>};
export type OwnedPartySnapshot={parties:EveryviewHostPartySummary[];checkedAt:string;complete:boolean};
export type CorrelatedLookupResult={state:'confirmed';partyId:number}|{state:'held';reason:string};
const codeValid=(s:string)=>/^[A-F0-9]{12}$/.test(s);
const hashValid=(s:string)=>/^[a-f0-9]{64}$/.test(s);
const normTitle=(s:string)=>s.normalize('NFKC').replace(/\s+/g,' ').trim().toUpperCase();
const validId=(n:unknown):n is number=>Number.isSafeInteger(n)&&Number(n)>0;
const fresh=(stamp:string,now:Date,window=60_000)=>{const n=Date.parse(stamp),t=now.getTime();return Number.isFinite(n)&&Number.isFinite(t)&&n<=t&&t-n<=window;};
const matchCode=(title:string,code:string)=>normTitle(title).includes(`[${code}]`);

/** Code must be persisted before POST; do not place credentials in the title or intent. */
export function buildDisneyCorrelatedTitle(baseTitle:string,code=randomBytes(6).toString('hex').toUpperCase()):{title:string;code:string} {
  const base=baseTitle.trim().replace(/\s+/g,' ');
  if(!base||!codeValid(code)||base.includes('[')||base.includes(']'))throw Error('TITLE_INVALID');
  const title=`${base} [${code}]`;
  if(title.length>25)throw Error('TITLE_TOO_LONG');
  return {title,code};
}

/**
 * Caller must hold the AIO shared inventory lock and atomically persist the
 * returned whole store before beginning POST. The slot reservation, baseline,
 * and desired monitors are written together in one durable store update.
 */
export function prepareDisneyCorrelatedIntent(input:{store:DisneyCorrelatedStore;accountEmail:string;accountEndDate:string;
  baseTitle:string;code:string;baseline:OwnedPartySnapshot;preflight:EveryviewDisneyPublishPreflight;now:Date}):{store:DisneyCorrelatedStore;intent:DisneyCorrelatedIntent} {
  const {store,accountEmail,accountEndDate,baseTitle,code,baseline,preflight,now}=input;
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(accountEmail)||!codeValid(code)||!baseline?.complete||!Array.isArray(baseline.parties)
    ||!fresh(baseline.checkedAt,now)||!fresh(preflight?.verifiedAt,now))throw Error('INTENT_EVIDENCE_INVALID');
  const key=disneyEveryviewAccountKey(accountEmail);
  if(preflight.accountHash!==key||preflight.accountEndDate!==accountEndDate||preflight.accountCapacity!==6||preflight.committedOtherPlaces!==5
    ||!preflight.profile6Available||!preflight.otherSourcesComplete||!preflight.currentAdvertisementsReserved||!preflight.syncReady
    ||!preflight.cutoffReady||!preflight.profileDeliveryReady||!preflight.credentialsValidated
    ||everyviewRollingCutoff(accountEndDate,30,now).state!=='open')throw Error('INTENT_PREFLIGHT_INVALID');
  const free=baseline.parties.filter(p=>p.partyType==='free');
  if(free.some(p=>!validId(p.partyId)||typeof p.title!=='string')||new Set(free.map(p=>p.partyId)).size!==free.length
    ||free.some(p=>matchCode(p.title,code)))throw Error('BASELINE_UNCONFIRMED');
  const existing=store.everyviewDisneyIntents||{};
  if(existing[key]||Object.values(existing).some(x=>x.requestCode===code)
    ||Object.prototype.hasOwnProperty.call(store.disneyEveryview||{},key))throw Error('RESERVATION_ALREADY_EXISTS');
  const {title}=buildDisneyCorrelatedTitle(baseTitle,code),next=structuredClone(store);
  next.disneyEveryview||={};next.disneyEveryview[key]={partyIds:[],accountCapacity:6,snapshots:{}};
  const intent:DisneyCorrelatedIntent={accountHash:key,requestCode:code,title,accountEndDate,profileNumber:6,
    baselinePartyIds:free.map(p=>p.partyId),baselineCheckedAt:baseline.checkedAt,preparedAt:now.toISOString(),state:'prepared',
    monitors:{cutoffDays:30,profileNumber:6,enabled:true}};
  next.everyviewDisneyIntents||={};next.everyviewDisneyIntents[key]=intent;
  return {store:next,intent};
}

/** Persist the attempted transition before POST; never retry an attempted request. */
export function beginDisneyCorrelatedSubmission(store:DisneyCorrelatedStore,key:string,now:Date):DisneyCorrelatedStore {
  const intent=store.everyviewDisneyIntents?.[key],mapping=store.disneyEveryview?.[key];
  if(!hashValid(key)||!intent||intent.accountHash!==key||intent.state!=='prepared'||!mapping||mapping.accountCapacity!==6
    ||mapping.partyIds.length!==0||!fresh(intent.baselineCheckedAt,now)||!fresh(intent.preparedAt,now)
    ||everyviewRollingCutoff(intent.accountEndDate,30,now).state!=='open')throw Error('SUBMISSION_NOT_AUTHORIZED');
  const next=structuredClone(store);next.everyviewDisneyIntents![key].state='attempted';next.everyviewDisneyIntents![key].attemptedAt=now.toISOString();return next;
}

/**
 * Only read-only seller list and exact account/terms evidence. Never creates or
 * retries a party. Missing, duplicate, stale or uncorrelated observations hold.
 * An exact random marker also cannot guarantee monitoring before public exposure.
 */
export async function identifyCorrelatedDisneySubmission(input:{store:DisneyCorrelatedStore;key:string;accountEmail:string;
  current:OwnedPartySnapshot;now:Date;verify:(partyId:number)=>Promise<{title:string;proof:EveryviewDisneyPublicationProof}|null>}):Promise<CorrelatedLookupResult> {
  const {store,key,accountEmail,current,now}=input,intent=store.everyviewDisneyIntents?.[key];
  if(!intent||key!==disneyEveryviewAccountKey(accountEmail)||intent.accountHash!==key||intent.state!=='attempted'
    ||!intent.attemptedAt||!codeValid(intent.requestCode)||!matchCode(intent.title,intent.requestCode)
    ||!Array.isArray(intent.baselinePartyIds)||new Set(intent.baselinePartyIds).size!==intent.baselinePartyIds.length
    ||intent.baselinePartyIds.some(n=>!validId(n))||!current?.complete||!Array.isArray(current.parties)||!fresh(current.checkedAt,now)
    ||Date.parse(current.checkedAt)<Date.parse(intent.attemptedAt))return {state:'held',reason:'EVIDENCE_UNCONFIRMED'};
  const owned=current.parties.filter(p=>p.partyType==='free');
  if(owned.some(p=>!validId(p.partyId)||typeof p.title!=='string')||new Set(owned.map(p=>p.partyId)).size!==owned.length)
    return {state:'held',reason:'LIST_AMBIGUOUS'};
  const matches=owned.filter(p=>matchCode(p.title,intent.requestCode));
  if(matches.length!==1||normTitle(matches[0].title)!==normTitle(intent.title)||intent.baselinePartyIds.includes(matches[0].partyId))
    return {state:'held',reason:'RESULT_NOT_UNIQUE'};
  const candidate=matches[0];let result:Awaited<ReturnType<typeof input.verify>>;
  try{result=await input.verify(candidate.partyId);}catch{return {state:'held',reason:'PROOF_UNAVAILABLE'};}
  const p=result?.proof;
  if(!result||normTitle(result.title)!==normTitle(intent.title)||!p||p.partyId!==candidate.partyId||p.owned!==true
    ||p.serviceCode!=='disney_plus'||p.shareType!=='ACCOUNT'||p.accountEmail.trim().toLowerCase()!==accountEmail.trim().toLowerCase()
    ||p.periodTermType!=='ROLLING'||p.usageDays!==30||p.totalUsageFee!==2910||p.oneDayUsageFee!==97||p.monthUsageFee!==2910
    ||p.shareEndDate!==null||p.buyerCapacity!==1||p.profileNumber!==6||p.emailAccessVerified!==true)
    return {state:'held',reason:'PROOF_UNCONFIRMED'};
  return {state:'confirmed',partyId:candidate.partyId};
}

/** Mark proof only after caller rechecks and persists under the same inventory lock. */
export function confirmDisneyCorrelatedSubmission(store:DisneyCorrelatedStore,key:string,partyId:number,now:Date):DisneyCorrelatedStore {
  const intent=store.everyviewDisneyIntents?.[key],mapping=store.disneyEveryview?.[key];
  if(!intent||intent.state!=='attempted'||!mapping||mapping.accountCapacity!==6
    ||(mapping.partyIds.length!==0&&(mapping.partyIds.length!==1||mapping.partyIds[0]!==partyId))
    ||!validId(partyId)||!Array.isArray(intent.baselinePartyIds)||intent.baselinePartyIds.includes(partyId)
    ||!intent.attemptedAt||!Number.isFinite(Date.parse(intent.attemptedAt))||!Number.isFinite(now.getTime())
    ||now.getTime()<Date.parse(intent.attemptedAt))throw Error('CONFIRMATION_NOT_AUTHORIZED');
  const next=structuredClone(store),i=next.everyviewDisneyIntents![key],m=next.disneyEveryview![key];
  i.state='confirmed';i.partyId=partyId;i.confirmedAt=now.toISOString();m.partyIds=[partyId];
  m.snapshots[String(partyId)]||={source:`everyview:${partyId}`,complete:false,verifiedAt:now.toISOString(),advertisedVacancies:1,
    claims:[{id:`dedicated_${partyId}_6`,kind:'advertised',state:'unknown',profileNumber:6}]};
  return next;
}
