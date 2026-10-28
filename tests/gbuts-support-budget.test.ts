import { describe, it, expect } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  statSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { supportRoute, reserveSupportBudget } from "../src/support/provider";
describe("support route and daily budget", () => {
  it("never activates a paid route without explicit authorization", () => {
    expect(() =>
      supportRoute({
        GBUTS_SUPPORT_PROVIDER: "openrouter",
        GBUTS_SUPPORT_OPENROUTER_KEY: "private",
        GBUTS_SUPPORT_MODEL: "google/gemini-2.5-flash-lite",
      }),
    ).toThrow("PAID_MODEL_NOT_AUTHORIZED");
  });
  it("accepts only approved provider/model pairs", () => {
    expect(() =>
      supportRoute({
        GBUTS_SUPPORT_PROVIDER: "openrouter",
        GBUTS_SUPPORT_OPENROUTER_KEY: "private",
        GBUTS_SUPPORT_MODEL: "expensive/unreviewed",
      }),
    ).toThrow();
    expect(
      supportRoute({
        GBUTS_SUPPORT_PROVIDER: "openrouter",
        GBUTS_SUPPORT_OPENROUTER_KEY: "private",
      }).paid,
    ).toBe(false);
  });
  it("reserves before use and stops at the daily ceiling", () => {
    const dir = mkdtempSync(join(tmpdir(), "gbuts-budget-")),
      p = join(dir, "budget.json");
    try {
      reserveSupportBudget(p, 0.002);
      reserveSupportBudget(p, 0.002);
      expect(() => reserveSupportBudget(p, 0.002)).toThrow(
        "SUPPORT_DAILY_BUDGET_EXHAUSTED",
      );
      expect(JSON.parse(readFileSync(p, "utf8")).requests).toBe(2);
      expect(statSync(p).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
  it("resets by Korean calendar date and fails closed on corrupted state", () => {
    const dir = mkdtempSync(join(tmpdir(), "gbuts-budget-")),
      p = join(dir, "budget.json");
    try {
      reserveSupportBudget(p, 0.001, new Date("2026-10-28T14:59:00Z"));
      expect(
        reserveSupportBudget(p, 0.001, new Date("2026-10-28T15:01:00Z"))
          .requests,
      ).toBe(1);
      writeFileSync(p, "{}");
      expect(() => reserveSupportBudget(p, 0.001)).toThrow(
        "SUPPORT_BUDGET_INVALID",
      );
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});
