import { PARTY_ACCESS_URL_PLACEHOLDER } from './party-access-template';
import { makeDefaultProductDescription, makeDefaultProductTitle } from './write-default-template';

export const DEFAULT_SELLING_GUIDE_SUFFIX = makeDefaultProductDescription();
export const GRAYTAG_ACCESS_NOTICE_ID = '아래 메세지를 꼭 확인해주세요';
export const GRAYTAG_ACCESS_NOTICE_PW = '그래야 계정에 접근할 수 있습니다.';

export function isGraytagAccessNoticeCredential(value: string | null | undefined): boolean {
  const normalized = String(value || '').trim().replace(/\s+/g, '');
  if (!normalized) return false;
  return normalized === GRAYTAG_ACCESS_NOTICE_ID.replace(/\s+/g, '')
    || normalized === GRAYTAG_ACCESS_NOTICE_PW.replace(/\s+/g, '')
    || normalized.includes('아래메세지를')
    || normalized.includes('아래메시지를')
    || normalized.includes('확인해주세요')
    || normalized.includes('계정에접근할수있습니다');
}

export function makeDefaultSellingGuide(serviceLabel: string): string {
  return makeDefaultProductDescription(serviceLabel);
}

export interface FillProductModelInput {
  category: string;
  endDate: string;
  price: number;
  productName: string;
  serviceType: string;
  sellingGuide?: string;
}

export function buildFillProductModel(input: FillProductModelInput): Record<string, string> {
  const productModel: Record<string, string> = {
    tempProductCategory: input.category,
    endDate: input.endDate,
    priceType: 'Normal',
    price: String(input.price),
    name: makeDefaultProductTitle(input.serviceType),
    sellingGuide: input.sellingGuide?.trim() || makeDefaultSellingGuide(input.serviceType),
  };
  if (input.category === 'Netflix') {
    productModel.netflixSeatCount = '5';
    productModel.productCountryString = 'Domestic';
  }
  return productModel;
}

export function buildAutoFillDeliveryMemo(profileNickname: string, accessUrl = PARTY_ACCESS_URL_PLACEHOLDER): string {
  const url = String(accessUrl || PARTY_ACCESS_URL_PLACEHOLDER).trim() || PARTY_ACCESS_URL_PLACEHOLDER;
  const profile = String(profileNickname || '').trim();
  return [
    `계정 업데이트 주소: ${url}`,
    profile ? `배정 프로필: ${profile}` : '',
    '위 링크에서 최신 ID/PW/PIN 확인 후 로그인해주세요.',
    '프로필은 배정된 이름으로만 사용해주세요.',
    '프로필이 꽉 찼다면 링크의 파티원 현황에 없는 프로필을 삭제 후 새로 만들어주세요.',
  ].filter(Boolean).join('\n');
}

export function buildFillPartyAccessMember(input: { productUsid: string | number; profileNickname: string; endDateTime: string }) {
  return {
    kind: 'graytag' as const,
    memberId: `fill:${String(input.productUsid || '').trim()}`,
    memberName: '구매자',
    profileName: String(input.profileNickname || '').trim() || '구매자',
    status: 'OnSale',
    statusName: '판매 중',
    startDateTime: null,
    endDateTime: String(input.endDateTime || '').trim() || null,
  };
}

export function assertAutoDeliveryInput(input: { keepAcct?: string; keepPasswd?: string; keepMemo?: string }): string | null {
  if (!input.keepAcct?.trim()) return '계정 아이디가 없어 자동전달 설정을 할 수 없어요.';
  if (!input.keepPasswd?.trim()) return '계정 비밀번호가 없어 자동전달 설정을 할 수 없어요.';
  if (!input.keepMemo?.trim()) return '계정 전달 문구가 없어 자동전달 설정을 할 수 없어요.';
  return null;
}

export interface PasswordCandidate {
  keepAcct?: string;
  productType?: string;
  serviceType?: string;
  keepPasswd?: string;
}

function sameNormalizedText(a: string | undefined, b: string | undefined): boolean {
  return Boolean(a?.trim()) && Boolean(b?.trim()) && a!.trim().toLowerCase() === b!.trim().toLowerCase();
}

export function findExactPasswordForAccount(
  accountEmail: string,
  serviceType: string,
  onSaleList: PasswordCandidate[] = [],
  onSaleByKeepAcct: Record<string, PasswordCandidate[]> = {},
): string {
  const candidates = [
    ...onSaleList,
    ...(onSaleByKeepAcct[accountEmail] || []),
  ];
  const found = candidates.find((item) =>
    sameNormalizedText(item.keepAcct, accountEmail)
    && (sameNormalizedText(item.productType, serviceType) || sameNormalizedText(item.serviceType, serviceType))
    && Boolean(item.keepPasswd?.trim())
  );
  return found?.keepPasswd?.trim() || '';
}

export function requireExactAliasMemoForAutoFill(input: { statusOk?: boolean; memo?: string; expectedMemo?: string }): string | null {
  if (!input.statusOk) return '이메일/PIN 정보를 정확히 찾은 계정만 자동 등록할 수 있어요.';
  if (!input.memo?.trim()) return '계정 전달 문구가 없어 자동전달 설정을 할 수 없어요.';
  if (input.expectedMemo !== undefined && input.memo.trim() !== input.expectedMemo.trim()) return '계정 전달 문구가 Email Dashboard에서 확인된 내용과 다르게 변경되어 자동 등록할 수 없어요.';
  return null;
}

export function buildFinishedDealsUrl(kind: 'after' | 'before', page: number, rows = 500, finishedDealIncluded = true): string {
  const endpoint = kind === 'after' ? 'findAfterUsingLenderDeals' : 'findBeforeUsingLenderDeals';
  return `https://graytag.co.kr/ws/lender/${endpoint}?finishedDealIncluded=${finishedDealIncluded ? 'true' : 'false'}&sorting=Latest&page=${page}&rows=${rows}`;
}
