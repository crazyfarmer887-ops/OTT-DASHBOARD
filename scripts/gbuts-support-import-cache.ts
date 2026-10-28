import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { validateFeatures } from "../src/support/dify";
import { cachePlan } from "../src/support/cache";
import { supportRoute } from "../src/support/provider";
import { hash, parsePlan, allowedPlan } from "../src/support/policy";
const root =
    process.env.GBUTS_SUPPORT_ROOT || "/home/ubuntu/.config/gbuts/support",
  report = JSON.parse(
    readFileSync(root + "/validation-second-pass-private.json", "utf8"),
  );
const start = process.env.GBUTS_SUPPORT_CACHE_IMPORT_AFTER,
  end = process.env.GBUTS_SUPPORT_CACHE_IMPORT_BEFORE;
if (
  !start ||
  !end ||
  ![start, end].every((x) =>
    /^2026-10-28T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(x),
  ) ||
  !/^[a-f0-9-]{36}$/.test(report.workflowId) ||
  report.safeCorrect !== report.safeTotal
)
  throw Error("VERIFIED_SOURCE_REQUIRED");
const valid = new Set(
  report.caseResults
    .filter((r: any) => r.valid && r.expected === r.prediction)
    .map((r: any) => r.featureHash),
);
const sql = `SELECT json_build_object('id',id,'inputs',inputs,'outputs',outputs,'createdAt',created_at) FROM workflow_runs WHERE app_id='${report.workflowId}' AND status='succeeded' AND created_at >= '${start}' AND created_at <= '${end}' ORDER BY created_at;`;
const raw = execFileSync(
  "docker",
  [
    "exec",
    "gbuts-dify-support-db-1",
    "psql",
    "-U",
    "dify",
    "-d",
    "dify",
    "-tAc",
    sql,
  ],
  { encoding: "utf8", timeout: 20000 },
);
let imported = 0;
const route = supportRoute({});
for (const line of raw.split("\n").filter(Boolean)) {
  try {
    const row = JSON.parse(line),
      inputs =
        typeof row.inputs === "string" ? JSON.parse(row.inputs) : row.inputs,
      outputs =
        typeof row.outputs === "string" ? JSON.parse(row.outputs) : row.outputs;
    const f = validateFeatures(JSON.parse(inputs.context));
    if (!valid.has(hash(f))) continue;
    const p = parsePlan(JSON.parse(outputs.plan));
    if (p.plan !== allowedPlan(f) || p.confidence < 0.9) continue;
    cachePlan(
      root,
      f,
      route,
      p,
      "verified-dify-run:" + row.id,
      new Date(
        /(?:Z|[+-]\d{2}:?\d{2})$/.test(row.createdAt)
          ? row.createdAt
          : row.createdAt + "Z",
      ),
    );
    imported++;
  } catch {
    /* Invalid/unverified rows cannot seed a cache. */
  }
}
if (!imported) throw Error("NO_VERIFIED_RESULTS");
console.log(
  JSON.stringify({
    importedVerifiedAnonymousResults: imported,
    newModelCalls: 0,
  }),
);
