export type Channel = "buts" | "graytag";
export interface Contract {
  dailyPrice: number;
  start: string;
  end: string;
}
export interface FinanceRow {
  id: string;
  channel: Channel;
  service: string;
  contracts: Contract[];
  source: "live" | "manual";
}
export interface Plan {
  dailyPrice: number;
  fee: number;
  capacity: number;
  retainedUnits: number;
  cost: number | null;
  costBasis: "account" | "seat";
  cycleMonths: number;
  nextPayment: string;
  payoutDay: number | null;
  payoutLag: number;
  openingBalance: number;
}
export const DEFAULT_PLAN: Plan = {
  dailyPrice: 150,
  fee: 10,
  capacity: 5,
  retainedUnits: 0,
  cost: null,
  costBasis: "account",
  cycleMonths: 1,
  nextPayment: "",
  payoutDay: null,
  payoutLag: 7,
  openingBalance: 0,
};
export function koreaDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}
export function addDays(value: string, count: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}
export function dayCount(start: string, end: string): number {
  return Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1;
}
function monthlyDate(anchor: string, offset: number): string {
  const date = new Date(`${anchor}T00:00:00Z`);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + offset);
  const last = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return date.toISOString().slice(0, 10);
}
export function validatePlan(raw: unknown): Plan {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("설정 형식을 확인해주세요.");
  const p = raw as Plan;
  const bounded = (v: unknown, max: number, integer = false) =>
    typeof v === "number" &&
    Number.isFinite(v) &&
    v >= 0 &&
    v <= max &&
    (!integer || Number.isInteger(v));
  if (
    !bounded(p.dailyPrice, 1000000) ||
    !bounded(p.fee, 100) ||
    !bounded(p.capacity, 1000, true) ||
    p.capacity < 1 ||
    !bounded(p.retainedUnits, 100000, true) ||
    (p.cost !== null && !bounded(p.cost, 1e9)) ||
    !["account", "seat"].includes(p.costBasis) ||
    ![1, 3, 6, 12].includes(p.cycleMonths) ||
    !(p.nextPayment === "" || validDate(p.nextPayment)) ||
    !(
      p.payoutDay === null ||
      (bounded(p.payoutDay, 31, true) && p.payoutDay >= 1)
    ) ||
    !bounded(p.payoutLag, 365, true) ||
    typeof p.openingBalance !== "number" ||
    !Number.isFinite(p.openingBalance) ||
    Math.abs(p.openingBalance) > 1e12
  )
    throw new Error("금액·인원·날짜 범위를 확인해주세요.");
  return {
    dailyPrice: p.dailyPrice,
    fee: p.fee,
    capacity: p.capacity,
    retainedUnits: p.retainedUnits,
    cost: p.cost,
    costBasis: p.costBasis,
    cycleMonths: p.cycleMonths,
    nextPayment: p.nextPayment,
    payoutDay: p.payoutDay,
    payoutLag: p.payoutLag,
    openingBalance: p.openingBalance,
  };
}
export interface ProjectionDay {
  date: string;
  gross: number;
  fee: number;
  earned: number;
  accruedCost: number;
  expense: number;
  deposit: number;
  balance: number;
}
export function project(
  row: FinanceRow,
  plan: Plan,
  target: number,
  start: string,
  days: number,
) {
  const active = row.contracts.filter(
    (c) => c.start <= start && c.end >= start,
  );
  const kept = active;
  const retainedRatio = active.length ? Math.min(1, target / active.length) : 0;
  const added = Math.max(0, target - active.length);
  const units =
    plan.costBasis === "seat"
      ? Math.max(plan.retainedUnits, target)
      : Math.max(plan.retainedUnits, Math.ceil(target / plan.capacity));
  const monthlyCost =
    units === 0
      ? 0
      : plan.cost === null
        ? null
        : (units * plan.cost) / plan.cycleMonths;
  const existingUnits = Math.min(
    units,
    plan.costBasis === "seat"
      ? Math.max(plan.retainedUnits, active.length)
      : Math.max(plan.retainedUnits, Math.ceil(active.length / plan.capacity)),
  );
  const newUnits = units - existingUnits;
  const end = addDays(start, days - 1);
  const paymentDates = new Set<string>();
  if (plan.nextPayment)
    for (let offset = 0; offset <= 2400; offset += plan.cycleMonths) {
      const date = monthlyDate(plan.nextPayment, offset);
      if (date > end) break;
      if (date >= start) paymentDates.add(date);
    }
  const newPaymentDates = new Set<string>();
  if (newUnits > 0)
    for (let offset = 0; offset <= 2400; offset += plan.cycleMonths) {
      const date = monthlyDate(start, offset);
      if (date > end) break;
      newPaymentDates.add(date);
    }
  const deposits = new Map<string, number>();
  let balance = plan.openingBalance;
  const timeline: ProjectionDay[] = Array.from({ length: days }, (_, i) => {
    const date = addDays(start, i);
    const gross =
      kept
        .filter((c) => c.start <= date && c.end >= date)
        .reduce((s, c) => s + c.dailyPrice, 0) *
        retainedRatio +
      added * plan.dailyPrice;
    const fee = (gross * plan.fee) / 100;
    const earned = gross - fee;
    if (plan.payoutDay !== null) {
      const dateAfterLag = addDays(date, plan.payoutLag);
      const month = dateAfterLag.slice(0, 7);
      const last = new Date(
        Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0),
      ).getUTCDate();
      let payout = `${month}-${String(Math.min(plan.payoutDay, last)).padStart(2, "0")}`;
      if (payout < dateAfterLag)
        payout =
          monthlyDate(`${month}-01`, 1).slice(0, 7) +
          `-${String(Math.min(plan.payoutDay, new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) + 1, 0)).getUTCDate())).padStart(2, "0")}`;
      deposits.set(payout, (deposits.get(payout) || 0) + earned);
    }
    return {
      date,
      gross,
      fee,
      earned,
      accruedCost: (monthlyCost || 0) / 30,
      expense:
        plan.cost === null
          ? 0
          : ((paymentDates.has(date) ? existingUnits : 0) +
              (newPaymentDates.has(date) ? newUnits : 0)) *
            plan.cost,
      deposit: 0,
      balance: 0,
    };
  });
  for (const day of timeline) {
    day.deposit = deposits.get(day.date) || 0;
    balance += day.deposit - day.expense;
    day.balance = balance;
  }
  const gross = timeline.reduce((s, d) => s + d.gross, 0),
    fee = timeline.reduce((s, d) => s + d.fee, 0);
  const cost = monthlyCost === null ? null : (monthlyCost * days) / 30;
  return {
    target,
    units,
    monthlyCost,
    gross,
    fee,
    cost,
    net: cost === null ? null : gross - fee - cost,
    deposits: timeline.reduce((s, d) => s + d.deposit, 0),
    expenses: timeline.reduce((s, d) => s + d.expense, 0),
    breakEven:
      monthlyCost === null
        ? null
        : plan.dailyPrice * (1 - plan.fee / 100) > 0
          ? Math.ceil(
              monthlyCost / (plan.dailyPrice * 30 * (1 - plan.fee / 100)),
            )
          : null,
    minBalance: Math.min(
      plan.openingBalance,
      ...timeline.map((d) => d.balance),
    ),
    timeline,
  };
}
