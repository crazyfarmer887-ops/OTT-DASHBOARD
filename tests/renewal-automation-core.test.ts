import { describe, expect, test } from 'vitest';
import {
  buildRenewalPreviewRows,
  buildExtensionProductModel,
  buildRenewalMessage,
  isNeutralRenewalMessage,
  normalizeRenewalCandidate,
  parseGraytagEndDate,
  renewalIdempotencyKey,
  serviceCategoryFor,
  sortRenewalRows,
} from '../src/renewal/core';

const valid = (patch: Record<string, unknown> = {}) => ({
  dealStatus: 'UsingNearExpiration',
  extensionStatus: null,
  extensionProductExist: false,
  productTypeCode: 'N',
  productTypeString: '넷플릭스',
  endDateTime: '26. 07. 28',
  dealDays: 30,
  purePrice: 12000,
  productName: '넷플릭스 프리미엄 30일',
  sellingGuide: '안내를 지켜 주세요',
  chatRoomUuid: 'room-1',
  dealUsid: 'deal-1',
  productUsid: 'product-1',
  ...patch,
});

describe('renewal candidate core', () => {
  test('parses a strict Graytag date and adds contract days without timezone drift', () => {
    const parsed = parseGraytagEndDate('26. 07. 28');
    expect(parsed?.canonical).toBe('20260728T0000');
    expect(parsed?.addDays(30)).toBe('20260827T0000');
    expect(parseGraytagEndDate('26. 02. 30')).toBeNull();
    expect(parseGraytagEndDate('2026-07-28')).toBeNull();
  });

  test('maps only supported Korean service categories', () => {
    expect(serviceCategoryFor('디즈니플러스')).toBe('disney');
    expect(serviceCategoryFor('넷플릭스')).toBe('Netflix');
    expect(serviceCategoryFor('왓챠플레이')).toBe('WatchaPlay');
    expect(serviceCategoryFor('웨이브')).toBe('wavve');
    expect(serviceCategoryFor('티빙')).toBe('tving');
    expect(serviceCategoryFor('유튜브')).toBeNull();
  });

  test('normalizes eligible rows and creates a stable key from deal plus old end', () => {
    const candidate = normalizeRenewalCandidate(valid());
    expect(candidate).not.toBeNull();
    expect(candidate?.oldEnd).toBe('20260728T0000');
    expect(candidate?.idempotencyKey).toBe(renewalIdempotencyKey('deal-1', '20260728T0000'));
    expect(normalizeRenewalCandidate(valid({ productName: '  제목  ', sellingGuide: '  안내  ' }))?.productName).toBe('제목');
    expect(normalizeRenewalCandidate(valid({ dealStatus: 'ExtensionUsingNearExpiration' }))).not.toBeNull();
  });

  test.each([
    ['wrong status', { dealStatus: 'Using' }],
    ['missing deal', { dealUsid: '' }],
    ['missing product', { productUsid: '' }],
    ['missing chat', { chatRoomUuid: '' }],
    ['D product', { productTypeCode: 'D' }],
    ['extension status', { extensionStatus: 'Waiting' }],
    ['extension product', { extensionProductExist: true }],
    ['bad date', { endDateTime: '26. 02. 30' }],
    ['bad days', { dealDays: 0 }],
    ['fractional days', { dealDays: 30.5 }],
    ['bad price', { purePrice: 0 }],
    ['bad name', { productName: ' ' }],
    ['bad guide', { sellingGuide: null }],
    ['unsupported category', { productTypeString: '유튜브' }],
  ])('rejects %s', (_label, patch) => {
    expect(normalizeRenewalCandidate(valid(patch))).toBeNull();
  });

  test('builds the exact Extended multipart productModel payload data', () => {
    const candidate = normalizeRenewalCandidate(valid())!;
    expect(buildExtensionProductModel(candidate)).toEqual({
      name: '넷플릭스 프리미엄 30일',
      sellingGuide: '안내를 지켜 주세요',
      endDate: '20260827T0000',
      priceType: 'Extended',
      tempProductCategory: 'Netflix',
      dealUsid: 'deal-1',
      dealEndDate: '20260728T0000',
      price: 12000,
    });
  });
});

describe('ethical renewal message', () => {
  test('uses the approved exact Korean copy', () => {
    expect(buildRenewalMessage()).toBe(
      '연장 상품이 등록되었습니다.\n' +
      '채팅에 표시된 연장 상품을 통해 연장을 신청하실 수 있습니다.\n' +
      '서비스 이용 경험을 후기로 남겨주시면 감사의 뜻으로 CU 상품권 1,000원권을 드립니다. 별점과 후기 내용은 혜택 제공 여부에 영향을 주지 않으며, 거래당 1회 제공됩니다.\n' +
      '후기 작성 후 이 채팅으로 알려주세요.',
    );
  });

  test.each(['긍정', '별 5개', '별점 5', '5점', '좋은 후기'])('never contains forbidden review pressure: %s', (phrase) => {
    expect(buildRenewalMessage()).not.toContain(phrase);
  });

  test.each(['긍정적인 리뷰', '좋은 리뷰', '별점 5점'])('rejects a custom template containing forbidden pressure: %s', (phrase) => {
    expect(isNeutralRenewalMessage(`솔직한 후기 부탁드립니다. ${phrase}`)).toBe(false);
  });
  test('accepts disclosed neutral copy where rating and content do not matter', () => {
    expect(isNeutralRenewalMessage(buildRenewalMessage())).toBe(true);
  });
});

describe('admin renewal preview rows', () => {
  test('returns only allowlisted display fields with stable identities, masks, and current states', () => {
    const [preview] = buildRenewalPreviewRows([
      valid({ borrowerName: '홍길동', accountEmail: 'owner@example.com' }),
    ], [{
      id: 'job-1', idempotencyKey: renewalIdempotencyKey('deal-1', '20260728T0000'),
      status: 'messaged', couponStatus: 'awaiting_review', registeredAt: '2026-07-24T12:00:00.000Z',
    } as any]);
    expect(preview).toEqual(expect.objectContaining({
      idempotencyKey: renewalIdempotencyKey('deal-1', '20260728T0000'), dealUsid: 'deal-1', productUsid: 'product-1',
      service: '넷플릭스', category: 'Netflix', buyer: '홍*동', account: 'ow***@example.com',
      oldEnd: '20260728T0000', newEnd: '20260827T0000', dealDays: 30, price: 12000,
      eligible: false, reason: 'already_processed', jobStatus: 'messaged', registrationStatus: 'registered',
      messageStatus: 'sent', couponStatus: 'awaiting_review',
    }));
    expect(preview).not.toHaveProperty('chatRoomUuid');
    expect(preview).not.toHaveProperty('sellingGuide');
  });

  test('sorts by fixed category order then old end ascending without mutating input', () => {
    const rows = [
      { category: 'disney', oldEnd: '20260720T0000', idempotencyKey: 'd' },
      { category: 'Netflix', oldEnd: '20260730T0000', idempotencyKey: 'n2' },
      { category: 'tving', oldEnd: '20260725T0000', idempotencyKey: 't' },
      { category: 'Netflix', oldEnd: '20260720T0000', idempotencyKey: 'n1' },
    ] as any;
    expect(sortRenewalRows(rows).map((row) => row.idempotencyKey)).toEqual(['n1', 'n2', 't', 'd']);
    expect(rows.map((row: any) => row.idempotencyKey)).toEqual(['d', 'n2', 't', 'n1']);
  });
});
