import { execFileSync } from 'node:child_process';

export function aioOwnerMatches(mainPid:string,currentPid:number):boolean {
  const value=mainPid.trim();
  return /^[1-9]\d*$/.test(value)&&Number.isSafeInteger(Number(value))&&Number(value)===currentPid;
}
/** A second Node process has a different in-memory inventory lock. Only the
 * currently active systemd MainPID may execute a cross-marketplace CREATE. */
export function isAioDashboardMainProcess():boolean {
  if(process.platform!=='linux')return false;
  try {
    const value=execFileSync('/usr/bin/systemctl',['show','aio-dashboard.service','--property=MainPID','--value'],
      {encoding:'utf8',timeout:3_000,stdio:['ignore','pipe','ignore']});
    return aioOwnerMatches(value,process.pid);
  }catch{return false;}
}
