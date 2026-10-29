import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCipheriv, createHash } from 'node:crypto';
import { emptyGbutsOttStore } from '../src/lib/gbuts-ott';
import { createEveryviewDisneyPublishEvidenceAdapter, noExistingEveryviewDisneyAccount, parseEveryviewDisneyPublicationProof, readEveryviewDisneyPreflight, readEveryviewDisneyPublicationProof } from '../src/lib/everyview-disney-publish-evidence';
import { disneyEveryviewAccountKey } from '../src/lib/gbuts-disney-everyview';

const email='disney@example.com', end='2027-01-24', now=new Date('2026-10-29T00:00:00Z');
const req={ accountEmail:email,accountEndDate:end,profileNumber:6 as const,title:'디즈니 30일',description:'참여일부터 30일' };
const extra=`6번 프로필을 이용해 주세요.\n\n이메일 인증 주소 : https://email-verify.one/email/mail/${email}\n이메일 PIN : 123456`;
const host=`<div class="pld-slot-name pld-slot-name-host">seller</div><span class="pld-login-svc-name">디즈니+</span>
<div data-svc-id="4" data-share-type="ACCOUNT"></div><input class="login-accountId" value="${email}">
<input class="login-accountPassword" value="private-password"><textarea class="login-additionalInfo">${extra}</textarea>
<input type="hidden" id="editPartyId" value="123"><input type="hidden" id="editPaymentType" value="PERIOD">
<input type="hidden" id="editIsRolling" value="Y"><input type="hidden" id="editBaseDays" value="30">
<input id="editUsageFee" value="2,910"><input id="editRecruitCnt" value="1"><input id="editCurrentMemberCnt" value="0">`;
const stat=(label:string,value:string,sub:string)=>`<div class="fpd-stat-item"><div class="fpd-stat-label">${label}</div><div class="fpd-stat-val">${value}</div><div class="fpd-stat-sub">${sub}</div></div>`;
const pub=`<div class="fpd-party-meta">파티ID : <span>s123</span> · 개설</div><span class="fpd-svc-tag">디즈니+ · 프리미엄</span>
${stat('이용기간','30일','참여일부터')}${stat('파티 종료일','기간만료 시','자동 종료')}${stat('이용료','2,910원','월 2,910원 꼴')}${stat('모집 현황','0 / 1','1자리 남음')}`;
const proofArgs={partyId:123,accountEmail:email,owned:true,hostHtml:host,publicHtml:pub,expectedAdditionalInfo:extra,expectedPassword:'private-password'};
afterEach(()=>vi.unstubAllGlobals());

describe('Everyview seller and public read-back evidence',()=>{
  it('requires matching owner, account, rolling 30-day price, capacity and exact profile notice',()=>{
    expect(parseEveryviewDisneyPublicationProof(proofArgs)).toMatchObject({partyId:123,accountEmail:email,periodTermType:'ROLLING',usageDays:30,
      totalUsageFee:2910,oneDayUsageFee:97,monthUsageFee:2910,buyerCapacity:1,profileNumber:6});
    for(const patch of [{owned:false},{partyId:124},{accountEmail:'other@example.com'},
      {hostHtml:host.replace('editIsRolling" value="Y','editIsRolling" value="N')},
      {hostHtml:host.replace('editBaseDays" value="30','editBaseDays" value="31')},
      {hostHtml:host.replace('6번 프로필','5번 프로필')},
      {hostHtml:host.replace('private-password','other-password')},
      {hostHtml:host.replace('123456','654321')},
      {hostHtml:host.replace('editRecruitCnt" value="1','editRecruitCnt" value="2')},
      {hostHtml:host.replace('editUsageFee" value="2,910','editUsageFee" value="2,900')},
      {publicHtml:pub.replace('0 / 1','0 / 2')},{publicHtml:pub.replace('월 2,910원 꼴','월 2,900원 꼴')},
      {publicHtml:pub.replace('참여일부터','공유 종료일 기준')}])
      expect(parseEveryviewDisneyPublicationProof({...proofArgs,...patch})).toBeNull();
  });
  it('uses GET-only owned-party and two fresh detail reads',async()=>{
    const fetchMock=vi.fn(async (input:string|URL|Request,options:RequestInit={})=>{
      expect(options.method || 'GET').toBe('GET');const url=String(input);
      if(url.endsWith('/myParty'))return new Response('<a class="mypg-gc host" href="/partyLeader_free_detail_type1?id=123" data-search="디즈니 s123 disney_plus 디즈니+">party</a>');
      if(url.includes('/partyLeader_free_detail_type1'))return new Response(host);
      if(url.includes('/findParty_free_detail'))return new Response(pub);
      throw Error('unexpected');
    });vi.stubGlobal('fetch',fetchMock);
    expect(await readEveryviewDisneyPublicationProof('private-session',123,email,{additionalInfo:extra,password:'private-password'})).toMatchObject({partyId:123});
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it('does not confirm an unavailable public page or a party absent from the owner list',async()=>{
    vi.stubGlobal('fetch',vi.fn(async (input:string|URL|Request)=>{
      const url=String(input);if(url.endsWith('/myParty'))return new Response('<a class="mypg-gc host" href="/partyLeader_free_detail_type1?id=123">party</a>');
      return url.includes('/findParty_free_detail')?new Response('',{status:404}):new Response(host);
    }));
    expect(await readEveryviewDisneyPublicationProof('private-session',123,email,{additionalInfo:extra,password:'private-password'})).toBeNull();
    expect(await readEveryviewDisneyPublicationProof('private-session',124,email,{additionalInfo:extra,password:'private-password'})).toBeNull();
  });
  it('detects an already-owned Everyview party using the same account',async()=>{
    vi.stubGlobal('fetch',vi.fn(async (input:string|URL|Request)=>String(input).endsWith('/myParty')
      ?new Response('<a class="mypg-gc host" href="/partyLeader_free_detail_type1?id=123" data-search="디즈니 s123 disney_plus 디즈니+">party</a>')
      :new Response(host)));
    expect(await noExistingEveryviewDisneyAccount('private-session',email)).toBe(false);
    expect(await noExistingEveryviewDisneyAccount('private-session','another@example.com')).toBe(true);
  });
});

function encrypted(value:string) {
  const ascii=Buffer.from(createHash('sha512').update('kkmouke0917').digest('hex'),'utf8'),key=Buffer.alloc(16);
  for(let i=0;i<ascii.length;i++)key[i%16]^=ascii[i];
  const cipher=createCipheriv('aes-128-ecb',key,null);return Buffer.concat([cipher.update(value),cipher.final()]).toString('hex');
}
function sourcesFixture(){
  const store=emptyGbutsOttStore();
  store.listings.one={ id:'one',requestHash:'hash',serviceType:'디즈니플러스',accountEmail:email,endDate:end,capacity:5,dailyPrice:110,
    title:'test',description:'test',state:'registered',postSeq:11,createdAt:now.toISOString(),deliveryMode:'disney-numbered-password' } as any;
  const post:any={seq:11,category1:{seq:6},memberLimit:5,memberCount:0,status:'ON_SALE',subscriptionEndsAt:end,
    subscriptionPrincipal:encrypted(email),subscriptionCredential:encrypted('private-password')};
  const management:any={services:[{serviceType:'디즈니플러스',accounts:[{email,serviceType:'디즈니플러스',expiryDate:end,totalSlots:6,members:[],generatedAccount:{paymentStatus:'paid'}}]}],onSaleByKeepAcct:{}};
  const credentials={id:email,password:'private-password',emailAccessUrl:`https://email-verify.one/email/mail/${email}`,emailAccessPin:'123456'};
  const readiness=vi.fn(async()=>({syncReady:true,cutoffReady:true,profileDeliveryReady:true}));
  const gbuts:any={management:vi.fn(async()=>management),manualMembers:()=>[],listingCredentials:vi.fn(async()=>credentials)};
  const sources:any={gbuts,listPosts:vi.fn(async()=>[post]),getPost:vi.fn(async()=>post),listMembers:vi.fn(async()=>[]),
    everyviewNoConflict:vi.fn(async()=>true),readiness,now:()=>now};
  return {store,post,management,credentials,readiness,gbuts,sources};
}
describe('live Disney preflight',()=>{
  it('verifies a single active five-place seller post and the uncommitted sixth place',async()=>{
    const f=sourcesFixture(),result=await readEveryviewDisneyPreflight(f.store,req,f.sources);
    expect(result).toMatchObject({accountHash:disneyEveryviewAccountKey(email),accountEndDate:end,accountCapacity:6,committedOtherPlaces:5,
      profile6Available:true,credentialsValidated:true,syncReady:true});
    expect(JSON.stringify(result)).not.toContain('private-password');expect(JSON.stringify(result)).not.toContain(email);
    expect(f.gbuts.management).toHaveBeenCalledWith({forceRefresh:true});
  });
  it('accepts a one-place repost when four existing buyers remain on the original post',async()=>{
    const f=sourcesFixture();f.store.listings.one.capacity=1;f.post.memberLimit=1;
    f.store.renewals={ [email]:{capacity:5} as any };
    const old={...f.store.listings.one,id:'old',postSeq:10,state:'closed' as const,capacity:4};f.store.listings.old=old;
    const oldPost={...f.post,seq:10,status:'CLOSED',memberLimit:4,memberCount:4};
    const oldMembers=Array.from({length:4},(_,i)=>({seq:i+1,userSeq:i+11,status:'APPLY',cancelStatus:null,subscriptionEndsAt:end}));
    for(const [i,m] of oldMembers.entries())f.store.orders[`10:${m.seq}`]={key:`10:${m.seq}`,listingId:'old',postSeq:10,memberSeq:m.seq,userSeq:m.userSeq,
      status:'APPLY',cancelStatus:null,startDate:'2026-10-29',endDate:end,profileNumber:i+1,profileName:String(i+1),delivery:'confirmed'} as any;
    f.sources.listPosts=vi.fn(async()=>[f.post,oldPost]);
    f.sources.getPost=vi.fn(async(seq:number)=>seq===10?oldPost:f.post);
    f.sources.listMembers=vi.fn(async(seq:number)=>seq===10?oldMembers:[]);
    expect(await readEveryviewDisneyPreflight(f.store,req,f.sources)).toMatchObject({committedOtherPlaces:5,profile6Available:true});
    f.sources.listMembers=vi.fn(async()=>[]);
    await expect(readEveryviewDisneyPreflight(f.store,req,f.sources)).rejects.toThrow('MEMBER_UNVERIFIED');
  });
  it('rejects mismatched expiry, hidden/changed posts, other platform reservations and credentials',async()=>{
    const expiry=sourcesFixture();expiry.management.services[0].accounts[0].expiryDate='2027-01-23';
    await expect(readEveryviewDisneyPreflight(expiry.store,req,expiry.sources)).rejects.toThrow('ACCOUNT_EXPIRY_UNVERIFIED');
    const suspended=sourcesFixture();suspended.post.status='SUSPENDED';
    await expect(readEveryviewDisneyPreflight(suspended.store,req,suspended.sources)).rejects.toThrow('GBUTS_LISTING_UNVERIFIED');
    const occupied=sourcesFixture();occupied.management.onSaleByKeepAcct[email]=[{productUsid:'extra',endDateTime:end}];
    await expect(readEveryviewDisneyPreflight(occupied.store,req,occupied.sources)).rejects.toThrow('ACCOUNT_SEATS_UNVERIFIED');
    const password=sourcesFixture();password.credentials.password='other-password';
    await expect(readEveryviewDisneyPreflight(password.store,req,password.sources)).rejects.toThrow('CREDENTIALS_UNVERIFIED');
    const conflict=sourcesFixture();conflict.sources.everyviewNoConflict=vi.fn(async()=>false);
    await expect(readEveryviewDisneyPreflight(conflict.store,req,conflict.sources)).rejects.toThrow('EVERYVIEW_CONFLICT_OR_UNVERIFIED');
  });
  it('rejects an unrecorded live buyer or any sixth-profile hold',async()=>{
    const unknown=sourcesFixture();unknown.post.memberCount=1;unknown.sources.listMembers=vi.fn(async()=>[{seq:5,userSeq:6,status:'APPLY',cancelStatus:null,subscriptionEndsAt:end}]);
    await expect(readEveryviewDisneyPreflight(unknown.store,req,unknown.sources)).rejects.toThrow('MEMBER_UNVERIFIED');
    const conflict=sourcesFixture();conflict.store.orders['11:5']={key:'11:5',listingId:'one',postSeq:11,memberSeq:5,userSeq:6,
      status:'APPLY',cancelStatus:null,startDate:'2026-10-29',endDate:end,profileNumber:6,profileName:'6',delivery:'confirmed'} as any;
    await expect(readEveryviewDisneyPreflight(conflict.store,req,conflict.sources)).rejects.toThrow('PROFILE_CONFLICT');
    const unknownProfile=sourcesFixture();unknownProfile.store.orders['11:5']={key:'11:5',listingId:'one',postSeq:11,memberSeq:5,userSeq:6,
      status:'APPLY',cancelStatus:null,startDate:'2026-10-29',endDate:end,delivery:'confirmed'} as any;
    await expect(readEveryviewDisneyPreflight(unknownProfile.store,req,unknownProfile.sources)).rejects.toThrow('PROFILE_CONFLICT');
  });
  it('defaults readiness to false and returns credentials only to the caller',async()=>{
    const f=sourcesFixture();const {readiness:_,everyviewNoConflict:__,...sources}=f.sources;
    const spotifyHost=host.replace('디즈니+','스포티파이').replace('data-share-type="ACCOUNT"','data-share-type="INVITE"')
      .replace('editPartyId" value="123','editPartyId" value="999');
    vi.stubGlobal('fetch',vi.fn(async(input:string|URL|Request)=>String(input).endsWith('/myParty')
      ?new Response('<a class="mypg-gc host" href="/partyLeader_free_detail_type1?id=999" data-search="스포티파이 s999 spotify 스포티파이">party</a>')
      :new Response(spotifyHost)));
    const adapter=createEveryviewDisneyPublishEvidenceAdapter({sources,readStore:()=>f.store,cookie:()=>'private-session'});
    expect(await adapter.preflight(f.store,req)).toMatchObject({syncReady:false,cutoffReady:false,profileDeliveryReady:false});
    expect(await adapter.credentials(req)).toEqual({id:email,password:'private-password',emailAccessUrl:`https://email-verify.one/email/mail/${email}`,emailAccessPin:'123456'});
    expect(await adapter.verify(123,req,{additionalInfo:extra,password:'private-password'})).toBeNull();
  });
});
