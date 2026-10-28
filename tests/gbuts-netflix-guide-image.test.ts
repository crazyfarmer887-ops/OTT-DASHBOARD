import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { emptyGbutsOttStore } from '../src/lib/gbuts-ott';
import { readGbutsOttStore, writeGbutsOttStore } from '../src/lib/gbuts-ott-store';
import { NETFLIX_GUIDE_ASSET, readNetflixGuideConfig } from '../src/lib/gbuts-netflix-guide';
import { GbutsChatDeliveryError, splitGbutsChatText } from '../src/lib/gbuts-chat-delivery';
import { syncGbutsDirectCredentials } from '../src/scheduler/gbuts-ott-direct-delivery';
import { fixtureListing, fixtureOrder } from './fixtures/gbuts-ott';
import type { GbutsChatMessage } from '../src/lib/gbuts-spotify';
import { emailVerifyDisneyMailboxUrl, safeDisneyEmailAccessUrl } from '../src/lib/disney-mailbox';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-28T12:00:00Z')); });
afterEach(() => vi.useRealTimers());
function fixture() {
  const store = emptyGbutsOttStore();
  const listing = fixtureListing({emailCodeProvider:'emailverify'}); store.listings[listing.id] = listing;
  const order = fixtureOrder({delivery:'confirmed',profileNumber:1,profileName:'1',roomId:'fixture-room',
    credentialDeliveryPolicy:'netflix-password-v1',purchasedAt:'2026-10-28T11:00:00Z'}); store.orders[order.key] = order;
  const messages: GbutsChatMessage[] = [], sent: string[] = [];
  const config = {enabled:true,activatedAt:'2026-10-28T10:00:00Z',allowedAccountEmails:[listing.accountEmail]};
  const client = {openPrivateRoom:async()=>order.roomId!,getChat:async()=>({messages})};
  const text = vi.fn(async (_room:string,seller:number,value:string) => { sent.push('text');
    for (const message of splitGbutsChatText(value)) messages.push({senderSeq:seller,messageType:'TEXT',message,createdAt:new Date().toISOString()}); });
  const image = vi.fn(async (_room:string,seller:number,url:string) => {sent.push('image');
    messages.push({senderSeq:seller,messageType:'IMAGE',message:'',images:[url],createdAt:new Date().toISOString()});});
  const runtime = {config:()=>config,send:image};
  const deps = {credentials:async()=>({id:listing.accountEmail,password:'fixture-password',emailAccessPin:'123456',emailAccessUrl:emailVerifyDisneyMailboxUrl(listing.accountEmail)})};
  const run = (s=store) => syncGbutsDirectCredentials(s,Object.values(s.orders),99,deps as any,client as any,()=>{},text,runtime);
  return {store,listing,order,messages,sent,config,client,text,image,runtime,run};
}
test('real guide follows all credential/PIN text, survives store reload and is never repeated on !',async()=>{
  const f=fixture(); await f.run(); expect(f.sent).toEqual(['text','image']); expect(f.order.guideImage?.state).toBe('confirmed');
  expect(f.messages.filter(m=>m.messageType==='TEXT').map(m=>m.message).join('\n')).toContain('이메일 PIN : 123456');
  const dir=mkdtempSync(join(tmpdir(),'netflix-guide-'));
  try { const path=join(dir,'store.json'); writeGbutsOttStore(f.store,path); const reloaded=readGbutsOttStore(path);
    await f.run(reloaded); expect(f.image).toHaveBeenCalledTimes(1);
    f.messages.push({senderSeq:10,messageType:'TEXT',message:'!',createdAt:new Date().toISOString()});
    await f.run(reloaded); expect(f.text).toHaveBeenCalledTimes(2); expect(f.image).toHaveBeenCalledTimes(1);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
test('no retroactive images, excluded accounts, disabled config, expired or refunded purchases',async()=>{
  for (const patch of ['historical','old-purchase','excluded','disabled','refunded','no-lease']) {
    const f=fixture();
    if(patch==='historical') { await f.run(); delete f.order.guideImage; f.image.mockClear(); }
    if(patch==='old-purchase') f.order.purchasedAt='2026-10-28T09:00:00Z';
    if(patch==='excluded') f.config.allowedAccountEmails=['other@example.com'];
    if(patch==='disabled') f.config.enabled=false;
    if(patch==='refunded') f.order.cancelStatus='REFUNDED';
    if(patch==='no-lease') f.order.profileReleasedAt=new Date().toISOString();
    await f.run(); expect(f.image,patch).not.toHaveBeenCalled(); expect(f.order.guideImage,patch).toBeUndefined();
  }
});
test('uncertain credential submission prevents image until every text part is found',async()=>{
  const f=fixture(); f.text.mockImplementationOnce(async()=>{throw new Error('uncertain');});
  await f.run(); await f.run(); expect(f.order.directDelivery?.state).toBe('attempted'); expect(f.image).not.toHaveBeenCalled();
});
test('uncertain image is query-only, accepts seller IMAGE history and never buyer TEXT/IMAGE lookalikes',async()=>{
  const f=fixture(); f.image.mockImplementationOnce(async()=>{throw new Error('uncertain');});
  await f.run(); expect(f.order.guideImage?.state).toBe('attempted');
  f.messages.push({senderSeq:10,messageType:'IMAGE',message:'',images:[NETFLIX_GUIDE_ASSET.url],createdAt:new Date().toISOString()},
    {senderSeq:99,messageType:'TEXT',message:NETFLIX_GUIDE_ASSET.url,createdAt:new Date().toISOString()});
  await f.run(); expect(f.order.guideImage?.state).toBe('attempted'); expect(f.image).toHaveBeenCalledTimes(1);
  f.config.enabled=false; f.messages.push({senderSeq:99,messageType:'IMAGE',message:'',images:[NETFLIX_GUIDE_ASSET.url],createdAt:new Date().toISOString()});
  await f.run(); expect(f.order.guideImage?.state).toBe('confirmed'); expect(f.image).toHaveBeenCalledTimes(1);
});
test('only definite pre-SEND retry is allowed; permanent rejection remains blocked',async()=>{
  for(const retryable of [true,false]) {
    const f=fixture(); f.image.mockImplementationOnce(async()=>{throw new GbutsChatDeliveryError('fixture',false,retryable);});
    await f.run(); expect(f.order.guideImage?.state).toBe(retryable?'ready':'blocked');
    await f.run(); expect(f.image).toHaveBeenCalledTimes(retryable?2:1);
  }
});
test('invalid optional image config does not block account details and reports an image-only error',async()=>{
  const f=fixture(); f.runtime.config=()=>{throw new Error('invalid config');};
  await f.run(); expect(f.order.directDelivery?.state).toBe('confirmed'); expect(f.image).not.toHaveBeenCalled();
  expect(f.order.error).toContain('계정 안내는 전달됐으나');
});
test('plain @ mailbox URL remains compatible with old encoded links and exact-address protection',()=>{
  expect(emailVerifyDisneyMailboxUrl('Test@Example.com')).toBe('https://email-verify.one/email/mail/test@example.com');
  expect(safeDisneyEmailAccessUrl('https://email-verify.one/email/mail/test%40example.com','test@example.com')).toBeTruthy();
  expect(safeDisneyEmailAccessUrl('https://email-verify.one/email/mail/other@example.com','test@example.com')).toBe('');
});
test('the pinned uploaded image matches the reviewed real screenshot guide in the release',()=>{
  const bytes=readFileSync(new URL('../assets/gbuts/netflix-email-guide-real-v1.jpg',import.meta.url));
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(NETFLIX_GUIDE_ASSET.sha256);
  expect(bytes.subarray(0,3).toString('hex')).toBe('ffd8ff'); expect(bytes.length).toBeLessThan(5_000_000);
});
test('invalid runtime configuration fails closed and invalid saved image URLs cannot load',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'netflix-guide-'));
  try { const path=join(dir,'config.json'); expect(readNetflixGuideConfig(path)).toBeNull();
    writeFileSync(path,JSON.stringify({enabled:true,activatedAt:'bad',allowedAccountEmails:[]})); expect(()=>readNetflixGuideConfig(path)).toThrow();
    const f=fixture(); await f.run(); f.order.guideImage!.url='https://example.com/image.jpg';
    writeGbutsOttStore(f.store,path); expect(()=>readGbutsOttStore(path)).toThrow();
  } finally {rmSync(dir,{recursive:true,force:true});}
});
