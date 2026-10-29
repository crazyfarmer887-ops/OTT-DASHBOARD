/** Durable state model only. The caller must hold the shared inventory lock,
 * persist each returned transition atomically before network mutation, and
 * independently verify the provider read-back. No secrets or buyer data here. */
export type DisneyEveryviewRegistrationState = 'reserved'|'submitting'|'uncertain'|'confirmed';
export interface DisneyEveryviewRegistration {
  accountHash:string; requestId:string; profileNumber:6; accountCapacity:6; gbutsQuota:5;
  endDate:string; dailyPrice:97; monthlyDisplay:2910; state:DisneyEveryviewRegistrationState;
  reservedAt:string; submittedAt?:string; confirmedAt?:string; partyId?:number;
}
export interface DisneyEveryviewRegistrationJournal {
  version:1; accounts:Record<string,DisneyEveryviewRegistration>;
}
export type DisneyEveryviewRegistrationSpec = Pick<DisneyEveryviewRegistration,
  'accountHash'|'requestId'|'endDate'>;
export interface DisneyEveryviewPartyEvidence {
  partyId:number; accountHash:string; ownerVerified:boolean; disneyVerified:boolean;
  periodVerified:boolean; endDate:string; dailyPrice:number; monthlyDisplay:number;
  singlePlaceVerified:boolean; readBackComplete:boolean;
}
const timeValid=(value:string)=>Number.isFinite(Date.parse(value));
function assertSpec(spec:DisneyEveryviewRegistrationSpec,at:string) {
 if(!/^[a-f0-9]{64}$/.test(spec.accountHash)||!/^[A-Za-z0-9_-]{8,100}$/.test(spec.requestId)
   || !/^\d{4}-\d{2}-\d{2}$/.test(spec.endDate)||!timeValid(spec.endDate)||new Date(spec.endDate).toISOString().slice(0,10)!==spec.endDate
   ||!timeValid(at))throw Error('DISNEY_RESERVATION_SPEC_INVALID');
 if(Date.parse(`${spec.endDate}T23:59:59+09:00`)<=Date.parse(at))throw Error('DISNEY_RESERVATION_SPEC_INVALID');
}
function validJournal(journal:DisneyEveryviewRegistrationJournal) {
 if(journal.version!==1||!journal.accounts||typeof journal.accounts!=='object'||Array.isArray(journal.accounts)) throw Error('DISNEY_REGISTRATION_JOURNAL_INVALID');
 for(const [key,r] of Object.entries(journal.accounts)) {
   if(!r||key!==r.accountHash||!['reserved','submitting','uncertain','confirmed'].includes(r.state)||r.profileNumber!==6
     ||r.accountCapacity!==6||r.gbutsQuota!==5||r.dailyPrice!==97||r.monthlyDisplay!==2910)throw Error('DISNEY_REGISTRATION_JOURNAL_INVALID');
   assertSpec(r,r.reservedAt);
   if(r.state!=='reserved'&&!timeValid(r.submittedAt||''))throw Error('DISNEY_REGISTRATION_JOURNAL_INVALID');
   if(r.state==='confirmed'&&(!Number.isSafeInteger(r.partyId)||r.partyId!<1||!timeValid(r.confirmedAt||'')))throw Error('DISNEY_REGISTRATION_JOURNAL_INVALID');
   if(r.state!=='confirmed'&&(r.partyId!==undefined||r.confirmedAt!==undefined))throw Error('DISNEY_REGISTRATION_JOURNAL_INVALID');
 }
 const confirmed=Object.values(journal.accounts).filter(r=>r.state==='confirmed').map(r=>r.partyId);
 if(new Set(confirmed).size!==confirmed.length)throw Error('DISNEY_REGISTRATION_JOURNAL_INVALID');
}
/** Reserves 6 before creation. Replaying the exact request is a read, not a new reservation. */
export function reserveEveryviewDisneyRegistration(journal:DisneyEveryviewRegistrationJournal,spec:DisneyEveryviewRegistrationSpec,at:string) {
 validJournal(journal);assertSpec(spec,at);
 const next=structuredClone(journal),previous=next.accounts[spec.accountHash];
 if(previous){if(previous.requestId!==spec.requestId||previous.endDate!==spec.endDate)throw Error('DISNEY_ACCOUNT_ALREADY_RESERVED');return next;}
 if(Object.values(next.accounts).some(r=>r.requestId===spec.requestId))throw Error('DISNEY_REQUEST_ALREADY_USED');
 next.accounts[spec.accountHash]={...spec,profileNumber:6,accountCapacity:6,gbutsQuota:5,dailyPrice:97,monthlyDisplay:2910,state:'reserved',reservedAt:at};
 return next;
}
/** Must persist 'submitting' before POST; a second begin is always forbidden. */
export function beginEveryviewDisneySubmission(journal:DisneyEveryviewRegistrationJournal,accountHash:string,requestId:string,at:string) {
 validJournal(journal);if(!timeValid(at))throw Error('DISNEY_SUBMISSION_TIME_INVALID');
 const next=structuredClone(journal),r=next.accounts[accountHash];
 if(!r||r.requestId!==requestId||r.state!=='reserved')throw Error('DISNEY_CREATE_RETRY_FORBIDDEN');
 assertSpec(r,at);if(Date.parse(at)<Date.parse(r.reservedAt))throw Error('DISNEY_SUBMISSION_TIME_INVALID');
 r.state='submitting';r.submittedAt=at;return next;
}
/** An ambiguous response is lookup-only forever until provider evidence confirms it. */
export function markEveryviewDisneyUncertain(journal:DisneyEveryviewRegistrationJournal,accountHash:string,requestId:string) {
 validJournal(journal);const next=structuredClone(journal),r=next.accounts[accountHash];
 if(!r||r.requestId!==requestId||!['submitting','uncertain'].includes(r.state))throw Error('DISNEY_SUBMISSION_STATE_INVALID');
 r.state='uncertain';return next;
}
/** A response ID alone is insufficient. Confirm only uniquely matched seller read-back. */
export function confirmEveryviewDisneyRegistration(journal:DisneyEveryviewRegistrationJournal,accountHash:string,requestId:string,e:DisneyEveryviewPartyEvidence,at:string) {
 validJournal(journal);const next=structuredClone(journal),r=next.accounts[accountHash];
 if(!r||r.requestId!==requestId||!['submitting','uncertain','confirmed'].includes(r.state)||!timeValid(at))throw Error('DISNEY_SUBMISSION_STATE_INVALID');
 if(Date.parse(at)<Date.parse(r.submittedAt!))throw Error('DISNEY_SUBMISSION_STATE_INVALID');
 if(!Number.isSafeInteger(e.partyId)||e.partyId<1||e.accountHash!==r.accountHash||!e.ownerVerified||!e.disneyVerified
   ||!e.periodVerified||e.endDate!==r.endDate||e.dailyPrice!==r.dailyPrice||e.monthlyDisplay!==r.monthlyDisplay
   ||!e.singlePlaceVerified||!e.readBackComplete||Object.values(next.accounts).some(x=>x.accountHash!==accountHash&&x.partyId===e.partyId))throw Error('DISNEY_PARTY_UNVERIFIED');
 if(r.state==='confirmed'){if(r.partyId!==e.partyId)throw Error('DISNEY_PARTY_UNVERIFIED');return next;}
 r.state='confirmed';r.partyId=e.partyId;r.confirmedAt=at;return next;
}
