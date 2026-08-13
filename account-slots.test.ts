import { describe, expect, test } from 'vitest';
import { buildAccountSlotStates, calculateAccountVacancy, canAccountReceiveAutoFill, dedupeRecruitingProducts, mergeRecruitingProducts } from './src/web/lib/account-slots';

describe('account slot UI helpers', () => {
  test('renders recruiting posts as gray slot state after existing and manual users', () => {
    expect(buildAccountSlotStates({
      totalSlots: 6,
      usingCount: 2,
      manualCount: 0,
      recruitingCount: 4,
    })).toEqual(['using', 'using', 'recruiting', 'recruiting', 'recruiting', 'recruiting']);
  });

  test('does not double count duplicate recruiting productUsid values', () => {
    const products = dedupeRecruitingProducts([
      { productUsid: 'P1', price: '1000원' },
      { productUsid: 'P1', price: '1000원' },
      { productUsid: 'P2', price: '1200원' },
    ]);

    expect(products.map(p => p.productUsid)).toEqual(['P1', 'P2']);
  });

  test('merges newly registered recruiting posts without duplicating existing posts', () => {
    const merged = mergeRecruitingProducts(
      [{ productUsid: 'P1', price: '1000원' }],
      [{ productUsid: 'P1', price: '1000원' }, { productUsid: 'P2', price: '1200원' }]
    );

    expect(merged.map(p => p.productUsid)).toEqual(['P1', 'P2']);
  });

  test('category fill vacancy counts only real unoccupied account slots', () => {
    const now = new Date('2026-05-19T12:00:00+09:00');
    const disneyFull = calculateAccountVacancy({
      serviceType: '디즈니플러스',
      now,
      members: Array.from({ length: 6 }, (_, i) => ({ dealUsid: `U${i}`, status: 'Using', endDateTime: '20260630T2359' })),
      recruitingProducts: [
        { productUsid: 'STALE', productType: '디즈니플러스', endDateTime: '20260101T2359', remainderDays: -1 },
      ],
    });
    const disneyOneOpenButAlreadyListed = calculateAccountVacancy({
      serviceType: '디즈니플러스',
      now,
      members: Array.from({ length: 5 }, (_, i) => ({ dealUsid: `U2-${i}`, status: 'Using', endDateTime: '20260630T2359' })),
      recruitingProducts: [
        { productUsid: 'LIVE', productType: '디즈니플러스', endDateTime: '20260630T2359', remainderDays: 42 },
        { productUsid: 'LIVE', productType: '디즈니플러스', endDateTime: '20260630T2359', remainderDays: 42 },
      ],
    });
    const disneyOneOpen = calculateAccountVacancy({
      serviceType: '디즈니플러스',
      now,
      members: Array.from({ length: 5 }, (_, i) => ({ dealUsid: `U3-${i}`, status: 'Using', endDateTime: '20260630T2359' })),
      recruitingProducts: [
        { productUsid: 'WRONG_SERVICE', productType: '티빙', endDateTime: '20260630T2359', remainderDays: 42 },
      ],
    });

    expect(disneyFull.unfilled).toBe(0);
    expect(disneyOneOpenButAlreadyListed.unfilled).toBe(0);
    expect(disneyOneOpen.unfilled).toBe(1);
    expect([disneyFull, disneyOneOpenButAlreadyListed, disneyOneOpen].reduce((sum, vi) => sum + vi.unfilled, 0)).toBe(1);
  });

  test('does not double count OnSale members already present in the account member list', () => {
    const vi = calculateAccountVacancy({
      serviceType: '디즈니플러스',
      now: new Date('2026-05-19T12:00:00+09:00'),
      members: [
        ...Array.from({ length: 5 }, (_, i) => ({ dealUsid: `U${i}`, status: 'Using', endDateTime: '20260630T2359' })),
        { dealUsid: 'D1', productUsid: 'P1', status: 'OnSale', statusName: '판매 중', endDateTime: '20260630T2359' },
      ],
      recruitingProducts: [{ productUsid: 'P1', productType: '디즈니플러스', endDateTime: '20260630T2359' }],
    });

    expect(vi.vacancy).toBe(1);
    expect(vi.recruiting).toBe(1);
    expect(vi.unfilled).toBe(0);
  });

  test('bulk category fill excludes empty/non-party placeholder accounts', () => {
    const now = new Date('2026-05-19T12:00:00+09:00');
    const emptyPaidGenerated = calculateAccountVacancy({ serviceType: '디즈니플러스', members: [], maxSlots: 6, now });
    const directDelivery = calculateAccountVacancy({
      serviceType: '디즈니플러스',
      members: Array.from({ length: 1 }, (_, i) => ({ dealUsid: `U${i}`, status: 'Using', endDateTime: '20260630T2359' })),
      maxSlots: 6,
      now,
    });
    const realOpenParty = calculateAccountVacancy({
      serviceType: '디즈니플러스',
      members: Array.from({ length: 5 }, (_, i) => ({ dealUsid: `U${i}`, status: 'Using', endDateTime: '20260630T2359' })),
      maxSlots: 6,
      now,
    });

    expect(canAccountReceiveAutoFill({ email: 'empty@example.com', vacancy: emptyPaidGenerated })).toBe(false);
    expect(canAccountReceiveAutoFill({ email: '(직접전달)', vacancy: directDelivery })).toBe(false);
    expect(canAccountReceiveAutoFill({ email: 'paid-generated@example.com', vacancy: emptyPaidGenerated, generatedPaymentStatus: 'paid' })).toBe(true);
    expect(canAccountReceiveAutoFill({ email: 'real@example.com', vacancy: realOpenParty })).toBe(true);
  });
});
