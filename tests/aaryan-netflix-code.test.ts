import { describe, expect, it } from 'vitest';
import { parseAaryanCode, netflixCodeRequestKind, AARYAN_BOT_ID } from '../src/lib/aaryan-netflix-code';
const fixture = () => ({ text:'🚪 넷플릭스 인증 코드:\nfixture@example.com\n765432\n🌍 계정 국가: UK\n📅 이메일 시간: 27/10, 02:34 PM (Seoul)',senderId:AARYAN_BOT_ID,
  messageId:101,replyTo:100,queryMessageId:100,email:'fixture@example.com',kind:'account' as const,requestedAt:'2026-10-27T05:35:00Z',now:new Date('2026-10-27T05:36:00Z') });
describe('Aaryan code correlation and freshness',()=>{
  it('extracts only the exact account code with a correlated bot reply and Seoul email time',()=>{
    expect(parseAaryanCode(fixture())).toMatchObject({code:'765432',email:'fixture@example.com',kind:'account',receivedAt:'2026-10-27T05:34:00.000Z'});
  });
  it('distinguishes four-digit sign-in codes from six-digit account codes',()=>{
    const f=fixture();const text=f.text.replace('인증 코드','로그인 코드').replace('765432','4321');
    expect(parseAaryanCode({...f,text,kind:'login'})).toMatchObject({code:'4321',kind:'login'});
    expect(parseAaryanCode({...f,text})).toBeUndefined();
  });
  it.each(['sender','reply','email','ambiguous-email','stale','before-request','future','reset','no-code','ambiguous-code','bad-time'] as const)('rejects %s evidence',type=>{
    const f=fixture();
    if(type==='sender')f.senderId='999';if(type==='reply')f.replyTo=99;if(type==='email')f.email='other@example.com';
    if(type==='ambiguous-email')f.text+='\nother@example.com';if(type==='stale')f.now=new Date('2026-10-27T05:55:00Z');
    if(type==='before-request')f.requestedAt='2026-10-27T05:37:00Z';if(type==='future')f.now=new Date('2026-10-27T05:30:00Z');
    if(type==='reset')f.text+='\nPassword reset https://example.com/reset';if(type==='no-code')f.text=f.text.replace('765432','');
    if(type==='ambiguous-code')f.text=f.text.replace('765432','765432\n654321');if(type==='bad-time')f.text=f.text.replace('(Seoul)','(India)');
    expect(parseAaryanCode(f)).toBeUndefined();
  });
  it('uses the closest year at the Seoul year boundary',()=>{
    const f=fixture();f.text=f.text.replace('27/10, 02:34 PM','31/12, 11:59 PM');f.now=new Date('2027-01-01T00:00:00+09:00');f.requestedAt='2027-01-01T00:00:00+09:00';
    expect(parseAaryanCode(f)?.receivedAt).toBe('2026-12-31T14:59:00.000Z');
  });
  it('recognizes explicit code requests without selecting password resets or guessing an ambiguous code type',()=>{
    expect(netflixCodeRequestKind('4자리 로그인 코드 주세요')).toBe('login');expect(netflixCodeRequestKind('6자리 인증번호 주세요')).toBe('account');
    expect(netflixCodeRequestKind('이메일 코드 요청합니다')).toBe('ambiguous');expect(netflixCodeRequestKind('비밀번호 재설정 코드')).toBeUndefined();
    expect(netflixCodeRequestKind('아이디 비번 주세요')).toBeUndefined();
  });
});

it('portal lookup allows a valid older code while legacy request binding stays strict',()=>{const f=fixture();f.now=new Date('2026-10-27T05:44:00Z');f.requestedAt=f.now.toISOString();expect(parseAaryanCode(f)).toBeUndefined();expect(parseAaryanCode({...f,lookbackMs:900000})).toMatchObject({code:'765432'});});
