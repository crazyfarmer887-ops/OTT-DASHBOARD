import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';
import { EVERYVIEW_BASE, everyviewFetch, fetchEveryviewHostParties, parsePartyDetail } from './everyview-api';
import { parseEveryviewDisneyObservation, type EveryviewDisneyBinding } from './everyview-disney-observation';
import { disneyEveryviewAccountKey } from './gbuts-disney-everyview';
import { parseEveryviewRecruitmentVisibility } from './everyview-recruitment-safety';
import type { EveryviewDedicatedSeatEvidence } from './everyview-disney-inventory-bridge';
import type { EveryviewDisneyWatchState } from '../scheduler/everyview-disney-observation';

type Node = DefaultTreeAdapterMap['node'];
const descendants = (n:Node):Node[] => [n,...('childNodes' in n ? n.childNodes.flatMap(descendants) : [])];
const attribute = (n:Node,k:string):string|undefined => 'attrs' in n ? n.attrs.find(x=>x.name===k)?.value : undefined;
const hasClass = (n:Node,c:string) => (attribute(n,'class')||'').split(/\s+/).includes(c);
const text = (n:Node):string => (n.nodeName==='#text'&&'value' in n?n.value:'') + ('childNodes' in n?n.childNodes.map(text).join(''):'');
const keyFor = (member:{memberSeq:number;userSeq:number}) => `${member.memberSeq}:${member.userSeq}`;
export type EveryviewDedicatedBinding = EveryviewDisneyBinding & { profileNumber:number };

/**
 * A fresh server-rendered page must match the earlier owned-account roster.
 * The global recruitment checkbox, its label, each slot switch, and the
 * server-rendered member count must agree. Slot names alone are never used to
 * infer a purchasable vacancy. Evidence contains no credentials or buyer names.
 */
export function parseEveryviewDedicatedSeatEvidence(html:string,binding:EveryviewDedicatedBinding,
  watch:EveryviewDisneyWatchState,now = new Date()):EveryviewDedicatedSeatEvidence {
  const current=now.getTime(), accountHash=disneyEveryviewAccountKey(binding.accountEmail), party=watch?.parties?.[String(binding.partyId)];
  const observed=Date.parse(party?.observedAt||'');
  if(watch?.version!==1||watch.lastError||!party||party.accountHash!==accountHash||!Number.isFinite(current)
    ||!Number.isFinite(observed)||observed>current||current-observed>120_000)throw Error('ROSTER_STALE');
  if(!Number.isInteger(binding.profileNumber)||binding.profileNumber<1||binding.profileNumber>6)throw Error('PROFILE_BINDING_INVALID');
  const actual=parseEveryviewDisneyObservation(html,binding,now);
  const guide=parsePartyDetail(html,binding.partyId).loginInfo[0]?.additionalInfo||'';
  if(!new RegExp(`(?<!\\d)${binding.profileNumber}\\s*번\\s*프로필`).test(guide))throw Error('PROFILE_GUIDE_UNCONFIRMED');
  const expected=Object.entries(party.members).filter(([,m])=>m.currentlyVisible)
    .map(([memberSeq,m])=>`${memberSeq}:${m.userSeq}`).sort();
  const observedRoster=actual.members.map(keyFor).sort();
  if(expected.length!==observedRoster.length||expected.some((x,i)=>x!==observedRoster[i]))throw Error('ROSTER_CHANGED');
  const nodes=descendants(parseFragment(html));
  const visibility=parseEveryviewRecruitmentVisibility(html,binding.partyId);
  const global=nodes.filter(n=>n.nodeName==='input'&&attribute(n,'id')==='recruitToggle');
  if(global.length!==1||attribute(global[0],'disabled')!==undefined)throw Error('VISIBILITY_UNCONFIRMED');
  const scripts=nodes.filter(n=>n.nodeName==='script').map(text);
  const counts=scripts.flatMap(script=>[...script.matchAll(/\b(?:var|let|const)\s+CURRENT_MEMBER_CNT\s*=\s*(\d+)\s*;/g)].map(m=>Number(m[1])));
  if(counts.length!==1||!Number.isSafeInteger(counts[0])||counts[0]!==actual.members.length)throw Error('MEMBER_COUNT_UNCONFIRMED');
  let opened=0;
  for(const slot of nodes.filter(n=>hasClass(n,'pld-slot')&&hasClass(n,'pld-slot-toggleable'))) {
    const child=descendants(slot), switches=child.filter(n=>n.nodeName==='input'&&hasClass(n,'pld-recruit-switch-input'));
    const labels=child.filter(n=>hasClass(n,'pld-slot-name-empty'));
    if(switches.length!==1||labels.length!==1||attribute(switches[0],'type')!=='checkbox'
      ||attribute(switches[0],'disabled')!==undefined)throw Error('SLOT_STATE_UNCONFIRMED');
    const checked=attribute(switches[0],'checked')!==undefined, closed=hasClass(slot,'pld-slot-closed');
    const label=text(labels[0]).replace(/\s/g,'');
    if(checked ? closed||label!=='모집중' : !closed||label!=='모집완료')throw Error('SLOT_STATE_UNCONFIRMED');
    if(checked)opened++;
  }
  const capacity=counts[0]+opened;
  if(capacity>1)throw Error('DEDICATED_CAPACITY_EXCEEDED');
  const advertised=visibility?opened:0;
  return { partyId:binding.partyId,accountHash,rosterObservedAt:party.observedAt,checkedAt:now.toISOString(),
    buyerCapacity:capacity as 0|1,advertisedVacancies:advertised as 0|1 };
}

/** Only performs provider reads; it never changes a listing or submits a test request. */
export async function collectEveryviewDedicatedSeatEvidence(cookie:string,binding:EveryviewDedicatedBinding,
  watch:EveryviewDisneyWatchState,now = new Date()):Promise<EveryviewDedicatedSeatEvidence> {
  if(!cookie)throw Error('SESSION_REQUIRED');
  const owned=(await fetchEveryviewHostParties(cookie)).filter(p=>p.partyId===binding.partyId&&p.partyType==='free'
    &&/디즈니|disney/i.test(p.serviceName||p.title));
  if(owned.length!==1)throw Error('OWNED_PARTY_UNAVAILABLE');
  const response=await everyviewFetch(`${EVERYVIEW_BASE}/partyLeader_free_detail_type1?id=${binding.partyId}`,
    {cookieStr:cookie,cache:'no-store'});
  if(!response.ok||response.redirected)throw Error('PARTY_READ_UNAVAILABLE');
  return parseEveryviewDedicatedSeatEvidence(await response.text(),binding,watch,now);
}

/** Suitable for the inventory bridge's evidence dependency; session values stay private. */
export const everyviewDedicatedEvidenceReader = (cookie:()=>string|null,now:()=>Date=()=>new Date()) =>
  async (binding:EveryviewDedicatedBinding,watch:EveryviewDisneyWatchState):Promise<EveryviewDedicatedSeatEvidence> => {
    const value=cookie();if(!value)throw Error('SESSION_REQUIRED');
    return collectEveryviewDedicatedSeatEvidence(value,binding,watch,now());
  };
