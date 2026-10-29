import { loadGraytagAuthCookies } from './graytag-sales-session';
export type GraytagAccountId = 'primary' | 'youtube-invite-sales' | 'secondary';
export const graytagSecondarySessionPath = () => process.env.GRAYTAG_SECONDARY_SESSION_PATH || '/home/ubuntu/graytag-session/secondary-cookies.json';
export function selectedGraytagAccount(value:unknown):GraytagAccountId { return value==='secondary'||value==='youtube-invite-sales'?value:'primary'; }
export function storedGraytagAccountCookies(account:GraytagAccountId,primary:()=>ReturnType<typeof loadGraytagAuthCookies>){
  if(account==='secondary')return loadGraytagAuthCookies(graytagSecondarySessionPath());
  return account==='youtube-invite-sales'?loadGraytagAuthCookies():primary();
}
export const graytagManagementCacheKey=(id:GraytagAccountId)=>id==='primary'?'auto-session':`auto-session:${id}`;
