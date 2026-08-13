import { describe, expect, it } from "vitest";
import { dashboardPageTitleForPath } from "../src/web/lib/page-title";

describe("dashboardPageTitleForPath", () => {
  it("includes the account management subpage in the browser tab title", () => {
    expect(dashboardPageTitleForPath("/manage")).toBe("OTT dashboard | 계정 관리");
  });

  it("includes the profit subpage in the browser tab title", () => {
    expect(dashboardPageTitleForPath("/profit")).toBe("OTT dashboard | 수익");
  });

  it("includes the YouTube invitations operations subpage", () => {
    expect(dashboardPageTitleForPath("/youtube-invites")).toBe("OTT dashboard | 유튜브 초대 운영");
  });

  it("supports prefixed dashboard paths and nested price pages", () => {
    expect(dashboardPageTitleForPath("/dashboard/price/wavve?x=1")).toBe("OTT dashboard | 가격");
  });

  it("falls back to the base title for unknown paths", () => {
    expect(dashboardPageTitleForPath("/unknown")).toBe("OTT dashboard");
  });
});
