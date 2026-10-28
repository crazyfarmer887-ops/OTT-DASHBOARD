import { features, time, type Features } from "./policy";
import { diagnosticMeta, diagnosticIssue, GUIDES } from "./diagnostics";
type Receipt = { state: string; plan: string; at: string; device?: string };
/** Derives only enum facts from the same room; never persists the buyer's text. */
export function conversationFeatures(
  text: string,
  service: string,
  delivered: boolean,
  rounds: number,
  receipts: Receipt[],
  at: string,
): Features {
  const f = features(text, service, delivered, rounds);
  const confirmed = receipts
    .filter(
      (r) =>
        r.state === "confirmed" &&
        time(r.at) < time(at) &&
        time(at) - time(r.at) < 48 * 3600000,
    )
    .sort((a, b) => time(a.at) - time(b.at));
  const prior = confirmed.at(-1),
    meta = prior && diagnosticMeta(prior.plan);
  const failed =
    /안\s*(?:돼|되|됐|됨|됩)|안돼|여전히|그대로|동일|똑같|계속|해결\s*못|미해결|실패|해\s*봤|(?:확인|검사|재시작|재부팅|입력)(?:했|해봤)|still|same|doesn.t work/i.test(
      text,
    );
  const outcome =
    failed ||
    /빨간\s*X|빨강|네트워크.*정상|다른\s*앱.*(?:돼|됩)|(?:Free|무료)(?:로|입니다|예요)|(?:Premium|프리미엄).*(?:활성|표시)|웹.*(?:되고|됩니다)|앱만/i.test(
      text,
    );
  if (
    outcome &&
    /다른\s*앱|네트워크.*(?:정상|검사)|빨간\s*X|웹.*되고|앱만/.test(text)
  )
    f.intents = f.intents.filter((x) => x !== "thanks");
  const isDeviceOnly =
    /^(?:TV|티비|PC|컴퓨터|휴대폰|핸드폰|아이폰|모바일)(?:예요|에요|입니다|요|에서요)?[.!\s]*$/i.test(
      text.trim(),
    );
  const explicitCode =
    /(?:오류|에러|error|코드|code)\s*[:：#]?\s*[a-z0-9-]*\d|\b(?:NW|UI|tvq)[-\s]\w/i.test(
      text,
    );
  let issue = diagnosticIssue(f.intents);
  // Do not reuse an earlier error for a new, unknown code or a different topic.
  if (
    !issue &&
    meta &&
    (outcome || isDeviceOnly) &&
    !explicitCode &&
    !f.intents.some((x) =>
      ["account", "code", "refund", "replace", "thanks"].includes(x),
    )
  ) {
    issue = meta.issue;
    f.intents.push("issue_" + issue);
  }
  if (f.device === "unknown" && prior?.device && (issue || failed))
    f.device = prior.device;
  if (prior?.plan === "login_clarify" && isDeviceOnly) f.intents.push("login");
  if (issue && meta?.issue === issue) {
    if (meta.stage === 1 && GUIDES[issue].steps.length > 1)
      f.intents.push("diagnostic_step_2");
    else f.intents.push("diagnostic_exhausted");
  }
  // A first message can already say the first step was completed.
  if (
    issue &&
    !meta &&
    /(?:확인|검사|점검|재입력|입력값|자동완성).*(?:했|해봤)|(?:비공개|시크릿).*(?:했|해봤)/.test(
      text,
    ) &&
    GUIDES[issue].steps.length > 1
  )
    f.intents.push("diagnostic_step_2");
  const clarification =
    prior && ["login_clarify", "troubleshoot_clarify"].includes(prior.plan);
  if (
    !issue &&
    !f.intents.some((x) =>
      ["login", "account", "thanks", "gratitude", "code"].includes(x),
    ) &&
    (!prior || (clarification && !explicitCode && !failed && !isDeviceOnly))
  )
    f.intents.push("diagnostic_clarify");
  // Exact but unsupported error after clarification is genuinely unresolved.
  if (!issue && clarification && (explicitCode || failed) && !isDeviceOnly)
    f.intents.push("diagnostic_exhausted");
  return f;
}

type TurnMessage = {
  senderSeq: number;
  messageType: string;
  message: string;
  createdAt: string;
};
/** One customer turn can span several bubbles. Stop at a seller response, attachment or >5min gap. */
export function latestBuyerTurn(
  messages: TurnMessage[],
  buyer: number,
  startAt: string,
): string {
  const ordered = [...messages].sort(
    (a, b) => time(a.createdAt) - time(b.createdAt),
  );
  const end = ordered.at(-1);
  if (!end || end.senderSeq !== buyer || end.messageType !== "TEXT") return "";
  const parts: string[] = [];
  let newer = time(end.createdAt),
    total = 0;
  for (let i = ordered.length - 1; i >= 0 && parts.length < 12; i--) {
    const m = ordered[i],
      t = time(m.createdAt);
    if (
      m.senderSeq !== buyer ||
      m.messageType !== "TEXT" ||
      !Number.isFinite(t) ||
      t < time(startAt) ||
      newer - t > 5 * 60000 ||
      time(end.createdAt) - t > 5 * 60000
    )
      break;
    if (total + m.message.length > 6000) break;
    parts.unshift(m.message);
    total += m.message.length;
    newer = t;
  }
  return parts.join("\n");
}
