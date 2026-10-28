import { createHash } from "node:crypto";
import type { GbutsChatMessage } from "../lib/gbuts-spotify";

export const POLICY_VERSION = "gbuts-support-v1";
export const PLANS = [
  "where_account",
  "login_clarify",
  "login_steps",
  "thanks",
  "handoff",
  "delegate",
] as const;
export type Plan = (typeof PLANS)[number];
export type Features = {
  service: string;
  intents: string[];
  device: string;
  delivered: boolean;
  rounds: number;
};
export const TEMPLATES = {
  where_account:
    "구매하신 상품의 계정 정보는 이 1:1 채팅의 앞선 안내에서 확인해주세요. 안내가 보이지 않으면 말씀해주세요.",
  login_clarify:
    "어떤 기기에서 이용 중이신가요? TV·휴대폰·PC 중 하나와 화면에 표시되는 오류 문구를 알려주시면 맞는 방법으로 안내해드리겠습니다. 비밀번호나 인증코드는 보내지 않으셔도 됩니다.",
  login_steps:
    "앱이나 브라우저를 완전히 종료한 뒤 다시 열어 로그인해보세요. 계속 실패하면 화면의 오류 문구를 그대로 알려주세요. 계정 비밀번호나 다른 사람의 프로필 설정은 변경하지 말아주세요.",
  thanks:
    "해결되셨다니 다행입니다. 이용 중 문제가 생기면 이 채팅에 남겨주세요!",
} as const;
export const time = (s: string): number =>
  Date.parse(s.includes("T") ? s : s.replace(" ", "T") + "+09:00");
export const hash = (s: unknown): string =>
  createHash("sha256").update(JSON.stringify(s)).digest("hex");
export const fingerprint = (room: string, m: GbutsChatMessage) =>
  hash([room, m.senderSeq, m.createdAt, m.messageType, m.message]);
const rules: Array<[string, RegExp]> = [
  ["refund", /환불|취소|반품|청약|refund|cancel/i],
  [
    "replace",
    /교체|교환|바꿔|바꿔주|다른\s*계정|새\s*계정|replacement|exchange/i,
  ],
  ["dispute", /신고|사기|고소|경찰|소비자|분쟁|차지백|chargeback|죽여|찾아간/i],
  [
    "failed",
    /안\s*돼|안\s*되|안됨|여전히|똑같|또\s*오류|해\s*봤|해봤|실패|안\s*와|안왔|못\s*받|못받/i,
  ],
  [
    "account",
    /아이디|아디|비번|비밀번호|계정\s*정보|로그인\s*정보|id\b|password/i,
  ],
  ["location", /어디|어딨|알려|주세요|주세|안\s*보|못\s*찾|보내/i],
  ["login", /로그인|접속|login|sign.?in/i],
  ["thanks", /감사|고마|해결|잘\s*돼|잘\s*되|됐어|됩니다/i],
  [
    "code",
    /인증|코드|가구|이메일|메일|초대|notion|노션|발급|링크|code|invite/i,
  ],
  [
    "injection",
    /지시.*무시|이전.*무시|프롬프트|시스템\s*메시지|토큰|쿠키|관리자|ignore.*instruction|system\s*prompt/i,
  ],
];
/** Only allowlisted intent labels leave this process; raw customer text never reaches a free model. */
export function features(
  text: string,
  service: string,
  delivered: boolean,
  rounds: number,
): Features {
  return {
    service: [
      "넷플릭스",
      "디즈니플러스",
      "유튜브",
      "스포티파이",
      "MSOffice",
      "iQiyi",
      "WeTV",
    ].includes(service)
      ? service
      : "기타",
    intents: rules.filter(([, r]) => r.test(text)).map(([k]) => k),
    device: /TV|티비|텔레비전/i.test(text)
      ? "tv"
      : /휴대폰|핸드폰|모바일|아이폰|안드로이드/i.test(text)
        ? "mobile"
        : /PC|컴퓨터|브라우저/i.test(text)
          ? "pc"
          : "unknown",
    delivered,
    rounds,
  };
}
export function allowedPlan(f: Features): Plan {
  const has = (s: string) => f.intents.includes(s);
  if (["refund", "replace", "dispute", "injection"].some(has) || f.rounds >= 2)
    return "handoff";
  if (has("failed") && f.rounds > 0) return "handoff";
  if (has("code")) return "delegate";
  if (has("thanks") && !has("failed") && !has("login") && !has("account"))
    return "thanks";
  if (has("account") && has("location") && !has("failed") && f.delivered)
    return "where_account";
  if (
    has("login") &&
    !has("account") &&
    f.delivered &&
    ["넷플릭스", "디즈니플러스"].includes(f.service) &&
    f.device !== "unknown" &&
    f.rounds < 2
  )
    return "login_steps";
  if (
    has("login") &&
    !has("account") &&
    f.device === "unknown" &&
    f.rounds === 0
  )
    return "login_clarify";
  return "handoff";
}
export function parsePlan(value: unknown): { plan: Plan; confidence: number } {
  if (!value || typeof value !== "object") throw Error("DIFY_PLAN_INVALID");
  const x = value as Record<string, unknown>;
  if (
    !PLANS.includes(x.plan as Plan) ||
    typeof x.confidence !== "number" ||
    !Number.isFinite(x.confidence) ||
    x.confidence < 0 ||
    x.confidence > 1 ||
    Object.keys(x).some((k) => !["plan", "confidence"].includes(k))
  )
    throw Error("DIFY_PLAN_INVALID");
  return { plan: x.plan as Plan, confidence: x.confidence };
}
export function approvedPlan(f: Features, prediction: unknown): Plan {
  const expected = allowedPlan(f),
    p = parsePlan(prediction);
  if (expected === "handoff" || expected === "delegate") return expected;
  return p.plan === expected && p.confidence >= 0.9 ? expected : "handoff";
}
