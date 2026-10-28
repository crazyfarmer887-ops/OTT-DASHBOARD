import {afterEach, beforeEach, expect, test, vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {manualRegisteredAccount} from '../src/lib/generated-accounts';
import {resolveGbutsNetflixListingCredentials} from '../src/lib/gbuts-ott-credentials';
import {buildGbutsNetflixMailboxText} from '../src/lib/gbuts-netflix-mailbox';
import {emptyGbutsOttStore} from '../src/lib/gbuts-ott';
import {readGbutsOttStore,writeGbutsOttStore} from '../src/lib/gbuts-ott-store';
import {createPartyAccessLinkRecord,buildPartyAccessPublicPayload} from '../src/lib/party-access';
import {syncGbutsDirectCredentials} from '../src/scheduler/gbuts-ott-direct-delivery';
import {fixtureListing,fixtureOrder} from './fixtures/gbuts-ott';
import {splitGbutsChatText} from '../src/lib/gbuts-chat-delivery';
import {buildGbutsOttPost} from '../src/lib/gbuts-ott-client';
import {buildGbutsNetflixDeliveryText} from '../src/lib/gbuts-ott-templates';
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-28T12:00:00Z'));});
afterEach(()=>vi.useRealTimers());
function fixture(){
 const listing=fixtureListing({emailCodeProvider:'emailverify',dailyPrice:180,capacity:5});
 const account=manualRegisteredAccount({serviceType:'넷플릭스',email:listing.accountEmail,password:'fixture-private-password',pin:'123456',emailAccessProvider:'emailverify',paymentStatus:'paid',expiryDate:'2026-12-01'},'fixture');
 const data={generated:{fixture:account},accessRecords:{},maintenance:{}};
 return {listing,account,data,credentials:()=>resolveGbutsNetflixListingCredentials(listing,data)};
}
test('only configured Netflix gets the exact mailbox and PIN in guide, access and seller notice',()=>{
 const f=fixture(),c=f.credentials();expect(c.emailAccessUrl).toBe('https://email-verify.one/email/mail/account%40example.com');
 expect(buildGbutsNetflixMailboxText(c,2)).toContain('이메일 PIN : 123456');
 for(const patch of [{emailAccessPin:undefined},{emailAccessUrl:'https://email-verify.one/dashboard'},{emailAccessUrl:'https://email-verify.one/email/mail/other%40example.com'}]) expect(()=>buildGbutsNetflixMailboxText({...c,...patch},2)).toThrow();
 const r=createPartyAccessLinkRecord({token:'fixture',serviceType:'넷플릭스',accountEmail:f.account.email,profileName:'2',member:{kind:'gbuts',memberId:'100:1',memberName:'fixture',status:'active',endDateTime:'2026-12-01',verifiedAt:new Date().toISOString()}});
 expect(buildPartyAccessPublicPayload(r,{},f.data.generated).emailAccessUrl).toBe(c.emailAccessUrl);
 expect(buildGbutsOttPost(f.listing).noticeAfterOrder).toContain('이메일 인증 주소·PIN');
 expect(buildGbutsNetflixDeliveryText('unused',2,false,true)).not.toContain('코드는 제공하지 않습니다');
 expect(buildGbutsNetflixDeliveryText('unused',2)).toContain('코드는 제공하지 않습니다');
 expect(buildGbutsNetflixDeliveryText('unused',2,true)).toContain('이 채팅에');
 f.account.emailAccessProvider=null;expect(f.credentials).toThrow();
});
test('real direct delivery persists all mailbox bubbles and never repeats after restart or an uncertain send',async()=>{
 const f=fixture(),s=emptyGbutsOttStore();s.listings[f.listing.id]=f.listing;
 const o=fixtureOrder({delivery:'confirmed',profileNumber:2,profileName:'2',roomId:'fixture-room',credentialDeliveryPolicy:'netflix-password-v1',purchasedAt:'2026-10-28T11:00:00Z'});s.orders[o.key]=o;
 const messages:any[]=[];let sends=0;
 const client={openPrivateRoom:async()=>o.roomId,getChat:async()=>({messages})};
 const deps={credentials:async()=>f.credentials()};
 const send=async(_r:string,seller:number,text:string)=>{sends++;for(const message of splitGbutsChatText(text))messages.push({senderSeq:seller,message,messageType:'TEXT',createdAt:new Date().toISOString()});};
 await syncGbutsDirectCredentials(s,[o],99,deps as any,client as any,()=>{},send as any);
 expect(sends).toBe(1);expect(o.directDelivery?.state).toBe('confirmed');expect(o.directDelivery?.format).toBe('netflix-mailbox-v1');
 expect(o.directDelivery?.messageHashes?.length).toBeGreaterThan(1);expect(messages.map(m=>m.message).join('\n')).toContain('이메일 PIN : 123456');
 const dir=mkdtempSync(join(tmpdir(),'netflix-mailbox-'));try{const path=join(dir,'store.json');writeGbutsOttStore(s,path);const reloaded=readGbutsOttStore(path);await syncGbutsDirectCredentials(reloaded,Object.values(reloaded.orders),99,deps as any,client as any,()=>{},send as any);expect(sends).toBe(1);}finally{rmSync(dir,{recursive:true,force:true});}
 o.directDelivery!.state='attempted';messages.splice(0);await syncGbutsDirectCredentials(s,[o],99,deps as any,client as any,()=>{},send as any);expect(sends).toBe(1);expect(o.directDelivery?.state).toBe('attempted');
});
