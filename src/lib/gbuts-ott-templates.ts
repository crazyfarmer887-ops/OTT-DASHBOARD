import { buildPartyAccessDeliveryTemplate } from './party-access-template';
import { makeDefaultProductDescription } from './write-default-template';

export function buildGbutsDisneyDeliveryText(_accessUrl: string, number: number, capacity = 6): string {
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 6 || !Number.isInteger(number) || number < 1 || number > capacity) throw new Error('디즈니 프로필 번호를 확인해주세요.');
  return `구매 감사합니다!\n디즈니플러스 ${number}번 프로필을 새로 만들어 이용해 주세요.\n구매 순서대로 1~${capacity}번을 배정합니다.\n\n[이용 안내]\nID·PW와 이메일 인증 주소를 이어서 보내드립니다.\n계정 정보 변경·타인 프로필 사용은 금지합니다.\n최신 정보를 다시 받으시려면 ! 만 남겨주세요.`;
}

export const GBUTS_ACCOUNT_CHANGE_WARNING = '무단 변경으로 피해가 발생하면 이용 제한과 함께 민사상 손해배상 청구 및 형사 고소·고발 등 법적 조치를 진행할 수 있습니다.';
export const GBUTS_NETFLIX_DESCRIPTION = `📌 넷플릭스 파티 필수 이용수칙

✅ 계정 ID·비밀번호는 구매 후 1:1 채팅으로 직접 안내합니다.
반드시 비밀번호로 로그인해 주세요. 이메일 인증·로그인 코드는 제공하지 않습니다.

✅ 한 사람이 여러 기기에서 동시에 시청하지 말아 주세요.
기기 변경 시 기존 기기에서 로그아웃 후 이용해 주세요.

✅ 프리미엄 계정의 동시 시청은 최대 4대까지 가능합니다.
파티는 5인으로 운영되므로 이용시간이 겹치면 일시적으로 시청이 제한될 수 있습니다.

✅ 구매 후 안내받은 번호의 프로필만 사용해 주세요.
프로필은 미리 만들어져 있습니다. 프로필 생성·삭제, 이름 변경, PIN 변경은 금지합니다.

✅ 성인 콘텐츠 이용에 필요한 인증은 아래 주소에서 직접 진행해 주세요.
https://www.netflix.com/verifyage

⚠️ 계정 이메일·비밀번호·PIN·결제 설정을 임의로 변경하지 마세요.
${GBUTS_ACCOUNT_CHANGE_WARNING}`;

export const GBUTS_NETFLIX_CODE_DESCRIPTION = GBUTS_NETFLIX_DESCRIPTION.replace('반드시 비밀번호로 로그인해 주세요. 이메일 인증·로그인 코드는 제공하지 않습니다.', '기본 로그인은 비밀번호로 진행해 주세요. 추가 이메일 코드가 필요하면 1:1 채팅에 4자리 로그인 코드 또는 6자리 계정 인증 코드를 요청해 주세요.');
export const GBUTS_NETFLIX_MAILBOX_DESCRIPTION = GBUTS_NETFLIX_DESCRIPTION.replace('반드시 비밀번호로 로그인해 주세요. 이메일 인증·로그인 코드는 제공하지 않습니다.', '기본은 비밀번호 로그인입니다. 이메일 인증이 필요하면 구매 후 1:1 채팅으로 받는 이메일 접근 주소와 PIN으로 최신 인증 메일을 확인하세요.');
export const GBUTS_NETFLIX_MAILBOX_AFTER_ORDER_NOTICE = 'ID·비밀번호·배정 프로필과 이메일 인증 주소·PIN을 구매 후 1:1 채팅으로 안내합니다.';

export function makeGbutsOttDescription(serviceType: string): string {
  if (serviceType === '디즈니플러스') return `디즈니플러스 · 1인 1프로필 이용

구매 순서대로 1~6번 프로필을 배정해 1:1 채팅으로 안내합니다. 안내받은 번호로 프로필을 새로 만들어 이용해 주세요.

기본은 계정 ID(이메일 주소)와 비밀번호를 직접 입력하는 비밀번호 로그인입니다. TV 등에서 이메일 인증이 필요하면 구매 후 안내받는 계정 정보 페이지를 확인해 주세요. 확인이 안 되면 1:1 채팅으로 문의해 주세요.

다른 분의 프로필을 변경·삭제하거나 계정 이메일·비밀번호·결제 설정을 변경하지 마세요. 로그인에 문제가 있으면 1:1 채팅으로 문의해 주세요.`;
  return serviceType === '넷플릭스' ? GBUTS_NETFLIX_DESCRIPTION : makeDefaultProductDescription(serviceType);
}
export function buildGbutsNetflixLegacyDeliveryText(accessUrl: string, number: number): string {
  if (!Number.isInteger(number) || number < 1 || number > 5) throw new Error('배정된 프로필 번호가 올바르지 않습니다.');
  return `구매 감사합니다! 😊

✅ 구매자님은 넷플릭스 「${number}번」 프로필을 사용해 주세요.
이미 만들어진 프로필이므로 새로 생성하지 않으셔도 됩니다.

🔗 계정 정보 확인 주소
${accessUrl}

위 주소에서 필수 이용 동의 후 아이디·비밀번호·이메일 PIN을 확인해 주세요.
가구 인증 / 로그인 코드 확인 방법도 해당 페이지에서 안내드립니다.

⚠️ 꼭 지켜주세요!
• 배정된 ${number}번 프로필만 사용해 주세요.
• 프로필 이름과 PIN을 변경하지 마세요.
• 프로필을 새로 만들거나 삭제하지 마세요.
• 계정 이메일·비밀번호·결제 설정을 변경하지 마세요.
• 한 사람이 여러 기기에서 동시에 시청하지 마세요.

${GBUTS_ACCOUNT_CHANGE_WARNING}

로그인이 안 되면 먼저 위 링크를 새로고침하여 최신 계정 정보를 확인해 주세요.
해결되지 않으면 이 채팅방으로 문의해 주세요!`;
}

/** The live-verified short guide also fits GButs as one readable message. */
function netflixDeliveryParagraphs(accessUrl: string, number: number): string[] {
  if (!Number.isInteger(number) || number < 1 || number > 5) throw new Error('배정된 프로필 번호가 올바르지 않습니다.');
  return [
    `구매 감사합니다! 넷플릭스 ${number}번 프로필을 이용해 주세요.`,
    accessUrl,
    '동의 후 ID·비밀번호·이메일 PIN, 가구 인증·로그인 코드를 확인하세요.',
    '프로필 생성·삭제/이름·PIN 변경, 계정 이메일·비밀번호·결제 설정 변경 금지.',
    '여러 기기 동시 시청 금지.',
  ];
}
export const GBUTS_DIRECT_CREDENTIAL_NOTICE = `접근 링크 접속이 부담스러우시다면 "!"라고 남겨주시면 직접 전송해드립니다.

다만 이메일 코드 인증은 접근 링크에 접속하셔서 진행하셔야 하는 점 양해 부탁드립니다.

계정 링크에 접근하지 못해 요청하시는 환불 또는 단순 변심에 의한 환불은 벗츠 이용약관에 의해 거절될 수 있습니다.`;
export function buildGbutsOttDeliveryText(accessUrl: string, netflixProfile?: number): string {
  if (netflixProfile !== undefined) return buildGbutsNetflixPasswordGuide(netflixProfile);
  const text = buildPartyAccessDeliveryTemplate(accessUrl);
  return `${text}\n\n${GBUTS_DIRECT_CREDENTIAL_NOTICE}`;
}

/** GButs collapses line breaks inside a bubble: three paragraphs are sent as three bubbles. */
export function buildGbutsNetflixAccessText(accessUrl: string, number: number): string {
  if (!Number.isInteger(number) || number < 1 || number > 5) throw new Error('배정된 프로필 번호가 올바르지 않습니다.');
  return [
    `구매 감사합니다! 넷플릭스 ${number}번 프로필을 이용해 주세요.`,
    `접근 링크: ${accessUrl}`,
    '위 링크에서 이용 동의 후 ID·비밀번호·이메일 PIN, 가구 인증·로그인 코드를 확인하세요. 이용수칙: 프로필 생성·삭제/이름·PIN 변경 금지. 계정 이메일·비밀번호·결제 설정 변경 금지. 여러 기기 동시 시청 금지.',
  ].join('\n\n');
}
export const GBUTS_NETFLIX_AFTER_ORDER_NOTICE = 'ID·비밀번호와 배정된 프로필을 1:1 채팅으로 직접 안내드립니다. 반드시 비밀번호로 로그인해 주세요. 이메일 인증·로그인 코드는 제공하지 않습니다.';
export function netflixPasswordOnlyOrderNotice(notice?: string): string {
  return !notice || /email-verify\.one|계정\s*확인\s*링크|접근\s*링크|이메일\s*PIN/i.test(notice)
    ? GBUTS_NETFLIX_AFTER_ORDER_NOTICE : notice;
}
export const GBUTS_NETFLIX_CODE_AFTER_ORDER_NOTICE = 'ID·비밀번호와 배정 프로필은 1:1 채팅으로 직접 안내합니다. 코드가 필요하면 4자리 로그인 코드 또는 6자리 인증 코드라고 요청해 주세요.';
export function buildGbutsNetflixPasswordGuide(number: number, emailCodeSupport = false): string {
  if (!Number.isInteger(number) || number < 1 || number > 5) throw new Error('배정된 프로필 번호가 올바르지 않습니다.');
  return `구매 감사합니다! 넷플릭스 ${number}번 프로필을 이용해 주세요.
ID·PW는 이 채팅으로 직접 보내드립니다.

[로그인 안내]
안내받은 ID와 비밀번호로 로그인해 주세요.
${emailCodeSupport ? '추가 코드가 필요하면 이 채팅에 “4자리 로그인 코드” 또는 “6자리 인증 코드”라고 요청해주세요. 확인한 최신 코드를 이 채팅으로 보내드립니다.' : '이메일 인증·로그인 코드는 제공하지 않습니다.'}
로그인에 문제가 있으면 이 채팅으로 문의해 주세요.

[이용수칙]
배정된 ${number}번 프로필만 사용해 주세요.
프로필 생성·삭제 및 이름·PIN 변경, 계정 이메일·비밀번호·결제 설정 변경은 금지합니다.
여러 기기에서 동시에 시청하지 마세요.`;
}
export function buildGbutsNetflixDeliveryText(_accessUrl: string, number: number, emailCodeSupport = false, mailboxSupport = false, portalSupport = false): string {
  if (portalSupport) return buildGbutsNetflixPasswordGuide(number).replace('이메일 인증·로그인 코드는 제공하지 않습니다.', '이메일 인증이 필요하면 이어서 전달하는 전용 인증 페이지 주소와 PIN을 이용해 주세요. 4자리 로그인 코드와 6자리 인증 코드를 직접 확인하실 수 있습니다.');
  if (mailboxSupport) return buildGbutsNetflixPasswordGuide(number).replace('이메일 인증·로그인 코드는 제공하지 않습니다.', '이메일 인증이 필요하면 함께 전달한 이메일 접근 주소와 PIN으로 최신 인증 메일을 확인해 주세요.');
  return buildGbutsNetflixPasswordGuide(number, emailCodeSupport);
}
/** History-only compatibility for the already delivered operational recovery. */
export function buildGbutsNetflixUnformattedDeliveryText(accessUrl: string, number: number): string {
  return netflixDeliveryParagraphs(accessUrl, number).join('\n');
}
