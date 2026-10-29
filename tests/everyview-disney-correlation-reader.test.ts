import { describe,expect,it } from 'vitest';
import { parseCorrelatedOwnedParties,parseCorrelatedSavedTitle } from '../src/lib/everyview-disney-correlation-reader';
const now=new Date('2026-10-29T00:00:00Z');
const card='<a class="mypg-gc host" href="/partyLeader_free_detail_type1?id=123" data-search="디즈니 3개월 [ABCDEF123456] s123 disney_plus 디즈니+">party</a>';
describe('seller correlation reads',()=>{
 it('uses the saved complete seller title and provider party ID',()=>{
  expect(parseCorrelatedOwnedParties(card,now)).toMatchObject({complete:true,parties:[{partyId:123,title:'디즈니 3개월 [ABCDEF123456]'}]});
  expect(parseCorrelatedSavedTitle('<input id="editPartyId" value="123"><input id="editRecruitTitle" value="디즈니 3개월 [ABCDEF123456]">',123)).toBe('디즈니 3개월 [ABCDEF123456]');
 });
 it('does not claim completeness for unparseable cards, duplicate IDs or pagination',()=>{
  expect(parseCorrelatedOwnedParties(card.replace('id=123','id=bad'),now).complete).toBe(false);
  expect(parseCorrelatedOwnedParties(card+card,now).complete).toBe(false);
  expect(parseCorrelatedOwnedParties(card+'<button>더보기</button>',now).complete).toBe(false);
  expect(parseCorrelatedSavedTitle('<input id="editPartyId" value="124"><input id="editRecruitTitle" value="x">',123)).toBeNull();
 });
});
