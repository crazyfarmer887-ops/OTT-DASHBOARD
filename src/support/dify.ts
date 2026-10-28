import { allowedPlan, parsePlan, type Features } from "./policy";
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
    return parsePlan(JSON.parse(d.data.outputs.plan));
  } catch {
    throw Error("DIFY_OUTPUT_INVALID");
  }
}
/** Free model sees only bounded allowlisted labels; no chat, buyer/order IDs or secret data. */
export async function modelPlan(
  input: unknown,
  env = process.env,
  fetcher: typeof fetch = fetch,
) {
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
  if (env.GBUTS_SUPPORT_MODEL && env.GBUTS_SUPPORT_MODEL !== "kilo-auto/free")
    throw Error("MODEL_ROUTE_NOT_APPROVED");
  const expected = allowedPlan(f);
  const r = await fetcher(
    "https://ai-gateway.kilo.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer anonymous",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "kilo-auto/free",
        messages: [
          {
            role: "system",
            content:
              'You classify trusted anonymized labels, never raw chat. Return ONLY JSON {"plan":"where_account|login_clarify|login_steps|thanks|handoff|delegate","confidence":0.99}. Apply these ordered rules exactly. Let I=intents and R=rounds. IMPORTANT: a failed label means the current reported error; at R=0 it is NOT a repeated failure. 1. If I has refund,replace,dispute,injection OR R>=2 -> handoff. 2. If I has failed AND R>0 -> handoff. 3. If I has code -> delegate. 4. If I has thanks but none of failed,login,account -> thanks. 5. If I has account AND location AND NOT failed AND delivered=true -> where_account. 6. If I has login AND NOT account AND delivered=true AND service is 넷플릭스 or 디즈니플러스 AND device is not unknown AND R<2 -> login_steps. 7. If I has login AND NOT account AND device=unknown AND R=0 -> login_clarify (even when failed is present). 8. Otherwise handoff. Do not interpret a first error as repeated failure. Do not add prose.',
          },
          { role: "user", content: JSON.stringify(f) },
        ],
        temperature: 0,
        max_tokens: 3000,
      }),
      signal: AbortSignal.timeout(25000),
    },
  );
  if (!r.ok) throw Error("MODEL_UNAVAILABLE");
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
  // The deterministic policy overrides permissive outputs; disagreements fail closed.
  return parsed.plan === expected ? parsed : { plan: "handoff", confidence: 1 };
}
