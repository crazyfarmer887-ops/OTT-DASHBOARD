import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createCipheriv, createHash } from 'node:crypto';
import { createGbutsOttSellerClient, buildGbutsOttPost } from '../src/lib/gbuts-ott-client';
import { decodeGbutsSubscriptionCredential } from '../src/lib/gbuts-subscription-credentials';
import { DISNEY_AFTER_ORDER_NOTICE, DISNEY_REFUND_NOTICE, buildGbutsDisneyDirectText } from '../src/lib/gbuts-disney-delivery';
import { buildGbutsDisneyDeliveryText } from '../src/lib/gbuts-ott-templates';
import { resolveGbutsDisneyListingCredentials, resolveGbutsOttDirectCredentials } from '../src/lib/gbuts-ott-credentials';
import { buildGeneratedAccount } from '../src/lib/generated-accounts';
import { createPartyAccessLinkRecord, partyAccessAccountKey } from '../src/lib/party-access';
import { emptyGbutsOttStore } from '../src/lib/gbuts-ott';
import { fixtureListing, fixtureOrder } from './fixtures/gbuts-ott';
import { syncGbutsDirectCredentials } from '../src/scheduler/gbuts-ott-direct-delivery';
import { splitGbutsChatText } from '../src/lib/gbuts-chat-delivery';
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-21T13:00:00Z'));});
afterEach(()=>vi.useRealTimers());
const listing=()=>fixtureListing({serviceType:'디즈니플러스',deliveryMode:'disney-numbered-password',capacity:5});
// Fixture provider uses the same authenticated seller field encoding as GButs.
function encrypted(value:string){const key=Buffer.alloc(16);const ascii=Buffer.from(createHash('sha512').update('kkmouke0917').digest('hex'));for(let i=0;i<ascii.length;i++)key[i%16]^=ascii[i];const c=createCipheriv('aes-128-ecb',key,null);return Buffer.concat([c.update(value,'utf8'),c.final()]).toString('hex');}
test('native Disney edits preserve public sale settings and only write again when current credentials change',async()=>{
 let post:any={seq:100,category1:{seq:6},countries:['KR'],subscriptionType:'SHARE',subscriptionStartsAt:'2026-10-21 00:00:00',subscriptionEndsAt:'2026-12-01 23:59:59',memberLimit:5,memberCount:2,status:'ON_SALE',price:150,priceType:'DAY',title:JSON.stringify({ko:'[디즈니플러스] 1개월 · 비밀번호 로그인'}),description:'성인 인증은 직접 진행해주세요. 구매 후 안내받는 계정 정보 페이지의 이메일 인증 코드 확인 버튼을 이용해 주세요.',noticeBeforeOrder:'본인 프로필만 이용',noticeAfterOrder:'계정 확인 링크 안내',subscriptionPrincipal:encrypted('old@example.com'),subscriptionCredential:encrypted('old-password')};
 const writes:any[]=[];
 const transport=vi.fn(async(url:any,init?:RequestInit)=>{if(init?.method==='PUT'){expect(String(url)).toBe('https://api.gbuts.com/api/subscribe/100/share');const body=JSON.parse(String(init.body));writes.push(body);post={...post,...body,title:JSON.stringify({ko:body.title}),subscriptionPrincipal:encrypted(body.subscriptionPrincipal),subscriptionCredential:encrypted(body.subscriptionCredential)};}return new Response(JSON.stringify({success:true,error:null,response:post}));});
 const client=createGbutsOttSellerClient('test',transport);const credentials={id:'new@example.com',password:'new-password'};
 await client.syncDisneyCredentials(await client.getPost(100),credentials);
 expect(writes).toHaveLength(1);expect(writes[0]).toMatchObject({memberLimit:5,price:150,subscriptionEndsAt:'2026-12-01 23:59:59',subscriptionPrincipal:'new@example.com',subscriptionCredential:'new-password',noticeAfterOrder:DISNEY_AFTER_ORDER_NOTICE});
 expect(writes[0].noticeBeforeOrder).toContain(DISNEY_REFUND_NOTICE);
 for(const field of ['title','description','noticeBeforeOrder','noticeAfterOrder']){expect(writes[0][field]).not.toContain('new-password');expect(writes[0][field]).not.toContain('new@example.com');}
 expect(writes[0].description).toContain('성인 인증');
 await client.syncDisneyCredentials(await client.getPost(100),credentials);expect(writes).toHaveLength(1);
 await client.syncDisneyCredentials(await client.getPost(100),{id:'changed@example.com',password:'changed-password'});expect(writes).toHaveLength(2);
 await expect(client.syncDisneyCredentials({...post,category1:{seq:5}},credentials)).rejects.toThrow('디즈니');
 expect(decodeGbutsSubscriptionCredential('not-encrypted')).toBe('');
});
test('new Disney posts require private credentials while buyer messages never contain the account access link',()=>{
 expect(()=>buildGbutsOttPost(listing())).toThrow('계정 정보');
 const post=buildGbutsOttPost(listing(),new Date(),{id:'current@example.com',password:'secret'});
 expect(post).toMatchObject({subscriptionPrincipal:'current@example.com',subscriptionCredential:'secret'});
 expect(post.description).not.toContain('secret');
 expect(buildGbutsDisneyDeliveryText('https://example.com/dashboard/access/private',2,5)).not.toContain('https://');
 const text=buildGbutsDisneyDirectText({id:'current@example.com',password:'secret',emailAccessUrl:'https://tinyhost.shop/current@example.com'},2);
 expect(text).toContain(DISNEY_REFUND_NOTICE);expect(text).not.toContain('/dashboard/access/');
 expect(splitGbutsChatText(text).every(x=>Buffer.byteLength(x)<=500)).toBe(true);
 expect(()=>buildGbutsDisneyDirectText({id:'current@example.com',password:'secret',emailAccessUrl:'https://tinyhost.shop/other@example.com'},2)).toThrow();
});
test('native and chat credentials follow current maintenance email and generated password, including the matching mailbox',()=>{
 const l=listing();const account={...buildGeneratedAccount({serviceType:'디즈니플러스',alias:{email:l.accountEmail},password:'current-generated-password',pin:'',memo:''}),emailAccessProvider:'tinyhost' as const};
 const generated={[account.id]:account};const maintenance:any={[partyAccessAccountKey(l.serviceType,l.accountEmail)]:{changedAccountEmail:'changed@example.com'}};
 const order=fixtureOrder({profileName:'2',profileNumber:2,delivery:'confirmed'});const inventory=emptyGbutsOttStore();inventory.listings[l.id]=l;inventory.orders[order.key]=order;
 const record=createPartyAccessLinkRecord({token:'test',serviceType:l.serviceType,accountEmail:l.accountEmail,fallbackPassword:'stale-password',profileName:'2',member:{kind:'gbuts',memberId:order.key,status:'active',endDateTime:l.endDate,memberName:'buyer',verifiedAt:new Date().toISOString()}});
 const data={generated,maintenance,accessRecords:{[record.tokenHash]:record},inventory};
 expect(resolveGbutsDisneyListingCredentials(l,data)).toEqual({id:'changed@example.com',password:'current-generated-password',emailAccessUrl:'https://tinyhost.shop/changed@example.com'});
 expect(resolveGbutsOttDirectCredentials(order,l,data)).toEqual(resolveGbutsDisneyListingCredentials(l,data));
 data.maintenance[partyAccessAccountKey(l.serviceType,l.accountEmail)].changedPassword='maintenance-password';
 expect(resolveGbutsOttDirectCredentials(order,l,data).password).toBe('maintenance-password');
 account.emailAccessProvider=null as any;expect(()=>resolveGbutsDisneyListingCredentials(l,data)).toThrow('인증 연결');
});
test('legacy successful credentials get one mailbox/refund supplement, and partial unknown sends reconcile every part',async()=>{
 let store=emptyGbutsOttStore();const l=listing();store.listings[l.id]=l;const order=fixtureOrder({profileName:'1',profileNumber:1,delivery:'confirmed',roomId:'room',directDelivery:{requestAt:'2026-10-21T12:00:00Z',requestKey:'a'.repeat(64),state:'confirmed',messageHash:'b'.repeat(64),attemptedAt:'2026-10-21T12:00:00Z'}});store.orders[order.key]=order;
 const credentials={id:'current@example.com',password:'secret',emailAccessUrl:'https://tinyhost.shop/current@example.com'};
 let messages:any[]=[{senderSeq:order.userSeq,messageType:'TEXT',message:'!',createdAt:'2026-10-21 20:59:00'}];
 const client={openPrivateRoom:async()=> 'room',getChat:async()=>({messages})};
 const send=vi.fn(async(_r:string,_s:number,text:string)=>{messages.push({senderSeq:99,messageType:'TEXT',message:splitGbutsChatText(text)[0],createdAt:new Date().toISOString()});throw new Error('partial unknown');});
 const run=()=>syncGbutsDirectCredentials(store,Object.values(store.orders),99,{credentials:async()=>credentials} as any,client as any,s=>{store=structuredClone(s);},send);
 await run();expect(send).toHaveBeenCalledOnce();expect(store.orders[order.key].directDelivery?.state).toBe('attempted');
 await run();expect(send).toHaveBeenCalledOnce();expect(store.orders[order.key].directDelivery?.state).toBe('attempted');
 messages.push(...splitGbutsChatText(buildGbutsDisneyDirectText(credentials,1)).slice(1).map(message=>({senderSeq:99,messageType:'TEXT',message,createdAt:new Date().toISOString()})));
 await run();expect(store.orders[order.key].directDelivery?.state).toBe('confirmed');
 await run();expect(send).toHaveBeenCalledOnce();expect(JSON.stringify(store)).not.toContain('secret');
});
test('an agreed refund holds the automatic supplement even before the provider request is filed',async()=>{
 const store=emptyGbutsOttStore();const l=listing();store.listings[l.id]=l;const order=fixtureOrder({profileName:'1',profileNumber:1,delivery:'confirmed',roomId:'room',directDelivery:{requestAt:'2026-10-21T12:00:00Z',requestKey:'a'.repeat(64),state:'confirmed',messageHash:'b'.repeat(64),attemptedAt:'2026-10-21T12:00:00Z'}});store.orders[order.key]=order;
 const credentials=vi.fn();const send=vi.fn();
 await syncGbutsDirectCredentials(store,[order],99,{credentials} as any,{openPrivateRoom:async()=> 'room',getChat:async()=>({messages:[{senderSeq:99,messageType:'TEXT',message:'환불 진행해드리겠습니다. 환불 신청해주세요.',createdAt:'2026-10-21 21:30:00'}]})} as any,()=>{},send);
 expect(credentials).not.toHaveBeenCalled();expect(send).not.toHaveBeenCalled();
});
