import { ensureNetflixPortal, netflixPortalNotice, portalHash, writeNetflixPortalStore, type NetflixPortalRecord } from '../lib/netflix-portal';
import { GbutsChatDeliveryError, splitGbutsChatText } from '../lib/gbuts-chat-delivery';
import { withGbutsOttInventory } from '../lib/gbuts-ott-store';
import { deliverableOttOrder, gbutsOrderListing, hasGbutsOttProfileLease } from '../lib/gbuts-ott';
import { NETFLIX_PORTAL_GUIDE_ASSET } from '../lib/gbuts-netflix-guide';
import { netflixPortalDependencies, verifiedNetflixPortalBinding, type NetflixPortalDependencies } from '../api/netflix-portal';
import type { GbutsOttRuntimeDependencies } from './gbuts-ott-sync';
import { sendGbutsImage, sendGbutsText } from './gbuts-spotify-messages';

type OnboardingDependencies=NetflixPortalDependencies & {write:typeof writeNetflixPortalStore;sendText:typeof sendGbutsText;sendImage:typeof sendGbutsImage};
function providerTime(value:string):number {
  const local=/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value);
  return Date.parse(local ? `${value.replace(' ','T')}+09:00` : value);
}
function purchaseTime(value:string):number {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return Date.parse(`${value}T00:00:00+09:00`);
  return providerTime(value);
}
function onboardingAllowed(deps:OnboardingDependencies):boolean {
  const current=deps.read();return current?.enabled===true&&current.onboardingEnabled===true&&deps.allowed();
}
export async function syncNetflixPortalOnboarding(deps:OnboardingDependencies):Promise<void>{
  let portal=deps.read();if(!portal?.enabled||portal.onboardingEnabled!==true||!deps.allowed())return;
  const inventory=deps.inventory();
  for(const order of Object.values(inventory.orders)){
    const listing=gbutsOrderListing(inventory,order);
    if(listing.serviceType!=='넷플릭스'||listing.emailCodeProvider!=='aaryan'||!deliverableOttOrder(order,deps.now())
      ||!hasGbutsOttProfileLease(inventory,order)||order.delivery!=='confirmed'||!order.roomId||!order.profileNumber)continue;
    // Legacy buyers are explicitly included; new buyers first get their account details.
    const purchased=purchaseTime(order.purchasedAt||order.startDate);
    if(purchased>=Date.parse(portal.activatedAt)&&order.directDelivery?.state!=='confirmed'){
      if(Number.isFinite(purchased)&&deps.now().getTime()-purchased>10*60_000)
        await deps.alert({provider:'gbuts',category:'system',attention:'action-required',key:`netflix-portal-account-wait:${portalHash(order.key)}`,
          title:'넷플릭스 계정 안내 지연',body:'계정 정보 전달 확인이 늦어 인증 페이지 안내도 대기 중입니다.',
          nextAction:'해당 구매자의 계정 정보 전달 및 채팅 상태를 확인해주세요.',actionUrl:`https://gbuts.com/seller/chats/${order.roomId}`,throttleMs:30*60_000}).catch(()=>undefined);
      continue;
    }
    let r:NetflixPortalRecord|undefined;
    let autoRetry=false;
    try{
      if(!deps.allowedEmail(listing.accountEmail.toLowerCase()))throw Error('PROVIDER_NOT_ALLOWED');
      r=ensureNetflixPortal(portal,inventory,order,deps.now().toISOString());deps.write(portal);
      let binding=await verifiedNetflixPortalBinding(r,deps);
      const notice=netflixPortalNotice(r),parts=splitGbutsChatText(notice),hashes=parts.map(portalHash);
      const saved=()=>hashes.every(h=>binding.room.messages.some(m=>m.senderSeq===binding.seller&&m.messageType==='TEXT'&&portalHash(m.message.trim())===h));
      if(r.text.state!=='confirmed'){
        if(saved()){r.text.state='confirmed';r.text.confirmedAt=deps.now().toISOString();deps.write(portal);}
        else if(r.text.state==='ready'){
          if(!onboardingAllowed(deps))return;
          r.text={state:'attempted',hashes,attemptedAt:deps.now().toISOString()};deps.write(portal);
          try{await deps.sendText(order.roomId,binding.seller,notice);}catch(error){if(error instanceof GbutsChatDeliveryError&&!error.submitted){r.text.state=error.retryable?'ready':'blocked';autoRetry=error.retryable;deps.write(portal);}throw error;}
          binding=await verifiedNetflixPortalBinding(r,deps);
          if(saved()){r.text.state='confirmed';r.text.confirmedAt=deps.now().toISOString();deps.write(portal);}else throw Error('TEXT_UNCONFIRMED');
        }else throw Error('TEXT_UNCONFIRMED');
      }
      if(r.text.state==='confirmed'&&r.image.state!=='confirmed'){
        r.image.url ||= NETFLIX_PORTAL_GUIDE_ASSET.url;
        binding=await verifiedNetflixPortalBinding(r,deps);
        // A previous guide image is not proof that this buyer received the image
        // after the current, newly issued portal link and PIN.
        const since=Math.floor(Date.parse(r.text.confirmedAt || '')/1000)*1000;
        const savedImage=()=>Number.isFinite(since)&&binding.room.messages.some(m=>m.senderSeq===binding.seller&&m.messageType==='IMAGE'
          &&providerTime(m.createdAt)>=since&&m.images?.includes(r!.image.url!));
        if(savedImage()){r.image.state='confirmed';r.image.confirmedAt=deps.now().toISOString();deps.write(portal);}
        else if(r.image.state==='ready'){
          if(!onboardingAllowed(deps))return;
          r.image.state='attempted';r.image.attemptedAt=deps.now().toISOString();deps.write(portal);
          try{await deps.sendImage(order.roomId,binding.seller,r.image.url);}catch(error){if(error instanceof GbutsChatDeliveryError&&!error.submitted){r.image.state=error.retryable?'ready':'blocked';autoRetry=error.retryable;deps.write(portal);}throw error;}
          binding=await verifiedNetflixPortalBinding(r,deps);
          if(savedImage()){r.image.state='confirmed';r.image.confirmedAt=deps.now().toISOString();deps.write(portal);}else throw Error('IMAGE_UNCONFIRMED');
        }else throw Error('IMAGE_UNCONFIRMED');
      }
      delete r.error;delete r.retryCount;deps.write(portal);
    }catch{
      if(r){r.retryCount=(r.retryCount||0)+1;r.error=autoRetry?'안내 연결 실패 — 자동 재시도 중':'구매자 연결 또는 안내 저장 결과 확인 필요';deps.write(portal);}
      if(autoRetry&&r&&(r.retryCount ?? 0)<2)continue;
      await deps.alert({provider:'gbuts',category:'system',attention:'action-required',key:`netflix-portal-onboarding:${portalHash(order.key)}`,title:'넷플릭스 인증 페이지 안내 확인 필요',
        body:'전용 링크 또는 사용법 이미지의 전달 확인이 필요합니다. 미확인 발송은 중복 전송하지 않습니다.',nextAction:'해당 구매자 채팅과 계정 배정을 확인해주세요.',actionUrl:`https://gbuts.com/seller/chats/${order.roomId}`,throttleMs:30*60_000}).catch(()=>undefined);
    }
    portal=deps.read();if(!portal?.enabled||portal.onboardingEnabled!==true)return;
  }
}
export function startNetflixPortalOnboarding(credentials:NonNullable<GbutsOttRuntimeDependencies['credentials']>){
  let pending=false;const deps={...netflixPortalDependencies(credentials),write:writeNetflixPortalStore,sendText:sendGbutsText,sendImage:sendGbutsImage};
  const run=()=>{if(pending)return;pending=true;void withGbutsOttInventory(()=>syncNetflixPortalOnboarding(deps)).catch(()=>deps.alert({provider:'gbuts',category:'system',attention:'action-required',key:'netflix-portal-config',title:'넷플릭스 인증 페이지 설정 확인 필요',body:'인증 페이지의 비공개 설정을 읽지 못했습니다.',nextAction:'서버의 인증 페이지 연결 설정을 확인해주세요.'})).finally(()=>{pending=false;});};
  const first=setTimeout(run,6000),timer=setInterval(run,30_000);first.unref();timer.unref();return()=>{clearTimeout(first);clearInterval(timer);};
}
