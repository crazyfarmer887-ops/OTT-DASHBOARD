export type NetflixCodeKind = 'login' | 'account';
export type NetflixCode = { email: string; kind: NetflixCodeKind; code: string; receivedAt: string; botMessageId: number };
export const AARYAN_BOT_USERNAME = 'Aaryanac_bot';
export const AARYAN_BOT_ID = '8731554856';
export function netflixCodeRequestKind(text: string): NetflixCodeKind | 'ambiguous' | undefined {
  if (!/(코드|인증\s*번호|인증\s*숫자|\bcode\b|otp)/i.test(text) || /(비밀번호\s*(?:변경|재설정)|password\s*reset)/i.test(text)) return;
  const login = /(4\s*자리|로그인\s*(?:인증\s*)?(?:코드|번호)|sign.?in\s*code|login\s*code)/i.test(text);
  const account = /(6\s*자리|계정\s*인증|가구|여행|인증\s*(?:코드|번호)|household|travel)/i.test(text);
  if (login && !/(6\s*자리|가구|계정\s*인증)/i.test(text)) return 'login';
  return account && !login ? 'account' : 'ambiguous';
}
/** Accept exact bot/email/kind, correlated reply, and the actual Seoul email timestamp only. */
export function parseAaryanCode(input: { text: string; senderId: string; messageId: number; replyTo: number | undefined; queryMessageId: number;
  email: string; kind: NetflixCodeKind; requestedAt: string; now?: Date }): NetflixCode | undefined {
  const now = input.now || new Date(); const text = input.text;
  if (input.senderId !== AARYAN_BOT_ID || input.replyTo !== input.queryMessageId || (!Number.isSafeInteger(input.messageId) || input.messageId<1)
    || /https?:\/\/|비밀번호\s*재설정|password\s*reset|access revoked|not authorized|no matching|액세스.*(?:없|취소)/i.test(text)) return;
  const emails = [...new Set((text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || []).map(x => x.toLowerCase()))];
  if (emails.length !== 1 || emails[0] !== input.email.toLowerCase()) return;
  const kind = /넷플릭스\s*로그인\s*코드|netflix\s*(?:login|sign.?in)\s*code/i.test(text) ? 'login'
    : /넷플릭스\s*인증\s*코드|netflix\s*(?:verification|household)\s*code/i.test(text) ? 'account' : undefined;
  if (kind !== input.kind) return;
  const block = text.split(/계정\s*국가|account\s*country|이메일\s*시간|email\s*time/i)[0];
  const codes = block.split('\n').map(line => line.trim()).filter(line => new RegExp(`^\\d{${kind === 'login' ? 4 : 6}}$`).test(line));
  if (codes.length !== 1) return;
  const time = text.match(/(?:이메일\s*시간|email\s*time):\s*(\d{1,2})\/(\d{1,2}),\s*(\d{1,2}):(\d{2})\s*(AM|PM)\s*\(Seoul\)/i);
  if (!time) return;
  const year = Number(new Intl.DateTimeFormat('en',{timeZone:'Asia/Seoul',year:'numeric'}).format(now));
  const day = Number(time[1]), month = Number(time[2]), hour12 = Number(time[3]), minute = Number(time[4]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour12 < 1 || hour12 > 12 || minute > 59) return;
  const hour = hour12 % 12 + (time[5].toUpperCase() === 'PM' ? 12 : 0);
  const timestamps = [year - 1,year,year + 1].filter(y=>new Date(Date.UTC(y,month-1,day)).getUTCMonth()===month-1).map(y => Date.UTC(y,month - 1,day,hour - 9,minute));
  if(!timestamps.length)return;
  const at = timestamps.sort((a,b) => Math.abs(now.getTime()-a) - Math.abs(now.getTime()-b))[0];
  const age = now.getTime() - at; const requested = Date.parse(input.requestedAt);
  if (!Number.isFinite(requested) || age < -60_000 || age > 15*60_000 || at < requested - 120_000) return;
  return { email: input.email.toLowerCase(), kind, code: codes[0], receivedAt: new Date(at).toISOString(), botMessageId: input.messageId };
}
