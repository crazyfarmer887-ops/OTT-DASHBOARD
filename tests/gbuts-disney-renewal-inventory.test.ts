import { expect, test, vi } from 'vitest';
import { buildDisneyRenewalInventory } from '../src/lib/gbuts-disney-renewal-inventory';
import { buildGeneratedAccount } from '../src/lib/generated-accounts';
import { createPartyAccessLinkRecord, partyAccessAccountKey } from '../src/lib/party-access';
import { readVerifiedGraytagManagementSnapshot } from '../src/lib/graytag-management-snapshot';
const account=()=>({...buildGeneratedAccount({serviceType:'디즈니플러스',alias:{email:'disney@example.com'},password:'private-password',pin:'',memo:''}),paymentStatus:'paid' as const,expiryDate:'2026-12-01'});
test('fresh renewal inventory reads only complete current streams without old-history hydration',async()=>{
 const read=vi.fn(async(kind:string,finished:boolean)=>{expect(finished).toBe(false);return new Response(JSON.stringify({succeeded:true,data:{lenderDeals:[{dealUsid:kind,dealStatus:'Using'}]}}));});
 const snapshot=await readVerifiedGraytagManagementSnapshot(read,{includeFinished:false});
 expect(read.mock.calls.map(c=>c.slice(0,2))).toEqual([['after',false],['before',false]]);
 expect(snapshot.afterFinishedDeals).toEqual([]);expect(snapshot.beforeFinishedDeals).toEqual([]);
});
test('current foreign users and recruitment map to generated account aliases without disclosing passwords',()=>{
 const a=account();const maintenance:any={[partyAccessAccountKey(a.serviceType,a.email)]:{changedAccountEmail:'changed@example.com'}};
 const deals=[{dealUsid:'buyer',productTypeString:'디즈니플러스',dealStatus:'Using',keepAcct:'changed@example.com'},
 {productUsid:'sale',productTypeString:'디즈니플러스',dealStatus:'OnSale',keepAcct:a.email},
 {dealUsid:'unrelated',productTypeString:'넷플릭스',dealStatus:'Using',keepAcct:a.email}];
 const result=buildDisneyRenewalInventory({[a.id]:a},deals,{},maintenance);
 expect(result.services[0].accounts[0].members).toHaveLength(1);expect(result.onSaleByKeepAcct[a.email]).toHaveLength(1);
 expect(result.services[0].accounts[0]).toMatchObject({expiryDate:'2026-12-01',totalSlots:6,generatedAccount:{paymentStatus:'paid'}});expect(JSON.stringify(result)).not.toContain('private-password');
});
test('placeholder account notices require a verified listing mapping, and unknown service rows fail closed',()=>{
 const a=account();const deal={productUsid:'sale',productTypeString:'디즈니플러스',dealStatus:'OnSale',keepAcct:'아래 메세지를 확인해주세요'};
 expect(()=>buildDisneyRenewalInventory({[a.id]:a},[deal],{},{})).toThrow('계정 연결');
 const record=createPartyAccessLinkRecord({token:'inventory-test',serviceType:a.serviceType,accountEmail:a.email,profileName:'1',member:{kind:'graytag',memberId:'fill:sale',memberName:'buyer',status:'active',endDateTime:'2026-12-01'}});
 expect(buildDisneyRenewalInventory({[a.id]:a},[deal],{[record.tokenHash]:record},{}).onSaleByKeepAcct[a.email]).toHaveLength(1);
 expect(()=>buildDisneyRenewalInventory({[a.id]:a},[{...deal,productTypeString:undefined}],{},{})).toThrow('서비스 종류');
});
