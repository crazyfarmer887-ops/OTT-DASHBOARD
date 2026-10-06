import { makeDefaultProductDescription } from './write-default-template';

export const GBUTS_ACCOUNT_CHANGE_WARNING = '무단 변경으로 피해가 발생하면 이용 제한과 함께 민사상 손해배상 청구 및 형사 고소·고발 등 법적 조치를 진행할 수 있습니다.';
export const GBUTS_NETFLIX_DESCRIPTION = `📌 넷플릭스 파티 필수 이용수칙

✅ 가구 인증 / 로그인 코드 확인 방법은 파티 참여 후 안내드립니다.

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

export function makeGbutsOttDescription(serviceType: string): string {
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
export function buildGbutsNetflixDeliveryText(accessUrl: string, number: number): string {
  return netflixDeliveryParagraphs(accessUrl, number).join('\n\n');
}
/** History-only compatibility for the already delivered operational recovery. */
export function buildGbutsNetflixUnformattedDeliveryText(accessUrl: string, number: number): string {
  return netflixDeliveryParagraphs(accessUrl, number).join('\n');
}
