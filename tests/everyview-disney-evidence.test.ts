import { afterEach,describe,expect,it,vi } from 'vitest';
import { parseEveryviewDedicatedSeatEvidence,collectEveryviewDedicatedSeatEvidence } from '../src/lib/everyview-disney-evidence';
import { disneyEveryviewAccountKey } from '../src/lib/gbuts-disney-everyview';
import { applyDedicatedEveryviewDisneySeat } from '../src/lib/everyview-disney-inventory-bridge';
import { emptyGbutsOttStore } from '../src/lib/gbuts-ott';
import type { EveryviewDisneyWatchState } from '../src/scheduler/everyview-disney-observation';

const binding={partyId:10,accountEmail:'disney@example.com',profileNumber:6},accountHash=disneyEveryviewAccountKey(binding.accountEmail);
const now=new Date('2026-10-29T00:01:00Z'),observedAt='2026-10-29T00:00:30.000Z';
const member={userSeq:20,currentlyVisible:true,firstObservedAt:observedAt,lastObservedAt:observedAt};
const watch=(sold=false):EveryviewDisneyWatchState=>({version:1,parties:{'10':{accountHash,observedAt,visibleEmptySlots:sold?0:1,members:sold?{'30':member}:{}}}});
const html=(options:{visible?:boolean;sold?:boolean;slotOpen?:boolean}={})=>{
 const visible=options.visible!==false,sold=!!options.sold,slotOpen=options.slotOpen!==false;
 return `<div class="pld-card-meta">파티ID : <span>s10</span> · 가입일</div>
 <span id="recruitStatus"><span class="pld-recruit-state">${visible?'노출':'숨김'}</span></span>
 <input type="checkbox" id="recruitToggle" ${visible?'checked="checked"':''}>
 <div class="pld-slot-name pld-slot-name-host">host</div>
 ${sold?'<div class="pld-slot" data-user-id="20" onclick="openGeneralPartyChat(10,30)"><div class="pld-slot-name">buyer</div></div>':
 `<div class="pld-slot pld-slot-toggleable ${slotOpen?'':'pld-slot-closed'}"><div class="pld-slot-name pld-slot-name-empty">${slotOpen?'모집중':'모집완료'}</div><input type="checkbox" class="pld-recruit-switch-input" ${slotOpen?'checked="checked"':''}></div>`}
 <span class="pld-login-svc-name">디즈니플러스</span><div data-svc-id="4" data-share-type="ACCOUNT"></div>
 <input class="login-accountId" value="disney@example.com"><input class="login-accountPassword" value="never-output-password">
 <span class="pld-info-key">추가 이용 정보</span><div class="pld-info-val-row"><span class="pld-info-val">6번 프로필을 이용해 주세요.</span></div>
 <script>var CURRENT_MEMBER_CNT = ${sold?1:0};</script>`;
};
afterEach(()=>vi.unstubAllGlobals());

describe('Everyview dedicated seat evidence',()=>{
 it('checks owned account, visible state, member count and real open toggle',()=>{
  const result=parseEveryviewDedicatedSeatEvidence(html(),binding,watch(),now);
  expect(result).toEqual({partyId:10,accountHash,rosterObservedAt:observedAt,checkedAt:now.toISOString(),buyerCapacity:1,advertisedVacancies:1});
  expect(JSON.stringify(result)).not.toContain('never-output-password');
 });
 it('counts a hidden but open slot as reserved and a closed toggle as unavailable',()=>{
  expect(parseEveryviewDedicatedSeatEvidence(html({visible:false}),binding,watch(),now)).toMatchObject({buyerCapacity:1,advertisedVacancies:0});
  expect(parseEveryviewDedicatedSeatEvidence(html({slotOpen:false}),binding,watch(),now)).toMatchObject({buyerCapacity:0,advertisedVacancies:0});
 });
 it('recognizes the production markup with a plain member-name class and links the buyer to profile 6',()=>{
  const evidence=parseEveryviewDedicatedSeatEvidence(html({sold:true}),binding,watch(true),now);
  expect(evidence).toMatchObject({buyerCapacity:1,advertisedVacancies:0});
  const store={...emptyGbutsOttStore(),disneyEveryview:{[accountHash]:{partyIds:[10],accountCapacity:6,snapshots:{}}}};
  const result=applyDedicatedEveryviewDisneySeat({store,accountEmail:binding.accountEmail,partyId:10,profileNumber:6,watch:watch(true),evidence,now});
  expect(result.complete).toBe(true);
  expect(result.store.disneyEveryview![accountHash].snapshots['10'].claims[0]).toMatchObject({kind:'buyer',profileNumber:6});
 });
 it('fails closed for altered state, member count, mismatched roster and stale observations',()=>{
  expect(()=>parseEveryviewDedicatedSeatEvidence(html().replace('>노출<','>숨김<'),binding,watch(),now)).toThrow();
  expect(()=>parseEveryviewDedicatedSeatEvidence(html().replace('CURRENT_MEMBER_CNT = 0','CURRENT_MEMBER_CNT = 1'),binding,watch(),now)).toThrow('MEMBER_COUNT_UNCONFIRMED');
  expect(()=>parseEveryviewDedicatedSeatEvidence(html({sold:true}),binding,watch(),now)).toThrow('ROSTER_CHANGED');
  expect(()=>parseEveryviewDedicatedSeatEvidence(html(),binding,watch(),new Date('2026-10-29T00:03:00Z'))).toThrow('ROSTER_STALE');
  expect(()=>parseEveryviewDedicatedSeatEvidence(html().replace('>모집중<','>모집완료<'),binding,watch(),now)).toThrow('SLOT_STATE_UNCONFIRMED');
  expect(()=>parseEveryviewDedicatedSeatEvidence(html().replace('disney@example.com','other@example.com'),binding,watch(),now)).toThrow('PARTY_BINDING_UNVERIFIED');
  expect(()=>parseEveryviewDedicatedSeatEvidence(html().replace('6번 프로필','5번 프로필'),binding,watch(),now)).toThrow('PROFILE_GUIDE_UNCONFIRMED');
 });
 it('rejects two open buyer seats even if the listing is hidden',()=>{
  const extra='<div class="pld-slot pld-slot-toggleable"><div class="pld-slot-name pld-slot-name-empty">모집중</div><input type="checkbox" class="pld-recruit-switch-input" checked="checked"></div>';
  expect(()=>parseEveryviewDedicatedSeatEvidence(html({visible:false})+extra,binding,watch(),now)).toThrow('DEDICATED_CAPACITY_EXCEEDED');
 });
 it('only reads a seller-owned party and its fresh detail page',async()=>{
  const calls:string[]=[];
  vi.stubGlobal('fetch',vi.fn(async(input:string|URL|Request)=>{const url=String(input);calls.push(url);
   if(url.endsWith('/myParty'))return new Response('<a class="mypg-gc host" href="/partyLeader_free_detail_type1?id=10" data-search="디즈니 s10 disney_plus 디즈니+">party</a>');
   if(url.includes('/partyLeader_free_detail_type1'))return new Response(html());throw Error('unexpected');}));
  expect(await collectEveryviewDedicatedSeatEvidence('session-private',binding,watch(),now)).toMatchObject({advertisedVacancies:1});
  expect(calls).toHaveLength(2);
 });
});
