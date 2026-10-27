import {
  readSubscriptionRankDefaults,
  writeSubscriptionRankDefaults,
  type SubscriptionRankDefaults,
} from "../lib/gbuts-rank-defaults";
import { readGbutsOttStore } from "../lib/gbuts-ott-store";
import { koreaToday, ottDate } from "../lib/gbuts-ott";
import {
  readYouTubeRenewals,
  validateYouTubeRenewals,
  bindSubscriptionRenewal,
  renewSubscriptionRankings,
  type InviteClient,
  type YouTubeRenewal,
} from "./gbuts-youtube-renewal";
import {
  adoptSubscriptionRankPost,
  existingOttRankPostSeqs,
  reserveSubscriptionRankPlaces,
} from "./gbuts-rank-adoption";
export type FutureRankDependencies = {
  read?: typeof readSubscriptionRankDefaults;
  write?: typeof writeSubscriptionRankDefaults;
  existingPosts?: () => { covered: Set<number>; pending: boolean };
  reserve?: typeof reserveSubscriptionRankPlaces;
  adopt?: typeof adoptSubscriptionRankPost;
  allowed?: () => boolean;
  verify?: (policy: YouTubeRenewal) => Promise<void>;
  now?: Date;
};
function existingPosts() {
  const ott = readGbutsOttStore(),
    yt = readYouTubeRenewals();
  return {
    covered: new Set([
      ...existingOttRankPostSeqs(ott),
      ...Object.values(yt.policies).flatMap((p) => [
        ...p.posts.map((row) => row.seq),
        ...(p.pending?.postSeq ? [p.pending.postSeq] : []),
      ]),
    ]),
    pending:
      Object.values(ott.renewals || {}).some((p) => p.pendingId) ||
      Object.values(yt.policies).some((p) => p.pending),
  };
}
/** One default/discovery seam for both dashboard and directly published seller posts. Caller holds shared inventory serialization. */
export async function syncFutureSubscriptionRank(
  client: InviteClient,
  deps: FutureRankDependencies = {},
) {
  const read = deps.read || readSubscriptionRankDefaults,
    write = deps.write || writeSubscriptionRankDefaults;
  const s = read(),
    now = deps.now || new Date(),
    result = { discovered: 0, renewed: 0, errors: 0 };
  if (
    !s.enabled ||
    !s.activatedAt ||
    s.watermark === undefined ||
    (deps.allowed && !deps.allowed())
  )
    return result;
  validateYouTubeRenewals({ version: 1, policies: s.policies });
  const existing = (deps.existingPosts || existingPosts)();
  const save = () => {
    (deps.reserve || reserveSubscriptionRankPlaces)(s.policies, now);
    validateYouTubeRenewals({ version: 1, policies: s.policies });
    write(s);
  };
  // A submitted but unknown old-engine replacement must not be mistaken for a new seed.
  if (existing.pending) {
    s.lastError = "기존 재등록 결과 조회 복구 후 신규 글 감시를 계속합니다.";
    write(s);
    return result;
  }
  if (
    !Object.values(s.policies).some((p) => p.pending) &&
    (!s.nextDiscoveryAt || Date.parse(s.nextDiscoveryAt) <= now.getTime())
  ) {
    try {
      const posts = (await client.listPostsAfter(s.watermark)).sort(
        (a, b) => a.seq - b.seq,
      );
      const covered = new Set([
        ...existing.covered,
        ...Object.values(s.policies).flatMap((p) =>
          p.posts.map((row) => row.seq),
        ),
      ]);
      for (const listed of posts) {
        if (listed.seq <= s.watermark) continue;
        if (!covered.has(listed.seq)) {
          const post = await client.getPost(listed.seq);
          if (
            post.status === "ON_SALE" &&
            ottDate(post.subscriptionEndsAt) > koreaToday(now)
          ) {
            bindSubscriptionRenewal(s, post, true, now);
            result.discovered++;
          }
        }
        s.watermark = listed.seq;
        save();
      }
      s.lastDiscoveryAt = now.toISOString();
      delete s.lastError;
    } catch {
      s.lastError = "신규 구독공유 판매글 또는 재등록 연결 확인 필요";
      result.errors++;
    }
    s.nextDiscoveryAt = new Date(now.getTime() + 60_000).toISOString();
    save();
  }
  const renewed = await renewSubscriptionRankings(client, {
    read: () => ({ version: 1, policies: s.policies }),
    write: (v) => {
      s.policies = v.policies;
      save();
    },
    now,
    clock: () => deps.now || new Date(),
    allowed: deps.allowed,
    adopt: deps.adopt || adoptSubscriptionRankPost,
    verify:
      deps.verify ||
      (async (p) => {
        if (
          Object.values(readGbutsOttStore().listings).some(
            (l) => l.postSeq === p.currentPostSeq,
          )
        )
          throw Error("공동 재고 검증 연결 확인 필요");
      }),
  });
  return {
    ...result,
    renewed: renewed.renewed,
    errors: result.errors + renewed.errors,
  };
}
export function activateFutureRankDefaults(
  s: SubscriptionRankDefaults,
  enabled: boolean,
  baseline: number,
  now = new Date(),
) {
  if (!Number.isSafeInteger(baseline) || baseline < 0)
    throw Error("신규 글 감시 시작 기준 확인 필요");
  if (s.activatedAfterSeq === undefined) {
    s.activatedAfterSeq = baseline;
    s.watermark = baseline;
    s.activatedAt = now.toISOString();
  }
  s.enabled = enabled;
  s.nextDiscoveryAt = now.toISOString();
  return s;
}
