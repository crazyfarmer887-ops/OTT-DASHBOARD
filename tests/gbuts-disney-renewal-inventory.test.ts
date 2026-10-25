import { expect, test, vi } from 'vitest';
import { buildGbutsRenewalInventory, resolveGbutsRenewalDealAccounts } from '../src/lib/gbuts-ott-renewal-inventory';
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
 const result=buildGbutsRenewalInventory({[a.id]:a},deals,{},maintenance);
 expect(result.services[0].accounts[0].members).toHaveLength(1);expect(result.onSaleByKeepAcct[a.email]).toHaveLength(1);
 expect(result.services[0].accounts[0]).toMatchObject({expiryDate:'2026-12-01',totalSlots:6,generatedAccount:{paymentStatus:'paid'}});expect(JSON.stringify(result)).not.toContain('private-password');
});
test('placeholder account notices require a verified listing mapping, and unknown service rows fail closed',()=>{
 const a=account();const deal={productUsid:'sale',productTypeString:'디즈니플러스',dealStatus:'OnSale',keepAcct:'아래 메세지를 확인해주세요'};
 expect(()=>buildGbutsRenewalInventory({[a.id]:a},[deal],{},{})).toThrow('계정 연결');
 const record=createPartyAccessLinkRecord({token:'inventory-test',serviceType:a.serviceType,accountEmail:a.email,profileName:'1',member:{kind:'graytag',memberId:'fill:sale',memberName:'buyer',status:'active',endDateTime:'2026-12-01'}});
 expect(buildGbutsRenewalInventory({[a.id]:a},[deal],{[record.tokenHash]:record},{}).onSaleByKeepAcct[a.email]).toHaveLength(1);
 expect(()=>buildGbutsRenewalInventory({[a.id]:a},[{...deal,productTypeString:undefined}],{},{})).toThrow('서비스 종류');
});

test('Netflix renewal inventory uses only the selected service and catches foreign alias occupancy',()=>{
 const a={...account(),serviceType:'넷플릭스',email:'netflix@example.com'};
 const maintenance:any={[partyAccessAccountKey(a.serviceType,a.email)]:{changedAccountEmail:'changed-netflix@example.com'}};
 const rows=[{dealUsid:'n1',productTypeString:'넷플릭스',dealStatus:'Using',keepAcct:'changed-netflix@example.com'},
 {productUsid:'d1',productTypeString:'디즈니플러스',dealStatus:'OnSale',keepAcct:a.email}];
 const result=buildGbutsRenewalInventory({[a.id]:a},rows,{},maintenance,'넷플릭스');
 expect(result.services[0]).toMatchObject({serviceType:'넷플릭스',accounts:[{email:a.email,totalSlots:5,members:[{dealUsid:'n1'}]}]});
 expect(result.onSaleByKeepAcct).toEqual({});expect(JSON.stringify(result)).not.toContain('private-password');
});

test('Netflix inventory resolves placeholder rows only from seller-owned evidence and ignores verified expired history',async()=>{
 const a={...account(),serviceType:'넷플릭스',email:'netflix@example.com'};
 const record=createPartyAccessLinkRecord({token:'renewal-delivered-link',serviceType:a.serviceType,accountEmail:a.email,profileName:'1',member:{kind:'graytag',memberId:'historical-room',memberName:'buyer',status:'active',endDateTime:'2026-12-01'}});
 const access={[record.tokenHash]:record};const deals=[{dealUsid:'buyer',productTypeString:'넷플릭스',dealStatus:'Using',endDateTime:'2026-12-01',keepAcct:'아래 메세지를 확인해주세요'},
 {dealUsid:'expired',productTypeString:'넷플릭스',dealStatus:'Pause',endDateTime:'2020-01-01',keepAcct:''}];
 const read=vi.fn(async()=>[{owned:false,message:'ID: attacker@example.com'},{owned:true,message:'https://email-verify.one/dashboard/access/renewal-delivered-link'}]);
 const rows=await resolveGbutsRenewalDealAccounts(deals,access,'넷플릭스',read,new Date('2026-10-25T00:00:00Z'));
 expect(read).toHaveBeenCalledTimes(1);expect(buildGbutsRenewalInventory({[a.id]:a},rows,access,{},'넷플릭스').services[0].accounts[0].members).toHaveLength(1);
 expect(deals[0].keepAcct).toBe('아래 메세지를 확인해주세요');
 const direct=await resolveGbutsRenewalDealAccounts([deals[0]],access,'넷플릭스',async()=>[{owned:true,message:'ID: netflix@example.com'}]);expect(direct[0].keepAcct).toBe(a.email);
 const untrusted=await resolveGbutsRenewalDealAccounts([deals[0]],access,'넷플릭스',async()=>[{owned:false,message:'ID: netflix@example.com'}]);
 expect(()=>buildGbutsRenewalInventory({[a.id]:a},untrusted,access,{},'넷플릭스')).toThrow('계정 연결');
 await expect(resolveGbutsRenewalDealAccounts([deals[0]],access,'넷플릭스',async()=>[{owned:true,message:'ID: one@example.com'},{owned:true,message:'ID: two@example.com'}])).rejects.toThrow('하나로');
});

test('one seller message containing previous and current IDs cannot hide target occupancy',async()=>{
 const row={dealUsid:'buyer',productTypeString:'넷플릭스',dealStatus:'Using',endDateTime:'2026-12-01',keepAcct:'아래 메세지를 확인해주세요'};
 await expect(resolveGbutsRenewalDealAccounts([row],{},'넷플릭스',async()=>[{owned:true,message:'이전 ID: previous@example.com\n현재 ID: current@example.com'}])).rejects.toThrow('하나로');
 await expect(resolveGbutsRenewalDealAccounts([row],{},'넷플릭스',async()=>[{owned:true,message:'이전 ID: previous@example.com / 현재 ID: current@example.com'}])).rejects.toThrow('하나로');
});
