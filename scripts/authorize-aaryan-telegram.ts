import { createServer } from 'node:http';
import { readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { TelegramClient } from 'teleproto';
import { StringSession } from 'teleproto/sessions/index.js';
import { Logger, LogLevel } from 'teleproto/extensions/Logger.js';
import QRCode from 'qrcode';

// Owner-operated, loopback-only one-time login. No browser storage/cookies are read.
const input = process.env.AARYAN_API_INPUT; const output = process.env.AARYAN_AUTH_OUTPUT;
if (!input || !output) throw Error('PRIVATE_AUTH_PATHS_REQUIRED');
const api = JSON.parse(readFileSync(input,'utf8')); const nonce = randomBytes(24).toString('hex');
let status = 'connecting'; let qr = ''; let passwordResolve: ((v:string)=>void) | undefined;
const server = createServer(async (req,res) => {
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  if (!req.url?.startsWith('/'+nonce)) {res.writeHead(404);res.end();return;}
  const address=server.address(); const origin = typeof address==='object'&&address ? `http://127.0.0.1:${address.port}` : '';
  if(req.method==='POST') {
    if(req.headers.origin!==origin || req.url!=='/'+nonce+'/password' || !passwordResolve){res.writeHead(403);res.end();return;}
    let body='';for await(const chunk of req){body+=chunk;if(body.length>4096){res.writeHead(413);res.end();return;}}
    try {const p=JSON.parse(body).password;if(typeof p!=='string'||!p||p.length>512)throw Error();const resolve=passwordResolve;passwordResolve=undefined;resolve(p);res.end('ok');}
    catch{res.writeHead(400);res.end();}return;
  }
  if(req.url==='/' + nonce + '/state'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({status,qr}));return;}
  if(req.url!=='/'+nonce){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type','text/html;charset=utf-8');
  res.end(`<!doctype html><html lang="ko"><meta name="viewport" content="width=device-width"><title>텔레그램 코드 전달 연결</title><style>body{font:17px system-ui;max-width:650px;margin:45px auto;padding:20px}img{width:280px;display:block}input,button{padding:12px;font-size:17px;margin:8px}</style><h1>텔레그램 코드 전달 연결</h1><p>본인 텔레그램 앱 → 설정 → 기기 → 데스크톱 기기 연결에서 QR을 스캔해 주세요.</p><p>이 연결은 벗츠 구매자의 코드 요청에 응답하도록 서버에 저장됩니다. 자동화는 Aaryanac_bot과 지정된 이메일만 사용합니다.</p><img id="qr"><p id="status"></p><form id="form" hidden><label>텔레그램 2단계 인증 비밀번호<input id="pw" type="password" autocomplete="off"></label><button>연결 확인</button></form><script>const root=location.pathname;const statusEl=document.getElementById('status');const f=document.getElementById('form');async function update(){const s=await(await fetch(root+'/state')).json();document.getElementById('qr').src=s.qr;document.getElementById('qr').hidden=s.status!=='scan';f.hidden=s.status!=='password';statusEl.textContent=({connecting:'연결 준비 중',scan:'QR을 스캔해 주세요. 자동 갱신됩니다.',password:'추가 비밀번호가 필요합니다. 이 페이지에 직접 입력해 주세요.',connected:'연결 완료. 창을 닫으셔도 됩니다.',failed:'연결하지 못했습니다. 이 대화에 알려 주세요.'})[s.status]||s.status;}f.onsubmit=async e=>{e.preventDefault();const p=document.getElementById('pw');const password=p.value;p.value='';await fetch(root+'/password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password})});update();};update();setInterval(update,2000);</script></html>`);
});
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve)); const address=server.address();if(!address||typeof address==='string')throw Error('LOOPBACK_REQUIRED');
console.log(JSON.stringify({setupUrl:`http://127.0.0.1:${address.port}/${nonce}`}));
const client = new TelegramClient(new StringSession(''),api.apiId,api.apiHash,{baseLogger:new Logger(LogLevel.NONE),connectionRetries:1,requestRetries:1,autoReconnect:false,deviceModel:'GButs Aaryan code relay',appVersion:'1.0'});
const stop=setTimeout(()=>{void client.destroy();server.close();process.exitCode=1;},30*60_000);
try {
  await client.connect();
  const user=await client.signInUserWithQrCode({apiId:api.apiId,apiHash:api.apiHash},{
    qrCode:async value=>{qr=await QRCode.toDataURL('tg://login?token='+value.token.toString('base64url'),{width:360,margin:2});status='scan';},
    password:async()=>{status='password';return new Promise<string>(resolve=>{passwordResolve=resolve;});},
    onError:async()=>{status='failed';return true;},
  });
  if(String(user.id)!=='1148538638')throw Error('OWNER_IDENTITY_MISMATCH');
  writeFileSync(output,JSON.stringify({apiId:api.apiId,apiHash:api.apiHash,session:client.session.save(),userId:String(user.id),allowedEmails:['angel01@saturnemail.com','ethan@pkriti.com'],expiresAt:'2026-11-25T23:59:59+09:00'}),{mode:0o600});chmodSync(output,0o600);
  status='connected';qr='';console.log('AARYAN_OWNER_SESSION_SAVED');await client.disconnect();
  clearTimeout(stop);setTimeout(()=>server.close(),60_000).unref();
} catch {status='failed';qr='';console.error('AARYAN_OWNER_AUTH_INCOMPLETE');await client.destroy().catch(()=>undefined);clearTimeout(stop);setTimeout(()=>server.close(),60_000).unref();process.exitCode=1;}
