import { it, expect } from "vitest";
import { hasDeliveryEvidence } from "../src/support/policy";
const m = (message: string, senderSeq = 1) => ({
  message,
  senderSeq,
  messageType: "TEXT",
  createdAt: "2026-10-28T00:00:00Z",
});
it("does not interpret a seller's question or buyer-pasted credentials as delivery", () => {
  expect(hasDeliveryEvidence([m("계정 확인 부탁드립니다")], 1)).toBe(false);
  expect(hasDeliveryEvidence([m("ID: x PW: y", 2)], 1)).toBe(false);
});
it.each([
  "ID: x PW: y",
  "아이디: x 비밀번호: y",
  "초대를 보냈습니다",
  "계정 정보 전달 완료",
  "https://example.notion.site/page",
])("recognizes bounded positive delivery marker %s", (text) =>
  expect(hasDeliveryEvidence([m(text)], 1)).toBe(true),
);
