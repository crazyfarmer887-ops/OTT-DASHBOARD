import { it,expect,vi,afterEach } from 'vitest';
import { mkdtempSync,rmSync } from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {storedGraytagAccountCookies,selectedGraytagAccount,graytagManagementCacheKey} from '../src/lib/graytag-account-session';
import {writeGraytagAuthCookiesAtomic} from '../src/lib/graytag-sales-session';
afterEach(()=>vi.unstubAllEnvs());
it('uses the secondary session without falling back to a different account',()=>{const dir=mkdtempSync(join(tmpdir(),'graytag-second-'));try{vi.stubEnv('GRAYTAG_SECONDARY_SESSION_PATH',join(dir,'cookies.json'));const primary=vi.fn(()=>({AWSALB:'',AWSALBCORS:'',JSESSIONID:'primary'}));expect(storedGraytagAccountCookies('secondary',primary)).toBeNull();writeGraytagAuthCookiesAtomic(join(dir,'cookies.json'),{AWSALB:'',AWSALBCORS:'',JSESSIONID:'secondary'});expect(storedGraytagAccountCookies('secondary',primary)?.JSESSIONID).toBe('secondary');expect(primary).not.toHaveBeenCalled();expect(storedGraytagAccountCookies('primary',primary)?.JSESSIONID).toBe('primary');expect(graytagManagementCacheKey('secondary')).not.toBe(graytagManagementCacheKey('primary'));expect(selectedGraytagAccount('secondary')).toBe('secondary');}finally{rmSync(dir,{recursive:true,force:true});}});
