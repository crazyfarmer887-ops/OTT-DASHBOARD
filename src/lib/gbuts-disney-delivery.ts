import { safeDisneyEmailAccessUrl } from './disney-mailbox';
import { isGraytagAccessNoticeCredential } from './graytag-fill';

export interface GbutsOttCredentials { id: string; password: string; emailAccessUrl?: string; emailAccessPin?: string }
export const DISNEY_DIRECT_FORMAT = 'disney-mailbox-v1' as const;
export const DISNEY_REFUND_NOTICE = '환불 안내: 이용 개시 후 단순 변심·이용규칙 위반은 환불이 제한됩니다. 사전 고지된 일시적 동시 시청 제한을 사유로 한 환불은 불가합니다. 계정 문제로 이용이 불가능하면 확인 후 대체 제공 또는 환불하며, 벗츠 정책에 따라 처리합니다.';
export const DISNEY_AFTER_ORDER_NOTICE = 'ID·비밀번호는 벗츠 계정 정보에서 확인하세요. 1:1 채팅으로도 ID·비밀번호와 이메일 인증 주소를 보내드립니다.';

export function assertGbutsOttCredentials(value: GbutsOttCredentials): void {
  if (![value.id, value.password].every(x => typeof x === 'string' && x.trim() && !/[\r\n]/.test(x) && !isGraytagAccessNoticeCredential(x)))
    throw new Error('최신 ID·비밀번호를 확인해주세요.');
}

export function buildGbutsDisneyDirectText(value: GbutsOttCredentials, profileNumber: number): string {
  assertGbutsOttCredentials(value);
  const mailbox = safeDisneyEmailAccessUrl(value.emailAccessUrl, value.id);
  if (!mailbox || !Number.isInteger(profileNumber) || profileNumber < 1 || profileNumber > 6)
    throw new Error('배정된 디즈니 계정의 이메일 인증 주소·프로필을 확인해주세요.');
  const emailverify = new URL(mailbox).origin === 'https://email-verify.one';
  if (emailverify && !/^\d{6}$/.test(value.emailAccessPin || '')) throw new Error('이메일 인증 PIN을 확인해주세요.');
  const pinText = emailverify ? `\n이메일 PIN : ${value.emailAccessPin}` : '';
  const refund = DISNEY_REFUND_NOTICE.replace('환불 안내: ', '').replace(/\. /g, '.\n');
  return `[계정 정보]\nID : ${value.id}\nPW : ${value.password}\n프로필 : ${profileNumber}번 (새로 만들어 이용)\n\n[이메일 인증]\n${mailbox}${pinText}\nTV에서 6자리 코드를 요구하면\n위 주소의 최신 메일을 확인하세요.\n\n[환불 안내]\n${refund}`;
}

/** Keep merchant copy in sync without touching prices, dates or refund promises. */
export function disneyDirectDescription(description: string): string {
  return description
    .replace(/구매 후 안내받는 계정 정보 페이지의 이메일 인증 코드 확인 버튼을 이용해 주세요\./g, '구매 후 1:1 채팅으로 받는 이메일 인증 주소를 이용해 주세요.')
    .replace(/구매 후 안내받는 계정 정보 페이지를 확인해 주세요\./g, '구매 후 1:1 채팅으로 받는 이메일 인증 주소를 확인해 주세요.')
    .replace(/계정 정보를 채팅으로 바로 받으시려면 ! 하나만 남겨주세요\. 최신 ID·비밀번호를 자동 안내합니다\./g, 'ID·비밀번호와 이메일 인증 주소는 구매 후 1:1 채팅으로 바로 안내합니다.');
}
