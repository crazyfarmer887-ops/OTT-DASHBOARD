import {describe,expect,it,vi} from 'vitest';
import {processNetflixCodeRequest,type NetflixCodeDependencies,type NetflixCodeJournal} from '../src/scheduler/gbuts-netflix-codes';
import type {GbutsOttStore} from '../src/lib/gbuts-ott';
function fixture(){
  const now=new Date('2026-10-27T05:35:00Z');let safe=true;
  const s:GbutsOttStore={version:1,listings:{sale:{id:'sale',requestHash:'hash',serviceType:'넷플릭스',accountEmail:'fixture@example.com',capacity:5,dailyPrice:190,endDate:'2026-11-25',title:'title',description:'description',state:'registered',postSeq:1,createdAt:'2026-10-27T00:00:00Z',emailCodeProvider:'aaryan'}},
    orders:{'1:10':{key:'1:10',listingId:'sale',postSeq:1,memberSeq:10,userSeq:20,name:'구매자',status:'APPLY',cancelStatus:null,startDate:'2026-10-27',endDate:'2026-11-25',profileNumber:1,profileName:'1',roomId:'room',delivery:'confirmed',verifiedAt:now.toISOString(),purchasedAt:'2026-10-27T00:00:00Z'}},graytagClaims:{},lastSuccess:null,lastError:null};
  let members:any[]=[{seq:10,userSeq:20,status:'APPLY',cancelStatus:null,subscriptionEndsAt:'2026-11-25 23:59:59'}];
  const messages:any[]=[{senderSeq:20,messageType:'TEXT',message:'6자리 인증 코드 주세요',createdAt:now.toISOString()}];
  let journal:NetflixCodeJournal={version:1,receipts:{}};
  const client={getPost:vi.fn(async()=>({category1:{seq:5},memberLimit:5,subscriptionEndsAt:'2026-11-25 23:59:59'})),listOttMembers:vi.fn(async()=>members),
    openPrivateRoom:vi.fn(async()=> 'room'),getChat:vi.fn(async()=>({messages:structuredClone(messages)}))};
  const deps:NetflixCodeDependencies={store:()=>s,client:client as never,sellerSeq:100,credentials:vi.fn(async()=>({id:'fixture@example.com',password:'private-password'})),
    query:vi.fn(async()=>({email:'fixture@example.com',kind:'account' as const,code:'765432',receivedAt:'2026-10-27T05:34:00Z',botMessageId:101})),
    send:vi.fn(async(_room,_seller,text)=>{messages.push({senderSeq:100,messageType:'TEXT',message:text,createdAt:now.toISOString()});}),
    read:()=>journal,write:v=>{journal=structuredClone(v);},now:()=>now,allowed:()=>safe};
  return{deps,s,client,messages,get journal(){return journal;},setMembers(v:any[]){members=v;},pause(){safe=false;}};
}
describe('private Netflix bot code delivery',()=>{
  it('delivers only to the bound paid buyer, keeps plaintext codes out of its journal, and deduplicates',async()=>{
    const f=fixture();await processNetflixCodeRequest('1:10',f.deps);await processNetflixCodeRequest('1:10',f.deps);
    expect(f.deps.query).toHaveBeenCalledOnce();expect(f.deps.send).toHaveBeenCalledOnce();expect(f.deps.send).toHaveBeenCalledWith('room',100,expect.stringContaining('765432'));
    expect(Object.values(f.journal.receipts)[0].state).toBe('confirmed');expect(JSON.stringify(f.journal)).not.toContain('765432');expect(JSON.stringify(f.journal)).not.toContain('private-password');
  });
  it.each(['refund','human-reply','changed-account','safe-mode'] as const)('revalidates %s after the bot lookup and sends nothing',async type=>{
    const f=fixture();const query=vi.mocked(f.deps.query).getMockImplementation()!;
    vi.mocked(f.deps.query).mockImplementation(async(...args)=>{const code=await query(...args);if(type==='refund')f.setMembers([{seq:10,userSeq:20,status:'APPLY',cancelStatus:'REFUNDED',subscriptionEndsAt:'2026-11-25'}]);
      if(type==='human-reply')f.messages.push({senderSeq:100,messageType:'TEXT',message:'제가 확인해드리겠습니다.',createdAt:f.deps.now().toISOString()});
      if(type==='changed-account')vi.mocked(f.deps.credentials).mockResolvedValue({id:'other@example.com',password:'private'});if(type==='safe-mode')f.pause();return code;});
    await processNetflixCodeRequest('1:10',f.deps);expect(f.deps.send).not.toHaveBeenCalled();
  });
  it('asks which code is needed without calling the bot for ambiguous text',async()=>{
    const f=fixture();f.messages[0].message='메일 코드 주세요';await processNetflixCodeRequest('1:10',f.deps);
    expect(f.deps.query).not.toHaveBeenCalled();expect(f.deps.send).toHaveBeenCalledWith('room',100,expect.stringContaining('어떤 인증 화면'));
  });
  it('reconciles an uncertain send from seller echo and never blindly sends again',async()=>{
    const f=fixture();const send=vi.mocked(f.deps.send).getMockImplementation()!;vi.mocked(f.deps.send).mockImplementation(async(...args)=>{await send(...args);throw Error('lost response');});
    await processNetflixCodeRequest('1:10',f.deps);expect(Object.values(f.journal.receipts)[0].state).toBe('attempted');await processNetflixCodeRequest('1:10',f.deps);
    expect(Object.values(f.journal.receipts)[0].state).toBe('confirmed');expect(f.deps.send).toHaveBeenCalledOnce();
  });
  it('holds a missing uncertain echo instead of repeating the secret',async()=>{
    const f=fixture();vi.mocked(f.deps.send).mockRejectedValue(Error('unknown'));await processNetflixCodeRequest('1:10',f.deps);await processNetflixCodeRequest('1:10',f.deps);
    expect(f.deps.send).toHaveBeenCalledOnce();expect(f.deps.query).toHaveBeenCalledOnce();
  });
  it('checks expiry again after final buyer revalidation before sending',async()=>{
    const f=fixture();let reads=0;const original=f.client.getChat.getMockImplementation()!;
    f.client.getChat.mockImplementation(async()=>{if(++reads===3)f.deps.now().setTime(Date.parse('2026-10-27T05:50:00Z'));return original();});
    await processNetflixCodeRequest('1:10',f.deps);expect(f.deps.send).not.toHaveBeenCalled();
  });
  it('leaves old password-only accounts untouched',async()=>{
    const f=fixture();delete f.s.listings.sale.emailCodeProvider;await processNetflixCodeRequest('1:10',f.deps);expect(f.deps.query).not.toHaveBeenCalled();expect(f.client.getChat).not.toHaveBeenCalled();
  });
});
