import type { Hono } from "hono";
import { loadSafeModeConfig } from "./safe-mode";
import { withGbutsOttInventory } from "../lib/gbuts-ott-store";
import {
  readSubscriptionRankDefaults,
  writeSubscriptionRankDefaults,
} from "../lib/gbuts-rank-defaults";
import {
  validateYouTubeRenewals,
  youtubeOccupied,
  type InviteClient,
  type YouTubeRenewal,
} from "../scheduler/gbuts-youtube-renewal";
import {
  activateFutureRankDefaults,
  syncFutureSubscriptionRank,
} from "../scheduler/gbuts-future-rank";
export function registerGbutsRankDefaultRoutes(
  app: Hono,
  client: () => InviteClient,
  verify?: (policy: YouTubeRenewal) => Promise<void>,
) {
  const active = () =>
    process.env.GBUTS_OTT_SYNC_ENABLED === "true" &&
    !loadSafeModeConfig().enabled;
  app.get("/gbuts/rank-renewals", (c) => {
    try {
      const s = readSubscriptionRankDefaults();
      validateYouTubeRenewals({ version: 1, policies: s.policies });
      return c.json({
        ok: true,
        enabled: s.enabled,
        workerEnabled: process.env.GBUTS_OTT_SYNC_ENABLED === "true",
        safeMode: loadSafeModeConfig().enabled,
        activatedAt: s.activatedAt,
        activatedAfterSeq: s.activatedAfterSeq,
        watermark: s.watermark,
        nextDiscoveryAt: s.nextDiscoveryAt,
        lastDiscoveryAt: s.lastDiscoveryAt,
        lastError: s.lastError,
        renewals: Object.values(s.policies).map((p) => ({
          seedPostSeq: p.seedPostSeq,
          currentPostSeq: p.currentPostSeq,
          categorySeq: p.categorySeq,
          subscriptionType: p.subscriptionType,
          enabled: p.enabled,
          trigger: p.trigger,
          rankThreshold: p.rankThreshold,
          nextAt: p.nextAt,
          rankCheckedAt: p.rankCheckedAt,
          lastRank: p.lastRank,
          lastSuccess: p.lastSuccess,
          lastError: p.lastError,
          pendingId: p.pending
            ? `subscription:${p.seedPostSeq}:${p.pending.sourcePostSeq}`
            : null,
          capacity: p.capacity,
          occupied: youtubeOccupied(p),
        })),
      });
    } catch {
      return c.json(
        { ok: false, error: "구독공유 재등록 기본 설정 확인 필요" },
        503,
      );
    }
  });
  app.post("/gbuts/rank-renewals/defaults", (c) =>
    withGbutsOttInventory(async () => {
      try {
        const body = await c.req.json();
        if (typeof body.enabled !== "boolean" || (body.enabled && !active()))
          throw Error("자동 재등록 실행 상태 확인 필요");
        const s = readSubscriptionRankDefaults();
        const baseline =
          body.afterSeq ??
          s.activatedAfterSeq ??
          (await client().latestPostSeq());
        if (
          body.afterSeq !== undefined &&
          (!Number.isSafeInteger(body.afterSeq) ||
            body.afterSeq < 0 ||
            body.afterSeq > (await client().latestPostSeq()))
        )
          throw Error("판매글 감시 시작 번호 확인 필요");
        activateFutureRankDefaults(s, body.enabled, baseline);
        writeSubscriptionRankDefaults(s);
        return c.json({
          ok: true,
          enabled: s.enabled,
          activatedAt: s.activatedAt,
          activatedAfterSeq: s.activatedAfterSeq,
        });
      } catch {
        return c.json(
          { ok: false, error: "신규 판매글 자동 재등록 설정 확인 필요" },
          409,
        );
      }
    }),
  );
  app.post("/gbuts/rank-renewals/:seed/enabled", (c) =>
    withGbutsOttInventory(async () => {
      try {
        const s = readSubscriptionRankDefaults(),
          p = s.policies[c.req.param("seed")],
          body = await c.req.json();
        if (
          !p ||
          typeof body.enabled !== "boolean" ||
          (body.enabled && !active())
        )
          throw Error();
        p.enabled = body.enabled;
        writeSubscriptionRankDefaults(s);
        return c.json({ ok: true, enabled: p.enabled });
      } catch {
        return c.json(
          { ok: false, error: "대상 판매글과 자동 재등록 상태 확인 필요" },
          409,
        );
      }
    }),
  );
  app.post("/gbuts/rank-renewals/run", (c) =>
    withGbutsOttInventory(async () => {
      if (!active())
        return c.json(
          { ok: false, error: "판매 자동화가 일시정지 상태입니다." },
          409,
        );
      try {
        const r = await syncFutureSubscriptionRank(client(), {
          allowed: active,
          verify,
        });
        return c.json({ ok: r.errors === 0, ...r });
      } catch {
        return c.json({ ok: false, error: "구독공유 재등록 확인 필요" }, 503);
      }
    }),
  );
}
