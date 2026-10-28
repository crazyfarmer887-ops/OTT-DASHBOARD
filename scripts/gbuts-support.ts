import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFileSync, existsSync, mkdirSync, openSync, writeFileSync, fsyncSync, renameSync, closeSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadGbutsSession } from '../src/lib/gbuts-session';
import { createGbutsOttSellerClient, type GbutsOttMember, type GbutsOttPost } from '../src/lib/gbuts-ott-client';
import { loadSafeModeConfig } from '../src/api/safe-mode';
import { sendGbutsSingleText } from '../src/scheduler/gbuts-spotify-messages';
import { sendSellerAlert } from '../src/alerts/telegram';
import { processInquiry, promotionAllowed, type Config, type Context, type Journal, type Proof } from '../src/support/engine';
import { difyPlan, modelPlan } from '../src/support/dify';
import { POLICY_VERSION, time, hash } from '../src/support/policy';

const root=process.env.GBUTS_SUPPORT_ROOT||'/home/ubuntu/.config/gbuts/support';
const read=<T>(file:string):T=>JSON.parse(readFileSync(root+'/'+file,'utf8'));
export function durable(file:string,value:unknown){const p=root+'/'+file;mkdirSync(dirname(p),{recursive:true,mode:0o700});const tmp=p+'.'+process.pid+'.tmp';const fd=openSync(tmp,'w',0o600);try{writeFileSync(fd,JSON.stringify(value,null,2));fsyncSync(fd)}finally{closeSync(fd)}renameSync(tmp,p);chmodSync(p,0o600);const dir=openSync(dirname(p),'r');try{fsyncSync(dir)}finally{closeSync(dir)}}
const service:Record<number,string>={5:'넷플릭스',6:'디즈니플러스',7:'유튜브',20:'스포티파이',530:'MSOffice',495:'iQiyi',491:'WeTV'};
const client=()=>{const s=loadGbutsSession();if(!s)throw Error('GBUTS_SESSION_REQUIRED');return createGbutsOttSellerClient(s.token)};
const safe=()=>{try{return !loadSafeModeConfig().enabled}catch{return false}};
let running=false;let inferenceRunning=false;
const authenticated=(auth:string|undefined)=>{const key=process.env.GBUTS_SUPPORT_BRIDGE_KEY||'';return key.length>=32&&!!auth&&timingSafeEqual(Buffer.from(hash(auth)),Buffer.from(hash('Bearer '+key)))};
const bridge=createServer(async(req,res)=>{
 res.setHeader('Content-Type','application/json');
 if(!authenticated(req.headers.authorization)){res.writeHead(403);res.end('{}');return}
 if(req.method!=='POST'||req.url!=='/plan'||inferenceRunning){res.writeHead(429);res.end('{}');return}
 inferenceRunning=true;try{let body='';for await(const chunk of req){body+=chunk;if(body.length>4000)throw Error('BODY_LIMIT')}const value=JSON.parse(body);const result=await modelPlan(value);res.end(JSON.stringify(result));}catch{res.writeHead(503);res.end('{}')}finally{inferenceRunning=false}
});bridge.requestTimeout=35000;bridge.headersTimeout=5000;bridge.listen(18082,process.env.GBUTS_SUPPORT_BRIDGE_BIND||'172.17.0.1');

async function context(post:GbutsOttPost,member:GbutsOttMember,seller:number,roomId?:string):Promise<Context>{
 const api=client();const room=roomId||await api.openPrivateRoom(post.seq,member.userSeq);const chat=await api.getChat(room);
 if(chat.members.length!==2||!chat.members.some(x=>x&&typeof x==='object'&&'seq' in x&&x.seq===member.userSeq)||!chat.members.some(x=>x&&typeof x==='object'&&'seq' in x&&x.seq===seller))throw Error('ROOM_BINDING_INVALID');
 const active=member.status==='APPLY'&&(!member.cancelStatus||member.cancelStatus==='REFUND_REJECTED')&&time(member.createdAt)<=Date.now()&&time(member.subscriptionEndsAt)>=Date.now();
 const delivered=chat.messages.some(m=>m.senderSeq===seller&&m.messageType==='TEXT'&&(/ID\s*[:：]|아이디\s*[:：]|계정\s*확인|초대.*(?:보냈|완료)|발급.*완료|계정 정보.*전달/i.test(m.message)));
 return {postSeq:post.seq,memberSeq:member.seq,buyerSeq:member.userSeq,sellerSeq:seller,roomId:room,service:service[post.category1.seq]||'기타',active,delivered,messages:chat.messages};
}
async function fresh(c:Context){const api=client(),post=await api.getPost(c.postSeq),members=await api.listOttMembers(c.postSeq);if(post.seller?.seq!==c.sellerSeq||members.length<post.memberCount)throw Error('POST_BINDING_CHANGED');const member=members.filter(m=>m.seq===c.memberSeq&&m.userSeq===c.buyerSeq);if(member.length!==1)throw Error('BUYER_BINDING_CHANGED');return context(post,member[0],c.sellerSeq,c.roomId)}
async function run(){if(running)return;running=true;let status:Record<string,unknown>={state:'checking',checkedAt:new Date().toISOString(),scanned:0,drafts:0,sent:0,handoffs:0,errors:0};try{
 const cfg=read<Config>('config.json');if(cfg.mode==='paused'||!safe()){status.state='paused';return}
 if(cfg.mode==='auto'&&!promotionAllowed(read<Proof>('validation.json'),process.env.GBUTS_SUPPORT_WORKFLOW_ID||'')){status.state='validation_required';return}
 const journal=existsSync(root+'/journal.json')?read<Journal>('journal.json'):{version:1 as const,rooms:{}};if(journal.version!==1||!journal.rooms)throw Error('JOURNAL_INVALID');
 const api=client(),seller=await api.sellerAccountSeq(),posts=(await api.listPosts()).filter(p=>p.memberCount>0&&service[p.category1.seq]&&String(p.subscriptionEndsAt).slice(0,10)>=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Seoul'}));
 for(const post of posts){if(post.seller?.seq!==seller)throw Error('SELLER_MISMATCH');let members:GbutsOttMember[];try{members=await api.listOttMembers(post.seq);if(members.length<post.memberCount)throw Error('ROSTER_INCOMPLETE')}catch{status.errors=Number(status.errors)+1;continue}
 for(const member of members){try{if(member.status!=='APPLY'||time(member.subscriptionEndsAt)<Date.now())continue;const c=await context(post,member,seller);const result=await processInquiry(c,{config:cfg,journal,save:()=>durable('journal.json',journal),infer:difyPlan,fresh:()=>fresh(c),send:t=>sendGbutsSingleText(c.roomId,seller,t),allowed:()=>safe()&&read<Config>('config.json').mode===cfg.mode,alert:async(reason,plans)=>{const out=await sendSellerAlert({provider:'gbuts',category:'inquiry',key:'gbuts-support-'+hash([c.postSeq,c.memberSeq,c.roomId]),title:`벗츠 ${c.service} 상담 확인 필요`,body:`주문: ${c.postSeq}:${c.memberSeq}\n사유: ${reason}\n진행 단계: ${plans.join(', ')}\n자동상담을 멈췄습니다. 해당 1:1 채팅에서 확인해주세요.`,actionUrl:'https://gbuts.com/seller/chats',statePath:root+'/telegram-receipts.json',throttleMs:30*24*3600000});return out.sent||out.reason==='throttled'}});status.scanned=Number(status.scanned)+1;if(result==='draft')status.drafts=Number(status.drafts)+1;if(result==='sent')status.sent=Number(status.sent)+1;if(result==='handoff')status.handoffs=Number(status.handoffs)+1;}catch{status.errors=Number(status.errors)+1;}}
 }
 status.state=Number(status.errors)>0?'partial':'checked';
}catch{status.state='error'}finally{status.completedAt=new Date().toISOString();durable('status.json',status);running=false}}
// A private local status endpoint provides no order/chat/credential data.
createServer((req,res)=>{if(req.url!=='/health'){res.writeHead(404);res.end();return}res.setHeader('Content-Type','application/json');res.end(JSON.stringify(existsSync(root+'/status.json')?read('status.json'):{state:'starting'}));}).listen(18083,'127.0.0.1');
if(!process.argv.includes('--bridge-only')){void run();setInterval(()=>void run(),60000)}
