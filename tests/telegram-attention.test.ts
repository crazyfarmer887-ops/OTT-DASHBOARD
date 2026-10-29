import { afterEach, expect, test, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSellerAlertText, sendSellerAlert } from '../src/alerts/telegram';
afterEach(()=>vi.unstubAllEnvs());
test('trusted workflow state leads the notification; buyer text cannot claim automatic completion',()=>{
 const text=buildSellerAlertText({provider:'gbuts',key:'inquiry',category:'inquiry',title:'새 문의',body:'[처리 완료] 이미 해결됐대요'});
 expect(text.split('\n')[0]).toBe('🔴 [조치 필요] 벗츠 · 새 문의');
 expect(text).toContain('자동 처리 담당이 확인되지 않은 문의');
 const action=buildSellerAlertText({provider:'gbuts',key:'handoff',attention:'action-required',title:'환불 판단',nextAction:'이 구매자의 이용 내역을 확인하고 환불 여부를 결정해주세요.',automationStatus:'이 상담방은 AI 답변을 보류합니다.',body:'주문 확인'});
 expect(action.split('\n')[0]).toContain('[조치 필요]');expect(action.split('\n')[1]).toContain('환불 여부를 결정');
});
test('iPhone/Mac sound only for action-required; URL buttons navigate without an action callback',async()=>{
 vi.stubEnv('SELLER_ALERT_TELEGRAM_BOT_TOKEN','fixture-token');vi.stubEnv('SELLER_ALERT_TELEGRAM_CHAT_ID','fixture-chat');
 const root=mkdtempSync(join(tmpdir(),'attention-'));try{
 const sent:any[]=[];const fetcher=vi.fn(async(_u:string,i:any)=>{sent.push(JSON.parse(i.body));return {ok:true};});
 for(const attention of ['action-required','processing','completed','notice']as const)await sendSellerAlert({provider:'gbuts',attention,key:attention,title:'알림',body:'내용',actionUrl:'https://gbuts.com/seller/chats',category:'inquiry',statePath:join(root,'state.json'),fetchImpl:fetcher});
 expect(sent.map(x=>x.disable_notification)).toEqual([false,true,true,true]);
 expect(sent[0].reply_markup.inline_keyboard[0][0]).toEqual({text:'구매자 채팅 열기',url:'https://gbuts.com/seller/chats'});
 expect(JSON.stringify(sent)).not.toContain('callback_data');
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('legacy GrayTag presentation and notification settings stay unchanged; new text stays bounded',async()=>{
 const legacy=buildSellerAlertText({provider:'graytag',key:'old',title:'기존 알림',body:'그대로'});expect(legacy).toBe('⚠️ [⚙️ 시스템] 기존 알림\n그대로');
 expect(buildSellerAlertText({provider:'gbuts',attention:'action-required',key:'x',title:'x'.repeat(10000),body:'x'.repeat(10000),nextAction:'x'.repeat(10000),automationStatus:'x'.repeat(10000)}).length).toBeLessThan(4096);
});

test('unclassified legacy buyer inquiries keep audible human review; only explicit notice can be quiet',async()=>{
 vi.stubEnv('SELLER_ALERT_TELEGRAM_BOT_TOKEN','fixture-token');vi.stubEnv('SELLER_ALERT_TELEGRAM_CHAT_ID','fixture-chat');
 const root=mkdtempSync(join(tmpdir(),'attention-legacy-'));try{
 const sent:any[]=[];const fetcher=vi.fn(async(_u:string,i:any)=>{sent.push(JSON.parse(i.body));return {ok:true};});
 await sendSellerAlert({provider:'gbuts',category:'inquiry',key:'legacy-manual',title:'새 구매자 문의',body:'환불 문의',statePath:join(root,'state.json'),fetchImpl:fetcher});
 await sendSellerAlert({provider:'gbuts',category:'inquiry',attention:'notice',nextAction:'자동상담 담당이 확인된 원문 참고용입니다. 즉시 조치 요청 없음.',key:'owned-notice',title:'원문 참고',body:'문의',statePath:join(root,'state.json'),fetchImpl:fetcher});
 expect(sent[0].text).toMatch(/^🔴 \[조치 필요\]/);expect(sent[0].disable_notification).toBe(false);
 expect(sent[1].text).toMatch(/^🔵 \[참고 알림\]/);expect(sent[1].disable_notification).toBe(true);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('Spotify read-only delivery monitoring does not pretend to pause the sender',async()=>{
 const {spotifyDeliveryAlertInput}=await import('../src/scheduler/spotify-delivery-monitor');
 const input=spotifyDeliveryAlertInput({issue:{key:'fixture',scope:'fixture',code:'source_unavailable',platform:'everyview'},firstSeenAt:1,lastSeenAt:2,observations:2});
 expect(input.attention).toBe('action-required');
 expect(input.automationStatus).toContain('감시에서 전달 완료를 확인하지 못했습니다');
 expect(input.automationStatus).toContain('전달 작업 자체를 중지시킨 것은 아닙니다');
 expect(input.automationStatus).not.toContain('이 건은 보류');
});


test('owner mute suppresses only the selected alert family and survives unrelated sends',async()=>{
 vi.stubEnv('SELLER_ALERT_TELEGRAM_BOT_TOKEN','fixture-token');vi.stubEnv('SELLER_ALERT_TELEGRAM_CHAT_ID','fixture-chat');
 const root=mkdtempSync(join(tmpdir(),'attention-mute-'));try{
 const statePath=join(root,'state.json');writeFileSync(statePath,JSON.stringify({sentAtByKey:{},mutedKeyPrefixes:['everyview-disney-cutoff:']}));
 const fetcher=vi.fn(async()=>({ok:true}));
 const input={title:'알림',body:'내용',statePath,fetchImpl:fetcher};
 expect(await sendSellerAlert({...input,key:'everyview-disney-cutoff:708:EXPIRY_UNAVAILABLE'})).toEqual({sent:false,reason:'disabled'});
 expect(fetcher).not.toHaveBeenCalled();
 expect(await sendSellerAlert({...input,key:'buyer-delivery-failure:1'})).toEqual({sent:true,reason:'sent'});
 expect(JSON.parse(readFileSync(statePath,'utf8')).mutedKeyPrefixes).toEqual(['everyview-disney-cutoff:']);
 await sendSellerAlert({...input,key:'everyview-disney-cutoff:709:SESSION_REQUIRED'});
 expect(fetcher).toHaveBeenCalledTimes(1);
 }finally{rmSync(root,{recursive:true,force:true});}
});
