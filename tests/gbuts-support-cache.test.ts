import { it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cachedPlan,
  cachePlan,
  permitModelRequest,
  blockModel,
} from "../src/support/cache";
import { features } from "../src/support/policy";
import { supportRoute } from "../src/support/provider";
it("reuses a verified plan only for identical anonymous facts", () => {
  const root = mkdtempSync(join(tmpdir(), "support-cache-"));
  try {
    const route = supportRoute({}),
      f = features("아이디 어디 있어요", "넷플릭스", true, 0);
    cachePlan(root, f, route, { plan: "where_account", confidence: 1 });
    expect(cachedPlan(root, f, route)?.plan).toBe("where_account");
    expect(cachedPlan(root, { ...f, delivered: false }, route)).toBeUndefined();
    expect(
      cachedPlan(root, { ...f, service: "디즈니플러스" }, route),
    ).toBeUndefined();
  } finally {
    rmSync(root, { recursive: true });
  }
});
it("keeps cached answers available while an exhausted provider is paused", () => {
  const root = mkdtempSync(join(tmpdir(), "support-cache-"));
  try {
    const route = supportRoute({}),
      f = features("감사합니다", "넷플릭스", true, 0);
    cachePlan(root, f, route, { plan: "thanks", confidence: 1 });
    blockModel(root);
    expect(() => permitModelRequest(root, route)).toThrow("MODEL_BACKOFF");
    expect(cachedPlan(root, f, route)?.plan).toBe("thanks");
  } finally {
    rmSync(root, { recursive: true });
  }
});
it("does not cache a mismatched or low-confidence prediction", () => {
  const root = mkdtempSync(join(tmpdir(), "support-cache-"));
  try {
    const route = supportRoute({}),
      f = features("로그인 오류", "넷플릭스", true, 0);
    cachePlan(root, f, route, { plan: "thanks", confidence: 1 });
    expect(cachedPlan(root, f, route)).toBeUndefined();
    cachePlan(root, f, route, { plan: "login_clarify", confidence: 0.6 });
    expect(cachedPlan(root, f, route)).toBeUndefined();
  } finally {
    rmSync(root, { recursive: true });
  }
});
