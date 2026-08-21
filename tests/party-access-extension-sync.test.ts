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

  test('inherits an active ExtensionUsing cycle through the durable renewal job when Graytag drops previous metadata', () => {
    const existing = existingBuyerLink();
    const activeExtension = {
      ...paidExtension,
      previousProductUsid: undefined,
      dealStatus: 'ExtensionUsing',
      lenderDealStatusName: '사용중',
      productTypeString: '넷플릭스',
    };

    const result = syncPartyAccessStoreWithGraytagDeals({
      store: { [existing.tokenHash]: existing },
      deals: [{ ...oldDeal, productTypeString: '넷플릭스' }, activeExtension],
      renewalJobs: [{
        dealUsid: oldDeal.dealUsid,
        productUsid: oldDeal.productUsid,
        oldEnd: oldDeal.endDateTime,
        newEnd: '20261119T0000',
        status: 'message_skipped',
        registeredAt: '2026-08-01T00:00:00.000Z',
      }],
      now: '2026-08-22T00:00:00.000Z',
    });

    expect(result.changed).toBe(true);
    expect(result.store[existing.tokenHash]).toMatchObject({
      shareToken: existing.shareToken,
      revokedAt: null,
      member: {
        memberId: 'new-extension-deal-usid',
        status: 'ExtensionUsing',
        statusName: '사용중',
        endDateTime: '2026-11-19',
      },
    });
  });

  test('fails closed when the renewal job identity matches more than one active extension', () => {
    const existing = existingBuyerLink();
    const activeExtension = {
      ...paidExtension,
      previousProductUsid: undefined,
      dealStatus: 'ExtensionUsing',
      lenderDealStatusName: '사용중',
      productTypeString: '넷플릭스',
    };
    const renewalJobs = [{
      dealUsid: oldDeal.dealUsid,
      productUsid: oldDeal.productUsid,
      oldEnd: oldDeal.endDateTime,
      newEnd: '20261119T0000',
      status: 'messaged',
      registeredAt: '2026-08-01T00:00:00.000Z',
    }];

    const result = syncPartyAccessStoreWithGraytagDeals({
      store: { [existing.tokenHash]: existing },
      deals: [
        { ...oldDeal, productTypeString: '넷플릭스' },
        activeExtension,
        { ...activeExtension, dealUsid: 'ambiguous-extension-deal-usid' },
      ],
      renewalJobs,
      now: '2026-08-22T00:00:00.000Z',
    });

    expect(result.store[existing.tokenHash].member.memberId).toBe('old-deal-usid');
  });

  test('reopens a status-revoked old link when one paid active extension chain is proven', () => {
    const existing = { ...existingBuyerLink(), revokedAt: '2026-08-22T00:00:00.000Z' };
    const result = syncPartyAccessStoreWithGraytagDeals({
      store: { [existing.tokenHash]: existing },
      deals: [oldDeal, paidExtension],
      now: '2026-08-22T00:00:00.000Z',
    });

    expect(result.store[existing.tokenHash].member.memberId).toBe('new-extension-deal-usid');
    expect(result.store[existing.tokenHash].revokedAt).toBeNull();
  });

  test.each(['message_sending', 'message_error', 'message_unknown'])(
    'inherits a registered paid extension even when chat delivery is %s',
    (status) => {
      const existing = existingBuyerLink();
      const result = syncPartyAccessStoreWithGraytagDeals({
        store: { [existing.tokenHash]: existing },
        deals: [
          { ...oldDeal, productTypeString: '넷플릭스' },
          { ...paidExtension, previousProductUsid: undefined, dealStatus: 'ExtensionUsing', lenderDealStatusName: '사용중', productTypeString: '넷플릭스' },
        ],
        renewalJobs: [{
          dealUsid: oldDeal.dealUsid,
          productUsid: oldDeal.productUsid,
          oldEnd: oldDeal.endDateTime,
          newEnd: '20261119T0000',
          status,
          registeredAt: '2026-08-01T00:00:00.000Z',
        }],
      });

      expect(result.store[existing.tokenHash].member.memberId).toBe('new-extension-deal-usid');
      expect(result.store[existing.tokenHash].revokedAt).toBeNull();
    },
  );

  test('rejects impossible renewal calendar dates instead of normalizing them', () => {
    const existing = existingBuyerLink();
    const result = syncPartyAccessStoreWithGraytagDeals({
      store: { [existing.tokenHash]: existing },
      deals: [
        { ...oldDeal, productTypeString: '넷플릭스' },
        { ...paidExtension, previousProductUsid: undefined, dealStatus: 'ExtensionUsing', lenderDealStatusName: '사용중', productTypeString: '넷플릭스', endDateTime: '2026-03-02' },
      ],
      renewalJobs: [{
        dealUsid: oldDeal.dealUsid,
        productUsid: oldDeal.productUsid,
        oldEnd: oldDeal.endDateTime,
        newEnd: '20260230T0000',
        status: 'messaged',
        registeredAt: '2026-08-01T00:00:00.000Z',
      }],
    });

    expect(result.store[existing.tokenHash].member.memberId).toBe('old-deal-usid');
  });

  test('rejects a renewal job whose old end does not match the old deal', () => {
    const existing = existingBuyerLink();
    const result = syncPartyAccessStoreWithGraytagDeals({
      store: { [existing.tokenHash]: existing },
      deals: [
        { ...oldDeal, productTypeString: '넷플릭스' },
        { ...paidExtension, previousProductUsid: undefined, dealStatus: 'ExtensionUsing', lenderDealStatusName: '사용중', productTypeString: '넷플릭스' },
      ],
      renewalJobs: [{
        dealUsid: oldDeal.dealUsid,
        productUsid: oldDeal.productUsid,
        oldEnd: '2026-07-01',
        newEnd: '20261119T0000',
        status: 'messaged',
        registeredAt: '2026-08-01T00:00:00.000Z',
      }],
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
    expect(source.match(/renewalJobs: renewalJobsForPartyAccessSync\(\)/g)).toHaveLength(2);
    expect(source).toMatch(/function renewalJobsForPartyAccessSync\([\s\S]*catch[\s\S]*return \[\]/);
  });
});
