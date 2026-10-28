import {
  existsSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  renameSync,
  chmodSync,
} from "node:fs";
import { dirname } from "node:path";
import {
  hash,
  POLICY_VERSION,
  MODEL_INSTRUCTIONS,
  parsePlan,
  allowedPlan,
  type Features,
} from "./policy";
import type { Route } from "./provider";
type Entry = {
  plan: string;
  confidence: number;
  at: string;
  source: string;
  expiresAt: string;
};
type Cache = {
  version: 1;
  entries: Record<string, Entry>;
  hits: number;
  requests: number;
  blockedUntil?: string;
};
const path = (root: string) => root + "/inference-cache.json";
const read = (root: string): Cache => {
  const p = path(root);
  if (!existsSync(p)) return { version: 1, entries: {}, hits: 0, requests: 0 };
  const d = JSON.parse(readFileSync(p, "utf8"));
  if (
    d.version !== 1 ||
    !d.entries ||
    typeof d.entries !== "object" ||
    Array.isArray(d.entries)
  )
    throw Error("MODEL_CACHE_INVALID");
  return d;
};
const save = (root: string, value: Cache) => {
  const p = path(root);
  mkdirSync(dirname(p), { recursive: true, mode: 0o700 });
  const tmp = p + ".tmp";
  writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 });
  renameSync(tmp, p);
  chmodSync(p, 0o600);
};
export const cacheKey = (f: Features, route: Route) =>
  hash([POLICY_VERSION, MODEL_INSTRUCTIONS, route.model, route.url, f]);
export function cachedPlan(
  root: string,
  f: Features,
  route: Route,
  now = new Date(),
) {
  const c = read(root),
    e = c.entries[cacheKey(f, route)];
  if (
    !e ||
    !Number.isFinite(Date.parse(e.expiresAt)) ||
    Date.parse(e.expiresAt) < now.getTime()
  )
    return;
  const p = parsePlan({ plan: e.plan, confidence: e.confidence });
  if (p.plan !== allowedPlan(f) || p.confidence < 0.9) return;
  c.hits++;
  save(root, c);
  return p;
}
export function cachePlan(
  root: string,
  f: Features,
  route: Route,
  p: unknown,
  source = "live",
  now = new Date(),
) {
  const parsed = parsePlan(p);
  if (parsed.plan !== allowedPlan(f) || parsed.confidence < 0.9) return;
  const c = read(root);
  c.entries[cacheKey(f, route)] = {
    ...parsed,
    at: now.toISOString(),
    expiresAt: new Date(now.getTime() + 86400000).toISOString(),
    source,
  };
  save(root, c);
}
export function permitModelRequest(
  root: string,
  route: Route,
  now = new Date(),
) {
  const c = read(root);
  if (
    route.model === "kilo-auto/free" &&
    c.blockedUntil &&
    Date.parse(c.blockedUntil) > now.getTime()
  )
    throw Error("MODEL_BACKOFF");
  c.requests++;
  save(root, c);
}
export function blockModel(root: string, now = new Date()) {
  const c = read(root);
  c.blockedUntil = new Date(now.getTime() + 3600000).toISOString();
  save(root, c);
}
