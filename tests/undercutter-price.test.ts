import { describe, expect, test } from 'vitest';
import { chooseUndercutterTargetDaily, planUndercutterPriceChange } from '../src/lib/undercutter-price';

describe('planUndercutterPriceChange', () => {
  test('drops long 티빙 products to the final target in one run', () => {
    const plan = planUndercutterPriceChange({
      currentPrice: 16206,
      targetDaily: 197,
      remainderDays: 72,
      maxDecreaseOnce: 1000,
      minPrice: 1000,
    });

    expect(plan.targetPrice).toBe(14184);
    expect(plan.nextPrice).toBe(14184);
    expect(plan.stepped).toBe(false);
    expect(plan.delta).toBe(-2022);
  });

  test('uses the target price directly when the target raises the total price', () => {
    const plan = planUndercutterPriceChange({
      currentPrice: 4250,
      targetDaily: 197,
      remainderDays: 24,
      maxDecreaseOnce: 1000,
      minPrice: 1000,
    });

    expect(plan.targetPrice).toBe(4728);
    expect(plan.nextPrice).toBe(4728);
    expect(plan.stepped).toBe(false);
    expect(plan.delta).toBe(478);
  });
});

describe('chooseUndercutterTargetDaily', () => {
  test('uses one won below the cheapest rival when it stays above the typed floor', () => {
    const plan = chooseUndercutterTargetDaily({
      floorDaily: 200,
      myDaily: 250,
      rivals: [{ name: '현재1등', daily: 211 }, { name: '2등', daily: 231 }],
    });

    expect(plan.targetDaily).toBe(210);
    expect(plan.action).toBe('lead');
    expect(plan.rivalDaily).toBe(211);
  });

  test('targets just below the next affordable rival when the cheapest rival is below the typed floor', () => {
    const plan = chooseUndercutterTargetDaily({
      floorDaily: 200,
      myDaily: 250,
      rivals: [{ name: '하한선아래', daily: 199 }, { name: '2등', daily: 231 }],
    });

    expect(plan.targetDaily).toBe(230);
    expect(plan.action).toBe('lead-above-floor');
    expect(plan.rivalDaily).toBe(231);
    expect(plan.blockingRivalDaily).toBe(199);
  });

  test('keeps the typed floor and reports impossible first place when every rival is below the floor', () => {
    const plan = chooseUndercutterTargetDaily({
      floorDaily: 200,
      myDaily: 210,
      rivals: [{ name: '하한선아래', daily: 199 }],
    });

    expect(plan.targetDaily).toBe(200);
    expect(plan.action).toBe('floor-blocked');
    expect(plan.canBeFirst).toBe(false);
  });
});
