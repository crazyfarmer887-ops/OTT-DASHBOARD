import {
  readFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  renameSync,
  chmodSync,
  openSync,
  fsyncSync,
  closeSync,
} from "node:fs";
import { dirname } from "node:path";
export type Route = {
  url: string;
  key: string;
  model: string;
  paid: boolean;
  maxTokens: number;
};
export function supportRoute(env: Record<string, string | undefined>): Route {
  if ((env.GBUTS_SUPPORT_PROVIDER || "kilo") === "kilo") {
    if (env.GBUTS_SUPPORT_MODEL && env.GBUTS_SUPPORT_MODEL !== "kilo-auto/free")
      throw Error("MODEL_ROUTE_NOT_APPROVED");
    return {
      url: "https://ai-gateway.kilo.ai/api/v1/chat/completions",
      key: "anonymous",
      model: "kilo-auto/free",
      paid: false,
      maxTokens: 3000,
    };
  }
  if (
    env.GBUTS_SUPPORT_PROVIDER !== "openrouter" ||
    !env.GBUTS_SUPPORT_OPENROUTER_KEY
  )
    throw Error("MODEL_ROUTE_NOT_APPROVED");
  const model = env.GBUTS_SUPPORT_MODEL || "google/gemma-4-26b-a4b-it:free";
  if (
    ![
      "google/gemma-4-26b-a4b-it:free",
      "google/gemini-2.5-flash-lite",
    ].includes(model)
  )
    throw Error("MODEL_ROUTE_NOT_APPROVED");
  const paid = model === "google/gemini-2.5-flash-lite";
  if (paid && env.GBUTS_SUPPORT_ALLOW_PAID !== "true")
    throw Error("PAID_MODEL_NOT_AUTHORIZED");
  return {
    url: "https://openrouter.ai/api/v1/chat/completions",
    key: env.GBUTS_SUPPORT_OPENROUTER_KEY,
    model,
    paid,
    maxTokens: paid ? 512 : 2000,
  };
}
let prices: { at: number; data: any[] } | undefined;
export async function verifyRoutePrice(
  route: Route,
  fetcher: typeof fetch = fetch,
) {
  if (!route.url.startsWith("https://openrouter.ai/")) return;
  if (!prices || Date.now() - prices.at > 3600000) {
    const r = await fetcher("https://openrouter.ai/api/v1/models", {
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw Error("MODEL_PRICE_CHECK_FAILED");
    const d = (await r.json()) as any;
    if (!Array.isArray(d.data)) throw Error("MODEL_PRICE_CHECK_FAILED");
    prices = { at: Date.now(), data: d.data };
  }
  const row = prices.data.find((x) => x.id === route.model),
    p = row?.pricing;
  if (
    !p ||
    !Number.isFinite(Number(p.prompt)) ||
    !Number.isFinite(Number(p.completion))
  )
    throw Error("MODEL_PRICE_CHECK_FAILED");
  const prompt = Number(p.prompt),
    completion = Number(p.completion),
    request = Number(p.request || 0);
  if (
    request !== 0 ||
    prompt < 0 ||
    completion < 0 ||
    (!route.paid && (prompt !== 0 || completion !== 0)) ||
    (route.paid && (prompt > 0.0000001 || completion > 0.0000004))
  )
    throw Error("MODEL_PRICE_CHANGED");
}
/** Reserve a conservative upper bound before each paid request; failed requests keep the reservation. */
export function reserveSupportBudget(
  path: string,
  limit: number,
  now = new Date(),
) {
  if (!Number.isFinite(limit) || limit <= 0 || limit > 0.5)
    throw Error("SUPPORT_BUDGET_INVALID");
  const day = now.toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" }),
    prior = existsSync(path)
      ? JSON.parse(readFileSync(path, "utf8"))
      : { day, reservedUsd: 0, requests: 0 };
  if (
    typeof prior.day !== "string" ||
    !Number.isFinite(prior.reservedUsd) ||
    prior.reservedUsd < 0 ||
    !Number.isSafeInteger(prior.requests) ||
    prior.requests < 0
  )
    throw Error("SUPPORT_BUDGET_INVALID");
  const state =
    prior.day === day ? prior : { day, reservedUsd: 0, requests: 0 };
  if (state.reservedUsd + 0.001 > limit + Number.EPSILON)
    throw Error("SUPPORT_DAILY_BUDGET_EXHAUSTED");
  const next = {
    day,
    reservedUsd: Number((state.reservedUsd + 0.001).toFixed(6)),
    requests: state.requests + 1,
  };
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(next), { mode: 0o600 });
  const fd = openSync(tmp, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
  chmodSync(path, 0o600);
  return next;
}
