import { conversationFeatures } from "./conversation";
import { diagnosticMeta } from "./diagnostics";
import type { GbutsChatMessage } from "../lib/gbuts-spotify";
import {
  approvedPlan,
  allowedPlan,
  hasDeliveryEvidence,
  fingerprint,
  hash,
  POLICY_VERSION,
  TEMPLATES,
  time,
  type Features,
  type Plan,
} from "./policy";
export type Context = {
  postSeq: number;
  memberSeq: number;
  buyerSeq: number;
  sellerSeq: number;
  roomId: string;
  service: string;
  active: boolean;
  delivered: boolean;
  messages: GbutsChatMessage[];
};
export type Receipt = {
  event: string;
  state:
    | "draft"
    | "attempted"
    | "confirmed"
    | "handoff"
    | "delegated"
    | "superseded";
  plan: Plan;
  reply?: string;
  at: string;
  notified?: boolean;
  reason?: string;
  device?: string;
};
export type RoomState = {
  rounds: number;
  paused: boolean;
  lastSentAt?: string;
  receipts: Record<string, Receipt>;
};
export type Journal = { version: 1; rooms: Record<string, RoomState> };
export type Config = {
  mode: "draft" | "auto" | "paused";
  startAt: string;
  autoSince?: string;
  policyVersion: string;
};
export type Proof = {
  policyVersion: string;
  workflowId: string;
  testedAt: string;
  fixtures: number;
  realCases: number;
  unsafeAuto: number;
  invalid: number;
  safeCorrect: number;
  safeTotal: number;
};
export function promotionAllowed(
  p: Proof,
  workflowId: string,
  now = new Date(),
): boolean {
  return (
    p.policyVersion === POLICY_VERSION &&
    p.workflowId === workflowId &&
    p.fixtures >= 24 &&
    p.realCases >= 12 &&
    p.unsafeAuto === 0 &&
    p.invalid === 0 &&
    p.safeTotal >= 3 &&
    p.safeCorrect === p.safeTotal &&
    now.getTime() - time(p.testedAt) >= 0
  );
}
export async function processInquiry(
  c: Context,
  deps: {
    config: Config;
    journal: Journal;
    save(): void;
    infer(f: Features): Promise<unknown>;
    fresh(): Promise<Context>;
    send(text: string): Promise<void>;
    alert(reason: string, plans: Plan[], incident: string): Promise<boolean>;
    allowed(): boolean;
    now?: () => Date;
  },
) {
  const now = deps.now?.() || new Date(),
    cfg = deps.config;
  if (
    cfg.mode === "paused" ||
    !deps.allowed() ||
    cfg.policyVersion !== POLICY_VERSION
  )
    return "paused";
  if (!Number.isFinite(time(cfg.startAt))) throw Error("SUPPORT_START_INVALID");
  if (
    !c.roomId ||
    c.buyerSeq === c.sellerSeq ||
    c.messages.some((m) => ![c.buyerSeq, c.sellerSeq].includes(m.senderSeq))
  )
    return "ineligible";
  const roomKey = hash([c.postSeq, c.memberSeq, c.roomId]);
  const priorRoom = deps.journal.rooms[roomKey];
  if (cfg.mode === "auto" && priorRoom?.paused) {
    for (const r of Object.values(priorRoom.receipts).filter(
      (r) => r.state === "handoff" && !r.notified,
    )) {
      r.notified = await deps.alert(
        r.reason || "operator_review_retry",
        Object.values(priorRoom.receipts).map((r) => r.plan),
        r.event,
      );
      deps.save();
    }
  }
  const ordered = [...c.messages].sort(
    (a, b) => time(a.createdAt) - time(b.createdAt),
  );
  const latest = ordered.at(-1);
  if (
    !latest ||
    latest.senderSeq !== c.buyerSeq ||
    ordered.some(
      (m) =>
        m.senderSeq === c.sellerSeq &&
        time(m.createdAt) === time(latest.createdAt),
    ) ||
    !Number.isFinite(time(latest.createdAt)) ||
    time(latest.createdAt) < time(cfg.startAt) ||
    time(latest.createdAt) > now.getTime() ||
    now.getTime() - time(latest.createdAt) < 60000
  )
    return "quiet";
  const key = hash([c.postSeq, c.memberSeq, c.roomId]),
    room = (deps.journal.rooms[key] ??= {
      rounds: 0,
      paused: false,
      receipts: {},
    });
  const event = fingerprint(c.roomId, latest),
    old = room.receipts[event];
  const handoff = async (reason: string) => {
    room.paused = true;
    room.receipts[event] ??= {
      event,
      state: "handoff",
      plan: "handoff",
      at: now.toISOString(),
    };
    const r = room.receipts[event];
    r.state = "handoff";
    r.plan = "handoff";
    r.reason = reason;
    deps.save();
    if (!r.notified) {
      r.notified = await deps.alert(
        reason,
        Object.values(room.receipts).map((x) => x.plan),
        event,
      );
      deps.save();
    }
    return "handoff";
  };
  if (!c.active) {
    if (cfg.mode === "auto") return handoff("purchase_review");
    return "ineligible";
  }
  if (old?.state === "handoff") return handoff(old.reason || "operator_review");
  if (room.paused) return "human_owned";
  if (old?.state === "attempted") {
    if (
      old.reply &&
      c.messages.some(
        (m) =>
          m.senderSeq === c.sellerSeq &&
          m.messageType === "TEXT" &&
          m.message === old.reply &&
          time(m.createdAt) >= Math.floor(time(old.at) / 1000) * 1000,
      )
    ) {
      old.state = "confirmed";
      room.rounds++;
      room.lastSentAt = old.at;
      deps.save();
      if (diagnosticMeta(old.plan)?.review)
        return handoff("account_restriction");
      return "reconciled";
    }
    return handoff("delivery_uncertain");
  }
  if (Object.values(room.receipts).some((r) => r.state === "attempted"))
    return handoff("previous_delivery_uncertain");
  if (
    old?.state === "delegated" &&
    cfg.mode === "auto" &&
    now.getTime() - time(old.at) >= 15 * 60000
  )
    return handoff("specialized_delivery_unresolved");
  if (old) return old.state;
  if (
    cfg.mode === "auto" &&
    (!cfg.autoSince ||
      !Number.isFinite(time(cfg.autoSince)) ||
      time(latest.createdAt) < time(cfg.autoSince))
  )
    return "historical";
  if (latest.messageType !== "TEXT") {
    if (cfg.mode === "draft") {
      room.receipts[event] = {
        event,
        state: "draft",
        plan: "handoff",
        at: now.toISOString(),
        reason: "attachment_review",
      };
      deps.save();
      return "draft";
    }
    return handoff("attachment_review");
  }
  // A later human seller response takes ownership; routine workers get a full minute first.
  if (
    room.lastSentAt &&
    ordered.some(
      (m) =>
        m.senderSeq === c.sellerSeq &&
        time(m.createdAt) > time(room.lastSentAt!) &&
        !hasDeliveryEvidence([m], c.sellerSeq) &&
        !Object.values(room.receipts).some(
          (r) => r.reply === m.message && r.state === "confirmed",
        ),
    )
  ) {
    room.paused = true;
    deps.save();
    return "human_owned";
  }
  const f = conversationFeatures(
    latest.message,
    c.service,
    c.delivered,
    room.rounds,
    Object.values(room.receipts),
    latest.createdAt,
  );
  let plan: Plan;
  try {
    const deterministic = allowedPlan(f);
    plan =
      deterministic === "handoff" || deterministic === "delegate"
        ? deterministic
        : approvedPlan(f, await deps.infer(f));
  } catch {
    if (cfg.mode === "draft") {
      room.receipts[event] = {
        event,
        state: "draft",
        plan: "handoff",
        at: now.toISOString(),
      };
      deps.save();
      return "draft";
    }
    return handoff("inference_unavailable");
  }
  const rec: Receipt = {
    event,
    state: "draft",
    plan,
    device: f.device,
    at: now.toISOString(),
    ...(plan in TEMPLATES
      ? { reply: TEMPLATES[plan as keyof typeof TEMPLATES] }
      : {}),
  };
  room.receipts[event] = rec;
  deps.save();
  if (cfg.mode === "draft") return "draft";
  if (plan === "handoff")
    return handoff(
      allowedPlan(f) === "handoff"
        ? f.intents.includes("refund")
          ? "refund_requested"
          : f.intents.includes("replace")
            ? "replacement_requested"
            : f.intents.includes("dispute")
              ? "dispute"
              : f.intents.includes("failed")
                ? "guidance_failed"
                : f.intents.includes("diagnostic_exhausted")
                  ? "guidance_failed"
                  : "operator_decision"
        : "draft_not_approved",
    );
  if (plan === "delegate") {
    if (
      cfg.mode === "auto" &&
      Object.values(room.receipts).some(
        (r) =>
          r.state === "delegated" && now.getTime() - time(r.at) >= 15 * 60000,
      )
    )
      return handoff("specialized_delivery_unresolved");
    rec.state = "delegated";
    deps.save();
    return "delegated";
  }
  if (room.lastSentAt && now.getTime() - time(room.lastSentAt) < 120000) {
    delete room.receipts[event];
    deps.save();
    return "cooldown";
  }
  const fresh = await deps.fresh();
  const fm = [...fresh.messages]
    .sort((a, b) => time(a.createdAt) - time(b.createdAt))
    .at(-1);
  if (
    !deps.allowed() ||
    !fresh.active ||
    fresh.roomId !== c.roomId ||
    fresh.postSeq !== c.postSeq ||
    fresh.memberSeq !== c.memberSeq ||
    fresh.buyerSeq !== c.buyerSeq ||
    fresh.sellerSeq !== c.sellerSeq ||
    fresh.service !== c.service ||
    fresh.delivered !== c.delivered ||
    fresh.messages.some(
      (m) => ![c.buyerSeq, c.sellerSeq].includes(m.senderSeq),
    ) ||
    !fm ||
    fingerprint(c.roomId, fm) !== event
  ) {
    rec.state = "superseded";
    deps.save();
    return "superseded";
  }
  rec.state = "attempted";
  rec.at = now.toISOString();
  deps.save();
  try {
    await deps.send(rec.reply!);
  } catch {
    /* A thrown SEND may still have been saved: query only. */
  }
  let after: Context;
  try {
    after = await deps.fresh();
  } catch {
    return "uncertain";
  }
  if (
    after.messages.some(
      (m) =>
        m.senderSeq === c.sellerSeq &&
        m.messageType === "TEXT" &&
        m.message === rec.reply &&
        time(m.createdAt) >= Math.floor(time(rec.at) / 1000) * 1000,
    )
  ) {
    rec.state = "confirmed";
    room.rounds++;
    room.lastSentAt = rec.at;
    deps.save();
    if (diagnosticMeta(plan)?.review) return handoff("account_restriction");
    return "sent";
  }
  return "uncertain";
}
