import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { mkdtempSync, rmSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_PLAN } from "../src/lib/finance/model";
vi.mock("../src/api/gbuts-ott", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/api/gbuts-ott")>();
  return {
    ...actual,
    gbutsOttClient: () => ({
      listPosts: async () => [
        {
          seq: 10,
          category1: { seq: 20 },
          status: "ON_SALE",
          priceType: "DAY",
          price: 140,
          subscriptionEndsAt: "2099-12-31",
        },
      ],
      listOttMembers: async () => [
        {
          seq: 3,
          status: "APPLY",
          cancelStatus: null,
          createdAt: "2026-01-01",
          subscriptionEndsAt: "2099-12-31",
        },
      ],
    }),
  };
});
const old = {
  token: process.env.AIO_ADMIN_TOKEN,
  path: process.env.FINANCE_SETTINGS_PATH,
};
let api: (typeof import("../src/api/index"))["default"];
let root: string;
beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "finance-api-"));
  process.env.AIO_ADMIN_TOKEN = "finance-test-token";
  process.env.FINANCE_SETTINGS_PATH = join(root, "settings.json");
  api = (await import("../src/api/index")).default;
});
beforeEach(() => {
  vi.restoreAllMocks();
  rmSync(join(root, "settings.json"), { force: true });
});
afterAll(() => {
  if (old.token === undefined) delete process.env.AIO_ADMIN_TOKEN;
  else process.env.AIO_ADMIN_TOKEN = old.token;
  if (old.path === undefined) delete process.env.FINANCE_SETTINGS_PATH;
  else process.env.FINANCE_SETTINGS_PATH = old.path;
  rmSync(root, { recursive: true, force: true });
});
describe("private finance endpoints", () => {
  it("blocks unauthenticated snapshot and settings reads before any provider access", async () => {
    for (const path of ["/finance/snapshot", "/finance/settings"])
      expect((await api.request(path)).status).toBe(403);
  });
  it("persists validated assumptions outside the release with private permissions", async () => {
    const plan = { ...DEFAULT_PLAN, cost: 10000, nextPayment: "2026-10-15" };
    const response = await api.request("/finance/settings", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-admin-token": "finance-test-token",
      },
      body: JSON.stringify({ id: "buts:20", plan }),
    });
    expect(response.status).toBe(200);
    expect(
      JSON.parse(readFileSync(join(root, "settings.json"), "utf8"))["buts:20"],
    ).toEqual(plan);
    expect(statSync(join(root, "settings.json")).mode & 0o777).toBe(0o600);
    const read = await api.request("/finance/settings", {
      headers: { "x-admin-token": "finance-test-token" },
    });
    expect((await read.json()).plans["buts:20"].cost).toBe(10000);
  });
  it("rejects unsafe service keys and invalid financial assumptions", async () => {
    for (const body of [
      { id: "../../secrets", plan: DEFAULT_PLAN },
      { id: "buts:20", plan: { ...DEFAULT_PLAN, fee: 101 } },
    ]) {
      const r = await api.request("/finance/settings", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          "x-admin-token": "finance-test-token",
        },
        body: JSON.stringify(body),
      });
      expect(r.status).toBe(400);
    }
  });
  it("keeps a failed platform distinct from an empty successful platform", async () => {
    const original = api.request.bind(api);
    vi.spyOn(api, "request").mockImplementation(((input: any, init: any) =>
      input === "/my/management"
        ? Promise.resolve(new Response("{}", { status: 503 }))
        : original(input, init)) as typeof api.request);
    const response = await api.request("/finance/snapshot", {
      headers: { "x-admin-token": "finance-test-token" },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body.errors.map((e: any) => e.channel)).toEqual(["graytag"]);
    expect(body.rows[0].contracts).toHaveLength(1);
    expect(body.rows[0].contracts[0].dailyPrice).toBe(140);
    expect(JSON.stringify(body)).not.toContain("finance-test-token");
  });
});
