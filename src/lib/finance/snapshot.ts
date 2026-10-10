import { dayCount, validDate, type FinanceRow } from "./model";
import { ottDate } from "../gbuts-ott";
export function graytagFinanceRows(data: any, today: string): FinanceRow[] {
  const contracts: FinanceRow["contracts"] = [];
  const seen = new Set<string>();
  for (const service of data.services || []) {
    if (!/유튜브|youtube/i.test(service.serviceType)) continue;
    for (const account of service.accounts || [])
      for (const member of account.members || []) {
        if (
          !["Using", "UsingNearExpiration"].includes(member.status) ||
          seen.has(member.dealUsid)
        )
          continue;
        seen.add(member.dealUsid);
        const start = ottDate(member.startDateTime),
          end = ottDate(member.endDateTime);
        const price = Number(member.purePrice);
        if (
          !validDate(start) ||
          !validDate(end) ||
          start > today ||
          end < today ||
          !Number.isFinite(price) ||
          price <= 0 ||
          end < start
        )
          continue;
        contracts.push({
          start,
          end,
          dailyPrice: price / dayCount(start, end),
        });
      }
  }
  return [
    {
      id: "graytag:youtube",
      channel: "graytag",
      service: "유튜브 프리미엄",
      contracts,
      source: "live",
    },
  ];
}
export function butsFinanceRows(
  posts: any[],
  members: any[][],
  today: string,
): FinanceRow[] {
  const names: Record<number, string> = {
    5: "넷플릭스",
    6: "디즈니플러스",
    8: "티빙",
    10: "웨이브",
    7: "유튜브 프리미엄",
    20: "스포티파이",
  };
  const rows = new Map<string, FinanceRow>();
  const seen = new Set<string>();
  posts.forEach((post, index) => {
    const service = names[post.category1.seq];
    if (!service || post.status === "REFUNDED") return;
    const id = `buts:${post.category1.seq}`;
    const row = rows.get(id) || {
      id,
      channel: "buts" as const,
      service,
      contracts: [],
      source: "live" as const,
    };
    rows.set(id, row);
    for (const member of members[index] || []) {
      const key = `${post.seq}:${member.seq}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const start = ottDate(member.createdAt),
        end = ottDate(member.subscriptionEndsAt);
      if (
        member.status !== "APPLY" ||
        (member.cancelStatus && member.cancelStatus !== "REFUND_REJECTED") ||
        !validDate(start) ||
        !validDate(end) ||
        start > today ||
        end < today
      )
        continue;
      const dailyPrice = post.priceType === "DAY" ? Number(post.price) : NaN;
      if (!Number.isFinite(dailyPrice) || dailyPrice <= 0)
        throw new Error("일 요금으로 확인되지 않은 벗츠 계약이 있습니다.");
      row.contracts.push({ start, end, dailyPrice });
    }
  });
  return [...rows.values()];
}
