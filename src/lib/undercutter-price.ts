export interface UndercutterPricePlanInput {
  currentPrice: number;
  targetDaily: number;
  remainderDays: number;
  maxDecreaseOnce: number;
  minPrice: number;
}

export interface UndercutterPricePlan {
  targetPrice: number;
  nextPrice: number;
  delta: number;
  stepped: boolean;
  reason: string;
}

export interface UndercutterRivalDaily {
  name?: string;
  daily: number;
}

export interface UndercutterTargetDailyInput {
  floorDaily: number;
  myDaily?: number;
  rivals: UndercutterRivalDaily[];
}

export interface UndercutterTargetDailyPlan {
  targetDaily: number;
  canBeFirst: boolean;
  action: 'lead' | 'lead-above-floor' | 'floor-blocked' | 'no-rival';
  reason: string;
  rivalName?: string;
  rivalDaily?: number;
  blockingRivalName?: string;
  blockingRivalDaily?: number;
}

export function chooseUndercutterTargetDaily(input: UndercutterTargetDailyInput): UndercutterTargetDailyPlan {
  const floorDaily = Math.max(0, Math.floor(Number(input.floorDaily) || 0));
  const rivals = (input.rivals || [])
    .map((rival) => ({ name: rival.name || '', daily: Math.max(0, Math.floor(Number(rival.daily) || 0)) }))
    .filter((rival) => rival.daily > 0)
    .sort((a, b) => a.daily - b.daily);

  const affordable = rivals.find((rival) => rival.daily > floorDaily);
  const blocking = rivals.find((rival) => rival.daily <= floorDaily);

  if (affordable) {
    const targetDaily = Math.max(floorDaily, affordable.daily - 1);
    const blockedByCheaper = blocking && blocking.daily < targetDaily;
    return {
      targetDaily,
      canBeFirst: !blockedByCheaper,
      action: blockedByCheaper ? 'lead-above-floor' : 'lead',
      reason: blockedByCheaper
        ? `마지노선 아래 경쟁자(${blocking.name || '경쟁자'} ${blocking.daily}원)는 추월 불가, 다음 경쟁자 바로 아래 목표`
        : '최저 경쟁자 바로 아래 목표',
      rivalName: affordable.name,
      rivalDaily: affordable.daily,
      blockingRivalName: blocking?.name,
      blockingRivalDaily: blocking?.daily,
    };
  }

  if (blocking) {
    return {
      targetDaily: floorDaily,
      canBeFirst: false,
      action: 'floor-blocked',
      reason: `마지노선 아래 경쟁자(${blocking.name || '경쟁자'} ${blocking.daily}원) 때문에 1등 불가`,
      rivalName: blocking.name,
      rivalDaily: blocking.daily,
      blockingRivalName: blocking.name,
      blockingRivalDaily: blocking.daily,
    };
  }

  return {
    targetDaily: floorDaily,
    canBeFirst: true,
    action: 'no-rival',
    reason: '경쟁자 없음: 마지노선 유지',
  };
}

export function planUndercutterPriceChange(input: UndercutterPricePlanInput): UndercutterPricePlan {
  const currentPrice = Math.max(0, Math.floor(Number(input.currentPrice) || 0));
  const targetDaily = Math.max(0, Math.floor(Number(input.targetDaily) || 0));
  const remainderDays = Math.max(0, Math.floor(Number(input.remainderDays) || 0));
  const minPrice = Math.max(0, Math.floor(Number(input.minPrice) || 0));

  const targetPrice = Math.max(minPrice, targetDaily * remainderDays);
  const delta = targetPrice - currentPrice;

  return {
    targetPrice,
    nextPrice: targetPrice,
    delta,
    stepped: false,
    reason: delta === 0 ? '이미 목표 가격' : '목표 가격 한 번에 적용',
  };
}
