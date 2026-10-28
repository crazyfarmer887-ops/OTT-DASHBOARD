import { DIAGNOSTIC_LABELS, diagnosticMeta } from "./diagnostics";
import { cachedPlan, cachePlan, permitModelRequest, blockModel } from "./cache";
import {
  supportRoute,
  verifyRoutePrice,
  reserveSupportBudget,
} from "./provider";
import {
  allowedPlan,
  parsePlan,
  MODEL_INSTRUCTIONS,
  type Features,
} from "./policy";
export async function difyPlan(
  f: Features,
  env = process.env,
  fetcher: typeof fetch = fetch,
) {
  const base = env.GBUTS_SUPPORT_DIFY_URL || "http://127.0.0.1:18081";
  const url = new URL(base);
  if (
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.protocol !== "http:" ||
    !env.GBUTS_SUPPORT_DIFY_KEY
  )
    throw Error("DIFY_CONFIG_INVALID");
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetcher(base + "/v1/workflows/run", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.GBUTS_SUPPORT_DIFY_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inputs: { context: JSON.stringify(f) },
          response_mode: "blocking",
          user: "gbuts-support",
        }),
        signal: AbortSignal.timeout(45000),
      });
      if (!response.ok) throw Error("DIFY_UNAVAILABLE");
      const d = (await response.json()) as any;
      if (
        d.data?.status !== "succeeded" ||
        typeof d.data.outputs?.plan !== "string"
      )
        throw Error("DIFY_WORKFLOW_FAILED");
      try {
        const result = JSON.parse(d.data.outputs.plan);
        if (result?.error && /^(MODEL_|SUPPORT_|PAID_)/.test(result.error))
          throw Error(result.error);
        return parsePlan(result);
      } catch (error) {
        if (
          error instanceof Error &&
          /^(MODEL_|SUPPORT_|PAID_)/.test(error.message)
        )
          throw error;
        throw Error("DIFY_OUTPUT_INVALID");
      }
    } catch (error) {
      if (
        attempt === 1 ||
        (error instanceof Error &&
          /^(MODEL_RATE_LIMIT|MODEL_BACKOFF|MODEL_CREDIT_REQUIRED|SUPPORT_DAILY_BUDGET_EXHAUSTED)$/.test(
            error.message,
          ))
      )
        throw error;
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
  }
  throw Error("DIFY_UNAVAILABLE");
}
export function validateFeatures(input: unknown): Features {
  if (!input || typeof input !== "object") throw Error("FEATURES_INVALID");
  const f = input as Features;
  const labels = [
    "refund",
    "replace",
    "dispute",
    "failed",
    "account",
    "location",
    "login",
    "thanks",
    "code",
    "injection",
    ...DIAGNOSTIC_LABELS,
  ];
  if (
    Object.keys(f).sort().join(",") !==
      "delivered,device,intents,rounds,service" ||
    ![
      "넷플릭스",
      "디즈니플러스",
      "유튜브",
      "스포티파이",
      "MSOffice",
      "iQiyi",
      "WeTV",
      "기타",
    ].includes(f.service) ||
    !Array.isArray(f.intents) ||
    f.intents.length > labels.length ||
    f.intents.some((x) => !labels.includes(x)) ||
    !["tv", "mobile", "pc", "unknown"].includes(f.device) ||
    typeof f.delivered !== "boolean" ||
    !Number.isSafeInteger(f.rounds) ||
    f.rounds < 0 ||
    f.rounds > 20
  )
    throw Error("FEATURES_INVALID");
  return f;
}
/** Free model sees only bounded allowlisted labels; no chat, buyer/order IDs or secret data. */
export async function modelPlan(
  input: unknown,
  env = process.env,
  fetcher: typeof fetch = fetch,
) {
  const f = validateFeatures(input);
  const route = supportRoute(env);
  const expected = allowedPlan(f);
  // Exact reviewed error guides and clarification use the Dify tool's knowledge rules.
  // No model can invent instructions, recovery promises or account-changing actions.
  if (
    diagnosticMeta(expected) ||
    expected === "troubleshoot_clarify" ||
    (f.rounds >= 2 && ["thanks", "where_account"].includes(expected))
  )
    return { plan: expected, confidence: 1 };
  const root = env.GBUTS_SUPPORT_ROOT || "/home/ubuntu/.config/gbuts/support";
  const cached = cachedPlan(root, f, route);
  if (cached) return cached;
  permitModelRequest(root, route);
  await verifyRoutePrice(route, fetcher);
  if (route.paid)
    reserveSupportBudget(
      (env.GBUTS_SUPPORT_ROOT || "/home/ubuntu/.config/gbuts/support") +
        "/budget.json",
      Number(env.GBUTS_SUPPORT_DAILY_USD || "0.25"),
    );
  const r = await fetcher(route.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${route.key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: route.model,
      messages: [
        {
          role: "system",
          content: MODEL_INSTRUCTIONS,
        },
        { role: "user", content: JSON.stringify(f) },
      ],
      temperature: 0,
      max_tokens: route.maxTokens,
    }),
    signal: AbortSignal.timeout(25000),
  });
  if (!r.ok) {
    if (r.status === 429) {
      blockModel(root);
      throw Error("MODEL_RATE_LIMIT");
    }
    throw Error(
      r.status === 402 ? "MODEL_CREDIT_REQUIRED" : "MODEL_UNAVAILABLE",
    );
  }
  const d = (await r.json()) as any;
  const text = d.choices?.[0]?.message?.content || "";
  let parsed;
  try {
    parsed = parsePlan(
      JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "")),
    );
  } catch {
    throw Error("MODEL_OUTPUT_INVALID");
  }
  cachePlan(root, f, route, parsed);
  // The deterministic policy overrides permissive outputs; disagreements fail closed.
  return parsed.plan === expected ? parsed : { plan: "handoff", confidence: 1 };
}
