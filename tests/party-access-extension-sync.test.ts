import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
  createPartyAccessLinkRecord,
  syncPartyAccessStoreWithGraytagDeals,
} from '../src/lib/party-access';

function existingBuyerLink() {
  return createPartyAccessLinkRecord({
    token: 'existing-extension-buyer-token',
    now: '2026-05-20T00:00:00.000Z',
    serviceType: '넷플릭스',
    accountEmail: 'extension@example.com',
    profileName: '사과',
    member: {
      kind: 'graytag',
      memberId: 'old-deal-usid',
      memberName: '기존 구매자',
      status: 'UsingNearExpiration',
      statusName: '종료임박',
      startDateTime: '2026-05-20',
      endDateTime: '2026-08-21',
    },
  });
}

const oldDeal = {
  dealUsid: 'old-deal-usid',
  productUsid: 'old-product-usid',
  dealStatus: 'UsingNearExpiration',
  lenderDealStatusName: '종료임박',
  borrowerName: '기존 구매자',
  startDateTime: '2026-05-20',
  endDateTime: '2026-08-21',
};

const paidExtension = {
  dealUsid: 'new-extension-deal-usid',
  productUsid: 'new-extension-product-usid',
  previousProductUsid: 'old-product-usid',
  dealStatus: 'ExtensionDelivering',
  lenderDealStatusName: '결제완료',
  lenderDealStatusDesc: '기존 사용기간 종료 후 자동 연장됩니다.',
  borrowerName: '기존 구매자',
  startDateTime: '2026-08-22',
  endDateTime: '2026-11-19',
};

describe('paid Graytag extension party-access inheritance', () => {
  test('permanently migrates the existing share-token record to the paid ExtensionDelivering deal', () => {
    const existing = existingBuyerLink();

    const result = syncPartyAccessStoreWithGraytagDeals({
      store: { [existing.tokenHash]: existing },
      deals: [oldDeal, paidExtension],
      now: '2026-08-22T00:00:00.000Z',
    });
    const migrated = result.store[existing.tokenHash];

    expect(result.changed).toBe(true);
    expect(migrated.shareToken).toBe(existing.shareToken);
    expect(migrated.tokenHash).toBe(existing.tokenHash);
    expect(migrated.member).toMatchObject({
      memberId: 'new-extension-deal-usid',
      memberName: '기존 구매자',
      status: 'ExtensionDelivering',
      statusName: '결제완료',
      startDateTime: '2026-08-22',
      endDateTime: '2026-11-19',
    });
    expect(migrated.revokedAt).toBeNull();

    // Graytag later drops previousProductUsid when the extension becomes Using.
    // The durable memberId migration must keep the same buyer URL on the new cycle.
    const afterTransition = syncPartyAccessStoreWithGraytagDeals({
      store: result.store,
      deals: [{ ...paidExtension, previousProductUsid: undefined, dealStatus: 'ExtensionUsing', lenderDealStatusName: '사용중' }],
      now: '2026-08-23T00:00:00.000Z',
    }).store[existing.tokenHash];
    expect(afterTransition.shareToken).toBe(existing.shareToken);
    expect(afterTransition.member).toMatchObject({
      memberId: 'new-extension-deal-usid',
      status: 'ExtensionUsing',
      statusName: '사용중',
      endDateTime: '2026-11-19',
    });
  });

  test.each([
    ['waiting extension', { ...paidExtension, dealStatus: 'ExtensionWaiting', lenderDealStatusName: '연장 결제를 기다리고 있어요' }],
    ['cancelled extension', { ...paidExtension, dealStatus: 'CancelByLenderRequest', lenderDealStatusName: '연장취소' }],
    ['unpaid delivering extension', { ...paidExtension, lenderDealStatusName: '연장 결제를 기다리고 있어요' }],
  ])('does not inherit the existing link for %s', (_label, extensionDeal) => {
    const existing = existingBuyerLink();

    const result = syncPartyAccessStoreWithGraytagDeals({
      store: { [existing.tokenHash]: existing },
      deals: [oldDeal, extensionDeal],
      now: '2026-08-22T00:00:00.000Z',
    });

    expect(result.store[existing.tokenHash].member.memberId).toBe('old-deal-usid');
    expect(result.store[existing.tokenHash].member.endDateTime).toBe('2026-08-21');
  });

  test('fails closed when previousProductUsid does not identify exactly one old deal', () => {
    const existing = existingBuyerLink();

    const result = syncPartyAccessStoreWithGraytagDeals({
      store: { [existing.tokenHash]: existing },
      deals: [
        oldDeal,
        { ...oldDeal, dealUsid: 'ambiguous-old-deal-usid' },
        paidExtension,
      ],
      now: '2026-08-22T00:00:00.000Z',
    });

    expect(result.store[existing.tokenHash].member.memberId).toBe('old-deal-usid');
  });

  test('does not migrate tokenless account-management synthetic records', () => {
    const existing = existingBuyerLink();
    const synthetic = {
      ...existing,
      id: '넷플릭스:extension@example.com:graytag:old-deal-usid:management',
      shareToken: undefined,
    };

    const result = syncPartyAccessStoreWithGraytagDeals({
      store: { [synthetic.tokenHash]: synthetic },
      deals: [oldDeal, paidExtension],
      now: '2026-08-22T00:00:00.000Z',
    });

    expect(result.store[synthetic.tokenHash].member.memberId).toBe('old-deal-usid');
  });

  test('uses the same Graytag deal sync helper in refresh and account-management paths', () => {
    const source = readFileSync(new URL('../src/api/index.ts', import.meta.url), 'utf8');
    expect(source.match(/syncPartyAccessStoreWithGraytagDeals\(\{/g)).toHaveLength(2);
  });
});
