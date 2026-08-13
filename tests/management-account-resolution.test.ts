import { describe, expect, test } from 'vitest';
import { GRAYTAG_ACCESS_NOTICE_ID } from '../src/lib/graytag-fill';
import { resolveManagementAccount } from '../src/lib/management-account-resolution';
import type { PartyAccessDeliverySnapshot } from '../src/lib/party-access';

function snapshot(accountEmail: string, memberId: string): PartyAccessDeliverySnapshot {
  return {
    serviceType: '넷플릭스',
    accountEmail,
    memberKind: 'graytag',
    memberId,
    memberName: memberId,
    password: `${memberId}-pw`,
    pin: '123456',
    emailAccessUrl: '',
    profileName: memberId,
    deliveredAt: '2026-07-24T00:00:00.000Z',
    revokedAt: null,
  };
}

const base = {
  serviceType: '넷플릭스',
  rawKeepAcct: GRAYTAG_ACCESS_NOTICE_ID,
  dealStatus: 'Using',
  dealUsid: 'deal-1',
  productUsid: 'product-1',
  placeholderSnapshotByDealUsid: new Map<string, PartyAccessDeliverySnapshot>(),
  onSaleSnapshotByProductUsid: new Map<string, PartyAccessDeliverySnapshot>(),
};

describe('management account resolution', () => {
  test('resolves a current placeholder member in deal, exact-product, direct-listing, then profile-assignment order', () => {
    const deal = snapshot('deal@example.com', 'deal-1');
    const product = snapshot('product@example.com', 'fill:product-1');
    const direct = snapshot('direct@example.com', 'deal-1');

    expect(resolveManagementAccount({
      ...base,
      placeholderSnapshotByDealUsid: new Map([['deal-1', deal]]),
      onSaleSnapshotByProductUsid: new Map([['product-1', product]]),
      directListingSnapshot: direct,
      assignmentAccountEmail: 'profile@example.com',
    })).toMatchObject({ accountEmail: 'deal@example.com', snapshot: deal });

    expect(resolveManagementAccount({
      ...base,
      onSaleSnapshotByProductUsid: new Map([['product-1', product], ['other-product', snapshot('wrong@example.com', 'fill:other-product')]]),
      directListingSnapshot: direct,
      assignmentAccountEmail: 'profile@example.com',
    })).toMatchObject({ accountEmail: 'product@example.com', snapshot: product });

    expect(resolveManagementAccount({ ...base, directListingSnapshot: direct, assignmentAccountEmail: 'profile@example.com' }))
      .toMatchObject({ accountEmail: 'direct@example.com', snapshot: direct });
    expect(resolveManagementAccount({ ...base, assignmentAccountEmail: 'profile@example.com' }))
      .toEqual({ accountEmail: 'profile@example.com' });
    expect(resolveManagementAccount(base)).toEqual({ accountEmail: '(직접전달)' });
  });

  test('never assigns a service-wide on-sale snapshot to 43 distinct Using placeholder deals, while an OnSale listing may use it', () => {
    const serviceWide = snapshot('only-sale@example.com', 'fill:sale-product');
    const usingResults = Array.from({ length: 43 }, (_, index) => resolveManagementAccount({
      ...base,
      dealUsid: `using-${index + 1}`,
      productUsid: `using-product-${index + 1}`,
      uniqueOnSaleSnapshotForService: serviceWide,
    }));

    expect(usingResults).toHaveLength(43);
    expect(usingResults.every((result) => result.accountEmail === '(직접전달)')).toBe(true);
    const inferredUsingCount = usingResults.reduce(
      (count, result) => count + Number(result.accountEmail === serviceWide.accountEmail),
      0,
    );
    expect(inferredUsingCount).toBe(0);

    expect(resolveManagementAccount({
      ...base,
      dealStatus: 'OnSale',
      dealUsid: 'sale-deal',
      productUsid: 'sale-product-without-exact-snapshot',
      uniqueOnSaleSnapshotForService: serviceWide,
    })).toMatchObject({ accountEmail: 'only-sale@example.com', snapshot: serviceWide });
  });

  test('preserves direct non-placeholder account credentials without applying inferred snapshots', () => {
    expect(resolveManagementAccount({
      ...base,
      rawKeepAcct: ' Direct.Login@Example.com ',
      placeholderSnapshotByDealUsid: new Map([['deal-1', snapshot('inferred@example.com', 'deal-1')]]),
      uniqueOnSaleSnapshotForService: snapshot('sale@example.com', 'fill:sale'),
      assignmentAccountEmail: 'profile@example.com',
    })).toEqual({ accountEmail: 'Direct.Login@Example.com' });
  });
});
