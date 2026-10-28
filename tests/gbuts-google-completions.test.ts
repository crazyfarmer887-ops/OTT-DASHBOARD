import { expect, it, vi } from 'vitest';
import { GOOGLE_INVITE_COMPLETE_TEXT, syncFamilyCompletions, familyCompletionPending, type FamilyCompletionJournal } from '../src/monitoring/gbuts-google-completions';
import { FAMILY_MANAGER, type FamilyJournal, type InviteOrder, type FamilyView } from '../src/monitoring/gbuts-google-invites';
import { GbutsChatDeliveryError } from '../src/lib/gbuts-chat-delivery';
import type { GbutsChatMessage } from '../src/lib/gbuts-spotify';
function setup() {
 const order: InviteOrder = { key:'18864:5',email:'buyer@gmail.com',endDate:'2026-11-26',context:{postSeq:18864,memberSeq:5,userSeq:2,sellerSeq:1,roomId:'ROOM',requestedAt:'2026-10-28 12:00:00'} };
 const invites: FamilyJournal = {version:1,enabled:true,target:FAMILY_MANAGER,seedPostSeq:18756,orders:{[order.key]:{email:order.email!,state:'confirmed',updatedAt:'2026-10-28T03:01:00Z'}}};
 const journal: FamilyCompletionJournal = {version:1,orders:{}};
 const messages: GbutsChatMessage[] = [{senderSeq:2,messageType:'TEXT',message:order.email!,createdAt:order.context!.requestedAt}];
 const view: FamilyView = {manager:FAMILY_MANAGER,members:[order.email!],remaining:4,subscribed:true,benefitsThrough:'2026-11-26'};
 const scan=vi.fn(async()=>[order]),save=vi.fn(),allowed=vi.fn(()=>true),getChat=vi.fn(async()=>({members:[{seq:1},{seq:2}],messages}));
 const sendText=vi.fn(async()=>{messages.push({senderSeq:1,messageType:'TEXT',message:GOOGLE_INVITE_COMPLETE_TEXT,createdAt:'2026-10-28 12:01:00'});});
 return {order,invites,journal,view,scan,save,allowed,getChat,sendText,messages};
}
it('announces a Google-confirmed invitation once and observes its saved message',async()=>{
 const f=setup();expect(familyCompletionPending(f.invites,[f.order],f.journal)).toBe(true);
 expect(await syncFamilyCompletions(f)).toEqual({sent:1,confirmed:1,uncertain:0,failed:0});
 expect(f.journal.orders[f.order.key].state).toBe('confirmed');
 await syncFamilyCompletions(f);expect(f.sendText).toHaveBeenCalledTimes(1);
 expect(familyCompletionPending(f.invites,[f.order],f.journal)).toBe(false);
});
it('never claims completion for an attempted Google invitation or missing family observation',async()=>{
 const f=setup();f.invites.orders[f.order.key].state='attempted';await syncFamilyCompletions(f);expect(f.sendText).not.toHaveBeenCalled();
 f.invites.orders[f.order.key].state='confirmed';await syncFamilyCompletions({...f,view:undefined});expect(f.sendText).not.toHaveBeenCalled();
});
it('records a durable attempt before SEND and recovers an uncertain response without another SEND',async()=>{
 const f=setup();f.sendText.mockImplementation(async()=>{expect(f.journal.orders[f.order.key].state).toBe('attempted');throw new GbutsChatDeliveryError('unknown',true);});
 expect(await syncFamilyCompletions(f)).toMatchObject({uncertain:1});await syncFamilyCompletions(f);expect(f.sendText).toHaveBeenCalledTimes(1);
 f.messages.push({senderSeq:1,messageType:'TEXT',message:GOOGLE_INVITE_COMPLETE_TEXT,createdAt:'2026-10-28 12:01:00'});
 await syncFamilyCompletions({...f,view:undefined});expect(f.journal.orders[f.order.key].state).toBe('confirmed');expect(f.sendText).toHaveBeenCalledTimes(1);
});
it('adopts an owner acknowledgement after the latest requested email and does not resend',async()=>{
 const f=setup();f.messages.push({senderSeq:1,messageType:'TEXT',message:'안녕하세요. 보냈습니다.',createdAt:'2026-10-28 12:01:00'});
 await syncFamilyCompletions(f);expect(f.sendText).not.toHaveBeenCalled();expect(f.journal.orders[f.order.key].state).toBe('confirmed');
});
it('does not mistake a future promise or an older acknowledgement for completion',async()=>{
 const f=setup();f.messages.push({senderSeq:1,messageType:'TEXT',message:'보냈습니다',createdAt:'2026-10-28 11:59:00'},
 {senderSeq:1,messageType:'TEXT',message:'초대 완료되면 연락드리겠습니다',createdAt:'2026-10-28 12:01:00'});
 await syncFamilyCompletions(f);expect(f.sendText).toHaveBeenCalledTimes(1);
});
it.each(['buyer','room','safety','family'])('holds when %s changes before completion',async mode=>{
 const f=setup();
 if(mode==='buyer')f.scan.mockResolvedValueOnce([f.order]).mockResolvedValueOnce([{...f.order,email:'other@gmail.com'}]);
 if(mode==='room')f.getChat.mockResolvedValue({members:[{seq:1}],messages:f.messages});
 if(mode==='safety')f.allowed.mockReturnValue(false);
 if(mode==='family')f.view.members=[];
 await expect(syncFamilyCompletions(f)).rejects.toThrow();expect(f.sendText).not.toHaveBeenCalled();
});
it('does not create another Google session for an uncertain buyer-message receipt',()=>{
 const f=setup();f.journal.orders[f.order.key]={email:f.order.email!,roomId:'ROOM',state:'attempted',updatedAt:'2026-10-28T03:00:00Z'};
 expect(familyCompletionPending(f.invites,[f.order],f.journal)).toBe(false);
});

it('retries only a confirmed pre-SEND failure and exposes it in completion status',async()=>{
 const f=setup();f.sendText.mockRejectedValue(new GbutsChatDeliveryError('not sent',false,true));
 expect(await syncFamilyCompletions(f)).toMatchObject({failed:1,uncertain:0});expect(f.journal.orders[f.order.key]).toBeUndefined();
 await syncFamilyCompletions(f);expect(f.sendText).toHaveBeenCalledTimes(2);
});
