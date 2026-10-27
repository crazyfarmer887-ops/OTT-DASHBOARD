import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerGbutsRankDefaultRoutes } from "../src/api/gbuts-rank-defaults";
import {
  readSubscriptionRankDefaults,
  writeSubscriptionRankDefaults,
} from "../src/lib/gbuts-rank-defaults";
let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "gbuts-default-api"));
  vi.stubEnv("GBUTS_RANK_DEFAULTS_PATH", join(directory, "defaults.json"));
  vi.stubEnv("SAFE_MODE_PATH", join(directory, "safety.json"));
  vi.stubEnv("GBUTS_OTT_STORE_PATH", join(directory, "ott.json"));
  vi.stubEnv("GBUTS_YOUTUBE_RENEWALS_PATH", join(directory, "youtube.json"));
  vi.stubEnv("GBUTS_OTT_SYNC_ENABLED", "true");
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});
function fixture() {
  const app = new Hono();
  const client = {
    latestPostSeq: vi.fn(async () => 100),
    listPostsAfter: vi.fn(async () => []),
  };
  registerGbutsRankDefaultRoutes(app, () => client as never);
  return {
    app,
    client,
    post: (path: string, body: any) =>
      app.request(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
  };
}
it("activates only future posts with one persistent cutoff and reports no private pending payload", async () => {
  const f = fixture();
  expect(
    (
      await f.post("/gbuts/rank-renewals/defaults", {
        enabled: true,
        afterSeq: 90,
      })
    ).status,
  ).toBe(200);
  expect(readSubscriptionRankDefaults()).toMatchObject({
    enabled: true,
    activatedAfterSeq: 90,
    watermark: 90,
  });
  expect(
    (await f.post("/gbuts/rank-renewals/defaults", { enabled: false })).status,
  ).toBe(200);
  expect(
    (
      await f.post("/gbuts/rank-renewals/defaults", {
        enabled: true,
        afterSeq: 99,
      })
    ).status,
  ).toBe(200);
  expect(readSubscriptionRankDefaults().watermark).toBe(90);
  expect((await f.app.request("/gbuts/rank-renewals")).status).toBe(200);
});
it("refuses activation and writes in safety mode while still permitting pause", async () => {
  const f = fixture();
  writeFileSync(process.env.SAFE_MODE_PATH!, JSON.stringify({ enabled: true }));
  expect(
    (await f.post("/gbuts/rank-renewals/defaults", { enabled: true })).status,
  ).toBe(409);
  expect((await f.post("/gbuts/rank-renewals/run", {})).status).toBe(409);
  expect(f.client.listPostsAfter).not.toHaveBeenCalled();
  expect(
    (await f.post("/gbuts/rank-renewals/defaults", { enabled: false })).status,
  ).toBe(200);
});
it("rejects invalid discovery dates rather than silently leaving future posts unmonitored", async () => {
  const f = fixture();
  writeSubscriptionRankDefaults({
    version: 1,
    enabled: true,
    activatedAt: "2026-10-27T00:00:00Z",
    activatedAfterSeq: 90,
    watermark: 90,
    nextDiscoveryAt: "broken",
    policies: {},
  });
  expect((await f.app.request("/gbuts/rank-renewals")).status).toBe(503);
  expect((await f.post("/gbuts/rank-renewals/run", {})).status).toBe(503);
});
