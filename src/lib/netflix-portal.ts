import { existsSync, readFileSync, statSync } from 'node:fs';
import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import { writeJsonAtomic } from './graytag-sales-session';
import { gbutsOrderListing, type GbutsOttListing, type GbutsOttOrder, type GbutsOttStore } from './gbuts-ott';

export const portalHash = (s: string) => createHash('sha256').update(s).digest('hex');
export type PortalDelivery = { state: 'ready'|'attempted'|'confirmed'|'blocked'; hashes?: string[]; url?:string; attemptedAt?: string; confirmedAt?: string };
export interface NetflixPortalRecord {
  token: string; tokenHash: string; pin: string; pinHash: string; orderKey: string; roomHash: string;
  accountEmail: string; profileNumber: number; createdAt: string; revokedAt?: string;
  text: PortalDelivery; image: PortalDelivery; error?: string; retryCount?:number;
}
export interface NetflixPortalStore {
  version: 1; enabled: boolean; onboardingEnabled?: boolean; activatedAt: string; sessionSecret: string;
  records: Record<string, NetflixPortalRecord>;
}
export const netflixPortalPath = () => process.env.GBUTS_NETFLIX_PORTAL_PATH || '/home/ubuntu/.config/gbuts/netflix-portal.json';
export function readNetflixPortalStore(): NetflixPortalStore | null {
  const path = netflixPortalPath(); if (!existsSync(path)) return null;
  if (statSync(path).mode & 0o077) throw Error('PORTAL_PRIVATE_STORE_REQUIRED');
  const s = JSON.parse(readFileSync(path,'utf8')) as NetflixPortalStore;
  if (s.version !== 1 || typeof s.enabled !== 'boolean' || (s.onboardingEnabled !== undefined && typeof s.onboardingEnabled !== 'boolean') || !/^[a-f0-9]{64}$/.test(s.sessionSecret)
    || !Number.isFinite(Date.parse(s.activatedAt)) || !s.records || Array.isArray(s.records)) throw Error('PORTAL_STORE_INVALID');
  for (const [hash,r] of Object.entries(s.records)) {
    if (hash !== portalHash(r.token) || r.tokenHash !== hash || !/^[A-Za-z0-9_-]{43}$/.test(r.token)
      || !/^\d{6}$/.test(r.pin) || !/^[a-f0-9]{64}$/.test(r.pinHash) || !r.orderKey || !/^[a-f0-9]{64}$/.test(r.roomHash)
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.accountEmail) || !Number.isInteger(r.profileNumber) || r.profileNumber<1 || r.profileNumber>5
      || !Number.isFinite(Date.parse(r.createdAt)) || (r.retryCount!==undefined&&(!Number.isSafeInteger(r.retryCount)||r.retryCount<0))
      || [r.text,r.image].some(d=>!d || !['ready','attempted','confirmed','blocked'].includes(d.state))) throw Error('PORTAL_RECORD_INVALID');
  }
  return s;
}
export function writeNetflixPortalStore(s: NetflixPortalStore) { writeJsonAtomic(netflixPortalPath(),s); }
export function portalPinHash(pin: string, tokenHash: string): string { return scryptSync(pin, tokenHash,32).toString('hex'); }
export function verifyPortalPin(pin: unknown, r: NetflixPortalRecord): boolean {
  if(typeof pin!=='string'||!/^\d{6}$/.test(pin))return false;
  return timingSafeEqual(Buffer.from(portalPinHash(pin,r.tokenHash),'hex'),Buffer.from(r.pinHash,'hex'));
}
export function portalUrl(r: NetflixPortalRecord): string { return `https://email-verify.one/netflix/${r.token}`; }
export function portalRecordMatches(r: NetflixPortalRecord, s: GbutsOttStore, o: GbutsOttOrder): boolean {
  const l=gbutsOrderListing(s,o);
  return !r.revokedAt && r.orderKey===o.key && l.serviceType==='넷플릭스' && l.emailCodeProvider==='aaryan'
    && r.accountEmail===l.accountEmail.toLowerCase() && r.profileNumber===o.profileNumber && r.roomHash===portalHash(o.roomId||'');
}
/** Caller verifies live paid membership before reserving or delivering this capability. */
export function ensureNetflixPortal(s: NetflixPortalStore, inventory: GbutsOttStore, o: GbutsOttOrder, now: string): NetflixPortalRecord {
  const existing=Object.values(s.records).find(r=>portalRecordMatches(r,inventory,o)); if(existing)return existing;
  for(const r of Object.values(s.records).filter(r=>r.orderKey===o.key&&!r.revokedAt))r.revokedAt=now;
  const token=randomBytes(32).toString('base64url'),tokenHash=portalHash(token),pin=String(randomInt(0,1_000_000)).padStart(6,'0');
  const r:NetflixPortalRecord={token,tokenHash,pin,pinHash:portalPinHash(pin,tokenHash),orderKey:o.key,roomHash:portalHash(o.roomId!),
    accountEmail:gbutsOrderListing(inventory,o).accountEmail.toLowerCase(),profileNumber:o.profileNumber!,createdAt:now,text:{state:'ready'},image:{state:'ready'}};
  s.records[tokenHash]=r; return r;
}
export function portalDelivered(orderKey: string, inventory: GbutsOttStore): boolean {
  const s=readNetflixPortalStore(),order=inventory.orders[orderKey];
  return !!s?.enabled&&!!order&&Object.values(s.records).some(r=>portalRecordMatches(r,inventory,order)&&r.text.state==='confirmed'&&r.image.state==='confirmed');
}
export function netflixPortalEnabledForListing(listing:GbutsOttListing):boolean {
  if(listing.serviceType!=='넷플릭스'||listing.emailCodeProvider!=='aaryan')return false;
  const s=readNetflixPortalStore();return s?.enabled===true&&s.onboardingEnabled===true;
}
export function netflixPortalNotice(r: NetflixPortalRecord): string {
  return `[이메일 인증 안내]\n앞으로 넷플릭스 인증코드는 아래 전용 페이지에서 직접 확인하실 수 있습니다.\n${portalUrl(r)}\n이메일 PIN : ${r.pin}\n\n넷플릭스에서 먼저 인증을 요청한 뒤, 위 링크에 PIN을 입력하고 필요한 “4자리 로그인 코드” 또는 “6자리 인증 코드”를 선택해 주세요.\nPIN은 이 페이지 입장용이며 넷플릭스 인증코드와 다릅니다.\n계정·배정 프로필·이용 기간은 그대로입니다. 아래 사용법 이미지를 참고해 주세요.`;
}
