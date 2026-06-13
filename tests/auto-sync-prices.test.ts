import { describe, expect, test } from 'vitest';
import { planAutoSyncPrice } from '../src/lib/auto-sync-prices';

describe('planAutoSyncPrice', () => {
  test('uses Graytag pricePerDay when it is present', () => {
    const plan = planAutoSyncPrice({
      price: '10,275원',
      pricePerDay: '139원',
      remainderDays: 74,
    });

    expect(plan.action).toBe('update');
    expect(plan.currentPrice).toBe(10275);
    expect(plan.correctPrice).toBe(10286);
    expect(plan.dailyRate).toBe(139);
    expect(plan.dailyRateSource).toBe('graytag');
  });

  test('falls back to current total divided by remaining days when pricePerDay is missing', () => {
    const plan = planAutoSyncPrice({
      price: '10,064원',
      pricePerDay: '',
      remainderDays: 74,
    });

    expect(plan.action).toBe('skip');
    expect(plan.reason).toBe('이미 일치');
    expect(plan.currentPrice).toBe(10064);
    expect(plan.correctPrice).toBe(10064);
    expect(plan.dailyRate).toBe(136);
    expect(plan.dailyRateSource).toBe('derived-from-total');
  });

  test('plans an update when derived daily price exposes stale total price', () => {
    const plan = planAutoSyncPrice({
      price: '10,200원',
      pricePerDay: '',
      remainderDays: 74,
    });

    expect(plan.action).toBe('update');
    expect(plan.currentPrice).toBe(10200);
    expect(plan.correctPrice).toBe(10212);
    expect(plan.dailyRate).toBe(138);
    expect(plan.dailyRateSource).toBe('derived-from-total');
  });

  test('skips safely when neither daily nor derived price can be computed', () => {
    const plan = planAutoSyncPrice({
      price: '0원',
      pricePerDay: '',
      remainderDays: 74,
    });

    expect(plan.action).toBe('skip');
    expect(plan.reason).toBe('일당 정보 없음');
  });
});
