import {expect,it,vi} from 'vitest';
import {extractSpotifyFulfillmentCredentials,spotifyExistingDetailsPrompt} from '../src/scheduler/spotify-fulfillment-choice';
import {requestedSpotifyNewAccount,syncGbutsSpotifyMessages,SPOTIFY_BUYER_GUIDE} from '../src/scheduler/gbuts-spotify-messages';
import {syncGbutsSpotifyCredentials,type SpotifyNotionRow} from '../src/scheduler/gbuts-spotify-sync';
const msg=(message:string,time='2026-10-28T01:00:00Z')=>({senderSeq:42,message,messageType:'TEXT',createdAt:time});
const member={seq:91,userSeq:42,productId:'801',status:'APPLY',cancelStatus:null};
const issued={email:'spabcdefgh23@jamkkangudok.com',password:'Abcdefgh2345!@#K',receivedAt:'2026-10-28T02:00:00Z'};
it('uses literal credentials before model interpretation and accepts concise new-account selections',async()=>{
 const fallback=vi.fn();expect(await extractSpotifyFulfillmentCredentials([msg('ID: buyer@example.com\n비밀번호: Supplied!123')],42,fallback)).toMatchObject({email:'buyer@example.com',password:'Supplied!123'});expect(fallback).not.toHaveBeenCalled();
 const guide={...msg(SPOTIFY_BUYER_GUIDE),senderSeq:7};
 for(const choice of ['2','2번','②','새 계정이요','신규 계정'])expect(requestedSpotifyNewAccount([guide,msg(choice)],42)).toBeTruthy();
 expect(requestedSpotifyNewAccount([guide,msg('새 계정 가능한가요?')],42)).toBeNull();
 expect(spotifyExistingDetailsPrompt([msg('buyer@example.com')],42)?.suffix).toBe('existing-password');
});
it('asks for the missing password once without importing an incomplete account',async()=>{
 let journal:any={version:1,records:{}};const sendText=vi.fn(async(_room:string,_seller:number,_text:string)=>{});
 const deps={listMembers:async()=>[member],openPrivateRoom:async()=> 'room',getChat:async()=>({messages:[msg('buyer@example.com')]}),sellerAccountSeq:async()=>7,listRows:async()=>[],extractCredentials:async()=>null,sendText,readJournal:()=>journal,writeJournal:(j:any)=>{journal=j}};
 await syncGbutsSpotifyMessages(deps,15557);await syncGbutsSpotifyMessages(deps,15557);
 expect(sendText).toHaveBeenCalledOnce();expect(sendText.mock.calls[0][2]).toContain('비밀번호도');
});
it('a clear later new-account choice converts only a pending exact bound request, not a completed row',async()=>{
 const row:SpotifyNotionRow={id:'page',orderKey:'15557:91',email:'buyer@example.com',password:'Old!12345',emailHistory:[],registered:false,invited:false,cancelled:false};
 const replace=vi.fn(async()=>({...row,...issued,emailHistory:[row.email]}));
 const deps={listMembers:async()=>[member],openPrivateRoom:async()=> 'room',getChat:async()=>({messages:[msg('ID: buyer@example.com\n비밀번호: Old!12345'),msg('새 계정 발급해주세요','2026-10-28T02:00:00Z')]}),listRows:async()=>[row],getRow:async()=>row,createRow:vi.fn(),replaceCredentials:vi.fn(),cancelRow:vi.fn(),replaceWithNewAccountRequestRow:replace};
 expect(await syncGbutsSpotifyCredentials(deps,15557)).toMatchObject({updated:1});expect(replace).toHaveBeenCalledOnce();
 row.invited=true;replace.mockClear();expect(await syncGbutsSpotifyCredentials(deps,15557)).toMatchObject({conflicts:1});expect(replace).not.toHaveBeenCalled();
});

it('uses the latest explicit choice and never treats old account details as the new selection',()=>{
 const entries=[msg('ID: old@example.com\n비밀번호: Old!12345'),msg('새 계정 발급해주세요','2026-10-28T02:00:00Z')];
 expect(requestedSpotifyNewAccount(entries,42)).toBe('2026-10-28T02:00:00Z');
 entries.push(msg('기존 계정으로','2026-10-28T03:00:00Z'));
 expect(requestedSpotifyNewAccount(entries,42)).toBeNull();
 expect(spotifyExistingDetailsPrompt(entries,42)?.suffix).toBe('existing-details');
 expect(requestedSpotifyNewAccount([msg('기존 계정 말고 새 계정 만들어주세요')],42)).toBeTruthy();
 expect(requestedSpotifyNewAccount([msg('새 계정 말고 기존 계정으로')],42)).toBeNull();
});
it('does not send onboarding questions to a completed bound historical buyer',async()=>{
 const sendText=vi.fn();await syncGbutsSpotifyMessages({listMembers:async()=>[member],openPrivateRoom:async()=> 'room',getChat:async()=>({messages:[]}),sellerAccountSeq:async()=>7,listRows:async()=>[{id:'done',orderKey:'15557:91',email:'issued@example.com',password:'Done!12345',emailHistory:[],registered:true,invited:true,cancelled:false}],sendText,readJournal:()=>({version:1,records:{}}),writeJournal:vi.fn()},15557);
 expect(sendText).not.toHaveBeenCalled();
});

it('retains a completed manual issue only with a saved exact seller pair after the same request',async()=>{
 const completed:SpotifyNotionRow={id:'complete',orderKey:'15557:91',email:'manual@jamkkangudok.com',password:'Manual!12345',emailHistory:[],registered:true,invited:true,cancelled:false};
 const request=msg('새 계정 발급해주세요','2026-10-28T02:00:00Z');
 const delivery={...msg('ID : manual@jamkkangudok.com\n비밀번호 : Manual!12345','2026-10-28T03:00:00Z'),senderSeq:7};
 let messages=[request,delivery];const replace=vi.fn();
 const deps={listMembers:async()=>[member],sellerAccountSeq:async()=>7,openPrivateRoom:async()=> 'room',getChat:async()=>({messages}),listRows:async()=>[completed],getRow:async()=>completed,createRow:vi.fn(),replaceCredentials:vi.fn(),cancelRow:vi.fn(),replaceWithNewAccountRequestRow:replace};
 expect(await syncGbutsSpotifyCredentials(deps,15557)).toMatchObject({updated:0,created:0,conflicts:0,waitingForCredentials:0});
 expect(replace).not.toHaveBeenCalled();
 messages=[request];expect(await syncGbutsSpotifyCredentials(deps,15557)).toMatchObject({conflicts:1});
 messages=[request,{...delivery,message:'ID : different@jamkkangudok.com\n비밀번호 : Manual!12345'}];expect(await syncGbutsSpotifyCredentials(deps,15557)).toMatchObject({conflicts:1});
 messages=[request,delivery,msg('새 계정 다시 만들어주세요','2026-10-28T04:00:00Z')];expect(await syncGbutsSpotifyCredentials(deps,15557)).toMatchObject({conflicts:1});
 messages=[request,{...delivery,senderSeq:99}];expect(await syncGbutsSpotifyCredentials(deps,15557)).toMatchObject({conflicts:1});
 expect(replace).not.toHaveBeenCalled();expect(deps.createRow).not.toHaveBeenCalled();
});
