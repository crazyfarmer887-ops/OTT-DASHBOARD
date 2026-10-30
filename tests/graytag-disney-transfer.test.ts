import { expect,test } from 'vitest';
import { savedGraytagKeepMemo } from '../src/lib/graytag-keep-delivery';
import { transferEndDate,transferProductModel } from '../scripts/migrate-everyview-disney-to-graytag';
test('the official GrayTag remaining-day count uses a thirty-day date difference',()=>{
 const end=transferEndDate('2026-10-30');expect(end).toBe('2026-11-29');
 expect((Date.parse(end)-Date.parse('2026-10-30'))/86400000).toBe(30);
 expect(transferProductModel(end)).toMatchObject({price:'3150',endDate:'20261129T2359'});
});
test('reads the saved native delivery memo even though it is absent from the seller-list response',()=>{
 expect(savedGraytagKeepMemo('<textarea id="keepMemo">6번 프로필\nhttps://example.com/mail?a=1&amp;b=2</textarea>')).toBe('6번 프로필\nhttps://example.com/mail?a=1&b=2');
 expect(()=>savedGraytagKeepMemo('<div>6번 프로필</div>')).toThrow('KEEP_MEMO_UNVERIFIED');
});
