import { it, expect, vi } from "vitest";
import {
  processInquiry,
  type Context,
  type Journal,
} from "../src/support/engine";
import { allowedPlan, POLICY_VERSION } from "../src/support/policy";
function replay(texts: string[], delivered = false) {
  const c: Context = {
    postSeq: 1,
    memberSeq: 2,
    buyerSeq: 3,
    sellerSeq: 4,
    roomId: "r",
    service: "유튜브",
    active: true,
    delivered,
    messages: texts.map((message, i) => ({
      senderSeq: 3,
      messageType: "TEXT",
      message,
      createdAt: `2026-10-28T06:41:${String(i).padStart(2, "0")}Z`,
    })),
  };
  const journal: Journal = { version: 1, rooms: {} };
  const deps = {
    config: {
      mode: "auto" as const,
      policyVersion: POLICY_VERSION,
      startAt: "2026-10-28T00:00:00Z",
      autoSince: "2026-10-28T00:00:00Z",
    },
    journal,
    save() {},
    now: () => new Date("2026-10-28T06:43:00Z"),
    allowed: () => true,
    fresh: async () => c,
    infer: vi.fn(async (f: any) => ({ plan: allowedPlan(f), confidence: 1 })),
    alert: vi.fn(async () => true),
    send: vi.fn(async (message: string) => {
      c.messages.push({
        senderSeq: 4,
        messageType: "TEXT",
        message,
        createdAt: "2026-10-28T06:43:00Z",
      });
    }),
  };
  return { c, deps };
}
it("does not call a split invite request solved just because the final bubble says thanks", async () => {
  const { c, deps } = replay([
    "안녕하세요 유튜브 프리미엄 공유 참여하였습니다.",
    "buyer@example.com",
    "입니다.",
    "감사합니다",
  ]);
  expect(await processInquiry(c, deps)).toBe("delegated");
  expect(deps.send).not.toHaveBeenCalled();
  expect(deps.alert).not.toHaveBeenCalled();
});
it("does not claim problem resolution from a standalone courtesy thanks", async () => {
  const { c, deps } = replay(["감사합니다"], true);
  await processInquiry(c, deps);
  expect(deps.send).not.toHaveBeenCalled();
});
it("does not lose an unresolved report when thanks is sent in a separate bubble", async () => {
  const { c, deps } = replay(["이메일을 아직 받지 못했습니다.", "감사합니다"]);
  expect(await processInquiry(c, deps)).toBe("delegated");
  expect(deps.send).not.toHaveBeenCalled();
});
it("does not lose a refund request before a courtesy thanks", async () => {
  const { c, deps } = replay(["환불해주세요", "감사합니다"]);
  expect(await processInquiry(c, deps)).toBe("handoff");
  expect(deps.send).not.toHaveBeenCalled();
  expect(deps.alert).toHaveBeenCalledTimes(1);
});
it("keeps the actual diagnostic question before the final courtesy", async () => {
  const { c, deps } = replay(["TV NW-2-5 오류", "감사합니다"], true);
  c.service = "넷플릭스";
  expect(await processInquiry(c, deps)).toBe("sent");
  expect(deps.send.mock.calls[0][0]).toContain("네트워크 검사");
  expect(deps.send.mock.calls[0][0]).not.toContain("다행");
});
it("does not mix an older request across a seller response into a new turn", async () => {
  const { c, deps } = replay(["환불해주세요", "감사합니다"], true);
  c.messages.splice(1, 0, {
    senderSeq: 4,
    messageType: "TEXT",
    message: "제가 확인할게요",
    createdAt: "2026-10-28T06:41:00.500Z",
  });
  expect(await processInquiry(c, deps)).toBe("acknowledged");
  expect(deps.alert).not.toHaveBeenCalled();
  expect(deps.send).not.toHaveBeenCalled();
});
it.each(["잘되지 않습니다", "해결됐나요?", "아직 받지 못했습니다 감사합니다"])(
  "never claims resolution for %s",
  async (text) => {
    const { c, deps } = replay([text], true);
    await processInquiry(c, deps);
    expect(deps.send.mock.calls.flat().join(" ")).not.toContain("해결되셨다니");
  },
);
it("still closes an explicit resolution confirmation", async () => {
  const { c, deps } = replay(["이제 로그인 잘됩니다 감사합니다"], true);
  c.service = "넷플릭스";
  expect(await processInquiry(c, deps)).toBe("sent");
  expect(deps.send.mock.calls[0][0]).toContain("다행");
});
it("does not let a later courtesy hide an overdue unfulfilled delivery", async () => {
  const { c, deps } = replay(["초대가 안왔어요"]);
  expect(await processInquiry(c, deps)).toBe("delegated");
  c.messages.push({
    senderSeq: 3,
    messageType: "TEXT",
    message: "감사합니다",
    createdAt: "2026-10-28T07:01:00Z",
  });
  deps.now = () => new Date("2026-10-28T07:03:00Z");
  expect(await processInquiry(c, deps)).toBe("handoff");
  expect(deps.send).not.toHaveBeenCalled();
});
it("escalates an invite request blocked by authentication without claiming delivery", async () => {
  const { c, deps } = replay(["초대가 안와요", "감사합니다"]);
  expect(
    await processInquiry(c, {
      ...deps,
      deliveryBlocked: () => "invite_auth_required",
    }),
  ).toBe("handoff");
  expect(deps.send).not.toHaveBeenCalled();
  expect(deps.alert).toHaveBeenCalledWith(
    "invite_auth_required",
    expect.any(Array),
    expect.any(String),
  );
});
it("does not tell an unbound sale that its invite is being processed", async () => {
  const { c, deps } = replay(["buyer@example.com", "입니다.", "감사합니다"]);
  expect(
    await processInquiry(c, {
      ...deps,
      deliveryBlocked: () => "invite_not_bound",
    }),
  ).toBe("handoff");
  expect(deps.send).not.toHaveBeenCalled();
});
