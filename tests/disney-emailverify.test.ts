import { expect, test } from 'vitest';
import { emailVerifyDisneyMailboxUrl, safeDisneyEmailAccessUrl } from '../src/lib/disney-mailbox';
import { buildGbutsDisneyDirectText } from '../src/lib/gbuts-disney-delivery';
import { manualRegisteredAccount } from '../src/lib/generated-accounts';
import { resolveGbutsDisneyListingCredentials } from '../src/lib/gbuts-ott-credentials';
import { fixtureListing } from './fixtures/gbuts-ott';
test('exact Disney address and PIN reach private delivery; admin/other mailbox links fail closed',()=>{
 const email='disney@example.com';const url=emailVerifyDisneyMailboxUrl(email);
 for(const bad of ['https://email-verify.one/dashboard','https://email-verify.one/email/mail/other@example.com',url+'?admin=1',url+'#x','https://email-verify.one.evil/email/mail/disney@example.com']) expect(safeDisneyEmailAccessUrl(bad,email)).toBe('');
 const a=manualRegisteredAccount({serviceType:'디즈니플러스',email,password:'fixture-secret',emailAccessProvider:'emailverify',pin:'123456',paymentStatus:'paid',expiryDate:'2027-10-27'},'fixture');
 const l=fixtureListing({serviceType:'디즈니플러스',accountEmail:email,deliveryMode:'disney-numbered-password'});
 const credentials=resolveGbutsDisneyListingCredentials(l,{generated:{fixture:a},maintenance:{},accessRecords:{}});
 expect(credentials).toMatchObject({id:email,emailAccessUrl:url,emailAccessPin:'123456'});
 const text=buildGbutsDisneyDirectText(credentials,1);expect(text).toContain('ID : '+email);expect(text).toContain('이메일 PIN : 123456');
 expect(()=>buildGbutsDisneyDirectText({...credentials,emailAccessPin:undefined},1)).toThrow();
 expect(()=>manualRegisteredAccount({serviceType:'디즈니플러스',email,password:'secret',emailAccessProvider:'emailverify'},'bad')).toThrow();
});
