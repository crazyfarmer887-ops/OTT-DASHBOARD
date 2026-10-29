import { describe,it,expect } from 'vitest';
import { reserveEveryviewDisneyRegistration,beginEveryviewDisneySubmission,markEveryviewDisneyUncertain,
 confirmEveryviewDisneyRegistration, type DisneyEveryviewRegistrationJournal, type DisneyEveryviewPartyEvidence } from '../src/lib/everyview-disney-registration-journal';

const at='2026-10-29T12:00:00Z',hash='a'.repeat(64),spec={accountHash:hash,requestId:'request_001',endDate:'2027-01-24'};
const empty=():DisneyEveryviewRegistrationJournal=>({version:1,accounts:{}});
const evidence=():DisneyEveryviewPartyEvidence=>({partyId:700,accountHash:hash,ownerVerified:true,disneyVerified:true,
 periodVerified:true,endDate:spec.endDate,dailyPrice:97,monthlyDisplay:2910,singlePlaceVerified:true,readBackComplete:true});
describe('durable Everyview Disney publication intent',()=>{
 it('reserves profile 6 in a six-place account with a separate five-place GButs quota before any submission',()=>{
  const start=empty(),j=reserveEveryviewDisneyRegistration(start,spec,at);
  expect(start.accounts).toEqual({});expect(j.accounts[hash]).toMatchObject({profileNumber:6,accountCapacity:6,gbutsQuota:5,
    state:'reserved',dailyPrice:97,monthlyDisplay:2910});
  expect(reserveEveryviewDisneyRegistration(j,spec,at)).toEqual(j);
 });
 it('rejects conflicting requests, invalid calendar dates and duplicate request IDs',()=>{
  const j=reserveEveryviewDisneyRegistration(empty(),spec,at);
  expect(()=>reserveEveryviewDisneyRegistration(j,{...spec,requestId:'different_001'},at)).toThrow('DISNEY_ACCOUNT_ALREADY_RESERVED');
  expect(()=>reserveEveryviewDisneyRegistration(j,{...spec,accountHash:'b'.repeat(64)},at)).toThrow('DISNEY_REQUEST_ALREADY_USED');
  expect(()=>reserveEveryviewDisneyRegistration(empty(),{...spec,endDate:'2027-02-30'},at)).toThrow('DISNEY_RESERVATION_SPEC_INVALID');
  expect(()=>beginEveryviewDisneySubmission(j,hash,spec.requestId,'2027-01-25T00:00:00Z')).toThrow('DISNEY_RESERVATION_SPEC_INVALID');
 });
 it('allows one submitting transition and never resubmits after a lost response or uncertain result',()=>{
  const reserved=reserveEveryviewDisneyRegistration(empty(),spec,at),sending=beginEveryviewDisneySubmission(reserved,hash,spec.requestId,at);
  expect(sending.accounts[hash].state).toBe('submitting');expect(reserved.accounts[hash].state).toBe('reserved');
  expect(()=>beginEveryviewDisneySubmission(sending,hash,spec.requestId,at)).toThrow('DISNEY_CREATE_RETRY_FORBIDDEN');
  const uncertain=markEveryviewDisneyUncertain(sending,hash,spec.requestId);
  expect(()=>beginEveryviewDisneySubmission(uncertain,hash,spec.requestId,at)).toThrow('DISNEY_CREATE_RETRY_FORBIDDEN');
  expect(uncertain.accounts[hash]).not.toHaveProperty('partyId');
 });
 it('confirms only a complete unique owned-party readback with exact price and expiry',()=>{
  const pending=markEveryviewDisneyUncertain(beginEveryviewDisneySubmission(reserveEveryviewDisneyRegistration(empty(),spec,at),hash,spec.requestId,at),hash,spec.requestId);
  for(const patch of [{ownerVerified:false},{readBackComplete:false},{accountHash:'b'.repeat(64)},{endDate:'2027-04-24'},
   {dailyPrice:96},{monthlyDisplay:2880},{singlePlaceVerified:false},{periodVerified:false},{disneyVerified:false}])
   expect(()=>confirmEveryviewDisneyRegistration(pending,hash,spec.requestId,{...evidence(),...patch},at)).toThrow('DISNEY_PARTY_UNVERIFIED');
  const confirmed=confirmEveryviewDisneyRegistration(pending,hash,spec.requestId,evidence(),at);
  expect(confirmed.accounts[hash]).toMatchObject({state:'confirmed',partyId:700,profileNumber:6});
  expect(confirmEveryviewDisneyRegistration(confirmed,hash,spec.requestId,evidence(),at)).toEqual(confirmed);
  expect(()=>confirmEveryviewDisneyRegistration(confirmed,hash,spec.requestId,{...evidence(),partyId:701},at)).toThrow('DISNEY_PARTY_UNVERIFIED');
 });
 it('does not assign the same seller party to two different accounts',()=>{
  let j=reserveEveryviewDisneyRegistration(empty(),spec,at);j=beginEveryviewDisneySubmission(j,hash,spec.requestId,at);
  j=confirmEveryviewDisneyRegistration(j,hash,spec.requestId,evidence(),at);
  const other={...spec,accountHash:'b'.repeat(64),requestId:'request_002'};
  j=beginEveryviewDisneySubmission(reserveEveryviewDisneyRegistration(j,other,at),other.accountHash,other.requestId,at);
  expect(()=>confirmEveryviewDisneyRegistration(j,other.accountHash,other.requestId,{...evidence(),accountHash:other.accountHash},at)).toThrow('DISNEY_PARTY_UNVERIFIED');
 });
});
