/**
 * 에브리뷰(everyview.kr) API 어댑터
 *
 * 그레이태그(/ws/lender/*)와 대응되는 에브리뷰(/api/*, Spring form-data) 호출을 캡슐화한다.
 * 세션: JSESSIONID(+google_token 등) 쿠키 문자열 — /home/ubuntu/everyview-session/cookies.json (keeper 유지)
 *
 * 검증된 엔드포인트 (2026-08):
 * - GET  /myParty                                        : 내가 개설한 파티 목록 (server-rendered HTML)
 * - GET  /partyLeader_free_detail_type1?id={partyId}     : 파티 상세 (server-rendered HTML)
 * - POST /api/generalParty/updateLoginInfo               : {partyId, loginData:[{id,shareType,accountId,accountPassword,additionalInfo,sharingDescription}]}
 * - POST /api/generalParty/updateNotice                  : {partyId, notice}
 * - POST /api/generalParty/updateRecruitCnt              : {partyId, recruitCnt}
 * - POST /api/generalParty/getSettlementHistory          : {partyId} → 정산 내역 JSON
 * - POST /api/generalParty/disbandParty                  : {partyId}
 * - POST /api/user/userCreatePartyCnt                    : 세션 유효 확인 ({result:'200'})
 */

import { readFileSync } from 'node:fs';

export const EVERYVIEW_BASE = 'https://everyview.kr';
export const EVERYVIEW_COOKIE_PATH = '/home/ubuntu/everyview-session/cookies.json';

export interface EveryviewCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
}

export function loadEveryviewCookieHeader(cookiePath: string = EVERYVIEW_COOKIE_PATH): string | null {
  try {
    if (!cookiePath) return null;
    // existsSync 없이 try-read로 처리 (호환성)
    const raw = readFileSync(cookiePath, 'utf8');
    const arr = JSON.parse(raw) as EveryviewCookie[];
    const header = arr
      .filter((c) => c?.name && typeof c.value === 'string')
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');
    return header || null;
  } catch {
    return null;
  }
}

/** body.JSESSIONID(수동 입력) 우선, 없으면 keeper cookies.json 폴백 — graytag resolveCookies와 동일 계약 */
export function resolveEveryviewCookies(body?: { JSESSIONID?: string; cookieHeader?: string }): string | null {
  const manual = String(body?.JSESSIONID || '').trim();
  if (manual) return `JSESSIONID=${manual}`;
  return loadEveryviewCookieHeader();
}

function evHeaders(cookieStr: string, referer = '/myParty'): Record<string, string> {
  return {
    Cookie: cookieStr,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    Referer: `${EVERYVIEW_BASE}${referer}`,
    'X-Requested-With': 'XMLHttpRequest',
  };
}

export async function everyviewFetch(
  url: string,
  init: RequestInit & { cookieStr: string; referer?: string },
): Promise<Response> {
  const { cookieStr, referer, ...rest } = init;
  return fetch(url, {
    ...rest,
    headers: { ...evHeaders(cookieStr, referer), ...(rest.headers as Record<string, string> | undefined) },
    signal: rest.signal ?? AbortSignal.timeout(20_000),
  });
}

export interface EveryviewSessionCheck {
  valid: boolean;
  detail: string;
}

/** 세션 유효 확인 — graytag의 borrower deals 프루프와 동일 역할 */
export async function checkEveryviewSession(cookieStr: string): Promise<EveryviewSessionCheck> {
  try {
    const res = await fetch(`${EVERYVIEW_BASE}/api/user/userCreatePartyCnt`, {
      headers: evHeaders(cookieStr),
      signal: AbortSignal.timeout(15_000),
    });
    const json = await res.json().catch(() => null) as { result?: string; msg?: string } | null;
    if (json?.result === '200') return { valid: true, detail: '인증 세션 유효' };
    return { valid: false, detail: String(json?.msg || '인증 실패') };
  } catch (e: any) {
    return { valid: false, detail: `확인 실패: ${e.message}` };
  }
}

// ─── myParty HTML 파싱 ───────────────────────────────────────

export interface EveryviewHostPartySummary {
  partyId: number;
  partyType: 'free' | 'general';
  title: string;
  serviceCode: string | null;
  serviceName: string | null;
}

/** myParty 페이지에서 내가 개설한 파티 카드 추출 */
export function parseHostParties(html: string): EveryviewHostPartySummary[] {
  const out: EveryviewHostPartySummary[] = [];
  const cardRe = /<a class="mypg-gc host" href="([^"]+)" data-search="([^"]*)">([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = cardRe.exec(html)) !== null) {
    const [, href, search, body] = m;
    const idMatch = href.match(/[?&]id=(\d+)/) || href.match(/\/partyLeader\/(\d+)/);
    if (!idMatch) continue;
    const parts = String(search || '').trim().split(/\s+/);
    // data-search 형식: "{제목...} s{freeId}|e{generalId} {serviceCode} {serviceName}"
    const serviceCode = parts.length >= 3 ? parts[parts.length - 2] : null;
    const serviceName = parts.length >= 3 ? parts[parts.length - 1] : null;
    const title = parts.slice(0, Math.max(1, parts.length - 3)).join(' ');
    out.push({
      partyId: parseInt(idMatch[1], 10),
      partyType: href.includes('partyLeader_free') ? 'free' : 'general',
      title,
      serviceCode,
      serviceName,
    });
  }
  return out;
}

// ─── 파티 상세 HTML 파싱 ─────────────────────────────────────

export interface EveryviewPartyLoginInfo {
  svcId: number;
  shareType: 'ACCOUNT' | 'INVITE' | 'OTHER';
  accountId: string | null;
  accountPassword: string | null;
  sharingDescription: string | null;
  additionalInfo: string | null;
}

export interface EveryviewPartyDetail {
  partyId: number;
  hostName: string | null;
  members: Array<{ name: string; state: 'host' | 'member' | 'empty' }>;
  totalSlots: number;
  emptySlots: number;
  loginInfo: EveryviewPartyLoginInfo[];
  notice: string;
  startDateLabel: string | null;
  endDateLabel: string | null;
  settledAmountLabel: string | null;
  serviceName: string | null;
}

export interface EveryviewGeneralPartyDetail {
  partyId: number;
  serviceName: string;
  servicePlan: string | null;
  members: Array<{ name: string; joinedAt: string | null; inviteEmail: string | null }>;
  settlementPeriod: string | null;
  expectedSettlement: number;
  expectedSettlementLabel: string | null;
  depositDate: string | null;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

/** 파티 상세 페이지 파싱 (파티장 이름/슬롯/로그인정보/공지/기간) */
export function parsePartyDetail(html: string, partyId: number): EveryviewPartyDetail {
  // 슬롯 (나 + 파티원 + 빈자리)
  const slots = [...html.matchAll(/<div class="pld-slot-name ([^"]+)">([^<]*)<\/div>/g)].map((m) => ({
    cls: m[1],
    name: stripTags(m[2]),
  }));
  const hostSlot = slots.find((s) => s.cls.includes('slot-name-host'));
  const emptyCount = slots.filter((s) => s.cls.includes('slot-name-empty')).length;
  const memberNames = slots.filter((s) => !s.cls.includes('slot-name-host') && !s.cls.includes('slot-name-empty'));

  // 로그인정보 표시 rows
  const infoRows = [...html.matchAll(/pld-info-key">([^<]+)<\/span>\s*<div class="pld-info-val-row">\s*<span class="pld-info-val"[^>]*>([\s\S]*?)<\/span>/g)]
    .map((m) => [stripTags(m[1]), stripTags(m[2])] as const);

  // 편집 모달의 서비스 섹션 (svc id/share type)
  const modalSvcs = [...html.matchAll(/data-svc-id="(\d+)"\s+data-share-type="([A-Z]+)"/g)].map((m) => ({
    svcId: parseInt(m[1], 10),
    shareType: m[2] as EveryviewPartyLoginInfo['shareType'],
  }));

  // 모달 input 값 (ACCOUNT 타입)
  const modalAccountId = html.match(/class="[^"]*login-accountId"[^>]*value="([^"]*)"/)?.[1] ?? null;
  const modalAccountPw = html.match(/class="[^"]*login-accountPassword"[^>]*value="([^"]*)"/)?.[1] ?? null;
  const modalDesc = html.match(/class="[^"]*login-sharingDescription"[^>]*>([\s\S]*?)</)?.[1] ?? null;

  // 표시된 로그인 정보에서 아이디/비밀번호 추출 (모달이 없으면 fallback)
  const findInfo = (key: string) => infoRows.find(([k]) => k === key)?.[1] ?? null;

  const loginInfo: EveryviewPartyLoginInfo[] = modalSvcs.map((svc) => ({
    svcId: svc.svcId,
    shareType: svc.shareType,
    accountId: svc.shareType === 'ACCOUNT' ? unescapeHtml(modalAccountId ?? findInfo('아이디')) : null,
    accountPassword: svc.shareType === 'ACCOUNT' ? unescapeHtml(modalAccountPw ?? findInfo('비밀번호')) : null,
    sharingDescription: svc.shareType !== 'ACCOUNT'
      ? (unescapeHtml(modalDesc) ?? findInfo('공유방식 설명'))
      : null,
    additionalInfo: findInfo('추가 이용 정보'),
  }));

  const serviceName = html.match(/pld-login-svc-name">([^<]+)</)?.[1]?.trim() ?? null;
  const notice = html.match(/id="noticeDisplay">([\s\S]*?)<\/div>/)?.[1];

  return {
    partyId,
    hostName: hostSlot?.name ?? null,
    members: [
      ...(hostSlot ? [{ name: hostSlot.name, state: 'host' as const }] : []),
      ...memberNames.map((s) => ({ name: s.name, state: 'member' as const })),
      ...Array.from({ length: emptyCount }, () => ({ name: '모집중', state: 'empty' as const })),
    ],
    totalSlots: slots.length,
    emptySlots: emptyCount,
    loginInfo,
    notice: notice ? stripTags(notice) : '',
    startDateLabel: findInfo('파티 개설일'),
    endDateLabel: findInfo('공유 종료일'),
    settledAmountLabel: findInfo('누적 정산금'),
    serviceName,
  };
}

/** 검증파티(e*) 상세: 초대/프로필은 에브리뷰가 관리하고 파티장은 결제·정산을 관리한다. */
export function parseGeneralPartyDetail(html: string, partyId: number): EveryviewGeneralPartyDetail {
  const serviceName = stripTags(html.match(/<div class="platform">[\s\S]*?<h2>([\s\S]*?)<\/h2>/)?.[1] || '') || '기타';
  const members = [...html.matchAll(/<div class="detail-card-common">([\s\S]*?)<\/div>/g)].map((match) => {
    const block = match[1];
    const name = stripTags(block.match(/<a[^>]*>([\s\S]*?)<\/a>/)?.[1] || '') || '(미확인)';
    const joinedAt = stripTags(block.match(/참여일\s*<span[^>]*>([^<]+)<\/span>/)?.[1] || '') || null;
    return { name, joinedAt, inviteEmail: null as string | null };
  });
  const inviteEmails = [...html.matchAll(/<strong id="ott_email\d+">([^<]+)<\/strong>/g)].map((match) => stripTags(match[1]));
  members.forEach((member, index) => { member.inviteEmail = inviteEmails[index] || null; });
  const servicePlan = stripTags(html.match(/<li><span>이용권 종류<\/span><strong>([^<]+)<\/strong><\/li>/)?.[1] || '') || null;
  const settlementPeriod = stripTags(html.match(/<li><span>정산대상기간<\/span><strong[^>]*>([^<]+)<\/strong><\/li>/)?.[1] || '') || null;
  const expectedSettlementLabel = stripTags(html.match(/<span>정산예정액<\/span>\s*<strong[^>]*>([\s\S]*?)<\/strong>/)?.[1] || '') || null;
  const expectedSettlement = parseInt(String(expectedSettlementLabel || '').replace(/[^0-9]/g, '') || '0', 10);
  const depositDate = stripTags(html.match(/<li><span>입금일<\/span><strong[^>]*>([^<]+)<\/strong><\/li>/)?.[1] || '') || null;
  return { partyId, serviceName, servicePlan, members, settlementPeriod, expectedSettlement, expectedSettlementLabel, depositDate };
}

function unescapeHtml(s: string | null): string | null {
  if (s == null) return s;
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

// ─── 고수준 조회/수정 함수 ───────────────────────────────────

export async function fetchEveryviewHostParties(cookieStr: string): Promise<EveryviewHostPartySummary[]> {
  const res = await fetch(`${EVERYVIEW_BASE}/myParty`, {
    headers: { ...evHeaders(cookieStr), Accept: 'text/html' },
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status >= 300 && res.status < 400) throw new Error('에브리뷰 쿠키가 만료됐어요.');
  const html = await res.text();
  if (!html.includes('mypg-gc')) {
    // 로그인 페이지로 리다이렉트된 경우
    if (html.includes('login-wrap') || html.toLowerCase().includes('로그인')) throw new Error('에브리뷰 쿠키가 만료됐어요.');
    return [];
  }
  return parseHostParties(html);
}

export async function fetchEveryviewPartyDetail(cookieStr: string, partyId: number): Promise<EveryviewPartyDetail> {
  const res = await fetch(`${EVERYVIEW_BASE}/partyLeader_free_detail_type1?id=${partyId}`, {
    headers: { ...evHeaders(cookieStr), Accept: 'text/html' },
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status >= 300 && res.status < 400) throw new Error('에브리뷰 쿠키가 만료됐어요.');
  const html = await res.text();
  if (!html.includes('pld-slot')) throw new Error('에브리뷰 쿠키가 만료됐어요.');
  return parsePartyDetail(html, partyId);
}

export async function fetchEveryviewGeneralPartyDetail(cookieStr: string, partyId: number): Promise<EveryviewGeneralPartyDetail> {
  const res = await fetch(`${EVERYVIEW_BASE}/partyLeader/${partyId}`, {
    headers: { ...evHeaders(cookieStr), Accept: 'text/html' },
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status >= 300 && res.status < 400) throw new Error('에브리뷰 쿠키가 만료됐어요.');
  const html = await res.text();
  if (!html.includes('myPartyA') || !html.includes('파티장 정산 정보')) throw new Error('에브리뷰 검증파티 상세를 읽지 못했어요.');
  return parseGeneralPartyDetail(html, partyId);
}

async function postForm(
  cookieStr: string,
  path: string,
  params: Record<string, string>,
  referer: string,
): Promise<{ ok: boolean; result?: string; msg?: string }> {
  const body = new URLSearchParams(params).toString();
  const res = await fetch(`${EVERYVIEW_BASE}${path}`, {
    method: 'POST',
    headers: { ...evHeaders(cookieStr, referer), 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  try {
    const json = JSON.parse(text) as { result?: string; msg?: string };
    return { ok: json.result === '200', result: json.result, msg: json.msg };
  } catch {
    if (text.includes('로그인 되어 있지 않')) return { ok: false, msg: '에브리뷰 쿠키가 만료됐어요.' };
    return { ok: false, msg: `응답 파싱 실패 (${res.status})` };
  }
}

export interface EveryviewLoginDataItem {
  id: number;
  shareType: 'ACCOUNT' | 'INVITE' | 'OTHER';
  accountId?: string | null;
  accountPassword?: string | null;
  sharingDescription?: string | null;
  additionalInfo?: string | null;
}

// ─── 파티 개설 (글 작성) ─────────────────────────────────────
// everyview /party/make/makeParty_free_make → POST /api/generalParty/create (multipart)
// partyData JSON: { payment, party, services } — 2026-08 실제 폼 수집 로직과 동일한 스키마.

/** 에브리뷰 파티개설 셀렉터에 노출되는 서비스 목록 (v3-ss SS_SERVICES 스냅샷) */
export const EVERYVIEW_CREATE_SERVICES = [
  { code: 'youtube', name: '유튜브', id: 1, category: '영상' },
  { code: 'netflix', name: '넷플릭스', id: 2, category: '영상' },
  { code: 'tving', name: '티빙', id: 3, category: '영상' },
  { code: 'disney_plus', name: '디즈니+', id: 4, category: '영상' },
  { code: 'wavve', name: '웨이브', id: 15, category: '영상' },
  { code: 'laftel', name: '라프텔', id: 5, category: '영상' },
  { code: 'watcha', name: '왓챠', id: 6, category: '영상' },
  { code: 'apple', name: '애플', id: 9, category: '영상' },
  { code: 'coupang', name: '쿠팡플레이', id: 7, category: '영상' },
  { code: 'chatgpt', name: 'ChatGPT', id: 14, category: 'AI' },
  { code: 'google', name: 'Google AI', id: 13, category: 'AI' },
  { code: 'prime_video', name: '프라임비디오', id: 8, category: '영상' },
  { code: 'ms365', name: 'MS오피스365', id: 11, category: '생산성' },
  { code: 'spotify', name: '스포티파이', id: 12, category: '음악' },
] as const;

export interface EveryviewCreateServiceInput {
  serviceCode: string;          // EVERYVIEW_CREATE_SERVICES.code 또는 'direct'
  serviceName: string;
  serviceOptionCode?: string;   // 없으면 'direct'
  serviceOptionName?: string;
  shareType: 'ACCOUNT' | 'INVITE' | 'OTHER';
  userId?: string;
  userPassword?: string;
  sharingDescription?: string;
  additionalInfo?: string;
}

export interface EveryviewCreatePartyInput {
  recruitTitle: string;         // 최대 25자
  recruitInfo: string;          // 최대 1000자
  disallowRules?: string[];
  paymentType: 'PERIOD' | 'RECURRING';
  oneDayUsageFee: number;
  monthUsageFee: number;
  shareEndDate?: string | null; // PERIOD일 때 YYYY-MM-DD
  shareUserCnt: number;         // 모집 인원
  services: EveryviewCreateServiceInput[];
}

function validateEveryviewCreateParty(input: EveryviewCreatePartyInput): string | null {
  if (!input.recruitTitle.trim()) return '모집 제목을 입력해주세요.';
  if (input.recruitTitle.length > 25) return '모집 제목은 최대 25자예요.';
  if (!input.recruitInfo.trim()) return '파티 소개를 입력해주세요.';
  if (input.recruitInfo.length > 1000) return '파티 소개는 최대 1000자예요.';
  if (!Number.isFinite(input.shareUserCnt) || input.shareUserCnt < 1 || input.shareUserCnt > 20) return '모집 인원은 1~20명이어야 해요.';
  if (!input.services.length) return '공유 서비스를 1개 이상 등록해주세요.';
  if (input.services.length > 5) return '공유 서비스는 최대 5개까지 등록할 수 있어요.';
  for (const svc of input.services) {
    if (!svc.serviceCode || !svc.serviceName.trim()) return '서비스명을 선택하거나 입력해주세요.';
    if (svc.shareType === 'ACCOUNT') {
      if (!svc.userId?.trim() || !svc.userPassword?.trim()) return `${svc.serviceName}의 아이디/비밀번호를 입력해주세요.`;
    } else if ((svc.shareType === 'INVITE' || svc.shareType === 'OTHER') && !svc.sharingDescription?.trim()) {
      return `${svc.serviceName}의 공유 안내를 입력해주세요.`;
    }
  }
  if (input.paymentType === 'PERIOD') {
    if (!input.shareEndDate) return '공유 종료일을 선택해주세요.';
    if (!(input.oneDayUsageFee >= 0 && input.monthUsageFee >= 0)) return '요금을 확인해주세요.';
  } else if (!(input.monthUsageFee > 0)) return '월 요금을 입력해주세요.';
  return null;
}

export async function createEveryviewParty(
  cookieStr: string,
  input: EveryviewCreatePartyInput,
): Promise<{ ok: boolean; partyId?: number; msg?: string }> {
  const validationError = validateEveryviewCreateParty(input);
  if (validationError) return { ok: false, msg: validationError };

  const partyData = {
    payment: {
      paymentType: input.paymentType,
      oneDayUsageFee: Math.round(input.oneDayUsageFee),
      monthUsageFee: Math.round(input.monthUsageFee),
      shareEndDate: input.paymentType === 'RECURRING' ? null : input.shareEndDate,
      shareUserCnt: input.shareUserCnt,
    },
    party: {
      recruitTitle: input.recruitTitle.trim(),
      recruitInfo: input.recruitInfo.trim(),
      notice: '',
      disallowRule: (input.disallowRules || []).filter((rule) => rule.trim()),
    },
    services: input.services.map((svc) => ({
      serviceCode: svc.serviceCode,
      serviceName: svc.serviceName.trim(),
      serviceId: svc.serviceCode === 'direct' ? 0 : (EVERYVIEW_CREATE_SERVICES.find((s) => s.code === svc.serviceCode)?.id ?? 0),
      serviceOptionCode: svc.serviceOptionCode || 'direct',
      serviceOptionName: svc.serviceOptionName || '',
      serviceOptionId: parseInt(String(svc.serviceOptionCode || ''), 10) || 0,
      shareType: svc.shareType,
      userId: svc.shareType === 'ACCOUNT' ? (svc.userId || '') : '',
      userPassword: svc.shareType === 'ACCOUNT' ? (svc.userPassword || '') : '',
      sharingDescription: svc.shareType !== 'ACCOUNT' ? (svc.sharingDescription || '') : '',
      additionalInfo: svc.additionalInfo || '',
    })),
  };

  const formData = new FormData();
  formData.append('partyData', JSON.stringify(partyData));
  const res = await fetch(`${EVERYVIEW_BASE}/api/generalParty/create`, {
    method: 'POST',
    headers: { ...evHeaders(cookieStr, '/party/make/makeParty_free_make') },
    body: formData,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  try {
    const json = JSON.parse(text) as { result?: string; msg?: string; partyId?: number };
    if (json.result === '200' && json.partyId) return { ok: true, partyId: json.partyId };
    if (json.result === '401') return { ok: false, msg: '에브리뷰 쿠키가 만료됐어요.' };
    return { ok: false, msg: json.msg || `파티 생성 실패 (${json.result})` };
  } catch {
    if (text.includes('로그인 되어 있지 않')) return { ok: false, msg: '에브리뷰 쿠키가 만료됐어요.' };
    return { ok: false, msg: `응답 파싱 실패 (${res.status})` };
  }
}

export async function updateEveryviewLoginInfo(
  cookieStr: string,
  partyId: number,
  loginData: EveryviewLoginDataItem[],
): Promise<{ ok: boolean; msg?: string }> {
  return postForm(cookieStr, '/api/generalParty/updateLoginInfo', {
    partyId: String(partyId),
    loginData: JSON.stringify(loginData),
  }, `/partyLeader_free_detail_type1?id=${partyId}`);
}

export async function updateEveryviewNotice(
  cookieStr: string,
  partyId: number,
  notice: string,
): Promise<{ ok: boolean; msg?: string }> {
  return postForm(cookieStr, '/api/generalParty/updateNotice', { partyId: String(partyId), notice }, `/partyLeader_free_detail_type1?id=${partyId}`);
}

export async function updateEveryviewRecruitCnt(
  cookieStr: string,
  partyId: number,
  recruitCnt: number,
): Promise<{ ok: boolean; msg?: string }> {
  return postForm(cookieStr, '/api/generalParty/updateRecruitCnt', { partyId: String(partyId), recruitCnt: String(recruitCnt) }, `/partyLeader_free_detail_type1?id=${partyId}`);
}

export interface EveryviewSettlement {
  result?: string;
  totalSettled?: { totalSettled?: number };
  unsettled?: { totalAccrual?: number; totalFee?: number };
  dailyHistory?: unknown[];
  history?: unknown[];
}

export async function fetchEveryviewSettlement(cookieStr: string, partyId: number): Promise<EveryviewSettlement | null> {
  const body = new URLSearchParams({ partyId: String(partyId) }).toString();
  const res = await fetch(`${EVERYVIEW_BASE}/api/generalParty/getSettlementHistory`, {
    method: 'POST',
    headers: { ...evHeaders(cookieStr, `/partyLeader_free_detail_type1?id=${partyId}`), 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(20_000),
  });
  try {
    return await res.json() as EveryviewSettlement;
  } catch {
    return null;
  }
}

// ─── graytag management 호환 형태로 변환 ─────────────────────

export interface EveryviewManagementMember {
  memberId: string;           // `everyview:{partyId}:{index}`
  productUsid: string;        // partyId (그레이타그 productUsid 자리 대체)
  name: string | null;        // 파티원 프로필명 (에브리뷰는 좌석 개념이라 빈자리 제외 시 실명 없음 → 파티원 없음)
  profileName: string | null;
  status: string;             // Using | OnSale
  statusName: string;
  price: string;
  purePrice: number;
  realizedSum: number;
  progressRatio: string;
  startDateTime: string | null;
  endDateTime: string | null;
  remainderDays: number;
  source: 'after' | 'before';
}

export interface EveryviewManagementAccount {
  email: string;                       // 파티 ID 기반 가상 식별자 (에브리뷰는 계정 이메일 비노출)
  serviceType: string;
  members: EveryviewManagementMember[];
  usingCount: number;
  activeCount: number;
  totalSlots: number;
  totalIncome: number;
  totalRealizedIncome: number;
  expiryDate: string | null;
  keepPasswd?: string;
  partyId: number;
  partyType: 'free' | 'general';
  title: string;
  expectedSettlement?: number;
  expectedSettlementLabel?: string | null;
  settlementPeriod?: string | null;
  depositDate?: string | null;
}

export interface EveryviewManagementService {
  serviceType: string;
  accounts: EveryviewManagementAccount[];
  totalUsingMembers: number;
  totalActiveMembers: number;
  totalIncome: number;
  totalRealized: number;
}

export interface EveryviewManagementSnapshot {
  provider: 'everyview';
  services: EveryviewManagementService[];
  parties: EveryviewHostPartySummary[];
  summary: {
    totalUsingMembers: number;
    totalActiveMembers: number;
    totalIncome: number;
    totalRealized: number;
    totalAccounts: number;
  };
  cookieSource: 'manual' | 'session-keeper';
  updatedAt: string;
}

const KOREAN_DATE_RE = /(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/;

function parseKoreanDate(label: string | null): string | null {
  if (!label) return null;
  const m = label.match(KOREAN_DATE_RE);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).toISOString();
}

function daysBetween(from: Date, to: Date): number {
  return Math.ceil((to.getTime() - from.getTime()) / 86_400_000);
}

/** 파티 상세 → graytag management AccountEntry 형태로 변환 (대시보드 UI 재사용) */
export function toManagementAccount(detail: EveryviewPartyDetail, summary: EveryviewHostPartySummary): EveryviewManagementAccount {
  const endIso = parseKoreanDate(detail.endDateLabel);
  const startIso = parseKoreanDate(detail.startDateLabel);
  const memberRows = detail.members.filter((m) => m.state === 'member');
  const usingCount = memberRows.length;
  const svc = detail.loginInfo[0];
  return {
    // 에브리뷰는 공유 계정 이메일을 노출하지 않으므로 파티ID 기반 가상 식별자 사용
    email: `everyview:${detail.partyId}`,
    serviceType: summary.serviceName || detail.serviceName || '기타',
    members: memberRows.map((m, i) => ({
      memberId: `everyview:${detail.partyId}:${i}`,
      productUsid: String(detail.partyId),
      name: m.name,
      profileName: m.name,
      status: 'Using',
      statusName: '이용 중',
      price: '0',
      purePrice: 0,
      realizedSum: 0,
      progressRatio: '100',
      startDateTime: startIso,
      endDateTime: endIso,
      remainderDays: endIso ? daysBetween(new Date(), new Date(endIso)) : 0,
      source: 'after',
    })),
    usingCount,
    activeCount: usingCount,
    totalSlots: Math.max(detail.totalSlots, 1),
    totalIncome: 0,     // 에브리뷰는 정산 API 별도 (getSettlementHistory)
    totalRealizedIncome: 0,
    expiryDate: endIso,
    keepPasswd: svc?.accountPassword ?? undefined,
    partyId: detail.partyId,
    partyType: 'free',
    title: summary.title,
  };
}

function parseShortJoinedAt(label: string | null): string | null {
  const match = String(label || '').match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
  if (!match) return null;
  return new Date(Date.UTC(2000 + Number(match[1]), Number(match[2]) - 1, Number(match[3]))).toISOString();
}

/** 검증파티 → 관리 카드. 초대 메일은 민감정보라 기본 스냅샷에 싣지 않는다. */
export function toManagementGeneralAccount(detail: EveryviewGeneralPartyDetail, summary: EveryviewHostPartySummary): EveryviewManagementAccount {
  return {
    email: `everyview:${detail.partyId}`,
    serviceType: summary.serviceName || detail.serviceName || '기타',
    members: detail.members.map((member, index) => ({
      memberId: `everyview:${detail.partyId}:${index}`,
      productUsid: String(detail.partyId),
      name: member.name,
      profileName: member.name,
      status: 'Using',
      statusName: '이용 중',
      price: '0', purePrice: 0, realizedSum: 0, progressRatio: '100',
      startDateTime: parseShortJoinedAt(member.joinedAt),
      endDateTime: null, remainderDays: 0, source: 'after',
    })),
    usingCount: detail.members.length,
    activeCount: detail.members.length,
    totalSlots: Math.max(detail.members.length, 1),
    totalIncome: detail.expectedSettlement,
    totalRealizedIncome: 0,
    expiryDate: null,
    partyId: detail.partyId,
    partyType: 'general',
    title: summary.title,
    expectedSettlement: detail.expectedSettlement,
    expectedSettlementLabel: detail.expectedSettlementLabel,
    settlementPeriod: detail.settlementPeriod,
    depositDate: detail.depositDate,
  };
}
