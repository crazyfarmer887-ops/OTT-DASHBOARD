import { describe, expect, test, vi } from 'vitest';
import { maskNotionChat, extractNotionChatWithOpenRouter, cachedNotionChatExtraction, NOTION_CHAT_EXTRACTION_MODEL, type ExtractionTurn } from '../src/api/notion-chat-extraction';
import { syncGbutsSpotifyCredentials, type SpotifyNotionRow } from '../src/scheduler/gbuts-spotify-sync';
const turns: ExtractionTurn[] = [{role:'buyer',text:'주문번호: 261005TEST1, 스포티파이 아이디: buyer@yahoo.com 암호: PaSs579#@!',time:'2026-10-05T10:35:00Z'}];
function transportFor(input: readonly ExtractionTurn[], email='buyer@yahoo.com', password: string|null='PaSs579#@!', confidence=0.99) {
 const masked=maskNotionChat(input);
 const answer={email:masked.evidence.find(item=>item.value===email)?.id??'VALUE_999',password:password===null?null:masked.evidence.find(item=>item.value===password)?.id??'VALUE_999',confidence};
 return vi.fn(async (_url: string|URL|Request,_init?:RequestInit)=>Response.json({choices:[{message:{content:JSON.stringify(answer)}}]}));
}
describe('OpenRouter Notion extraction',()=>{
 test('sends masked incident context through the exact requested model and restores exact credentials',async()=>{
  const transport=transportFor(turns);
  expect(await extractNotionChatWithOpenRouter(turns,'credentials',transport,'fixture-key')).toEqual({email:'buyer@yahoo.com',password:'PaSs579#@!',receivedAt:turns[0].time});
  const request=JSON.parse(String(transport.mock.calls[0][1]?.body));
  expect(request.model).toBe(NOTION_CHAT_EXTRACTION_MODEL);
  for(const secret of ['buyer@yahoo.com','PaSs579#@!','261005TEST1'])expect(String(transport.mock.calls[0][1]?.body)).not.toContain(secret);
  expect(request.messages[1].content).toContain('암호:');
 });
 test('masks labeled unicode passwords and standalone passwords even when matching a common label',()=>{
  for(const text of ['아이디: buyer@yahoo.com 암호: 한글비번123!','아이디: buyer@yahoo.com\npassword: password','buyer@yahoo.com\npassword']){
   const payload=JSON.stringify(maskNotionChat([{role:'buyer',text}]).conversation);
   expect(payload).not.toContain('buyer@yahoo.com');expect(payload).not.toContain('한글비번123!');
   if(text.endsWith('\npassword'))expect(payload).not.toContain('password');
  }
 });
 test('normalizes explicit email separators while preserving password case and punctuation',async()=>{
  const input:ExtractionTurn[]=[{role:'buyer',text:'ID: buyer ＠ yahoo．com 비번: AbＣ123.@!',time:'today'}];
  expect(await extractNotionChatWithOpenRouter(input,'credentials',transportFor(input,'buyer@yahoo.com','AbＣ123.@!'),'key')).toMatchObject({email:'buyer@yahoo.com',password:'AbＣ123.@!'});
 });
 test('accepts separately submitted buyer password and derives its actual timestamp',async()=>{
  const input:ExtractionTurn[]=[{role:'seller',text:'아이디 비번 남겨주세요'}, {role:'buyer',text:'buyer@yahoo.com',time:'first'}, {role:'buyer',text:'PaSs579#@!',time:'second'}];
  expect(await extractNotionChatWithOpenRouter(input,'credentials',transportFor(input),'key')).toMatchObject({receivedAt:'second'});
 });
 test('preserves an entire standalone multilingual password reply',async()=>{
  const input:ExtractionTurn[]=[{role:'seller',text:'아이디 비번 남겨주세요'}, {role:'buyer',text:'buyer@yahoo.com'}, {role:'buyer',text:'하늘ABC123!'}];
  expect(JSON.stringify(maskNotionChat(input).conversation)).not.toContain('하늘ABC123!');
  expect(await extractNotionChatWithOpenRouter(input,'credentials',transportFor(input,'buyer@yahoo.com','하늘ABC123!'),'key')).toMatchObject({password:'하늘ABC123!'});
 });
 test('rejects seller credentials and reusing an old password after a changed email',async()=>{
  const input:ExtractionTurn[]=[{role:'seller',text:'ID: buyer@yahoo.com 암호: PaSs579#@!'}];
  const request=transportFor(input);expect(await extractNotionChatWithOpenRouter(input,'credentials',request,'key')).toBeNull();expect(request).not.toHaveBeenCalled();
  const changed:ExtractionTurn[]=[{role:'buyer',text:'암호: PaSs579#@!'}, {role:'buyer',text:'ID: buyer@yahoo.com'}];
  expect(await extractNotionChatWithOpenRouter(changed,'credentials',transportFor(changed),'key')).toBeNull();
 });
 test.each([0.5,NaN,1.01])('rejects low or invalid confidence %s',async confidence=>{
  expect(await extractNotionChatWithOpenRouter(turns,'credentials',transportFor(turns,undefined,undefined,confidence),'key')).toBeNull();
 });
 test('rejects invented values, malformed replies and partial pairs',async()=>{
  expect(await extractNotionChatWithOpenRouter(turns,'credentials',transportFor(turns,'madeup@gmail.com'),'key')).toBeNull();
  expect(await extractNotionChatWithOpenRouter(turns,'credentials',transportFor(turns,undefined,null),'key')).toBeNull();
  expect(await extractNotionChatWithOpenRouter(turns,'credentials',async()=>Response.json({choices:[{message:{content:'not json'}}]}),'key')).toBeNull();
 });
 test('caches unchanged chats but retries changed input and does not switch provider on failure',async()=>{
  const input=turns.map(turn=>({...turn,text:turn.text+' 테스트캐시'}));const transport=transportFor(input);
  vi.stubEnv('OPENROUTER_API_KEY','key');vi.stubGlobal('fetch',transport);
  try{
   const values=await Promise.all([cachedNotionChatExtraction(input,'credentials'),cachedNotionChatExtraction(input,'credentials')]);expect(values[0]).toEqual(values[1]);expect(transport).toHaveBeenCalledTimes(1);
   await cachedNotionChatExtraction([...input,{role:'buyer',text:'확인 부탁드려요'}],'credentials');expect(transport).toHaveBeenCalledTimes(2);
   transport.mockImplementation(async()=>new Response('',{status:429}));
   expect(await cachedNotionChatExtraction([...input,{role:'buyer',text:'재시도캐시'}],'credentials')).toBeNull();
   expect(transport.mock.calls.every(call=>String(call[0]).startsWith('https://openrouter.ai/'))).toBe(true);
  }finally{vi.unstubAllGlobals();vi.unstubAllEnvs();}
 });
 test('imports the original missed message into one order-linked Notion row using the model extractor',async()=>{
  let rows:SpotifyNotionRow[]=[];const transport=transportFor(turns);
  const deps={listMembers:async()=>[{seq:91,userSeq:42,productId:'SPOT123',status:'APPLY',cancelStatus:null}],openPrivateRoom:async()=> 'ROOM',getChat:async()=>({roomId:'ROOM',members:[],messages:[{senderSeq:42,message:turns[0].text,messageType:'TEXT',createdAt:turns[0].time!}]}),extractCredentials:async()=>extractNotionChatWithOpenRouter(turns,'credentials',transport,'key'),listRows:async()=>rows,getRow:async()=>rows[0],createRow:vi.fn(async(orderKey,credentials)=>{const row={id:'page',orderKey,emailHistory:[],...credentials,invited:false,cancelled:false};rows.push(row);return row;}),replaceCredentials:vi.fn(),cancelRow:vi.fn()};
  expect(await syncGbutsSpotifyCredentials(deps,15557)).toMatchObject({created:1,waitingForCredentials:0});expect(rows[0]).toMatchObject({orderKey:'15557:91',email:'buyer@yahoo.com',password:'PaSs579#@!'});
  expect(await syncGbutsSpotifyCredentials(deps,15557)).toMatchObject({created:0});expect(deps.createRow).toHaveBeenCalledTimes(1);
 });
});
