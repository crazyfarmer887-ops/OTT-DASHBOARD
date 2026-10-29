import { disneyEveryviewAccountKey } from '../lib/gbuts-disney-everyview';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { writeJsonAtomic } from '../lib/graytag-sales-session';
import type { GbutsOttStore } from '../lib/gbuts-ott';
import type { EveryviewCreatePartyInput } from '../lib/everyview-api';
import { everyviewRollingCutoff } from '../lib/everyview-recruitment-safety';
import { safeDisneyEmailAccessUrl } from '../lib/disney-mailbox';
import { buildDisneyCorrelatedTitle,prepareDisneyCorrelatedIntent,beginDisneyCorrelatedSubmission,identifyCorrelatedDisneySubmission,
  confirmDisneyCorrelatedSubmission,type DisneyCorrelatedStore,type OwnedPartySnapshot } from '../lib/everyview-disney-correlated-intent';

export interface EveryviewDisneyPublishRequest {
  accountEmail: string; accountEndDate: string; profileNumber: 6;
  title: string; description: string;
}
/** All fields are evidence obtained immediately from independently checked sources. */
export interface EveryviewDisneyPublishPreflight {
  accountHash: string; accountEndDate: string; verifiedAt: string;
  accountCapacity: number; committedOtherPlaces: number; profile6Available: boolean;
  otherSourcesComplete: boolean; currentAdvertisementsReserved: boolean;
  syncReady: boolean; cutoffReady: boolean; profileDeliveryReady: boolean; credentialsValidated: boolean;
}
export interface EveryviewDisneyPublicationProof {
  partyId: number; owned: boolean; serviceCode: string; accountEmail: string; shareType: string;
  periodTermType: string; usageDays: number; totalUsageFee: number; oneDayUsageFee: number; monthUsageFee: number;
  shareEndDate: null; buyerCapacity: number; profileNumber: number;
  emailAccessVerified: boolean;
}
export interface EveryviewDisneyPublishRecord {
  state: 'attempted' | 'created' | 'confirmed'; accountHash: string; accountEndDate: string;
  profileNumber: 6; attemptedAt: string; partyId?: number; confirmedAt?: string;
}
export interface EveryviewDisneyPublishJournal { version: 1; records: Record<string, EveryviewDisneyPublishRecord> }
const journalPath = () => process.env.EVERYVIEW_DISNEY_PUBLISH_JOURNAL_PATH || '/home/ubuntu/.config/gbuts/everyview-disney-publish-journal.json';
export function readEveryviewDisneyPublishJournal(): EveryviewDisneyPublishJournal {
  const path = journalPath(); if (!existsSync(path)) return { version: 1, records: {} };
  if (statSync(path).mode & 0o077) throw Error('PRIVATE_FILE_REQUIRED');
  const j = JSON.parse(readFileSync(path, 'utf8')) as EveryviewDisneyPublishJournal;
  if (!j || j.version !== 1 || !j.records || typeof j.records !== 'object' || Array.isArray(j.records)
    || Object.entries(j.records).some(([key,r]) => !/^[a-f0-9]{64}$/.test(key) || !r || r.accountHash !== key
      || r.profileNumber !== 6 || !['attempted','created','confirmed'].includes(r.state)
      || !Number.isFinite(Date.parse(r.attemptedAt)) || typeof r.accountEndDate !== 'string'
      || (r.state !== 'attempted' && (!validId(r.partyId)))
      || (r.state === 'confirmed' && !Number.isFinite(Date.parse(r.confirmedAt || ''))))) throw Error('PUBLISH_JOURNAL_INVALID');
  return j;
}
export function writeEveryviewDisneyPublishJournal(journal: EveryviewDisneyPublishJournal): void { writeJsonAtomic(journalPath(), journal); }
export type EveryviewDisneyPublishResult = { state: 'confirmed'; partyId: number } | { state: 'held'; reason: string };
export interface EveryviewDisneyPublishDeps {
  /** Same in-process shared lock as GButs sales and renewals; must include external submission. */
  withInventory<T>(work: () => Promise<T>): Promise<T>;
  readInventory(): GbutsOttStore; writeInventory(store: GbutsOttStore): void;
  readJournal(): EveryviewDisneyPublishJournal; writeJournal(journal: EveryviewDisneyPublishJournal): void;
  preflight(store: GbutsOttStore, request: EveryviewDisneyPublishRequest): Promise<EveryviewDisneyPublishPreflight>;
  credentials(request: EveryviewDisneyPublishRequest): Promise<{ id: string; password: string; emailAccessUrl: string; emailAccessPin?: string }>;
  submit(input: EveryviewCreatePartyInput): Promise<{ ok: boolean; partyId?: number }>;
  /** Read both seller ownership and platform's saved terms; do not trust a create acknowledgement alone. */
  verify(partyId: number, expected: { additionalInfo: string; password: string }): Promise<EveryviewDisneyPublicationProof | null>;
  /** Must identify exactly one already-created party or return null. Never sends a new request. */
  recover(record: EveryviewDisneyPublishRecord): Promise<number | null>;
  /** Optional correlated workflow; when supplied, records reservation and request code in one store. */
  correlation?: { snapshot():Promise<OwnedPartySnapshot>; savedTitle(partyId:number):Promise<string|null>; code?():string };
  safeToRun(): boolean; now(): Date;
}
const emailOkay = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const validId = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const normalize = (s: string) => s.trim().toLowerCase();
const fresh = (when: string, now: Date) => Number.isFinite(Date.parse(when)) && Date.parse(when) <= now.getTime()
  && now.getTime() - Date.parse(when) <= 60_000;
function proofMatches(proof: EveryviewDisneyPublicationProof | null, req: EveryviewDisneyPublishRequest, partyId: number): boolean {
  return !!proof && typeof proof.accountEmail === 'string' && proof.partyId === partyId && proof.owned === true && proof.serviceCode === 'disney_plus'
    && normalize(proof.accountEmail) === normalize(req.accountEmail) && proof.shareType === 'ACCOUNT'
    && proof.periodTermType === 'ROLLING' && proof.usageDays === 30 && proof.totalUsageFee === 2910
    && proof.oneDayUsageFee === 97 && proof.monthUsageFee === 2910 && proof.shareEndDate === null
    && proof.buyerCapacity === 1 && proof.profileNumber === req.profileNumber && proof.emailAccessVerified === true;
}
export function additionalInfo(credentials: { id:string; emailAccessUrl:string; emailAccessPin?:string }): string | null {
  const url = safeDisneyEmailAccessUrl(credentials.emailAccessUrl,credentials.id);if(!url)return null;
  const pinRequired = new URL(url).origin === 'https://email-verify.one';
  if (pinRequired && !/^\d{6}$/.test(credentials.emailAccessPin || '')) return null;
  return `6번 프로필을 이용해 주세요.\n\n이메일 인증 주소 : ${url}${pinRequired ? `\n이메일 PIN : ${credentials.emailAccessPin}` : ''}`;
}
function incompleteHold(store: GbutsOttStore, key: string, partyId: number, at: string): void {
  store.disneyEveryview ||= {};
  store.disneyEveryview[key] = { partyIds: [partyId], accountCapacity: 6,
    snapshots: { [String(partyId)]: { source: `everyview:${partyId}`, complete: false, verifiedAt: at,
      advertisedVacancies: 1, claims: [{ id: `dedicated_${partyId}_6`, kind: 'advertised', state: 'unknown', profileNumber: 6 }] } } };
}

/**
 * Reserve profile 6 before submitting. If submission is ambiguous, only recover
 * by reading provider state; never send again. No credentials enter the journal.
 * This executor is intentionally not wired to production until real preflight,
 * read-back, monitoring and cutoff dependencies have been independently verified.
 */
export async function publishEveryviewDisneySeat(request: EveryviewDisneyPublishRequest, deps: EveryviewDisneyPublishDeps): Promise<EveryviewDisneyPublishResult> {
  if (!request || typeof request.accountEmail !== 'string' || !emailOkay(request.accountEmail) || request.profileNumber !== 6
    || typeof request.title !== 'string' || !request.title.trim() || request.title.length > 25
    || typeof request.description !== 'string' || !request.description.trim() || request.description.length > 1000)
    return { state: 'held', reason: 'REQUEST_INVALID' };
  return deps.withInventory(async () => {
    if (!deps.safeToRun()) return { state: 'held', reason: 'PAUSED' };
    const now = deps.now(), key = disneyEveryviewAccountKey(request.accountEmail), journal = deps.readJournal();
    if (journal.version !== 1 || !journal.records || typeof journal.records !== 'object') return { state: 'held', reason: 'JOURNAL_INVALID' };
    const prior = journal.records[key];
    if (prior) {
      if (prior.accountHash !== key || prior.accountEndDate !== request.accountEndDate || prior.profileNumber !== 6
        || !['attempted','created','confirmed'].includes(prior.state)) return { state: 'held', reason: 'JOURNAL_CONFLICT' };
      const correlated=deps.readInventory() as DisneyCorrelatedStore;
      let id = prior.partyId || (correlated.everyviewDisneyIntents?.[key]?.state==='confirmed' ? correlated.everyviewDisneyIntents[key].partyId : undefined);
      if(!id&&deps.correlation&&correlated.everyviewDisneyIntents?.[key]?.state==='attempted') {
        const savedCredentials=await deps.credentials(request).catch(()=>null);
        const notice=savedCredentials&&additionalInfo(savedCredentials);
        if(savedCredentials&&notice){
          const snapshot=await deps.correlation.snapshot().catch(()=>null);
          if(snapshot){const result=await identifyCorrelatedDisneySubmission({store:correlated,key,accountEmail:request.accountEmail,current:snapshot,now:deps.now(),
            verify:async partyId=>{const [title,proof]=await Promise.all([deps.correlation!.savedTitle(partyId),deps.verify(partyId,{additionalInfo:notice,password:savedCredentials.password})]);
              return title&&proof?{title,proof}:null;}});
            if(result.state==='confirmed')id=result.partyId;
          }
        }
      } else if(!id) id=await deps.recover(prior).catch(()=>null) || undefined;
      if (!validId(id)) return { state: 'held', reason: 'SUBMISSION_UNCONFIRMED' };
      const store = deps.readInventory(), mapping = store.disneyEveryview?.[key];
      if (!mapping || (mapping.partyIds.length && (mapping.partyIds.length !== 1 || mapping.partyIds[0] !== id)))
        return { state: 'held', reason: 'RESERVATION_UNCONFIRMED' };
      const savedCredentials = await deps.credentials(request).catch(() => null);
      if (!savedCredentials || normalize(savedCredentials.id) !== normalize(request.accountEmail)) return { state: 'held', reason: 'CREDENTIALS_UNAVAILABLE' };
      const savedNotice = additionalInfo(savedCredentials);
      if (!savedNotice) return { state: 'held', reason: 'CREDENTIALS_UNAVAILABLE' };
      const proof = await deps.verify(id,{additionalInfo:savedNotice,password:savedCredentials.password}).catch(() => null);
      if (!proofMatches(proof, request, id)) return { state: 'held', reason: 'PUBLICATION_UNCONFIRMED' };
      const intent=(store as DisneyCorrelatedStore).everyviewDisneyIntents?.[key];
      if(intent&&deps.correlation){const title=await deps.correlation.savedTitle(id).catch(()=>null);
        if(!title||title.trim().replace(/\s+/g,' ').toUpperCase()!==intent.title.trim().replace(/\s+/g,' ').toUpperCase())
          return {state:'held',reason:'TITLE_UNCONFIRMED'};
      }
      if (!mapping.partyIds.length || !mapping.snapshots?.[String(id)]) {
        const c=store as DisneyCorrelatedStore;
        if(c.everyviewDisneyIntents?.[key]?.state==='attempted')deps.writeInventory(confirmDisneyCorrelatedSubmission(c,key,id,deps.now()));
        else {incompleteHold(store, key, id, deps.now().toISOString());deps.writeInventory(store);}
      } else if(intent?.state==='attempted')deps.writeInventory(confirmDisneyCorrelatedSubmission(store as DisneyCorrelatedStore,key,id,deps.now()));
      prior.partyId = id; prior.state = 'confirmed'; prior.confirmedAt ||= deps.now().toISOString(); deps.writeJournal(journal);
      return { state: 'confirmed', partyId: id };
    }
    const cutoff = everyviewRollingCutoff(request.accountEndDate, 30, now);
    if (cutoff.state !== 'open') return { state: 'held', reason: 'CUTOFF_REACHED_OR_INVALID' };
    const store = deps.readInventory();
    if (store.disneyEveryview && Object.prototype.hasOwnProperty.call(store.disneyEveryview, key))
      return { state: 'held', reason: 'RESERVATION_ALREADY_EXISTS' };
    let evidence: EveryviewDisneyPublishPreflight;
    try { evidence = await deps.preflight(store, request); } catch { return { state: 'held', reason: 'PREFLIGHT_UNAVAILABLE' }; }
    if (evidence.accountHash !== key || evidence.accountEndDate !== request.accountEndDate || !fresh(evidence.verifiedAt, deps.now())
      || evidence.accountCapacity !== 6 || evidence.committedOtherPlaces !== 5 || !evidence.profile6Available
      || !evidence.otherSourcesComplete || !evidence.currentAdvertisementsReserved || !evidence.syncReady
      || !evidence.cutoffReady || !evidence.profileDeliveryReady || !evidence.credentialsValidated)
      return { state: 'held', reason: 'PREFLIGHT_UNCONFIRMED' };
    let credentials: { id: string; password: string; emailAccessUrl: string; emailAccessPin?: string };
    try { credentials = await deps.credentials(request); } catch { return { state: 'held', reason: 'CREDENTIALS_UNAVAILABLE' }; }
    const notice = additionalInfo(credentials);
    if (normalize(credentials.id) !== normalize(request.accountEmail) || !credentials.password || !notice || !deps.safeToRun()
      || !fresh(evidence.verifiedAt, deps.now())) return { state: 'held', reason: 'PREFLIGHT_UNCONFIRMED' };
    // An empty, explicit mapping blocks GButs publication and renewal while the
    // external party ID is unknown. This is a reservation, not proof of a sale.
    let publishedTitle=request.title;
    if(deps.correlation){
      let baseline:OwnedPartySnapshot;
      try{baseline=await deps.correlation.snapshot();const code=deps.correlation.code?.()||buildDisneyCorrelatedTitle('디즈니').code;
        const prepared=prepareDisneyCorrelatedIntent({store:store as DisneyCorrelatedStore,accountEmail:request.accountEmail,
          accountEndDate:request.accountEndDate,baseTitle:request.title,code,baseline,preflight:evidence,now:deps.now()});
        publishedTitle=prepared.intent.title;deps.writeInventory(beginDisneyCorrelatedSubmission(prepared.store,key,deps.now()));
      }catch{return {state:'held',reason:'CORRELATION_UNCONFIRMED'};}
    } else {
      store.disneyEveryview ||= {};store.disneyEveryview[key] = { partyIds: [], accountCapacity: 6, snapshots: {} };deps.writeInventory(store);
    }
    const attemptedAt = deps.now().toISOString();
    const record: EveryviewDisneyPublishRecord = { state: 'attempted', accountHash: key, accountEndDate: request.accountEndDate,
      profileNumber: 6, attemptedAt };
    journal.records[key] = record; deps.writeJournal(journal);
    if (!deps.safeToRun() || !fresh(evidence.verifiedAt, deps.now()) || everyviewRollingCutoff(request.accountEndDate, 30, deps.now()).state !== 'open')
      return { state: 'held', reason: 'PAUSED_AFTER_RESERVATION' };
    const input: EveryviewCreatePartyInput = { recruitTitle: publishedTitle, recruitInfo: request.description,
      paymentType: 'PERIOD', periodTermType: 'ROLLING', usageDays: 30, totalUsageFee: 2910,
      oneDayUsageFee: 97, monthUsageFee: 2910, shareEndDate: null, shareUserCnt: 1,
      services: [{ serviceCode: 'disney_plus', serviceName: '디즈니+', shareType: 'ACCOUNT',
        userId: credentials.id, userPassword: credentials.password, additionalInfo: notice }] };
    let response: { ok: boolean; partyId?: number };
    try { response = await deps.submit(input); } catch { return { state: 'held', reason: 'SUBMISSION_UNCONFIRMED' }; }
    if (!response.ok || !validId(response.partyId)) return { state: 'held', reason: 'SUBMISSION_UNCONFIRMED' };
    const id = response.partyId;
    record.state = 'created'; record.partyId = id; deps.writeJournal(journal);
    const latest=deps.readInventory() as DisneyCorrelatedStore;
    incompleteHold(latest,key,id,deps.now().toISOString());deps.writeInventory(latest);
    const proof = await deps.verify(id,{additionalInfo:notice,password:credentials.password}).catch(() => null);
    if (!proofMatches(proof, request, id)) return { state: 'held', reason: 'PUBLICATION_UNCONFIRMED' };
    const intent=latest.everyviewDisneyIntents?.[key];
    if(intent&&deps.correlation){const title=await deps.correlation.savedTitle(id).catch(()=>null);
      if(!title||title.trim().replace(/\s+/g,' ').toUpperCase()!==intent.title.trim().replace(/\s+/g,' ').toUpperCase())
        return {state:'held',reason:'TITLE_UNCONFIRMED'};
      deps.writeInventory(confirmDisneyCorrelatedSubmission(latest,key,id,deps.now()));
    }
    record.state = 'confirmed'; record.confirmedAt = deps.now().toISOString(); deps.writeJournal(journal);
    return { state: 'confirmed', partyId: id };
  });
}
