import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
const state=vi.hoisted(()=>({client:undefined as any}));
vi.mock('teleproto',async original=>{const actual=await original<typeof import('teleproto')>();return {...actual,TelegramClient:class{constructor(){return state.client;}}};});
vi.mock('teleproto/sessions/index.js',()=>({StringSession:class{}}));
import {Api} from 'teleproto';import {requestAaryanNetflixCode} from '../src/lib/aaryan-telegram';
let directory:string;
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-27T05:36:00Z'));directory=mkdtempSync(join(tmpdir(),'aaryan-test-'));vi.stubEnv('AARYAN_TELEGRAM_CONFIG_PATH',join(directory,'config.json'));writeFileSync(process.env.AARYAN_TELEGRAM_CONFIG_PATH!,JSON.stringify({apiId:123,apiHash:'a'.repeat(32),session:'fixture',userId:'1148538638',allowedEmails:['fixture@example.com'],expiresAt:'2026-11-25T23:59:59+09:00'}),{mode:0o600});});
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();rmSync(directory,{recursive:true,force:true});});
function fixture(kind:'login'|'account'='login'){
 const button=new Api.KeyboardInlineButton({text:kind==='login'?'🔢 Sign-in Code':'⚠️ Verification Code',type:new Api.InlineButtonTypeCallback({data:Buffer.from('fixture')})});
 const bot=new Api.User({id:BigInt(8731554856),bot:true,username:'Aaryanac_bot'} as never);
 const menu={id:101,senderId:bot.id,message:'📩 인식된 이메일: fixture@example.com\n가져오고 싶은 것을 선택하세요:',replyMarkup:new Api.ReplyInlineMarkup({rows:[new Api.KeyboardButtonRow({buttons:[button]})]})};
 const code={id:102,senderId:bot.id,replyTo:{replyToMsgId:100},message:`넷플릭스 ${kind==='login'?'로그인':'인증'} 코드:\nfixture@example.com\n${kind==='login'?'4321':'765432'}\n이메일 시간: 27/10, 02:35 PM (Seoul)`};
 let polls=0;state.client={connect:vi.fn(),checkAuthorization:vi.fn(async()=>true),getMe:vi.fn(async()=>({id:'1148538638'})),getEntity:vi.fn(async()=>bot),sendMessage:vi.fn(async()=>({id:100})),getMessages:vi.fn(async()=>++polls===1?[menu]:[code]),invoke:vi.fn(),disconnect:vi.fn(async()=>{}),destroy:vi.fn(async()=>{})};
 return {menu,code,client:state.client};
}
it.each(['login','account'] as const)('selects the exact email menu then accepts only its correlated %s reply',async kind=>{const f=fixture(kind);const result=requestAaryanNetflixCode('fixture@example.com',kind,'2026-10-27T05:35:00Z');await vi.advanceTimersByTimeAsync(2100);expect((await result).kind).toBe(kind);expect(f.client.invoke).toHaveBeenCalledOnce();expect(f.client.sendMessage).toHaveBeenCalledOnce();expect(f.client.destroy).toHaveBeenCalledOnce();});
it('rejects an unallocated email before connecting or querying',async()=>{fixture();await expect(requestAaryanNetflixCode('other@example.com','login','2026-10-27T05:35:00Z')).rejects.toThrow('NOT_ALLOWED');expect(state.client.connect).not.toHaveBeenCalled();});
it('does not click a wrong-email menu or accept an uncorrelated code',async()=>{const f=fixture();f.menu.message=f.menu.message.replace('fixture@example.com','other@example.com');f.code.replyTo.replyToMsgId=99;const result=requestAaryanNetflixCode('fixture@example.com','login','2026-10-27T05:35:00Z');const rejected=expect(result).rejects.toThrow('UNCONFIRMED');await vi.advanceTimersByTimeAsync(91_000);await rejected;expect(f.client.invoke).not.toHaveBeenCalled();expect(f.client.destroy).toHaveBeenCalled();});
