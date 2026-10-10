import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronDown,
  Download,
  LayoutDashboard,
  SlidersHorizontal,
  CalendarDays,
  RefreshCw,
  Plus,
  Minus,
  X,
  Settings2,
  Check,
  ArrowRight,
  Wallet,
  ExternalLink,
} from "lucide-react";
import {
  DEFAULT_PLAN,
  addDays,
  koreaDate,
  project,
  validatePlan,
  type FinanceRow,
  type Plan,
} from "../../lib/finance/model";
import "./finance.css";
type Snapshot = {
  rows: FinanceRow[];
  updatedAt: string;
  errors: { channel: string; message: string }[];
};
const money = (n: number) => Math.round(n).toLocaleString("ko-KR");
const signed = (n: number) => `${n > 0 ? "+" : ""}${money(n)}`;
const CHANNEL = { buts: "BUTS", graytag: "그레이태그" };
const SEEDS: FinanceRow[] = [
  {
    id: "graytag:youtube",
    channel: "graytag",
    service: "유튜브 프리미엄",
    contracts: [],
    source: "manual",
  },
  ...Object.entries({
    5: "넷플릭스",
    6: "디즈니플러스",
    8: "티빙",
    10: "웨이브",
    20: "스포티파이",
    7: "유튜브 프리미엄",
  }).map(([id, service]) => ({
    id: `buts:${id}`,
    channel: "buts" as const,
    service,
    contracts: [],
    source: "manual" as const,
  })),
];
function starter(row: FinanceRow): Plan {
  return {
    ...DEFAULT_PLAN,
    dailyPrice: row.contracts.length
      ? Math.round(
          row.contracts.reduce((s, c) => s + c.dailyPrice, 0) /
            row.contracts.length,
        )
      : row.service === "스포티파이"
        ? 140
        : 150,
    capacity: ["티빙", "웨이브"].includes(row.service) ? 4 : 5,
    retainedUnits: Math.ceil(
      row.contracts.length / (["티빙", "웨이브"].includes(row.service) ? 4 : 5),
    ),
  };
}
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, cache: "no-store" });
  if (!r.ok)
    throw new Error(
      r.status === 401 || r.status === 403
        ? "관리자 로그인이 필요합니다."
        : "데이터를 불러오지 못했습니다. 잠시 후 다시 확인해주세요.",
    );
  return r.json();
}
function downloadCsv(
  headers: string[],
  rows: (string | number)[][],
  name: string,
) {
  const csv =
    "\uFEFF" +
    [headers, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\r\n");
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Chart({
  baseline,
  scenario,
  excludeCosts,
}: {
  baseline: ReturnType<typeof project>[];
  scenario: ReturnType<typeof project>[];
  excludeCosts: boolean;
}) {
  const points = Array.from(
    { length: scenario[0]?.timeline.length || 30 },
    (_, i) => ({
      a: baseline.reduce(
        (s, p) =>
          s +
          (p.timeline[i]?.earned || 0) -
          (excludeCosts || p.cost === null
            ? 0
            : p.timeline[i]?.accruedCost || 0),
        0,
      ),
      b: scenario.reduce(
        (s, p) =>
          s +
          (p.timeline[i]?.earned || 0) -
          (excludeCosts || p.cost === null
            ? 0
            : p.timeline[i]?.accruedCost || 0),
        0,
      ),
    }),
  );
  let a = 0,
    b = 0;
  const values = points.map((p) => ({ a: (a += p.a), b: (b += p.b) }));
  const min = Math.min(0, ...values.flatMap((v) => [v.a, v.b])),
    max = Math.max(1, ...values.flatMap((v) => [v.a, v.b]));
  const y = (v: number) => 160 - ((v - min) / (max - min)) * 135;
  const path = (key: "a" | "b") =>
    values
      .map(
        (v, i) =>
          `${i ? "L" : "M"} ${20 + (i / Math.max(1, values.length - 1)) * 760} ${y(v[key])}`,
      )
      .join(" ");
  return (
    <svg
      className="fn-chart"
      viewBox="0 0 800 195"
      role="img"
      aria-label="기간 내 누적 기여이익, 비용 미입력 시 누적 수수료 후 매출 비교"
    >
      <defs>
        <linearGradient id="fn-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#171717" stopOpacity=".09" />
          <stop offset="100%" stopColor="#171717" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[30, 75, 120, 160].map((v) => (
        <line key={v} x1="20" y1={v} x2="780" y2={v} stroke="#eeeeee" />
      ))}
      <path d={`${path("b")} L 780 165 L 20 165 Z`} fill="url(#fn-fill)" />
      <path
        d={path("a")}
        fill="none"
        stroke="#bcbcbc"
        strokeWidth="2"
        strokeDasharray="5 5"
      />
      <path d={path("b")} fill="none" stroke="#171717" strokeWidth="2.5" />
      <text x="20" y="190">
        시작일
      </text>
      <text x="740" y="190">
        {values.length}일 후
      </text>
      <text x="780" y="17" textAnchor="end">
        {money(b)}원
      </text>
    </svg>
  );
}
function PlanEditor({
  row,
  plan,
  onClose,
  onSave,
}: {
  row: FinanceRow;
  plan: Plan;
  onClose: () => void;
  onSave: (plan: Plan) => Promise<void>;
}) {
  const [draft, setDraft] = useState(plan);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>(".fn-modal");
    dialog?.querySelector<HTMLInputElement>("input")?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab" || !dialog) return;
      const controls = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input, select",
        ),
      );
      const first = controls[0],
        last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      previous?.focus();
    };
  }, [onClose]);
  const field = (key: keyof Plan, label: string, nullable = false) => (
    <label>
      {label}
      <input
        type="number"
        min={key === "openingBalance" ? undefined : key === "capacity" ? 1 : 0}
        step={key === "fee" ? "0.1" : "1"}
        value={draft[key] ?? ""}
        placeholder={nullable ? "미입력" : ""}
        onChange={(e) =>
          setDraft({
            ...draft,
            [key]:
              e.target.value === "" && nullable ? null : Number(e.target.value),
          })
        }
      />
    </label>
  );
  return (
    <div className="fn-overlay" onClick={onClose}>
      <section
        className="fn-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fn-settings-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <div>
            <span className="fn-eyebrow">COST & PAYOUT</span>
            <h2 id="fn-settings-title">
              {CHANNEL[row.channel]} · {row.service}
            </h2>
          </div>
          <button className="fn-icon" onClick={onClose} aria-label="설정 닫기">
            <X size={20} />
          </button>
        </header>
        <p>
          실제 공급자 청구 조건을 입력하세요. 저장하면 다른 기기에서도 같은
          설정을 사용합니다.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            try {
              validatePlan(draft);
              setBusy(true);
              await onSave(draft);
              onClose();
            } catch (e) {
              setError(e instanceof Error ? e.message : "설정을 확인해주세요.");
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="fn-fields">
            {field("dailyPrice", "신규 파티원 일 요금 (원)")}
            {field("fee", "판매 수수료 (%)")}
            <label>
              비용 기준
              <select
                value={draft.costBasis}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    costBasis: e.target.value as Plan["costBasis"],
                  })
                }
              >
                <option value="account">계정당 청구</option>
                <option value="seat">자리당 청구</option>
              </select>
            </label>
            {field("cost", "1회 청구 원가 (원)", true)}
            {field("capacity", "계정당 판매 가능한 자리")}
            <label>
              청구 주기
              <select
                value={draft.cycleMonths}
                onChange={(e) =>
                  setDraft({ ...draft, cycleMonths: Number(e.target.value) })
                }
              >
                {[1, 3, 6, 12].map((n) => (
                  <option key={n} value={n}>
                    {n}개월마다
                  </option>
                ))}
              </select>
            </label>
            {field(
              "retainedUnits",
              draft.costBasis === "account"
                ? "유지 중인 유료 계정 수"
                : "유지 중인 유료 자리 수",
            )}
            <label>
              다음 비용 결제일
              <input
                type="date"
                value={draft.nextPayment}
                onChange={(e) =>
                  setDraft({ ...draft, nextPayment: e.target.value })
                }
              />
            </label>
            {field("payoutDay", "가정 입금일 (매월 1~31일)", true)}
            {field("payoutLag", "가정 정산 대기일 (일)")}
            {field("openingBalance", "시작 현금 잔액 (원)")}
          </div>
          <p className="fn-note">
            유지 수량은 인원을 줄여도 비용이 계속 나가는 최소 수량입니다. 정산
            입금일은 입력한 가정이며 플랫폼의 입금 확약이 아닙니다. 오늘 이전에
            발생한 미수 정산액은 포함하지 않습니다.
          </p>
          {error && <p role="alert">{error}</p>}
          <button className="fn-button fn-dark" disabled={busy} type="submit">
            <Check size={15} />
            {busy ? "저장 중…" : "설정 저장"}
          </button>
        </form>
      </section>
    </div>
  );
}
export default function FinancePage() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [plans, setPlans] = useState<Record<string, Plan>>({}),
    [targets, setTargets] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [filter, setFilter] = useState("all"),
    [days, setDays] = useState(30),
    [editor, setEditor] = useState<FinanceRow | null>(null),
    [section, setSection] = useState("overview"),
    [saved, setSaved] = useState("");
  const today = koreaDate();
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const results = await Promise.allSettled([
      request<Snapshot>("/api/finance/snapshot"),
      request<{ plans: Record<string, Plan> }>("/api/finance/settings"),
    ]);
    if (results[0].status === "fulfilled") setSnapshot(results[0].value);
    else setError(results[0].reason.message);
    if (results[1].status === "fulfilled") setPlans(results[1].value.plans);
    else setError("설정을 불러오지 못했습니다. 새로고침 후 다시 확인해주세요.");
    setLoading(false);
  }, []);
  useEffect(() => {
    document.title = "수익 대시보드 · 잠깐구독";
    void load();
  }, [load]);
  const rows = useMemo(
    () =>
      SEEDS.map(
        (seed) =>
          snapshot?.rows.find((r) => r.id === seed.id) ||
          (snapshot && !snapshot.errors.some((e) => e.channel === seed.channel)
            ? { ...seed, source: "live" as const }
            : seed),
      ).filter((r) => filter === "all" || r.channel === filter),
    [snapshot, filter],
  );
  const calculations = rows.map((row) => {
    const plan = plans[row.id] || starter(row);
    const current = row.contracts.length;
    const target = targets[row.id] ?? current;
    return {
      row,
      plan,
      current,
      target,
      base: project(row, plan, current, today, days),
      sim: project(row, plan, target, today, days),
    };
  });
  const unknown = calculations.filter(
    (c) => c.sim.cost === null && c.sim.units > 0,
  ).length;
  const incomplete = rows.some((r) => r.source !== "live");
  const gross = calculations.reduce((s, c) => s + c.sim.gross, 0),
    fees = calculations.reduce((s, c) => s + c.sim.fee, 0),
    cost = calculations.reduce((s, c) => s + (c.sim.cost || 0), 0),
    net = gross - fees - cost;
  const baseNet = calculations.reduce(
    (s, c) => s + c.base.gross - c.base.fee - (c.base.cost || 0),
    0,
  );
  const current = calculations.reduce((s, c) => s + c.current, 0),
    target = calculations.reduce((s, c) => s + c.target, 0);
  const schedule = Array.from({ length: days }, (_, i) => {
    const events = calculations.map((c) => ({
      label: `${CHANNEL[c.row.channel]} · ${c.row.service}`,
      day: c.sim.timeline[i],
    }));
    const deposit = events.reduce((s, e) => s + e.day.deposit, 0),
      expense = events.reduce((s, e) => s + e.day.expense, 0);
    return {
      date: addDays(today, i),
      deposit,
      expense,
      balance: events.reduce((s, e) => s + e.day.balance, 0),
      labels: events
        .filter((e) => e.day.expense || e.day.deposit)
        .map((e) => e.label)
        .join(", "),
    };
  });
  const upcoming = schedule.filter((d) => d.expense || d.deposit);
  const go = (id: string) => {
    setSection(id);
    document
      .getElementById(`fn-${id}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const save = async (plan: Plan) => {
    if (!editor) return;
    await request("/api/finance/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: editor.id, plan }),
    });
    setPlans((p) => ({ ...p, [editor.id]: plan }));
    setSaved("설정을 저장했습니다.");
    setTimeout(() => setSaved(""), 3500);
  };
  return (
    <div className="fn-app">
      <aside className="fn-sidebar">
        <a className="fn-brand" href="/finance">
          <span className="fn-logo">j.</span>
          <span>
            잠깐구독<small>BUSINESS DASHBOARD</small>
          </span>
        </a>
        <div className="fn-workspace">
          <span className="fn-avatar">J</span>
          <div>
            잠깐구독 워크스페이스<small>수익 · 비용 관리</small>
          </div>
          <ChevronDown size={14} />
        </div>
        <span className="fn-nav-caption">WORKSPACE</span>
        <nav>
          {[
            ["overview", "수익 개요", LayoutDashboard],
            ["simulation", "파티원 시뮬레이션", SlidersHorizontal],
            ["cashflow", "입출금 일정", CalendarDays],
          ].map(([id, label, Icon]) => (
            <button
              key={String(id)}
              aria-label={String(label)}
              className={section === id ? "active" : ""}
              onClick={() => go(String(id))}
            >
              {typeof Icon !== "string" && <Icon size={17} />}
              <span>{String(label)}</span>
              {section === id && <span className="fn-nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="fn-sidebar-bottom">
          <span className="fn-status-dot" /> 관리자 전용
          <small>BUTS & GRAYTAG</small>
          <a
            href="https://email-verify.one/dashboard"
            target="_blank"
            rel="noreferrer"
          >
            운영 대시보드 열기 <ExternalLink size={12} />
          </a>
        </div>
      </aside>
      <div className="fn-main">
        <header className="fn-topbar">
          <span>
            워크스페이스 <span className="fn-slash">/</span>{" "}
            <strong>수익 대시보드</strong>
          </span>
          <div>
            <span className="fn-private">PRIVATE</span>
            <span className="fn-avatar">J</span>
          </div>
        </header>
        <main className="fn-content">
          <section id="fn-overview">
            <div className="fn-heading">
              <div>
                <div className="fn-eyebrow">YOUR BUSINESS, AT A GLANCE</div>
                <h1>
                  수익 대시보드<span className="fn-heading-dot">.</span>
                </h1>
                <p>
                  파티원이 늘면 수익은 얼마나 달라질까요? 숫자로 미리
                  확인하세요.
                </p>
              </div>
              <button
                className="fn-button"
                onClick={() =>
                  downloadCsv(
                    [
                      "플랫폼",
                      "서비스",
                      "현재 인원",
                      "예상 인원",
                      "기간 매출",
                      "수수료",
                      "기간 배분 원가",
                      "기여이익",
                    ],
                    calculations.map((c) => [
                      CHANNEL[c.row.channel],
                      c.row.service,
                      c.current,
                      c.target,
                      Math.round(c.sim.gross),
                      Math.round(c.sim.fee),
                      c.sim.cost === null ? "미입력" : Math.round(c.sim.cost),
                      c.sim.net === null ? "확인 필요" : Math.round(c.sim.net),
                    ]),
                    `수익시뮬레이션-${today}.csv`,
                  )
                }
              >
                <Download size={15} />표 내보내기
              </button>
            </div>
            <div className="fn-toolbar">
              <div className="fn-tabs" role="group" aria-label="플랫폼 선택">
                {[
                  ["all", "전체 플랫폼"],
                  ["buts", "BUTS"],
                  ["graytag", "그레이태그 · 유튜브"],
                ].map(([id, label]) => (
                  <button
                    key={id}
                    className={filter === id ? "selected" : ""}
                    onClick={() => setFilter(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="fn-toolbar-right">
                <span className="fn-period">
                  오늘부터{" "}
                  <select
                    aria-label="예측 기간"
                    value={days}
                    onChange={(e) => setDays(Number(e.target.value))}
                  >
                    {[30, 90, 365].map((n) => (
                      <option key={n} value={n}>
                        {n}일
                      </option>
                    ))}
                  </select>
                </span>
                <button
                  className="fn-icon"
                  disabled={loading}
                  onClick={load}
                  aria-label="실제 판매 현황 새로고침"
                >
                  <RefreshCw size={16} className={loading ? "fn-spin" : ""} />
                </button>
              </div>
            </div>
            {error && (
              <div role="alert" className="fn-alert">
                {error}
              </div>
            )}
            {snapshot?.errors.map((e) => (
              <div className="fn-alert" key={e.channel}>
                {e.channel === "buts" ? "BUTS" : "그레이태그"} 연결 확인 필요 ·{" "}
                {e.message}
              </div>
            ))}
            {loading && (
              <div className="fn-note">
                판매 중인 계약과 저장된 비용 조건을 확인하고 있습니다…
              </div>
            )}
            <div className="fn-metrics">
              <article className="fn-metric fn-featured">
                <div>
                  <span>예상 기여이익</span>
                  <ArrowUpRight size={18} />
                </div>
                <strong>
                  {unknown || incomplete ? "확인 필요" : `₩${money(net)}`}
                </strong>
                <p>
                  {unknown
                    ? `${unknown}개 서비스의 비용을 입력해주세요`
                    : incomplete
                      ? "연결하지 못한 서비스의 인원을 확인해주세요"
                      : `현재 대비 ${signed(net - baseNet)}원`}
                </p>
                <span className="fn-metric-foot">
                  {days}일 기준 · 세금 / 운영비 제외
                </span>
              </article>
              <article className="fn-metric">
                <div>
                  <span>예상 총매출</span>
                  <ArrowUpRight size={18} />
                </div>
                <strong>₩{money(gross)}</strong>
                <p>수수료 차감 후 ₩{money(gross - fees)}</p>
                <span className="fn-metric-foot">이용 기간 기준 매출 추정</span>
              </article>
              <article className="fn-metric">
                <div>
                  <span>비용 + 수수료</span>
                  <ArrowDownLeft size={18} />
                </div>
                <strong>
                  {unknown
                    ? "₩" + money(fees) + " + 미입력"
                    : "₩" + money(cost + fees)}
                </strong>
                <p>
                  원가 {unknown ? "확인 필요" : `₩${money(cost)}`} · 수수료 ₩
                  {money(fees)}
                </p>
                <span className="fn-metric-foot">
                  원가는 30일 기준으로 기간 배분
                </span>
              </article>
              <article className="fn-metric">
                <div>
                  <span>시뮬레이션 파티원</span>
                  <Wallet size={17} />
                </div>
                <strong>
                  {target}
                  <em>명</em>
                </strong>
                <p>
                  현재 {incomplete ? "조회된" : ""} {current}명{" "}
                  <span className="fn-pill">{signed(target - current)}명</span>
                </p>
                <span className="fn-metric-foot">
                  슬라이더로 인원을 조정하세요
                </span>
              </article>
            </div>
            <div className="fn-middle">
              <section className="fn-panel">
                <div className="fn-panel-heading">
                  <div>
                    <span className="fn-eyebrow">REVENUE FORECAST</span>
                    <h2>
                      {unknown ? "수수료 후 누적 매출" : "누적 기여이익"} 추이
                    </h2>
                  </div>
                  <div className="fn-legend">
                    <span>
                      <i className="dashed" />
                      현재
                    </span>
                    <span>
                      <i />
                      시뮬레이션
                    </span>
                  </div>
                </div>
                <Chart
                  baseline={calculations.map((c) => c.base)}
                  scenario={calculations.map((c) => c.sim)}
                  excludeCosts={unknown > 0}
                />
                <div className="fn-chart-caption">
                  기존 파티원은 계약 종료일까지 · 추가 인원은 오늘부터 유지 가정
                </div>
              </section>
              <section className="fn-panel fn-next">
                <span className="fn-eyebrow">UPCOMING PAYMENTS</span>
                <h2>다가오는 비용 결제</h2>
                {upcoming
                  .filter((d) => d.expense)
                  .slice(0, 3)
                  .map((d) => (
                    <div className="fn-next-item" key={d.date}>
                      <span className="fn-date-box">
                        {d.date.slice(5, 7)}
                        <strong>{d.date.slice(8)}</strong>
                      </span>
                      <div>
                        <b>{d.labels}</b>
                        <small>공급자 비용 · 설정 기준</small>
                      </div>
                      <strong>₩{money(d.expense)}</strong>
                    </div>
                  ))}
                {!upcoming.some((d) => d.expense) && (
                  <div className="fn-empty">
                    <CalendarDays size={27} />
                    <strong>결제 일정을 등록하세요</strong>
                    <p>
                      서비스 설정에서 원가와
                      <br />
                      다음 결제일을 입력해주세요.
                    </p>
                  </div>
                )}
                <button
                  className="fn-text-button"
                  onClick={() => go("cashflow")}
                >
                  전체 입출금 보기 <ArrowRight size={14} />
                </button>
              </section>
            </div>
          </section>
          <section className="fn-panel fn-simulation" id="fn-simulation">
            <div className="fn-panel-heading">
              <div>
                <span className="fn-eyebrow">PARTY SIMULATOR</span>
                <h2>인원은 움직이고, 수익은 계산하고.</h2>
                <p>빈자리를 채우거나 파티원을 줄였을 때의 변화를 확인하세요.</p>
              </div>
              <button className="fn-button" onClick={() => setTargets({})}>
                현재 인원으로 초기화
              </button>
            </div>
            <div className="fn-table-wrap">
              <table className="fn-table">
                <thead>
                  <tr>
                    <th>플랫폼 / 서비스</th>
                    <th className="fn-slider-heading">파티원 수 시뮬레이션</th>
                    <th>필요 계정 / 자리</th>
                    <th>{days}일 매출</th>
                    <th>배분 원가</th>
                    <th>예상 기여이익</th>
                    <th aria-label="서비스 설정" />
                  </tr>
                </thead>
                <tbody>
                  {calculations.map((c) => (
                    <tr key={c.row.id}>
                      <td>
                        <div className="fn-service">
                          <span
                            className={
                              "fn-service-icon " +
                              (c.row.channel === "graytag" ? "fn-yt" : "")
                            }
                          >
                            {c.row.channel === "graytag"
                              ? "▶"
                              : c.row.service.slice(0, 1)}
                          </span>
                          <div>
                            <b>{c.row.service}</b>
                            <small>
                              {CHANNEL[c.row.channel]}{" "}
                              <span className="fn-row-source">
                                {c.row.source === "live"
                                  ? "계약 조회"
                                  : "조회 전"}
                              </span>
                            </small>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="fn-slider-top">
                          <span>
                            현재 {c.row.source === "live" ? c.current : "—"}명
                          </span>
                          <div>
                            <button
                              className="fn-mini"
                              aria-label={`${c.row.id} 인원 감소`}
                              onClick={() =>
                                setTargets((t) => ({
                                  ...t,
                                  [c.row.id]: Math.max(0, c.target - 1),
                                }))
                              }
                            >
                              <Minus size={11} />
                            </button>
                            <input
                              className="fn-target-input"
                              aria-label={`${c.row.id} 예상 인원`}
                              type="number"
                              min="0"
                              max="10000"
                              value={c.target}
                              onChange={(e) =>
                                setTargets((t) => ({
                                  ...t,
                                  [c.row.id]: Math.min(
                                    10000,
                                    Math.max(
                                      0,
                                      Math.floor(Number(e.target.value)),
                                    ),
                                  ),
                                }))
                              }
                            />
                            <span>명</span>
                            <button
                              className="fn-mini"
                              aria-label={`${c.row.id} 인원 증가`}
                              onClick={() =>
                                setTargets((t) => ({
                                  ...t,
                                  [c.row.id]: Math.min(10000, c.target + 1),
                                }))
                              }
                            >
                              <Plus size={11} />
                            </button>
                          </div>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max={Math.max(100, c.current * 2, c.target)}
                          value={c.target}
                          aria-label={`${CHANNEL[c.row.channel]} ${c.row.service} 파티원 수`}
                          onChange={(e) =>
                            setTargets((t) => ({
                              ...t,
                              [c.row.id]: Number(e.target.value),
                            }))
                          }
                        />
                        <div className="fn-slider-labels">
                          <span>0명</span>
                          <span>{signed(c.target - c.current)}명</span>
                        </div>
                      </td>
                      <td>
                        <b>
                          {c.sim.units}
                          {c.plan.costBasis === "account" ? "개" : "자리"}
                        </b>
                        <small>
                          {c.plan.costBasis === "account"
                            ? `계정당 ${c.plan.capacity}명`
                            : "자리 수 기준 비용"}
                        </small>
                        {c.sim.units > c.base.units && (
                          <span className="fn-pill">
                            +{c.sim.units - c.base.units}{" "}
                            {c.plan.costBasis === "account" ? "계정" : "자리"}{" "}
                            필요
                          </span>
                        )}
                      </td>
                      <td>
                        <b>₩{money(c.sim.gross)}</b>
                        <small>수수료 {c.plan.fee}%</small>
                      </td>
                      <td>
                        <b>
                          {c.sim.cost === null
                            ? "미입력"
                            : `₩${money(c.sim.cost)}`}
                        </b>
                        <small>{c.plan.cycleMonths}개월 청구 주기</small>
                      </td>
                      <td>
                        <b>
                          {c.sim.net === null
                            ? "확인 필요"
                            : `₩${money(c.sim.net)}`}
                        </b>
                        <small>
                          {c.sim.net !== null && c.base.net !== null
                            ? `현재 대비 ${signed(c.sim.net - c.base.net)}원`
                            : "원가 입력 후 계산"}
                        </small>
                      </td>
                      <td>
                        <button
                          className="fn-icon"
                          aria-label={`${c.row.id} 비용 설정`}
                          onClick={() => setEditor(c.row)}
                        >
                          <Settings2 size={17} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>합계</td>
                    <td>
                      {target}명{" "}
                      <span className="fn-note">
                        현재 대비 {signed(target - current)}명
                      </span>
                    </td>
                    <td />
                    <td>₩{money(gross)}</td>
                    <td>{unknown ? "확인 필요" : `₩${money(cost)}`}</td>
                    <td>
                      {unknown || incomplete ? "확인 필요" : `₩${money(net)}`}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="fn-sim-footer">
              <SlidersHorizontal size={15} />
              <span>
                인원 변경은 가상 계산입니다. 실제 판매글이나 파티원은 변경되지
                않습니다.
              </span>
            </div>
          </section>
          <section className="fn-panel" id="fn-cashflow">
            <div className="fn-panel-heading">
              <div>
                <span className="fn-eyebrow">CASH FLOW CALENDAR</span>
                <h2>돈이 들어오고, 나가는 날.</h2>
                <p>수익 발생일과 실제 현금 입출금일을 구분해 확인하세요.</p>
              </div>
              <button
                className="fn-button"
                onClick={() =>
                  downloadCsv(
                    ["날짜", "내용", "예상 입금", "예상 출금", "예상 잔액"],
                    schedule.map((d) => [
                      d.date,
                      d.labels,
                      Math.round(d.deposit),
                      Math.round(d.expense),
                      Math.round(d.balance),
                    ]),
                    `입출금일정-${today}.csv`,
                  )
                }
              >
                <Download size={14} />
                일정 내보내기
              </button>
            </div>
            <div className="fn-cash-summary">
              <div>
                <small>기간 내 예상 입금</small>
                <strong>
                  ₩{money(upcoming.reduce((s, d) => s + d.deposit, 0))}
                </strong>
              </div>
              <div>
                <small>기간 내 예정 결제</small>
                <strong>
                  ₩{money(upcoming.reduce((s, d) => s + d.expense, 0))}
                </strong>
              </div>
              <div>
                <small>최저 예상 잔액</small>
                <strong>
                  ₩
                  {money(
                    Math.min(
                      calculations.reduce(
                        (s, c) => s + c.plan.openingBalance,
                        0,
                      ),
                      ...schedule.map((d) => d.balance),
                    ),
                  )}
                </strong>
              </div>
              <div>
                <small>일정 미입력</small>
                <strong>
                  {
                    calculations.filter(
                      (c) =>
                        c.target > 0 &&
                        (!c.plan.nextPayment ||
                          c.plan.payoutDay === null ||
                          c.plan.cost === null),
                    ).length
                  }
                  <em>개 서비스</em>
                </strong>
              </div>
            </div>
            <div className="fn-table-wrap">
              <table className="fn-table fn-schedule">
                <thead>
                  <tr>
                    <th>일자</th>
                    <th>내용</th>
                    <th>예상 입금</th>
                    <th>예상 출금</th>
                    <th>예상 잔액</th>
                  </tr>
                </thead>
                <tbody>
                  {upcoming.map((d) => (
                    <tr key={d.date}>
                      <td>
                        {d.date}
                        <small>
                          {new Date(`${d.date}T00:00:00Z`).toLocaleDateString(
                            "ko-KR",
                            { weekday: "long", timeZone: "UTC" },
                          )}
                        </small>
                      </td>
                      <td>{d.labels}</td>
                      <td>{d.deposit ? `+₩${money(d.deposit)}` : "—"}</td>
                      <td>{d.expense ? `−₩${money(d.expense)}` : "—"}</td>
                      <td>
                        <b>₩{money(d.balance)}</b>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!upcoming.length && (
                <div className="fn-empty">
                  <CalendarDays size={26} />
                  <strong>아직 등록된 입출금 일정이 없습니다</strong>
                  <p>
                    각 서비스의 설정 버튼에서 비용 결제일과 가정 입금일을
                    입력하세요.
                  </p>
                  <button
                    className="fn-button"
                    onClick={() => setEditor(rows[0])}
                  >
                    첫 결제 일정 입력 <ArrowRight size={14} />
                  </button>
                </div>
              )}
            </div>
            <p className="fn-note fn-cash-note">
              예상 입금은 오늘 이후 발생한 매출에 입력한 정산 대기일·매월
              입금일을 적용합니다. 기존 미수금, 주말·공휴일 지연, 환불·세금은
              미포함입니다. 결제일을 모르는 비용은 일정 합계에서 제외됩니다.
            </p>
          </section>
          <footer className="fn-footer">
            <span>
              잠깐구독 <b>FINANCE</b>
            </span>
            <span>
              {snapshot
                ? `최근 조회 ${new Date(snapshot.updatedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}`
                : "연결 대기"}{" "}
              · KST
            </span>
          </footer>
          <p className="fn-method">
            계산 기준: 기존 계약의 이용 기간과 조회된 일 요금을 사용한
            추정치입니다. BUTS의 현재 게시 가격은 기존 구매 시점 가격과 다를 수
            있습니다. 수수료 기본값 10%와 계정당 자리는 수정 가능한 가정입니다.
            비용은 매출 규모에 맞춰 새 계정/자리를 추가한다고 가정하며, 설정한
            유지 수량 아래로는 줄지 않습니다. 추가 계정·자리는 오늘 바로 첫
            비용을 지불한다고 가정합니다. 이미 결제한 비용은 기간 배분 원가에
            반영되지만 다음 결제일까지 현금 출금은 없습니다.
          </p>
        </main>
      </div>
      {editor && (
        <PlanEditor
          row={editor}
          plan={plans[editor.id] || starter(editor)}
          onClose={() => setEditor(null)}
          onSave={save}
        />
      )}
      <div className="fn-toast" role="status">
        {saved}
      </div>
    </div>
  );
}
