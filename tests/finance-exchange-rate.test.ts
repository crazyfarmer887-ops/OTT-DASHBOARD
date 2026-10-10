import { describe, it, expect, vi } from "vitest";
import { createExchangeRateService } from "../src/lib/finance/exchange-rate";
const now = Date.parse("2026-10-10T12:00:00Z");
const response = (rate = 1340.9, time = now - 86400_000) =>
  new Response(
    JSON.stringify({
      chart: {
        result: [
          {
            meta: {
              symbol: "KRW=X",
              currency: "KRW",
              regularMarketPrice: rate,
              regularMarketTime: time / 1000,
            },
          },
        ],
      },
    }),
  );
describe("latest USD/KRW quotes", () => {
  it("shares concurrent requests, caches for a minute and then refreshes", async () => {
    let time = now;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => response());
    const get = createExchangeRateService(fetcher, () => time);
    const [a, b] = await Promise.all([get(), get()]);
    expect(a.rate).toBe(1340.9);
    expect(b).toEqual(a);
    expect(a.quotedAt).toBe("2026-10-09T12:00:00.000Z");
    await get();
    expect(fetcher).toHaveBeenCalledTimes(1);
    time += 60_001;
    await get();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("identifies the last known quote when the provider fails", async () => {
    let time = now;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response())
      .mockRejectedValue(new Error("offline"));
    const get = createExchangeRateService(fetcher, () => time);
    await get();
    time += 60_001;
    const stale = await get();
    expect(stale.stale).toBe(true);
    expect(stale.rate).toBe(1340.9);
    expect(stale.fetchedAt).toBe(new Date(now).toISOString());
    time += 8 * 86400_000;
    await expect(get()).rejects.toThrow();
  });
  it.each([0, -1, 50000])("rejects implausible quote %s", async (rate) => {
    const get = createExchangeRateService(
      vi.fn<typeof fetch>().mockResolvedValue(response(rate)),
      () => now,
    );
    await expect(get()).rejects.toThrow();
  });
  it("rejects future and very old quotes rather than updating costs", async () => {
    for (const time of [now + 3600_000, now - 8 * 86400_000]) {
      const get = createExchangeRateService(
        vi.fn<typeof fetch>().mockResolvedValue(response(1340.9, time)),
        () => now,
      );
      await expect(get()).rejects.toThrow();
    }
  });
});
