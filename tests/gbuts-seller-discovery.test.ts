import {expect,test,vi}from'vitest';
import{createGbutsOttSellerClient}from'../src/lib/gbuts-ott-client';
const post=(seq:number,time:string,status='ON_SALE')=>({seq,createdAt:time,category1:{seq:6},memberLimit:5,memberCount:0,status,subscriptionEndsAt:'2027-10-27'});
test('discovery reaches new closed posts behind an older fully-subscribed ON_SALE prefix',async()=>{
 const pages=[[post(18268,'2026-10-25 17:39:51'),post(19079,'2026-10-28 10:35:37','CLOSED')],[post(19158,'2026-10-28 17:11:32','CLOSED')],[]];
 const transport=vi.fn(async(url:any)=>{const u=new URL(String(url));const response=u.pathname.endsWith('/view')?post(19079,'2026-10-28 10:35:37','CLOSED'):pages[Number(u.searchParams.get('page'))-1]||[];return new Response(JSON.stringify({success:true,error:null,response}));});
 const client=createGbutsOttSellerClient('fixture',transport);
 expect(await client.latestPostSeq()).toBe(19158);
 expect((await client.listPostsAfter(19079)).map(p=>p.seq)).toEqual([19158]);
});

test('duplicate seller rows fail closed rather than producing an incomplete high-water mark',async()=>{
 const row=post(1,'2026-10-28 10:00:00');const transport=vi.fn(async()=>new Response(JSON.stringify({success:true,error:null,response:[row,row]})));
 await expect(createGbutsOttSellerClient('fixture',transport).latestPostSeq()).rejects.toThrow('목록이 조회 중 변경');
});
