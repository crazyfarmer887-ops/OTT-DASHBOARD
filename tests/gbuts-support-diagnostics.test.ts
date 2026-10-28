import { describe, it, expect, vi } from "vitest";
import {
  processInquiry,
  type Context,
  type Journal,
} from "../src/support/engine";
import {
  features,
  allowedPlan,
  POLICY_VERSION,
  TEMPLATES,
} from "../src/support/policy";
import { GUIDES, knownIssue } from "../src/support/diagnostics";
import { conversationFeatures } from "../src/support/conversation";
import { modelPlan } from "../src/support/dify";
function dialogue(service = "넷플릭스") {
  let at = new Date("2026-10-28T06:00:00Z");
  const c: Context = {
    postSeq: 1,
    memberSeq: 2,
    buyerSeq: 3,
    sellerSeq: 4,
    roomId: "room",
    service,
    active: true,
    delivered: true,
    messages: [],
  };
  const journal: Journal = { version: 1, rooms: {} };
  const deps = {
    config: {
      mode: "auto" as const,
      startAt: "2026-10-28T00:00:00Z",
      autoSince: "2026-10-28T00:00:00Z",
      policyVersion: POLICY_VERSION,
    },
    journal,
    save: vi.fn(),
    now: () => at,
    infer: vi.fn(async (f: any) => ({ plan: allowedPlan(f), confidence: 1 })),
    fresh: vi.fn(async () => c),
    allowed: () => true,
    send: vi.fn(async (text: string) => {
      c.messages.push({
        senderSeq: 4,
        message: text,
        messageType: "TEXT",
        createdAt: at.toISOString(),
      });
    }),
    alert: vi.fn(async () => true),
  };
  return {
    c,
    deps,
    journal,
    async say(text: string, minutes = 3) {
      at = new Date(at.getTime() + minutes * 60000);
      c.messages.push({
        senderSeq: 3,
        message: text,
        messageType: "TEXT",
        createdAt: new Date(at.getTime() - 61000).toISOString(),
      });
      return processInquiry(c, deps);
    },
  };
}
it.each([
  ["넷플릭스", "TV NW-2-5 오류", "d_nf_network_1"],
  ["넷플릭스", "UI-800-3", "d_nf_cache_1"],
  ["넷플릭스", "현재 계정을 사용하는 사람이 너무 많습니다", "d_nf_streams_1"],
  ["넷플릭스", "비밀번호가 틀렸다고 나와요", "d_nf_password_1"],
  ["디즈니플러스", "오류 코드 83", "d_disney_device_1"],
  ["디즈니플러스", "오류 42", "d_disney_network_1"],
  ["디즈니플러스", "error code 73", "d_disney_location_1"],
  ["디즈니플러스", "코드 14", "d_disney_password_1"],
  ["스포티파이", "프리미엄인데 광고가 나와요", "d_spotify_premium_1"],
  ["스포티파이", "초대 링크가 만료됐어요", "d_spotify_invite_1"],
  ["스포티파이", "노션 접근 권한이 없어요", "d_notion_access_1"],
  ["유튜브", "초대 수락했는데 프리미엄이 없어요", "d_youtube_premium_1"],
])("matches reviewed issue %s %s", (service, text, plan) =>
  expect(allowedPlan(features(text, service, true, 0))).toBe(plan),
);
it("does not collapse different UI-800-3 subcodes into generic cache advice", () => {
  expect(knownIssue("UI-800-3 (207006)", "넷플릭스")).toBeUndefined();
  expect(allowedPlan(features("UI-800-3 (207006)", "넷플릭스", true, 0))).toBe(
    "troubleshoot_clarify",
  );
});
it("does not match another service or an incidental number as a Disney error", () => {
  expect(knownIssue("83명입니다", "디즈니플러스")).toBeUndefined();
  expect(knownIssue("NW-2-5", "유튜브")).toBeUndefined();
  expect(
    knownIssue("오류83과 오류42가 같이 나와요", "디즈니플러스"),
  ).toBeUndefined();
});
it("walks clarification -> exact cause -> distinct next step -> unresolved handoff", async () => {
  const d = dialogue();
  expect(await d.say("로그인이 안돼요")).toBe("sent");
  expect(await d.say("TV에서 NW-2-5가 떠요")).toBe("sent");
  expect(d.deps.send.mock.calls.at(-1)?.[0]).toContain("네트워크 검사");
  expect(await d.say("검사해봤는데 여전히 안돼요")).toBe("sent");
  expect(d.deps.send.mock.calls.at(-1)?.[0]).toContain("30초");
  expect(await d.say("공유기도 껐다 켰는데 계속 안돼요")).toBe("handoff");
  expect(d.deps.send).toHaveBeenCalledTimes(3);
  expect(d.deps.alert).toHaveBeenCalledTimes(1);
});
it("uses the answered device without prematurely treating clarification as failed help", async () => {
  const d = dialogue();
  await d.say("로그인 안돼요");
  expect(await d.say("TV예요")).toBe("sent");
  expect(d.deps.alert).not.toHaveBeenCalled();
});
it("does not repeat an already completed network test", async () => {
  const d = dialogue();
  await d.say("TV NW-2-5 네트워크 검사는 해봤어요");
  expect(d.deps.send.mock.calls[0][0]).toContain("30초");
  expect(d.deps.send.mock.calls[0][0]).not.toContain("네트워크 검사");
});
it("explains household restrictions then notifies the owner only once", async () => {
  const d = dialogue();
  expect(await d.say("이용 가구에 포함되지 않습니다")).toBe("handoff");
  expect(d.deps.send).toHaveBeenCalledTimes(1);
  expect(d.deps.send.mock.calls[0][0]).toContain("직접 변경하지");
  await d.say("확인 부탁");
  expect(d.deps.alert).toHaveBeenCalledTimes(1);
});
it("does not resend a restriction notice after an uncertain saved-message lookup", async () => {
  const d = dialogue();
  d.deps.send.mockImplementation(async () => {
    throw Error("timeout");
  });
  expect(await d.say("이용 가구 오류")).toBe("uncertain");
  expect(await processInquiry(d.c, d.deps)).toBe("handoff");
  expect(d.deps.send).toHaveBeenCalledTimes(1);
});
it("refund still overrides a known error and inference", async () => {
  const d = dialogue();
  expect(await d.say("NW-2-5 안돼요 환불해주세요")).toBe("handoff");
  expect(d.deps.send).not.toHaveBeenCalled();
  expect(d.deps.infer).not.toHaveBeenCalled();
});
it("asks for an unknown exact error before escalating", async () => {
  const d = dialogue();
  expect(await d.say("재생 오류 ZZZ-919")).toBe("sent");
  expect(d.deps.send.mock.calls[0][0]).toContain("오류 코드");
  expect(await d.say("PC에서 ZZZ-919 오류 계속 나와요")).toBe("handoff");
});
it("does not misreport a new error as an earlier network problem", async () => {
  const d = dialogue();
  await d.say("NW-2-5 오류");
  expect(await d.say("이제 오류코드 999가 떠요")).toBe("handoff");
  expect(d.deps.send).toHaveBeenCalledTimes(1);
});
it("does not permanently drop a follow-up that arrives during cooldown", async () => {
  const d = dialogue();
  await d.say("NW-2-5 오류");
  expect(await d.say("여전히 안돼요", 1.5)).toBe("cooldown");
  // same latest message, enough time has passed now
  d.deps.now = () => new Date("2026-10-28T06:06:00Z");
  d.deps.send.mockImplementation(async (text) => {
    d.c.messages.push({
      senderSeq: 4,
      message: text,
      messageType: "TEXT",
      createdAt: d.deps.now().toISOString(),
    });
  });
  expect(await processInquiry(d.c, d.deps)).toBe("sent");
  expect(d.deps.send).toHaveBeenCalledTimes(2);
});
it("keeps stale issue context and private values out of inference", () => {
  const f = conversationFeatures(
    "안돼요 user@example.com pw:secret 123456",
    "넷플릭스",
    true,
    1,
    [
      {
        state: "confirmed",
        plan: "d_nf_network_1",
        at: "2026-10-25T00:00:00Z",
        device: "tv",
      },
    ],
    "2026-10-28T00:00:00Z",
  );
  expect(f.intents).not.toContain("issue_nf_network");
  expect(f.device).toBe("unknown");
  expect(JSON.stringify(f)).not.toMatch(/example|secret|123456/);
});
it("routes exact reviewed guide through Dify tool without consuming free inference", async () => {
  const fetcher = vi.fn();
  const f = features("NW-2-5", "넷플릭스", true, 0);
  expect(await modelPlan(f, {}, fetcher)).toEqual({
    plan: "d_nf_network_1",
    confidence: 1,
  });
  expect(fetcher).not.toHaveBeenCalled();
  await expect(
    modelPlan({ ...f, customerText: "secret" }, {}, fetcher),
  ).rejects.toThrow("FEATURES_INVALID");
});
it("never calls an unresolved issue solved just because it contains 해결", () => {
  expect(
    allowedPlan(features("아직 해결 안됐어요", "넷플릭스", true, 1)),
  ).not.toBe("thanks");
  expect(allowedPlan(features("해결 못했어요", "넷플릭스", true, 1))).not.toBe(
    "thanks",
  );
});
it("each reviewed guide has an official source and fits native transport", () => {
  for (const g of Object.values(GUIDES))
    expect(g.source).toMatch(
      /^https:\/\/(help\.netflix\.com|help\.disneyplus\.com|support\.spotify\.com|support\.google\.com|www\.notion\.com)\//,
    );
  for (const text of Object.values(TEMPLATES))
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(500);
});
it("continues a diagnostic after the requested test result, not only the words 안돼요", async () => {
  const d = dialogue();
  await d.say("NW-2-5 오류");
  expect(await d.say("빨간 X는 없고 다른 앱은 됩니다")).toBe("sent");
  expect(d.deps.send.mock.calls.at(-1)?.[0]).toContain("30초");
});
it("escalates an unhandled specialized delivery request after 15 minutes without resending", async () => {
  const d = dialogue("유튜브");
  expect(await d.say("초대가 안와요")).toBe("delegated");
  d.deps.now = () => new Date("2026-10-28T06:20:00Z");
  expect(await processInquiry(d.c, d.deps)).toBe("handoff");
  expect(d.deps.send).not.toHaveBeenCalled();
  expect(d.deps.alert).toHaveBeenCalledTimes(1);
});
it("continues support after a specialized worker's confirmed delivery notice", async () => {
  const d = dialogue();
  await d.say("로그인 안돼요");
  d.c.messages.push({
    senderSeq: 4,
    message: "ID: delivered PW: delivered",
    messageType: "TEXT",
    createdAt: "2026-10-28T06:03:01Z",
  });
  expect(await d.say("TV NW-2-5 오류")).toBe("sent");
  expect(d.deps.alert).not.toHaveBeenCalled();
});
it("recognizes a successful follow-up instead of falsely escalating the word 해봤", async () => {
  const d = dialogue();
  await d.say("NW-2-5 오류");
  expect(await d.say("안내대로 해봤는데 이제 잘돼요 감사합니다")).toBe("sent");
  expect(d.deps.send.mock.calls.at(-1)?.[0]).toContain("다행");
  expect(d.deps.alert).not.toHaveBeenCalled();
});
it("advances when the customer repeats only the exact error code", async () => {
  const d = dialogue();
  await d.say("NW-2-5");
  expect(await d.say("NW-2-5")).toBe("sent");
  expect(d.deps.send.mock.calls.at(-1)?.[0]).toContain("30초");
  expect(await d.say("NW-2-5")).toBe("handoff");
  expect(d.deps.send).toHaveBeenCalledTimes(2);
});
it("continues an error-specific guide after a short requested device answer", async () => {
  const d = dialogue("디즈니플러스");
  await d.say("오류83");
  expect(await d.say("TV예요")).toBe("sent");
  expect(d.deps.send.mock.calls.at(-1)?.[0]).toContain("기기 전원");
  expect(d.deps.alert).not.toHaveBeenCalled();
});
it("does not restart troubleshooting when a solved message mentions the old error code", async () => {
  const d = dialogue();
  await d.say("NW-2-5");
  expect(await d.say("NW-2-5 이제 해결됐어요 감사합니다")).toBe("sent");
  expect(d.deps.send.mock.calls.at(-1)?.[0]).toContain("다행");
  expect(d.deps.alert).not.toHaveBeenCalled();
});
