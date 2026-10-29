import { parseFragment,type DefaultTreeAdapterMap } from 'parse5';
import { EVERYVIEW_BASE,everyviewFetch,parseHostParties } from './everyview-api';
import type { OwnedPartySnapshot } from './everyview-disney-correlated-intent';
type Node=DefaultTreeAdapterMap['node'];
const all=(n:Node):Node[]=>[n,...('childNodes' in n?n.childNodes.flatMap(all):[])];
const attr=(n:Node,k:string):string|undefined=>'attrs' in n?n.attrs.find(a=>a.name===k)?.value:undefined;
const classes=(n:Node)=>(attr(n,'class')||'').split(/\s+/);
const text=(n:Node):string=>(n.nodeName==='#text'&&'value' in n?n.value:'')+('childNodes' in n?n.childNodes.map(text).join(''):'');

/** Fail closed if a host card is unparseable or a pagination control exists. */
export function parseCorrelatedOwnedParties(html:string,now=new Date()):OwnedPartySnapshot {
  const nodes=all(parseFragment(html)), cards=nodes.filter(n=>n.nodeName==='a'&&classes(n).includes('mypg-gc')&&classes(n).includes('host'));
  const parties=parseHostParties(html),paginated=nodes.some(n=>['a','button'].includes(n.nodeName)
    &&(/pagination|next-page|load-more/i.test(attr(n,'class')||'')||/^(?:더\s*보기|다음\s*페이지)$/i.test(text(n).trim())));
  const complete=nodes.some(n=>n.nodeName==='a'&&classes(n).includes('mypg-gc'))&&!paginated&&cards.length===parties.length
    &&cards.every(n=>!!attr(n,'data-search')&&!!attr(n,'href'))
    &&new Set(parties.map(p=>`${p.partyType}:${p.partyId}`)).size===parties.length&&Number.isFinite(now.getTime());
  return {parties,checkedAt:now.toISOString(),complete};
}
/** Exact seller-side saved title; malformed, duplicated or unbound pages fail closed. */
export function parseCorrelatedSavedTitle(html:string,partyId:number):string|null {
  if(!Number.isSafeInteger(partyId)||partyId<1)return null;
  const nodes=all(parseFragment(html));
  const ids=nodes.filter(n=>n.nodeName==='input'&&attr(n,'id')==='editPartyId');
  const titles=nodes.filter(n=>n.nodeName==='input'&&attr(n,'id')==='editRecruitTitle');
  if(ids.length!==1||titles.length!==1||attr(ids[0],'value')!==String(partyId))return null;
  const value=attr(titles[0],'value');return value&&value.trim()?value.trim():null;
}
export const correlatedOwnedPartyReader=(cookie:()=>string|null,now:()=>Date=()=>new Date())=>async():Promise<OwnedPartySnapshot>=>{
  const session=cookie();if(!session)throw Error('SESSION_REQUIRED');
  const res=await everyviewFetch(`${EVERYVIEW_BASE}/myParty`,{cookieStr:session,cache:'no-store',redirect:'manual'});
  if(!res.ok||res.redirected)throw Error('SESSION_REQUIRED');
  const snapshot=parseCorrelatedOwnedParties(await res.text(),now());if(!snapshot.complete)throw Error('SELLER_LIST_INCOMPLETE');return snapshot;
};
export const correlatedSavedTitleReader=(cookie:()=>string|null)=>async(partyId:number):Promise<string|null>=>{
  const session=cookie();if(!session||!Number.isSafeInteger(partyId)||partyId<1)return null;
  const response=await everyviewFetch(`${EVERYVIEW_BASE}/partyLeader_free_detail_type1?id=${partyId}`,{cookieStr:session,cache:'no-store',redirect:'manual'});
  return response.ok&&!response.redirected?parseCorrelatedSavedTitle(await response.text(),partyId):null;
};
