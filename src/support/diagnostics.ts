/** Reviewed official-help knowledge. No account mutation, secret interpolation or live-web content. */
export const GUIDES = {
  nf_network: {
    service: "넷플릭스",
    match: /\bNW[-\s]?2[-\s]?5\b/i,
    source: "https://help.netflix.com/ko/node/14424",
    steps: [
      "NW-2-5는 기기에서 넷플릭스 서버 연결이 지연될 때 나오는 오류입니다.\n1. 오류 화면의 ‘상세 정보 > 네트워크 검사’를 실행해주세요.\n2. 같은 기기에서 다른 인터넷 앱도 열리는지 확인해주세요.\n빨간 X가 뜨는지 알려주세요.",
      "연결 검사를 해도 같다면 기기 전원을 완전히 껐다 켜주세요. 본인 집 공유기도 재시작할 수 있으면 전원을 30초 분리한 뒤 켜고 연결을 기다려주세요. 공용망은 건드리지 마세요. 이후 같은 코드인지 알려주세요.",
    ],
  },
  nf_cache: {
    service: "넷플릭스",
    match: /\bUI[-\s]?800[-\s]?3\b(?!\s*\()/i,
    source: "https://help.netflix.com/ko/node/12232",
    steps: [
      "UI-800-3는 기기에 남은 앱 정보나 연결 문제일 수 있습니다. TV·셋톱박스 전원을 완전히 분리해 3분 뒤 다시 켜주세요. 괄호 속 추가 번호가 있다면 전체 코드를 먼저 알려주세요.",
      "전원을 다시 켜도 같다면 앱과 기기 소프트웨어를 업데이트해주세요. 공장 초기화나 앱 데이터 삭제는 하지 마세요. 기기 모델명과 전체 오류 코드를 알려주시면 추가 확인하겠습니다.",
    ],
  },
  nf_streams: {
    service: "넷플릭스",
    match:
      /동시.*(?:접속|시청|재생)|(?:사용|시청).*(?:너무 많|사람이 많)|too many (?:devices|people)|\bE123\b|tvq-pb-101\s*\(2\.10\.5006\)/i,
    source: "https://help.netflix.com/ko/node/29",
    steps: [
      "동시 재생 한도에 도달한 메시지입니다. 본인이 다른 기기에서 재생 중인 영상만 종료한 뒤 5~10분 후 다시 시도해주세요. 다른 이용자의 기기를 로그아웃시키지 마세요. 계속 같다면 알려주세요.",
    ],
  },
  nf_household: {
    service: "넷플릭스",
    match: /이용\s*가구|넷플릭스\s*가구|netflix household/i,
    source: "https://help.netflix.com/ko/node/127200",
    review: true,
    steps: [
      "넷플릭스가 기기를 해당 계정의 이용 가구로 확인하지 못한 상태입니다. 가구 업데이트는 다른 이용자에게 영향을 줄 수 있어 직접 변경하지 말아주세요. 화면의 정확한 문구를 바탕으로 판매자가 이용 가능 여부를 확인하도록 전달하겠습니다.",
    ],
  },
  nf_password: {
    service: "넷플릭스",
    match:
      /(?:비번|비밀번호|password).*(?:틀|잘못|일치하지|incorrect|invalid)|incorrect password|password is incorrect/i,
    source: "https://help.netflix.com/en/node/470",
    steps: [
      "비밀번호 오류는 입력값·자동완성 정보가 맞지 않을 때 생길 수 있습니다. 앞서 받은 정보로 자동완성을 끄고 대소문자와 앞뒤 공백을 확인해 한 번만 입력해주세요. 비밀번호를 바꾸거나 이 채팅에 다시 적지는 마세요.",
      "입력값을 확인했는데도 같다면 본인 브라우저의 비공개 창에서 같은 계정으로 한 번 확인해주세요. 웹에서는 되고 앱만 안 되는지 알려주세요. 계속 거부되면 추가 로그인 반복 없이 판매자가 계정 상태를 확인하겠습니다.",
    ],
  },
  disney_network: {
    service: "디즈니플러스",
    match:
      /(?:오류|에러|error|code|코드)\s*(?:code|코드)?\s*[:：#-]?\s*42\b|^42(?:번|예요|입니다)?$/i,
    source: "https://help.disneyplus.com/article/disneyplus-error-42",
    steps: [
      "디즈니+ 오류 42는 인터넷 연결 문제일 가능성이 큽니다. 같은 기기에서 다른 인터넷 앱이 열리는지 확인하고 디즈니+ 앱을 완전히 종료한 뒤 다시 실행해주세요. 다른 앱도 안 되는지 알려주세요.",
      "다른 앱은 되는데 오류 42가 계속되면 본인 공유기를 다시 시작하고 연결이 안정된 뒤 시도해주세요. 공용망은 변경하지 마세요. 계속 같다면 기기 모델과 오류 문구를 알려주세요.",
    ],
  },
  disney_device: {
    service: "디즈니플러스",
    match:
      /(?:오류|에러|error|code|코드)\s*(?:code|코드)?\s*[:：#-]?\s*83\b|^83(?:번|예요|입니다)?$/i,
    source: "https://help.disneyplus.com/article/disneyplus-en-ph-error-83",
    steps: [
      "디즈니+ 오류 83은 기기 호환성이나 연결 문제일 수 있습니다. TV·휴대폰은 공식 앱으로, PC는 최신 지원 브라우저로 실행해주세요. 앱과 기기 업데이트 여부도 확인해주세요. 사용 기기는 무엇인가요?",
      "공식 앱과 업데이트를 확인했다면 기기 전원을 완전히 껐다 켜고 인터넷 연결을 점검해주세요. 그래도 오류 83이면 기기 모델명을 알려주세요. 지원 기기 여부를 추가 확인하겠습니다.",
    ],
  },
  disney_location: {
    service: "디즈니플러스",
    match:
      /(?:오류|에러|error|code|코드)\s*(?:code|코드)?\s*[:：#-]?\s*73\b|^73(?:번|예요|입니다)?$/i,
    source: "https://help.disneyplus.com/article/disneyplus-tr-tr-error-73",
    steps: [
      "오류 73은 현재 지역에서 이용할 수 없거나 VPN·프록시가 켜졌을 때 생길 수 있습니다. 사용 중인 VPN·프록시를 끄고 서비스 지원 지역에서 앱을 다시 실행해주세요. 국가를 허위로 바꾸지 마세요. 계속 같은지 알려주세요.",
    ],
  },
  disney_password: {
    service: "디즈니플러스",
    match:
      /(?:오류|에러|error|code|코드)\s*(?:code|코드)?\s*[:：#-]?\s*14\b|(?:비번|비밀번호|password).*(?:틀|잘못|일치하지|incorrect)|^14(?:번|예요|입니다)?$/i,
    source:
      "https://help.disneyplus.com/en-GB/article/disneyplus-en-ie-error-14",
    steps: [
      "오류 14는 비밀번호 확인이 필요한 상태입니다. 앞서 받은 계정 정보로 자동완성 대신 대소문자·공백을 확인해 한 번만 입력해주세요. 공유 계정 비밀번호 재설정은 하지 마세요. 그대로 거부되면 판매자가 확인하도록 알려주세요.",
    ],
  },
  spotify_premium: {
    service: "스포티파이",
    match:
      /광고|(?:프리미엄|premium).*(?:안|없|풀|해제)|(?:free|무료)\s*(?:계정|요금제|플랜)|무료로/i,
    source: "https://support.spotify.com/mx-en/article/premium-not-working/",
    steps: [
      "다른 계정으로 로그인됐거나 구독 정보가 앱에 갱신되지 않았을 수 있습니다. 초대를 수락한 본인 계정과 현재 로그인 계정이 같은지 확인한 뒤, 본인 앱에서 로그아웃·재로그인해주세요. 요금제에 Free/Premium 중 무엇이 보이나요?",
      "같은 계정으로 다시 로그인해도 Free라면 초대 수락 여부와 계정 페이지의 요금제를 확인해주세요. 추가 결제나 가족 탈퇴는 하지 마세요. 표시되는 요금제와 오류 문구를 알려주시면 구독 상태 확인으로 넘기겠습니다.",
    ],
  },
  spotify_invite: {
    service: "스포티파이",
    match:
      /(?:초대|invite|링크).*(?:만료|유효하지|작동|invalid|expired)|만료.*(?:초대|링크)/i,
    source:
      "https://support.spotify.com/bh-en/article/cannot-join-family-plan/",
    steps: [
      "초대 링크가 다른 계정으로 열렸거나 이미 사용됐을 수 있습니다. 비공개 창에서 앞서 받은 초대 링크를 열고 초대받은 본인 Spotify 계정으로 로그인해주세요. ‘만료’가 계속되면 문구를 알려주세요. 새 링크 발급은 판매자가 확인합니다.",
    ],
  },
  youtube_premium: {
    service: "유튜브",
    match: /광고|(?:프리미엄|premium).*(?:안|없|풀|해제)|무료로/i,
    source: "https://support.google.com/youtube/answer/7437519?hl=ko",
    steps: [
      "초대를 수락한 Google 계정과 유튜브에서 보는 계정이 다를 수 있습니다. 프로필에서 같은 계정인지 확인하고 ‘구매 항목 및 멤버십’에서 Premium 상태를 확인해주세요. 광고가 일반 영상 앞 광고인지 영상 속 협찬인지도 알려주세요.",
      "같은 계정에서 Premium이 활성이라면 공식 유튜브 앱으로 다시 로그인해 확인해주세요. TV로 전송 중이면 TV와 휴대폰 계정도 확인해주세요. 멤버십이 없거나 일시중지라면 결제·가족 변경 없이 표시 문구를 알려주세요.",
    ],
  },
  family_restriction: {
    service: "family",
    match:
      /다른\s*국가|같은\s*국가|국가.*(?:다르|일치|불일치)|같은\s*(?:주소|거주)|주소.*(?:인증|확인|일치)|12\s*개월|다른\s*가족|이미.*가족|country.*(?:same|different)|same household/i,
    source: "https://support.google.com/youtube/answer/7507349?hl=ko",
    review: true,
    steps: [
      "가족 요금제의 국가·거주지·기존 가족 가입 또는 변경 제한 확인이 필요한 상태입니다. 임의로 가족을 탈퇴하거나 국가·주소를 변경하지 말아주세요. 가입 가능 여부를 판단할 수 있도록 해당 오류 문구와 함께 판매자에게 전달하겠습니다.",
    ],
  },
  notion_access: {
    service: "스포티파이",
    match:
      /(?:노션|notion).*(?:권한|접근|열리지|안\s*열|access)|(?:권한|접근).*(?:노션|notion)/i,
    source: "https://www.notion.com/help/cant-access-my-own-page",
    steps: [
      "노션 권한 메시지는 로그인 계정이나 페이지 공개 권한 문제일 수 있습니다. 앞서 받은 링크를 외부 브라우저의 비공개 창에서 열어주세요. 계속 권한 요청이 뜨면 정확한 문구를 알려주세요. 접근 권한 변경은 판매자가 확인합니다.",
    ],
  },
} as const;
export type Issue = keyof typeof GUIDES;
export type DiagnosticPlan = `d_${Issue}_${1 | 2}`;
export const DIAGNOSTIC_TEMPLATES = Object.fromEntries(
  Object.entries(GUIDES).flatMap(([id, g]) =>
    g.steps.map((text, i) => [`d_${id}_${i + 1}`, text]),
  ),
) as Record<DiagnosticPlan, string>;
export const DIAGNOSTIC_LABELS = [
  ...Object.keys(GUIDES).map((x) => `issue_${x}`),
  "diagnostic_step_2",
  "diagnostic_exhausted",
  "diagnostic_clarify",
];
export function knownIssue(text: string, service: string): Issue | undefined {
  // A specific UI-800-3 subcode has different causes; never collapse it into the generic article.
  if (service === "넷플릭스" && /UI[-\s]?800[-\s]?3\s*\(/i.test(text)) return;
  const found = Object.entries(GUIDES).filter(
    ([, g]) =>
      (g.service === service ||
        (g.service === "family" &&
          ["유튜브", "스포티파이"].includes(service))) &&
      g.match.test(text),
  );
  // Multiple unrelated errors require clarification, not whichever regex happens to run first.
  if (found.length !== 1) return;
  return found[0][0] as Issue;
}
export function diagnosticIssue(intents: string[]): Issue | undefined {
  const ids = (Object.keys(GUIDES) as Issue[]).filter((x) =>
    intents.includes("issue_" + x),
  );
  return ids.length === 1 ? ids[0] : undefined;
}
export function diagnosticPlan(f: {
  service: string;
  intents: string[];
  delivered: boolean;
}): DiagnosticPlan | undefined {
  const id = diagnosticIssue(f.intents);
  if (!id) return;
  const g = GUIDES[id];
  if (
    !f.delivered ||
    !(
      g.service === f.service ||
      (g.service === "family" && ["유튜브", "스포티파이"].includes(f.service))
    )
  )
    return;
  const stage = f.intents.includes("diagnostic_step_2") ? 2 : 1;
  const plan = `d_${id}_${stage}` as DiagnosticPlan;
  return DIAGNOSTIC_TEMPLATES[plan] ? plan : undefined;
}
export function diagnosticMeta(plan: string) {
  const m = /^d_(.+)_([12])$/.exec(plan);
  if (!m || !(m[1] in GUIDES) || !(plan in DIAGNOSTIC_TEMPLATES)) return;
  const issue = m[1] as Issue;
  return {
    issue,
    stage: Number(m[2]),
    review: "review" in GUIDES[issue] && GUIDES[issue].review,
  };
}

const ISSUE_NAMES: Record<Issue, string> = {
  nf_network: "넷플릭스 NW-2-5 연결",
  nf_cache: "넷플릭스 UI-800-3 앱 정보",
  nf_streams: "넷플릭스 동시 재생",
  nf_household: "넷플릭스 이용 가구",
  nf_password: "넷플릭스 비밀번호",
  disney_network: "디즈니+ 42 연결",
  disney_device: "디즈니+ 83 호환성",
  disney_location: "디즈니+ 73 지역",
  disney_password: "디즈니+ 14 로그인",
  spotify_premium: "스포티파이 구독 반영",
  spotify_invite: "스포티파이 초대 링크",
  youtube_premium: "유튜브 구독 반영",
  family_restriction: "가족 가입 제한",
  notion_access: "노션 접근 권한",
};
export function planSummary(plan: string): string {
  const m = diagnosticMeta(plan);
  return m
    ? `${ISSUE_NAMES[m.issue]} ${m.stage}단계`
    : (
        {
          login_clarify: "기기 확인",
          troubleshoot_clarify: "오류 문구 확인",
          where_account: "전달 위치 안내",
          login_steps: "기본 로그인 점검",
          delegate: "기존 전달 처리 대기",
          handoff: "판매자 확인",
          thanks: "해결 확인",
        } as Record<string, string>
      )[plan] || "확인";
}
