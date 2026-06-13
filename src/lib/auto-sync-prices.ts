export type AutoSyncPriceInput = {
  price?: string | number | null;
  pricePerDay?: string | number | null;
  remainderDays?: number | string | null;
  minPrice?: number;
};

export type AutoSyncPricePlan = {
  action: 'update' | 'skip';
  reason?: string;
  currentPrice: number;
  correctPrice: number;
  dailyRate: number;
  dailyRateSource: 'graytag' | 'derived-from-total' | 'none';
  remainderDays: number;
};

function parseWon(value: string | number | null | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.floor(value) : 0;
  const parsed = parseInt(String(value ?? '').replace(/[^0-9]/g, '') || '0', 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function planAutoSyncPrice(input: AutoSyncPriceInput): AutoSyncPricePlan {
  const minPrice = Number(input.minPrice ?? 1000);
  const remainderDays = Math.max(0, Math.floor(Number(input.remainderDays) || 0));
  const currentPrice = parseWon(input.price);

  if (remainderDays <= 0) {
    return {
      action: 'skip',
      reason: '잔여일 0',
      currentPrice,
      correctPrice: 0,
      dailyRate: 0,
      dailyRateSource: 'none',
      remainderDays,
    };
  }

  const graytagDailyRate = parseWon(input.pricePerDay);
  const derivedDailyRate = currentPrice > 0 ? Math.ceil(currentPrice / remainderDays) : 0;
  const dailyRate = graytagDailyRate > 0 ? graytagDailyRate : derivedDailyRate;
  const dailyRateSource = graytagDailyRate > 0 ? 'graytag' : derivedDailyRate > 0 ? 'derived-from-total' : 'none';

  if (dailyRate <= 0) {
    return {
      action: 'skip',
      reason: '일당 정보 없음',
      currentPrice,
      correctPrice: 0,
      dailyRate: 0,
      dailyRateSource,
      remainderDays,
    };
  }

  const correctPrice = dailyRate * remainderDays;

  if (correctPrice === currentPrice) {
    return {
      action: 'skip',
      reason: '이미 일치',
      currentPrice,
      correctPrice,
      dailyRate,
      dailyRateSource,
      remainderDays,
    };
  }

  if (correctPrice < minPrice) {
    return {
      action: 'skip',
      reason: '최소가격 미만',
      currentPrice,
      correctPrice,
      dailyRate,
      dailyRateSource,
      remainderDays,
    };
  }

  return {
    action: 'update',
    currentPrice,
    correctPrice,
    dailyRate,
    dailyRateSource,
    remainderDays,
  };
}
