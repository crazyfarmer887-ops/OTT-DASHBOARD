import { describe, it, expect } from "vitest";
import {
  DEFAULT_PLAN,
  project,
  validatePlan,
  type FinanceRow,
} from "../src/lib/finance/model";
import {
  butsFinanceRows,
  graytagFinanceRows,
} from "../src/lib/finance/snapshot";
const row: FinanceRow = {
  id: "buts:20",
  channel: "buts",
  service: "스포티파이",
  source: "live",
  contracts: Array.from({ length: 5 }, () => ({
    dailyPrice: 100,
    start: "2026-10-01",
    end: "2027-09-30",
  })),
};
const plan = {
  ...DEFAULT_PLAN,
  dailyPrice: 100,
  cost: 10000,
  nextPayment: "2026-10-15",
  payoutDay: 20,
  payoutLag: 0,
};
describe("finance projections", () => {
  it("charges a second account when the sixth member joins", () => {
    const five = project(row, plan, 5, "2026-10-10", 30),
      six = project(row, plan, 6, "2026-10-10", 30);
    expect(five.net).toBe(3500);
    expect(six.net).toBe(-3800);
    expect(six.expenses).toBe(20000);
    expect(six.units).toBe(2);
  });
  it("keeps prepaid accounts after a member reduction", () => {
    const r = project(row, { ...plan, retainedUnits: 2 }, 0, "2026-10-10", 30);
    expect(r.gross).toBe(0);
    expect(r.cost).toBe(20000);
    expect(r.net).toBe(-20000);
  });
  it("stops earnings after existing contracts expire", () => {
    const r = project(
      {
        ...row,
        contracts: [
          { dailyPrice: 100, start: "2026-10-01", end: "2026-10-12" },
        ],
      },
      plan,
      1,
      "2026-10-10",
      30,
    );
    expect(r.gross).toBe(300);
    expect(r.fee).toBe(30);
  });
  it("leaves profit unknown until costs are supplied", () => {
    expect(project(row, DEFAULT_PLAN, 5, "2026-10-10", 30).net).toBeNull();
  });
  it("separates annual prepaid cash outflow from amortized cost", () => {
    const r = project(
      row,
      { ...plan, cost: 120000, cycleMonths: 12 },
      5,
      "2026-10-10",
      30,
    );
    expect(r.cost).toBe(10000);
    expect(r.expenses).toBe(120000);
    expect(r.timeline.find((d) => d.date === "2026-10-15")?.expense).toBe(
      120000,
    );
  });
  it("clamps renewal to the last day without moving the original 31st anchor", () => {
    const r = project(
      row,
      { ...plan, nextPayment: "2027-01-31" },
      5,
      "2027-01-01",
      90,
    );
    expect(r.timeline.filter((d) => d.expense).map((d) => d.date)).toEqual([
      "2027-01-31",
      "2027-02-28",
      "2027-03-31",
    ]);
  });
  it("does not count today-earned revenue as a deposit before the configured lag", () => {
    const r = project(
      row,
      { ...plan, payoutLag: 7, payoutDay: 15 },
      5,
      "2026-10-10",
      30,
    );
    expect(r.timeline.find((d) => d.date === "2026-10-15")?.deposit).toBe(0);
    expect(r.deposits).toBe(0);
  });
  it("deposits only earnings eligible before this months payout day", () => {
    const r = project(
      row,
      { ...plan, payoutDay: 20, payoutLag: 7 },
      5,
      "2026-10-10",
      30,
    );
    expect(r.timeline.find((d) => d.date === "2026-10-20")?.deposit).toBe(1800);
    expect(r.minBalance).toBe(-10000);
  });
  it("never silently turns an invalid date or negative cost into a forecast", () => {
    expect(() => validatePlan({ ...plan, cost: -1 })).toThrow();
    expect(() =>
      validatePlan({ ...plan, nextPayment: "2026-02-30" }),
    ).toThrow();
    expect(() => validatePlan({ ...plan, capacity: 0 })).toThrow();
  });
});
describe("seller read-only finance adapters", () => {
  it("excludes refunds, pending and expired GButs members", () => {
    const posts = [
      {
        seq: 1,
        category1: { seq: 20 },
        priceType: "DAY",
        price: 140,
        status: "ON_SALE",
      },
    ];
    const members = [
      [
        {
          seq: 1,
          status: "APPLY",
          createdAt: "2026-10-01",
          subscriptionEndsAt: "2027-10-01",
          cancelStatus: null,
        },
        {
          seq: 2,
          status: "APPLY",
          createdAt: "2026-10-01",
          subscriptionEndsAt: "2027-10-01",
          cancelStatus: "REFUNDED",
        },
        {
          seq: 3,
          status: "PENDING",
          createdAt: "2026-10-01",
          subscriptionEndsAt: "2027-10-01",
        },
      ],
    ];
    expect(
      butsFinanceRows(posts, members, "2026-10-10")[0].contracts,
    ).toHaveLength(1);
  });
  it("exports only aggregate-priced contracts from Graytag, never customer identifiers", () => {
    const data = {
      services: [
        {
          serviceType: "유튜브 프리미엄",
          accounts: [
            {
              email: "private@example.com",
              members: [
                {
                  dealUsid: "1",
                  name: "Private buyer",
                  status: "Using",
                  purePrice: 3000,
                  startDateTime: "2026-10-01",
                  endDateTime: "2026-10-30",
                },
                {
                  dealUsid: "2",
                  status: "CancelByDepositRejection",
                  purePrice: 3000,
                  startDateTime: "2026-10-01",
                  endDateTime: "2026-10-30",
                },
              ],
            },
          ],
        },
      ],
    };
    const result = graytagFinanceRows(data, "2026-10-10");
    expect(result[0].contracts).toEqual([
      { start: "2026-10-01", end: "2026-10-30", dailyPrice: 100 },
    ]);
    expect(JSON.stringify(result)).not.toContain("private@example.com");
  });
});
