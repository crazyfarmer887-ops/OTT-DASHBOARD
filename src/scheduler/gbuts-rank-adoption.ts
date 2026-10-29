import { readSubscriptionRankDefaults } from "../lib/gbuts-rank-defaults";
import { disneyEveryviewAccountKey, disneyEveryviewInventory, requireDisneyEveryviewAvailable } from "../lib/gbuts-disney-everyview";
import { createHash } from "node:crypto";
import { readGbutsOttStore, writeGbutsOttStore } from "../lib/gbuts-ott-store";
import {
  readSpotifyListings,
  writeSpotifyListings,
  spotifyText,
} from "../lib/gbuts-spotify-listings";
import {
  GBUTS_OTT_CATEGORIES,
  sharedOttAccounts,
  ottDate,
  koreaToday,
  type GbutsOttStore,
  type GbutsOttListing,
} from "../lib/gbuts-ott";
import type { GbutsOttPost } from "../lib/gbuts-ott-client";
import { subscriptionExternalOccupancy, youtubeOccupied, type YouTubeRenewal } from "./gbuts-youtube-renewal";
const fingerprint = (text: string) =>
  createHash("sha256").update(text).digest("hex");
const idFor = (p: YouTubeRenewal, seq = p.pending?.sourcePostSeq) =>
  `rank-auto-${p.seedPostSeq}-from-${seq}`;
/** Reserve uncertain replacements in the SAME inventory that publication already uses. */
export function reserveSubscriptionRankPlaces(
  policies: Record<string, YouTubeRenewal>,
  now = new Date(),
): void {
  const store = readGbutsOttStore();
  let changed = false;
  for (const p of Object.values(policies)) {
    const source = Object.values(store.listings).find(
      (l) => l.postSeq === p.currentPostSeq,
    );
    if (!source) continue;
    if (
      GBUTS_OTT_CATEGORIES[source.serviceType] !== p.categorySeq ||
      p.subscriptionType !== "SHARE" ||
      source.endDate !== p.endDate ||
      source.capacity !==
        p.posts.find((row) => row.seq === p.currentPostSeq)?.capacity
    )
      throw Error("공동 재고의 서비스·기간·정원 연결 확인 필요");
    // Import final-roster buyers before releasing the old recruiting reservation.
    // Older rank snapshots must never overwrite a newer ordinary order verification.
    for (const member of Object.values(p.members)) {
      const listing = Object.values(store.listings).find(
        (l) => l.postSeq === member.postSeq,
      );
      if (!listing) continue;
      const key = `${member.postSeq}:${member.seq}`,
        previous = store.orders[key];
      if (
        previous &&
        (previous.userSeq !== member.userSeq ||
          previous.listingId !== listing.id)
      )
        throw Error("재등록 구매자 연결 확인 필요");
      if (!member.observedAt) {
        if (previous) continue;
        throw Error("구매자 확인 시각 확인 필요");
      }
      if (
        previous &&
        Date.parse(previous.verifiedAt) > Date.parse(member.observedAt)
      )
        continue;
      if (!member.createdAt || !ottDate(member.createdAt))
        throw Error("구매 시각 확인 필요");
      const delivery =
        member.status === "MISSING" &&
        (!previous || previous.delivery === "ready")
          ? "blocked"
          : previous?.delivery === "blocked" &&
              previous.status === "MISSING" &&
              member.status !== "MISSING" &&
              !previous.attemptedAt
            ? "ready"
            : previous?.delivery || "ready";
      store.orders[key] = {
        ...previous,
        key,
        listingId: listing.id,
        postSeq: member.postSeq,
        memberSeq: member.seq,
        userSeq: member.userSeq,
        name: member.nickname || previous?.name || "(구매자)",
        status: member.status,
        cancelStatus: member.cancelStatus,
        startDate: ottDate(member.createdAt),
        endDate: member.endDate,
        purchasedAt: previous?.purchasedAt || member.createdAt,
        delivery,
        verifiedAt: member.observedAt,
      };
      changed = true;
    }
    const pending = p.pending;
    if (!pending) {
      for (const row of Object.values(store.listings).filter(
        (l) =>
          l.rankSeedPostSeq === p.seedPostSeq &&
          !l.postSeq &&
          l.repostPhase === "closing" &&
          l.state === "submitting",
      )) {
        row.state = "failed";
        row.error = "새 글 생성 전 자동 재등록 중단";
        changed = true;
      }
      continue;
    }
    if (pending.phase === "publishing") {
      source.state = "closed";
      changed = true;
    }
    const id = idFor(p);
    const existing = store.listings[id];
    if (
      existing &&
      (existing.repostFrom !== source.id ||
        existing.accountEmail !== source.accountEmail)
    )
      throw Error("자동 재등록 재고 연결 확인 필요");
    if (existing?.state === "registered" || existing?.state === "closed")
      continue;
    const capacity =
      pending.payload?.memberLimit ??
      Math.max(1, p.capacity - youtubeOccupied(p, now));
    const next: GbutsOttListing = {
      ...source,
      ...existing,
      id,
      requestHash: fingerprint(id),
      rankSeedPostSeq: p.seedPostSeq,
      createdAt: existing?.createdAt || now.toISOString(),
      state: pending.phase === "publishing" ? "uncertain" : "submitting",
      capacity,
      postSeq: pending.postSeq,
      repostFrom: source.id,
      repostPhase: pending.phase,
      beforePostSeqs: undefined,
      replacedBy: undefined,
      error: undefined,
      verifiedAt: undefined,
    };
    store.listings[id] = next;
    changed = true;
  }
  if (changed) writeGbutsOttStore(store);
}
export async function adoptSubscriptionRankPost(
  p: YouTubeRenewal,
  post: GbutsOttPost,
): Promise<void> {
  if (!p.pending) throw Error("재등록 제출 기록 확인 필요");
  const store = readGbutsOttStore();
  const source = Object.values(store.listings).find(
    (l) => l.postSeq === p.pending!.sourcePostSeq,
  );
  if (source) {
    const id = idFor(p);
    const reserved = store.listings[id];
    if (
      !reserved ||
      reserved.repostFrom !== source.id ||
      (source.replacedBy && source.replacedBy !== id)
    )
      throw Error("재등록 자리 예약 확인 필요");
    const conflict = Object.values(store.listings).find(
      (l) => l.postSeq === post.seq && l.id !== id,
    );
    if (conflict) throw Error("재등록 판매글 중복 연결 확인 필요");
    if (reserved.postSeq && reserved.postSeq !== post.seq)
      throw Error("재등록 결과 식별자 확인 필요");
    const prefix = `[${source.serviceType}]`;
    const title = spotifyText(post.title);
    store.listings[id] = {
      ...reserved,
      postSeq: post.seq,
      state: post.status === "ON_SALE" ? "registered" : "closed",
      capacity: post.memberLimit,
      title: title.startsWith(prefix)
        ? title.slice(prefix.length).trim()
        : title,
      description: spotifyText(post.description),
      noticeBeforeOrder: spotifyText(post.noticeBeforeOrder),
      noticeAfterOrder: spotifyText(post.noticeAfterOrder),
      dailyPrice: Number(post.price),
      verifiedAt: new Date().toISOString(),
    };
    source.state = "closed";
    source.replacedBy = id;
    writeGbutsOttStore(store);
  }
  const spotify = readSpotifyListings();
  const original = Object.values(spotify.listings).find(
    (l) => l.postSeq === p.pending!.sourcePostSeq,
  );
  if (original) {
    if (original.deletedAt)
      throw Error("모집 중단한 스포티파이 판매글 확인 필요");
    const id = idFor(p);
    const existing = spotify.listings[id];
    if (existing && existing.postSeq !== post.seq)
      throw Error("스포티파이 재등록 결과 확인 필요");
    spotify.listings[id] = {
      ...original,
      id,
      requestHash: fingerprint(id),
      postSeq: post.seq,
      state: "registered",
      beforePostSeqs: [],
      createdAt: existing?.createdAt || new Date().toISOString(),
      title: spotifyText(post.title),
      description: spotifyText(post.description),
      noticeBeforeOrder: post.noticeBeforeOrder ?? null,
      noticeAfterOrder: post.noticeAfterOrder ?? null,
      startDate: String(post.subscriptionStartsAt).slice(0, 10),
      endDate: p.endDate,
      dailyPrice: Number(post.price),
      capacity: post.memberLimit,
      countries: [...post.countries],
      deletedAt: undefined,
      error: undefined,
    };
    writeSpotifyListings(spotify);
  }
}
/** Only the actual existing policy's chain is excluded, never every post on an account. */
export function existingOttRankPostSeqs(store: GbutsOttStore): Set<number> {
  const result = new Set<number>();
  for (const p of Object.values(store.renewals || {})) {
    const queue = [p.listingId, ...(p.pendingId ? [p.pendingId] : [])];
    const seen = new Set<string>();
    while (queue.length) {
      const id = queue.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const l = store.listings[id];
      if (!l) continue;
      if (l.postSeq) result.add(l.postSeq);
      if (l.repostFrom) queue.push(l.repostFrom);
      if (l.replacedBy) queue.push(l.replacedBy);
    }
  }
  return result;
}

/** Keep the original marketplace quota inside the SAME verified cross-market inventory. */
function assertUnboundDisneyRankSafe(p:YouTubeRenewal,store:GbutsOttStore):void {
  if(p.categorySeq===6 && p.subscriptionType==='SHARE' && Object.keys(store.disneyEveryview||{}).length>0)
    throw Error("디즈니 판매글의 공동 계정 연결 확인 필요");
}
export function assertSubscriptionRankInventory(
  p: YouTubeRenewal,
  management: import("../lib/gbuts-ott").GbutsOttManagement,
  manual: any[],
  now = new Date(),
) {
  const store = readGbutsOttStore();
  const source = Object.values(store.listings).find(
    (l) => l.postSeq === p.currentPostSeq,
  );
  if (!source) {assertUnboundDisneyRankSafe(p,store);return;}
  let everyviewReserved = 0;
  const key = disneyEveryviewAccountKey(source.accountEmail);
  const mapped = source.serviceType === "디즈니플러스" && store.disneyEveryview
    && Object.prototype.hasOwnProperty.call(store.disneyEveryview, key);
  if (mapped) {
    const mapping = store.disneyEveryview![key];
    // Only the explicitly segregated setup is safe for this generic publisher.
    // Stale, uncertain or partial evidence never permits closing the old post.
    if (source.deliveryMode !== "disney-numbered-password" || mapping?.accountCapacity !== 6
      || p.capacity > 5 || p.capacity < 1 || !Array.isArray(mapping.partyIds) || mapping.partyIds.length !== 1)
      throw Error("에브리뷰 전용 6번과 벗츠 정원 확인 필요");
    const snapshot = mapping.snapshots?.[String(mapping.partyIds[0])];
    const held = snapshot?.claims?.filter(c => c.state !== "released") || [];
    if (held.length !== 1 || held[0].profileNumber !== 6
      || !((held[0].kind === "buyer" && held[0].state === "active" && /^[a-f0-9]{64}$/.test(held[0].buyerIdentity || "") && snapshot?.advertisedVacancies === 0)
        || (held[0].kind === "advertised" && held[0].state === "pending" && snapshot?.advertisedVacancies === 1)
        || (held[0].kind === "reserved" && held[0].state === "pending" && snapshot?.advertisedVacancies === 0)))
      throw Error("에브리뷰 6번 자리 상태 확인 필요");
    const shared = disneyEveryviewInventory(store, source, now);
    requireDisneyEveryviewAvailable(shared);
    if (!shared || shared.capacity !== 6) throw Error("공동 계정 정원 확인 필요");
    for (const member of Object.values(p.members)) {
      if (!(["APPLY", "MISSING"].includes(member.status) && member.cancelStatus !== "REFUNDED" && member.endDate >= koreaToday(now))) continue;
      const order = store.orders[`${member.postSeq}:${member.seq}`];
      if (!order || order.userSeq !== member.userSeq || order.status !== member.status
        || order.cancelStatus !== member.cancelStatus || order.endDate !== member.endDate)
        throw Error("벗츠 구매자 공동 재고 확인 필요");
    }
    everyviewReserved = 1;
  }
  const view = structuredClone(store),
    chain = new Set(p.posts.map((row) => row.seq));
  const ids = new Set(
    Object.values(view.listings)
      .filter(
        (l) =>
          (l.postSeq && chain.has(l.postSeq)) ||
          l.rankSeedPostSeq === p.seedPostSeq,
      )
      .map((l) => l.id),
  );
  for (const id of ids) view.listings[id].state = "failed";
  for (const [key, order] of Object.entries(view.orders))
    if (ids.has(order.listingId)) delete view.orders[key];
  const account = sharedOttAccounts(management, manual, view).find(
    (a) =>
      a.serviceType === source.serviceType &&
      a.accountEmail.toLowerCase() === source.accountEmail.toLowerCase(),
  );
  if (
    !account ||
    account.overbooked ||
    !account.eligible ||
    account.available < p.capacity - subscriptionExternalOccupancy(p) ||
    (everyviewReserved > 0 && account.total < 6) ||
    account.endDate < p.endDate
  )
    throw Error("다른 판매처의 자리 또는 계정 기간 확인 필요");
}
export async function verifyManagedSubscriptionRank(
  p: YouTubeRenewal,
  deps: import("./gbuts-ott-sync").GbutsOttRuntimeDependencies,
) {
  const store=readGbutsOttStore();
  const source = Object.values(store.listings).find(
    (l) => l.postSeq === p.currentPostSeq,
  );
  if (!source) {assertUnboundDisneyRankSafe(p,store);return;}
  const management = await (deps.renewalManagement
    ? deps.renewalManagement(source.serviceType)
    : deps.management());
  assertSubscriptionRankInventory(p, management, deps.manualMembers());
}

export function subscriptionManagedRenewalViews(store: GbutsOttStore) {
  const defaults = readSubscriptionRankDefaults();
  return Object.values(defaults.policies).flatMap((p) => {
    const listing = Object.values(store.listings).find(
      (l) => l.postSeq === p.currentPostSeq,
    );
    if (!listing) return [];
    return [
      {
        policySource: "subscription-default",
        serviceType: listing.serviceType,
        accountEmail: listing.accountEmail,
        listingId: listing.id,
        capacity: p.capacity,
        enabled: defaults.enabled && p.enabled,
        trigger: p.trigger,
        rankThreshold: p.rankThreshold,
        nextAt: p.nextAt,
        rankCheckedAt: p.rankCheckedAt,
        lastRank: p.lastRank,
        lastRepostedAt: p.lastRepostedAt,
        lastSuccess: p.lastSuccess,
        lastError: p.lastError,
        pendingId: p.pending ? idFor(p) : undefined,
      },
    ];
  });
}
