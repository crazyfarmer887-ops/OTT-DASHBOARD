import { describe, expect, test } from 'vitest';
import { buildYouTubeSharingNoKeepProductModel } from '../src/lib/graytag-fill';

describe('YouTube SharingNoKeep product model', () => {
  test('builds the exact normalized server-shareable model without credential or access fields', () => {
    const model = buildYouTubeSharingNoKeepProductModel({
      endDate: ' 20260831T2359 ',
      price: 7900,
      name: ' 유튜브 프리미엄 초대 ',
      sellingGuide: ' 초대 링크 안내를 확인해 주세요. ',
    });

    expect(model).toEqual({
      tempProductCategory: 'youtube',
      endDate: '20260831T2359',
      priceType: 'Normal',
      price: '7900',
      name: '유튜브 프리미엄 초대',
      sellingGuide: '초대 링크 안내를 확인해 주세요.',
    });
    expect(Object.keys(model).sort()).toEqual([
      'endDate',
      'name',
      'price',
      'priceType',
      'sellingGuide',
      'tempProductCategory',
    ]);
  });

  test.each([
    ['', 'missing'],
    ['2026-08-31', 'wrong format'],
    ['20260230T2359', 'impossible calendar date'],
    ['20260831T2460', 'impossible time'],
  ])('rejects an invalid endDate: %s (%s)', (endDate) => {
    expect(() => buildYouTubeSharingNoKeepProductModel({
      endDate,
      price: 7900,
      name: '유튜브 프리미엄 초대',
      sellingGuide: '초대 링크 안내',
    })).toThrow(/endDate/);
  });

  test('accepts a valid leap-day endDate boundary', () => {
    expect(buildYouTubeSharingNoKeepProductModel({
      endDate: '20280229T0000',
      price: 1,
      name: '유튜브',
      sellingGuide: '안내',
    }).endDate).toBe('20280229T0000');
  });

  test.each([
    0,
    -1,
    0.1,
    5e-324,
    1e21,
    Number.MAX_SAFE_INTEGER + 1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])('rejects a price that is not a positive safe integer: %s', (price) => {
    expect(() => buildYouTubeSharingNoKeepProductModel({
      endDate: '20260831T2359',
      price,
      name: '유튜브',
      sellingGuide: '안내',
    })).toThrow(TypeError);
  });

  test.each([
    [1, '1'],
    [Number.MAX_SAFE_INTEGER, '9007199254740991'],
  ])('accepts a positive safe-integer price boundary: %s', (price, expected) => {
    expect(buildYouTubeSharingNoKeepProductModel({
      endDate: '20260831T2359',
      price,
      name: '유튜브',
      sellingGuide: '안내',
    }).price).toBe(expected);
  });

  test.each([undefined, '', '   '])('rejects a missing or blank name: %s', (name) => {
    expect(() => buildYouTubeSharingNoKeepProductModel({
      endDate: '20260831T2359',
      price: 7900,
      name: name as string,
      sellingGuide: '안내',
    })).toThrow(/name/);
  });

  test.each([undefined, '', '   '])('rejects a missing or blank sellingGuide: %s', (sellingGuide) => {
    expect(() => buildYouTubeSharingNoKeepProductModel({
      endDate: '20260831T2359',
      price: 7900,
      name: '유튜브',
      sellingGuide: sellingGuide as string,
    })).toThrow(/sellingGuide/);
  });

  test('accepts a sellingGuide of exactly 300 characters', () => {
    const sellingGuide = '가'.repeat(300);
    expect(buildYouTubeSharingNoKeepProductModel({
      endDate: '20260831T2359',
      price: 7900,
      name: '유튜브',
      sellingGuide,
    }).sellingGuide).toBe(sellingGuide);
  });

  test('rejects a sellingGuide longer than 300 characters after trimming', () => {
    expect(() => buildYouTubeSharingNoKeepProductModel({
      endDate: '20260831T2359',
      price: 7900,
      name: '유튜브',
      sellingGuide: ` ${'가'.repeat(301)} `,
    })).toThrow(/sellingGuide.*300/);
  });
});
