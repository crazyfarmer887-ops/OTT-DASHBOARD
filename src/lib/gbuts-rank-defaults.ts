import { existsSync, readFileSync } from "node:fs";
import { writeJsonAtomic } from "./graytag-sales-session";
import type { YouTubeRenewal } from "../scheduler/gbuts-youtube-renewal";
export type SubscriptionRankDefaults = {
  version: 1;
  enabled: boolean;
  activatedAt?: string;
  activatedAfterSeq?: number;
  watermark?: number;
  nextDiscoveryAt?: string;
  lastDiscoveryAt?: string;
  lastError?: string;
  policies: Record<string, YouTubeRenewal>;
};
const path = () =>
  process.env.GBUTS_RANK_DEFAULTS_PATH ||
  "/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data/gbuts-rank-defaults.json";
export function readSubscriptionRankDefaults(): SubscriptionRankDefaults {
  if (!existsSync(path())) return { version: 1, enabled: false, policies: {} };
  const s = JSON.parse(
    readFileSync(path(), "utf8"),
  ) as SubscriptionRankDefaults;
  if (
    s?.version !== 1 ||
    typeof s.enabled !== "boolean" ||
    !s.policies ||
    typeof s.policies !== "object" ||
    Array.isArray(s.policies) ||
    [s.nextDiscoveryAt, s.lastDiscoveryAt].some(
      (value) => value !== undefined && !Number.isFinite(Date.parse(value)),
    ) ||
    ((s.enabled || s.activatedAfterSeq !== undefined) &&
      (!Number.isSafeInteger(s.activatedAfterSeq) ||
        s.activatedAfterSeq! < 0 ||
        !Number.isSafeInteger(s.watermark) ||
        s.watermark! < s.activatedAfterSeq! ||
        !Number.isFinite(Date.parse(s.activatedAt || ""))))
  )
    throw Error("신규 판매글 재등록 기본 설정 확인 필요");
  return s;
}
export function writeSubscriptionRankDefaults(s: SubscriptionRankDefaults) {
  writeJsonAtomic(path(), s);
}
export function futureSubscriptionRankApplies(postSeq: number): boolean {
  const s = readSubscriptionRankDefaults();
  return s.activatedAfterSeq !== undefined && postSeq > s.activatedAfterSeq;
}
export function subscriptionRankPostChain(postSeq: number): number[] {
  const s = readSubscriptionRankDefaults();
  const p = Object.values(s.policies).find((p) =>
    p.posts.some((row) => row.seq === postSeq),
  );
  return [...new Set([postSeq, ...(p?.posts.map((row) => row.seq) || [])])];
}
export function pauseSubscriptionRank(postSeq: number) {
  const s = readSubscriptionRankDefaults();
  const p = Object.values(s.policies).find((p) =>
    p.posts.some((row) => row.seq === postSeq),
  );
  if (p) {
    p.enabled = false;
    writeSubscriptionRankDefaults(s);
  }
}
