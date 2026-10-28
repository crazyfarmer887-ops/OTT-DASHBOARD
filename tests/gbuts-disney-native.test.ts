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
 expect(text.replace(/\s+/g,' ')).toContain(DISNEY_REFUND_NOTICE.replace('환불 안내: ',''));expect(text).not.toContain('/dashboard/access/');
 expect(splitGbutsChatText(text).map(part=>part.split('\n')[0])).toEqual(['[계정 정보]','[이메일 인증]','[환불 안내]']);
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
test('provider second precision confirms a migration started within that second without duplicate sends',async()=>{
 vi.setSystemTime(new Date('2026-10-21T13:00:00.789Z'));
 let store=emptyGbutsOttStore();const l=listing();store.listings[l.id]=l;const order=fixtureOrder({profileName:'1',profileNumber:1,delivery:'confirmed',roomId:'room',directDelivery:{requestAt:'2026-10-21T12:00:00Z',requestKey:'a'.repeat(64),state:'confirmed',messageHash:'b'.repeat(64),attemptedAt:'2026-10-21T12:00:00Z'}});store.orders[order.key]=order;
 let messages:any[]=[];const send=vi.fn(async(_r:string,_s:number,text:string)=>{messages=splitGbutsChatText(text).map(message=>({senderSeq:99,messageType:'TEXT',message,createdAt:'2026-10-21 22:00:00'}));});
 const run=()=>syncGbutsDirectCredentials(store,Object.values(store.orders),99,{credentials:async()=>({id:'current@example.com',password:'secret',emailAccessUrl:'https://tinyhost.shop/current@example.com'})} as any,{openPrivateRoom:async()=> 'room',getChat:async()=>({messages})} as any,s=>{store=structuredClone(s);},send);
 await run();expect(store.orders[order.key].directDelivery?.state).toBe('confirmed');
 await run();expect(send).toHaveBeenCalledOnce();
});
test('formatting-only changes never resend previously confirmed Disney credentials',async()=>{
 const store=emptyGbutsOttStore();const l=listing();store.listings[l.id]=l;
 const order=fixtureOrder({profileName:'1',profileNumber:1,delivery:'confirmed',roomId:'room',directDelivery:{format:'disney-mailbox-v1',requestAt:'2026-10-21T12:00:00Z',requestKey:'a'.repeat(64),state:'confirmed',messageHash:'b'.repeat(64),messageHashes:['b'.repeat(64)],attemptedAt:'2026-10-21T12:00:00Z'}});store.orders[order.key]=order;
 const previous=structuredClone(order.directDelivery);const credentials=vi.fn();const send=vi.fn();
 await syncGbutsDirectCredentials(store,[order],99,{credentials} as any,{openPrivateRoom:async()=> 'room',getChat:async()=>({messages:[]})} as any,()=>{},send);
 expect(send).not.toHaveBeenCalled();expect(credentials).not.toHaveBeenCalled();expect(order.directDelivery).toEqual(previous);
});
test('renewal scans all seller groups and rejects duplicate pages',async()=>{
 const post=(seq:number)=>({seq,createdAt:new Date(Date.UTC(2026,9,21,0,0,seq)).toISOString(),category1:{seq:6},memberLimit:5,memberCount:0,status:'ON_SALE',subscriptionEndsAt:'2026-12-01'});
 const pages:any[][]=[[post(110),post(109)],[post(108),post(107)],[post(106),post(105)]];
 const transport=vi.fn(async(url:any)=>new Response(JSON.stringify({success:true,error:null,response:String(url).endsWith('/view')?post(Number(new URL(String(url)).pathname.split('/').at(-2))):pages[Number(new URL(String(url)).searchParams.get('page'))-1]||[]})));
 const client=createGbutsOttSellerClient('test',transport);expect(await client.latestPostSeq()).toBe(110);transport.mockClear();
 expect((await client.listPostsAfter(108)).map(p=>p.seq)).toEqual([110,109]);expect(transport).toHaveBeenCalledTimes(4);
 pages[0]=[post(109),post(110)];expect(await client.latestPostSeq()).toBe(110);
 pages[0]=[post(110),post(109)];pages[1]=[post(109),post(108)];await expect(client.listPostsAfter(100)).rejects.toThrow('목록이 조회 중 변경');
});
test('full seller discovery tolerates same-second ID ties across page boundaries',async()=>{
 const p=(seq:number,time:string)=>({seq,createdAt:time,category1:{seq:6},memberLimit:5,memberCount:0,status:'ON_SALE',subscriptionEndsAt:'2026-12-01'});
 const time='2026-10-21 23:03:08';
 const pages=[[p(109,time),p(110,time)],[p(112,time),p(111,time)],[p(108,'2026-10-21 23:03:07')]];
 const transport=vi.fn(async(url:any)=>{const u=new URL(String(url));const response=u.pathname.endsWith('/view')?p(110,time):pages[Number(u.searchParams.get('page'))-1]||[];return new Response(JSON.stringify({success:true,error:null,response}));});
 const client=createGbutsOttSellerClient('test',transport);expect(await client.latestPostSeq()).toBe(112);
 expect((await client.listPostsAfter(110)).map(p=>p.seq).sort()).toEqual([111,112]);
 expect(transport.mock.calls.every(([url])=>String(url).includes('/list?page='))).toBe(true);
});
test('ordinary seller history still loads beyond one hundred hourly renewal pages',async()=>{
 const transport=vi.fn(async(url:any)=>{const page=Number(new URL(String(url)).searchParams.get('page'));return new Response(JSON.stringify({success:true,error:null,response:page<=105?[{seq:1000-page,category1:{seq:6},memberLimit:5,memberCount:0,status:'CLOSED',subscriptionEndsAt:'2026-12-01'}]:[]}));});
 expect(await createGbutsOttSellerClient('test',transport).listPosts()).toHaveLength(105);expect(transport).toHaveBeenCalledTimes(106);
});

test('sale terms PUT changes only current public price/title and preserves private fields, dates and notices',async()=>{
 let post:any={seq:100,category1:{seq:6},countries:['KR'],subscriptionType:'SHARE',subscriptionStartsAt:'2026-10-21 00:00:00',subscriptionEndsAt:'2026-12-01 23:59:59',memberLimit:3,memberCount:1,status:'ON_SALE',price:150,priceType:'DAY',title:JSON.stringify({ko:'[디즈니플러스] old'}),description:'성인 인증 직접',noticeBeforeOrder:'before',noticeAfterOrder:'after',subscriptionPrincipal:encrypted('account@example.com'),subscriptionCredential:encrypted('private-password')};
 const writes:any[]=[];
 const transport=vi.fn(async(_url:any,init?:RequestInit)=>{if(init?.method==='PUT'){const body=JSON.parse(String(init.body));writes.push(body);post={...post,...body,title:JSON.stringify({ko:body.title}),subscriptionPrincipal:encrypted(body.subscriptionPrincipal),subscriptionCredential:encrypted(body.subscriptionCredential)};}return new Response(JSON.stringify({success:true,error:null,response:post}));});
 const client=createGbutsOttSellerClient('test',transport);
 await client.updateDisneySaleTerms(await client.getPost(100),{dailyPrice:110,title:'벗츠 업자 최저가 보장 아니면 연장'});
 expect(writes).toHaveLength(1);expect(writes[0]).toMatchObject({price:110,title:'[디즈니플러스] 벗츠 업자 최저가 보장 아니면 연장',memberLimit:3,subscriptionPrincipal:'account@example.com',subscriptionCredential:'private-password',subscriptionStartsAt:'2026-10-21 00:00:00',subscriptionEndsAt:'2026-12-01 23:59:59',description:'성인 인증 직접',noticeBeforeOrder:'before',noticeAfterOrder:'after'});
 await client.updateDisneySaleTerms(await client.getPost(100),{dailyPrice:110,title:'벗츠 업자 최저가 보장 아니면 연장'});expect(writes).toHaveLength(1);
 await expect(client.updateDisneySaleTerms({...post,status:'CLOSED'},{dailyPrice:110,title:'new'})).rejects.toThrow('판매 조건');
});

test('ranking uses the buyer latest Disney list and rejects incomplete, mixed-category or duplicate prefixes',async()=>{
 let rows:any[]=[{seq:100,seller:{seq:99},category1:{seq:6}},{seq:101,seller:{seq:88},category1:{seq:6}}];let count=2;
 const transport=vi.fn(async(url:any)=>{expect(String(url)).toBe('https://api.gbuts.com/api/subscribe/share?categorySeqs=6&page=1&size=20');return new Response(JSON.stringify({success:true,error:null,response:rows,pagination:{currentPage:1,totalCount:count}}));});
 const client=createGbutsOttSellerClient('test',transport);expect(await client.listOttPublicRanking('디즈니플러스')).toEqual([{seq:100,sellerSeq:99},{seq:101,sellerSeq:88}]);
 count=3;await expect(client.listOttPublicRanking('디즈니플러스')).rejects.toThrow('모두 확인');count=2;rows[1].seq=100;await expect(client.listOttPublicRanking('디즈니플러스')).rejects.toThrow('조회 중 변경');rows[1].seq=101;rows[1].category1.seq=5;await expect(client.listOttPublicRanking('디즈니플러스')).rejects.toThrow('상품 종류');
});

test('Netflix rank discovery queries category five and native renewal publication preserves merchant notices',async()=>{
 const transport=vi.fn(async(url:any)=>{expect(String(url)).toBe('https://api.gbuts.com/api/subscribe/share?categorySeqs=5&page=1&size=20');return new Response(JSON.stringify({success:true,error:null,response:[{seq:555,seller:{seq:99},category1:{seq:5}}],pagination:{currentPage:1,totalCount:1}}));});
 const client=createGbutsOttSellerClient('test',transport);expect(await client.listOttPublicRanking('넷플릭스')).toEqual([{seq:555,sellerSeq:99}]);
 const l={...fixtureListing(),serviceType:'넷플릭스',repostFrom:'old',description:'비밀번호로만 로그인. 링키드 닉네임과 동일하게 설정.',noticeBeforeOrder:'닉네임 불일치는 정리될 수 있습니다.',noticeAfterOrder:'비밀번호 입력 전용'};
 const post=buildGbutsOttPost(l,new Date(),{id:'netflix@example.com',password:'secret-current'});
 expect(post).toMatchObject({category:5,subscriptionPrincipal:'netflix@example.com',subscriptionCredential:'secret-current',description:l.description,noticeBeforeOrder:l.noticeBeforeOrder,noticeAfterOrder:l.noticeAfterOrder});
 for(const key of ['description','noticeBeforeOrder','noticeAfterOrder','title'])expect(String(post[key])).not.toContain('secret-current');
});
test('Netflix credential rotation preserves public sale copy and native notices without Disney mailbox instructions',async()=>{
 let post:any={seq:100,category1:{seq:5},subscriptionType:'SHARE',memberLimit:3,memberCount:1,status:'ON_SALE',subscriptionStartsAt:'2026-10-21 00:00:00',subscriptionEndsAt:'2026-12-01 23:59:59',price:190,priceType:'DAY',countries:['KR'],title:JSON.stringify({ko:'[넷플릭스] 비밀번호 로그인'}),description:'이메일함 접근 불가',noticeBeforeOrder:'링키드 닉네임',noticeAfterOrder:'비밀번호 입력 전용',subscriptionPrincipal:encrypted('old@example.com'),subscriptionCredential:encrypted('old-pass')};
 const writes:any[]=[];const transport=vi.fn(async(_url:any,init?:RequestInit)=>{if(init?.method==='PUT'){const body=JSON.parse(String(init.body));writes.push(body);post={...post,...body,title:JSON.stringify({ko:body.title}),subscriptionPrincipal:encrypted(body.subscriptionPrincipal),subscriptionCredential:encrypted(body.subscriptionCredential)};}return new Response(JSON.stringify({success:true,error:null,response:post}));});
 const client=createGbutsOttSellerClient('test',transport);await client.syncNetflixCredentials(post,{id:'new@example.com',password:'new-password'});
 expect(writes[0]).toMatchObject({description:'이메일함 접근 불가',noticeBeforeOrder:'링키드 닉네임',noticeAfterOrder:'비밀번호 입력 전용',memberLimit:3,price:190});
 await client.syncNetflixCredentials(post,{id:'new@example.com',password:'new-password'});expect(writes).toHaveLength(1);
});
