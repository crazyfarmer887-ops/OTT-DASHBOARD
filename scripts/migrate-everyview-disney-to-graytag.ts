/** Owner-authorized one-time transfer. Run with aio-dashboard stopped; never print private fields. */
import { readFileSync, existsSync, mkdirSync, copyFileSync, chmodSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { gbutsOttRuntimeDependencies } from '../src/api/index';
import { readGbutsOttStore, writeGbutsOttStore } from '../src/lib/gbuts-ott-store';
import { writeJsonAtomic, loadGraytagAuthCookies } from '../src/lib/graytag-sales-session';
import { graytagSecondarySessionPath } from '../src/lib/graytag-account-session';
import { loadEveryviewCookieHeader, checkEveryviewSession, fetchEveryviewHostParties, everyviewFetch } from '../src/lib/everyview-api';
import { collectEveryviewDisneyObservation } from '../src/lib/everyview-disney-observation';
import { hideEveryviewRecruitment } from '../src/lib/everyview-recruitment-safety';
import { readEveryviewDisneyInventoryConfig } from '../src/scheduler/everyview-disney-inventory-runtime';
import { readEveryviewDisneyCutoffConfig } from '../src/scheduler/everyview-disney-cutoff';
import { disneyEveryviewAccountKey } from '../src/lib/gbuts-disney-everyview';
import { sharedOttAccounts, ottDate, koreaToday } from '../src/lib/gbuts-ott';
import { readVerifiedGraytagManagementSnapshot, dedupeGraytagManagementDeals } from '../src/lib/graytag-management-snapshot';
import { buildFinishedDealsUrl } from '../src/lib/graytag-fill';
import { safeDisneyEmailAccessUrl } from '../src/lib/disney-mailbox';

const journalPath = process.env.DISNEY_GRAYTAG_TRANSFER_PATH || '/home/ubuntu/.config/gbuts/disney-graytag-secondary-transfers.json';
const inventoryConfigPath = process.env.EVERYVIEW_DISNEY_INVENTORY_CONFIG_PATH || '/home/ubuntu/.config/gbuts/everyview-disney-inventory.json';
const cutoffConfigPath = process.env.EVERYVIEW_DISNEY_CUTOFF_CONFIG_PATH || '/home/ubuntu/.config/gbuts/everyview-disney-cutoff.json';
type Transfer = { partyId: number; accountEmail: string; claimId: string; endDate: string;
  phase: 'reserved'|'removing'|'removed'|'registering'|'registered'|'configured';
  baseline?: string[]; productUsid?: string; retiredAt?: string };
type Journal = { version: 1; records: Record<string, Transfer> };
const readJournal = (): Journal => existsSync(journalPath) ? JSON.parse(readFileSync(journalPath,'utf8')) : {version:1,records:{}};
const save = (j: Journal) => writeJsonAtomic(journalPath,j);
const same = (a:string,b:string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function transferEndDate(today: string): string {
  const date = new Date(`${today}T00:00:00Z`); date.setUTCDate(date.getUTCDate()+29);
  return date.toISOString().slice(0,10);
}
export function transferProductModel(endDate: string) {
  return { tempProductCategory:'disney', endDate:endDate.replace(/-/g,'')+'T2359', priceType:'Normal', price:'3150',
    name:'디즈니 프리미엄 TV가능 / 30일 / 일105원',
    sellingGuide:'디즈니플러스 프리미엄 · TV 이용 가능. 1인 1회선, 지정된 6번 프로필만 이용해 주세요.\n'
      +'판매 종료일 '+endDate+'까지 이용하는 기간제 상품입니다. 오늘 기준 30일 총 3,150원이며 늦게 참여하면 남은 기간이 적용됩니다.\n'
      +'구매 후 ID·비밀번호와 이메일 인증 주소를 자동 안내합니다. 계정·비밀번호·결제 설정과 다른 프로필은 변경하지 마세요.' };
}

// systemctl exits nonzero for an inactive service: inspect its state explicitly.
async function run(apply:boolean) {
  const service=execFileSync('systemctl',['show','aio-dashboard','-p','ActiveState','--value'],{encoding:'utf8'}).trim();
  if(apply && service!=='inactive')throw Error('STOP_AIO_BEFORE_TRANSFER');
  const safe=process.env.SAFE_MODE_PATH||'/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data/safe-mode.json';
  if(existsSync(safe)&&JSON.parse(readFileSync(safe,'utf8')).enabled!==false)throw Error('SAFE_MODE');
  const ev=loadEveryviewCookieHeader(), cookies=loadGraytagAuthCookies(graytagSecondarySessionPath());
  if(!ev||!(await checkEveryviewSession(ev)).valid||!cookies)throw Error('SESSION_REQUIRED');
  const cookieHeader=Object.entries(cookies).filter(([,v])=>v).map(([k,v])=>`${k}=${v}`).join('; ');
  const headers={Cookie:cookieHeader,'User-Agent':'Mozilla/5.0','X-Requested-With':'XMLHttpRequest',Referer:'https://graytag.co.kr/lender/deal/list'};
  const native=async(url:string,init:RequestInit={})=>{
    const r=await fetch(url,{...init,headers:{...headers,...init.headers},redirect:'manual',signal:AbortSignal.timeout(20000)});
    if(!r.ok||r.status>=300)throw Error('GRAYTAG_REQUEST_FAILED_'+r.status);return r;
  };
  const rows=async()=>{
    const snap=await readVerifiedGraytagManagementSnapshot((kind,_finished,page)=>native(buildFinishedDealsUrl(kind,page,100,false)),{includeFinished:false});
    return dedupeGraytagManagementDeals([...snap.beforeOpenDeals,...snap.afterOpenDeals]);
  };
  let allRows=await rows();
  const config=readEveryviewDisneyInventoryConfig();if(!config?.enabled)throw Error('INVENTORY_CONFIG_REQUIRED');
  const journal=readJournal();
  const targets=new Map([...config.parties.map(p=>[p.partyId,p.accountEmail] as const),
    ...Object.values(journal.records).map(p=>[p.partyId,p.accountEmail] as const)]);
  if(!targets.size)throw Error('NO_TRANSFER_TARGETS');
  const management=await gbutsOttRuntimeDependencies.renewalManagement!('디즈니플러스');
  const manual=gbutsOttRuntimeDependencies.manualMembers();
  const owned=await fetchEveryviewHostParties(ev);
  // Verify every target before removing any buyer-facing party.
  for(const [partyId,email] of targets){
    const prior=journal.records[String(partyId)];
    if(!prior||prior.phase==='reserved'||(prior.phase==='removing'&&owned.some(p=>p.partyId===partyId))){
      const observation=await collectEveryviewDisneyObservation(ev,{partyId,accountEmail:email});
      if(observation.members.length||observation.visibleEmptySlots!==1)throw Error('PARTY_HAS_BUYER_OR_UNKNOWN_SEATS');
    }
    const store=readGbutsOttStore(),key=disneyEveryviewAccountKey(email);
    const account=sharedOttAccounts(management,manual,store).find(a=>a.serviceType==='디즈니플러스'&&same(a.accountEmail,email));
    const duplicatedHold=prior&&store.graytagClaims[prior.claimId]&&store.disneyEveryview?.[key]?1:0;
    if(!account||account.total!==6||account.occupied-duplicatedHold>6||account.endDate<(prior?.endDate||transferEndDate(koreaToday())))throw Error('ACCOUNT_CAPACITY_OR_PERIOD');
    const mapping=store.disneyEveryview?.[key];
    if(!prior && (!mapping||mapping.partyIds.length!==1||mapping.partyIds[0]!==partyId||account.everyview!==1||account.occupied>6))throw Error('SOURCE_RESERVATION_REQUIRED');
    if(!prior && allRows.some(r=>same(String(r.keepAcct||''),email)))throw Error('SECONDARY_ACCOUNT_ALREADY_PRESENT');
    const source=Object.values(store.listings).find(l=>l.serviceType==='디즈니플러스'&&same(l.accountEmail,email)&&l.deliveryMode==='disney-numbered-password');
    if(!source)throw Error('ACCOUNT_BINDING_REQUIRED');
    const credentials=await gbutsOttRuntimeDependencies.listingCredentials!(source);
    if(!same(credentials.id,email)||!safeDisneyEmailAccessUrl(credentials.emailAccessUrl,credentials.id))throw Error('DELIVERY_CONFIGURATION_REQUIRED');
    console.log(JSON.stringify({partyId,buyers:0,profile:6,endDate:prior?.endDate||transferEndDate(koreaToday()),dailyPrice:105,preflight:true}));
  }
  if(!apply)return;
  const backupDir=journalPath.replace(/\/[^/]+$/,'')+'/transfer-backup-'+Date.now();mkdirSync(backupDir,{recursive:true,mode:0o700});
  for(const [i,path] of [process.env.GBUTS_OTT_STORE_PATH||'/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data/gbuts-ott-sales.json',inventoryConfigPath,cutoffConfigPath].entries()){
    if(existsSync(path)){const out=backupDir+'/'+i+'.json';copyFileSync(path,out);chmodSync(out,0o600);}
  }
  for(const [partyId,email] of targets){
    const id=String(partyId),key=disneyEveryviewAccountKey(email);
    let record=journal.records[id];
    if(!record){record=journal.records[id]={partyId,accountEmail:email,claimId:'everyview-to-graytag-secondary-'+id,
      endDate:transferEndDate(koreaToday()),phase:'reserved'};save(journal);}
    const store=readGbutsOttStore();
    if(!store.graytagClaims[record.claimId]){
      store.graytagClaims[record.claimId]={id:record.claimId,serviceType:'디즈니플러스',accountEmail:email,state:'pending',createdAt:new Date().toISOString(),
        accountId:'secondary',profileNumber:6,endDate:record.endDate,sourceEveryviewPartyId:partyId};writeGbutsOttStore(store);
    }
    if(record.phase==='reserved'){
      const observation=await collectEveryviewDisneyObservation(ev,{partyId,accountEmail:email});if(observation.members.length)throw Error('BUYER_ARRIVED');
      if(!(await hideEveryviewRecruitment(ev,partyId)).ok)throw Error('HIDE_UNCONFIRMED');
      if((await collectEveryviewDisneyObservation(ev,{partyId,accountEmail:email})).members.length)throw Error('BUYER_ARRIVED');
      record.phase='removing';save(journal);
      try {await everyviewFetch('https://everyview.kr/api/generalParty/disbandParty',{cookieStr:ev,referer:`/partyLeader_free_detail_type1?id=${partyId}`,
        method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({partyId:id}).toString()});}catch{/* Read back only. */}
    }
    if(record.phase==='removing'){
      if(!(await checkEveryviewSession(ev)).valid||(await fetchEveryviewHostParties(ev)).some(p=>p.partyId===partyId))throw Error('DELETE_UNCONFIRMED_NO_RETRY');
      record.retiredAt=new Date().toISOString();record.phase='removed';save(journal);
    }
    if(record.retiredAt){
      const latest=readGbutsOttStore();latest.retiredEveryviewPartyIds=[...new Set([...(latest.retiredEveryviewPartyIds||[]),partyId])];
      delete latest.disneyEveryview?.[key];latest.graytagClaims[record.claimId].everyviewRetiredAt=record.retiredAt;writeGbutsOttStore(latest);
      const inventory=readEveryviewDisneyInventoryConfig(),cutoff=readEveryviewDisneyCutoffConfig();
      if(inventory){inventory.parties=inventory.parties.filter(p=>p.partyId!==partyId);writeJsonAtomic(inventoryConfigPath,inventory);}
      if(cutoff){cutoff.parties=cutoff.parties.filter(p=>p.partyId!==partyId);writeJsonAtomic(cutoffConfigPath,cutoff);}
    }
    const model=transferProductModel(record.endDate);
    if(record.phase==='removed'){
      allRows=await rows();record.baseline=allRows.map(r=>String(r.productUsid));record.phase='registering';save(journal);
      const form=new FormData();form.set('productModel',new Blob([JSON.stringify(model)],{type:'application/json'}),'blob');
      try {
        const result=await (await native('https://graytag.co.kr/ws/lender/registerProduct',{method:'POST',body:form})).json() as any;
        if(result.succeeded===true&&typeof result.data==='string'&&result.data){record.productUsid=result.data;record.phase='registered';save(journal);}
      }catch{/* Never repeat an uncertain CREATE. */}
    }
    if(record.phase==='registering'){
      const candidates=(await rows()).filter(r=>!record.baseline?.includes(String(r.productUsid))&&r.name===model.name
        &&r.productTypeString==='디즈니플러스'&&ottDate(r.endDateTime)===record.endDate);
      if(candidates.length!==1)throw Error('CREATE_UNCONFIRMED_NO_RETRY');
      record.productUsid=String(candidates[0].productUsid);record.phase='registered';save(journal);
    }
    const latest=readGbutsOttStore(),claim=latest.graytagClaims[record.claimId];claim.productUsid=record.productUsid;claim.state='uncertain';writeGbutsOttStore(latest);
    const source=Object.values(latest.listings).find(l=>l.serviceType==='디즈니플러스'&&same(l.accountEmail,email)&&l.deliveryMode==='disney-numbered-password')!;
    const creds=await gbutsOttRuntimeDependencies.listingCredentials!(source);
    const memo=`6번 프로필만 이용해 주세요. 기존 1~5번 프로필은 다른 이용자가 사용 중입니다.\n이용 종료일: ${record.endDate}\n이메일 인증: ${creds.emailAccessUrl}${creds.emailAccessPin?'\n이메일 PIN: '+creds.emailAccessPin:''}\n계정 이메일·비밀번호·결제 설정과 다른 프로필은 변경하지 마세요.`;
    if(record.phase!=='configured'){
      const result=await (await native('https://graytag.co.kr/ws/lender/updateProductKeepAcct',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({productUsid:record.productUsid,keepAcct:creds.id,keepPasswd:creds.password,keepMemo:memo})})).json() as any;
      if(result.succeeded!==true)throw Error('AUTO_DELIVERY_SAVE_FAILED');
    }
    const saved=(await rows()).find(r=>String(r.productUsid)===record.productUsid);
    if(!saved||!same(String(saved.keepAcct||''),creds.id)||saved.keepPasswd!==creds.password||!String(saved.keepMemo||'').includes('6번')
      ||!String(saved.keepMemo||'').includes(creds.emailAccessUrl!)||ottDate(saved.endDateTime)!==record.endDate)throw Error('AUTO_DELIVERY_READBACK_FAILED');
    const final=readGbutsOttStore();final.graytagClaims[record.claimId].state='registered';writeGbutsOttStore(final);
    record.phase='configured';save(journal);
    console.log(JSON.stringify({partyId,sourceDeleted:true,productUsid:record.productUsid,profile:6,dailyPrice:105,totalPrice:3150,endDate:record.endDate,autoDeliveryVerified:true}));
  }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  run(process.argv.includes('--apply')).catch(error=>{const code=error instanceof Error&&/^[A-Z_0-9]+$/.test(error.message)?error.message:'TRANSFER_HELD';console.error(code+': inspect private journal; never repeat uncertain provider writes');process.exitCode=1;});
}
