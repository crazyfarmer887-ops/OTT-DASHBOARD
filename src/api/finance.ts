import { readFileSync, existsSync } from "node:fs";
import { Hono } from "hono";
import { writeJsonAtomic } from "../lib/graytag-sales-session";
import { koreaDate, validatePlan, type Plan } from "../lib/finance/model";
import { graytagFinanceRows, butsFinanceRows } from "../lib/finance/snapshot";
import { gbutsOttClient } from "./gbuts-ott";
const settingsPath = () =>
  process.env.FINANCE_SETTINGS_PATH ||
  "/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data/finance-settings.json";
function readSettings(): Record<string, Plan> {
  if (!existsSync(settingsPath())) return {};
  const raw = JSON.parse(readFileSync(settingsPath(), "utf8"));
  const result: Record<string, Plan> = {};
  for (const [key, value] of Object.entries(raw))
    result[key] = validatePlan(value);
  return result;
}
export function registerFinanceRoutes(app: Hono) {
  app.get("/finance/settings", (c) => {
    c.header("Cache-Control", "no-store");
    return c.json({ plans: readSettings() });
  });
  app.put("/finance/settings", async (c) => {
    c.header("Cache-Control", "no-store");
    try {
      const raw = await c.req.json();
      if (
        typeof raw.id !== "string" ||
        !/^(graytag:youtube|buts:\d+)$/.test(raw.id)
      )
        return c.json({ error: "서비스를 확인해주세요." }, 400);
      const plan = validatePlan(raw.plan);
      const plans = readSettings();
      plans[raw.id] = plan;
      writeJsonAtomic(settingsPath(), plans);
      return c.json({ ok: true });
    } catch {
      return c.json(
        {
          error:
            "저장하지 못했습니다. 입력값 또는 서버 저장 상태를 확인해주세요.",
        },
        400,
      );
    }
  });
  app.get("/finance/snapshot", async (c) => {
    c.header("Cache-Control", "no-store");
    const today = koreaDate();
    const results = await Promise.allSettled([
      (async () => {
        const response = await app.request("/my/management", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-admin-token": process.env.AIO_ADMIN_TOKEN || "",
            "x-graytag-account": "youtube-invite-sales",
          },
          body: "{}",
        });
        if (!response.ok)
          throw new Error("그레이태그 전용 계정 연결을 확인해주세요.");
        return graytagFinanceRows(await response.json(), today);
      })(),
      (async () => {
        const client = gbutsOttClient();
        const posts = (await client.listPosts()).filter(
          (p) =>
            p.status !== "REFUNDED" &&
            String(p.subscriptionEndsAt).slice(0, 10) >= today,
        );
        const members: any[][] = [];
        for (let i = 0; i < posts.length; i += 4)
          members.push(
            ...(await Promise.all(
              posts.slice(i, i + 4).map((p) => client.listOttMembers(p.seq)),
            )),
          );
        return butsFinanceRows(posts, members, today);
      })(),
    ]);
    const channels = ["graytag", "buts"];
    return c.json({
      updatedAt: new Date().toISOString(),
      rows: results.flatMap((r) => (r.status === "fulfilled" ? r.value : [])),
      errors: results.flatMap((r, i) =>
        r.status === "rejected"
          ? [
              {
                channel: channels[i],
                message:
                  r.reason instanceof Error
                    ? r.reason.message
                    : "연결 확인 필요",
              },
            ]
          : [],
      ),
    });
  });
}
