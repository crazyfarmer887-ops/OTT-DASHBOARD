export interface ExchangeRate {
  rate: number;
  quotedAt: string;
  fetchedAt: string;
  source: "Yahoo Finance";
  stale: boolean;
}
export function createExchangeRateService(
  fetcher: typeof fetch = (...args) => fetch(...args),
  now: () => number = Date.now,
) {
  let cached: ExchangeRate | null = null;
  let inFlight: Promise<ExchangeRate> | null = null;
  let checkedAt = -Infinity;
  return async function getRate(): Promise<ExchangeRate> {
    if (cached && now() - checkedAt < 60_000) return cached;
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        const response = await fetcher(
          "https://query1.finance.yahoo.com/v8/finance/chart/KRW=X?interval=1m&range=1d",
          {
            headers: { "User-Agent": "Mozilla/5.0" },
            signal: AbortSignal.timeout(10_000),
          },
        );
        if (!response.ok) throw new Error("환율 공급자 응답 오류");
        const body = await response.json();
        const meta = body?.chart?.result?.[0]?.meta;
        const rate = meta?.regularMarketPrice;
        const quoteMs = meta?.regularMarketTime * 1000;
        if (
          meta?.symbol !== "KRW=X" ||
          meta?.currency !== "KRW" ||
          typeof rate !== "number" ||
          !Number.isFinite(rate) ||
          rate < 100 ||
          rate > 10_000 ||
          !Number.isFinite(quoteMs) ||
          quoteMs > now() + 300_000 ||
          now() - quoteMs > 7 * 86400_000
        )
          throw new Error("유효한 최신 환율을 확인하지 못했습니다.");
        cached = {
          rate,
          quotedAt: new Date(quoteMs).toISOString(),
          fetchedAt: new Date(now()).toISOString(),
          source: "Yahoo Finance",
          stale: false,
        };
        checkedAt = now();
        return cached;
      } catch (error) {
        if (cached && now() - Date.parse(cached.quotedAt) < 7 * 86400_000) {
          cached = { ...cached, stale: true };
          checkedAt = now();
          return cached;
        }
        throw error;
      }
    })();
    try {
      return await inFlight;
    } finally {
      inFlight = null;
    }
  };
}
