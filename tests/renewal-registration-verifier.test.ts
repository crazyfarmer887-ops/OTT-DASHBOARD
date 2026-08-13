import { describe, expect, test } from 'vitest';
import { buildRegistrationEvidenceSnapshot } from '../src/renewal/graytag-registration-verifier';

const job = {
  id: 'job-1', dealUsid: 'deal-exact', productUsid: 'old-product', newEnd: '20260827T0000',
} as any;

describe('Graytag renewal registration evidence', () => {
  test('requires an exact fresh near-expiration deal and exact seller OnSale linked deal, Extended price type, target end and product id', () => {
    const snapshot = buildRegistrationEvidenceSnapshot(job, {
      capturedAt: '2026-07-24T12:00:00.000Z',
      nearExpirationDeals: [
        { dealUsid: 'deal-exact-other', dealStatus: 'UsingNearExpiration', extensionProductExist: true },
        { dealUsid: 'deal-exact', dealStatus: 'UsingNearExpiration', extensionProductExist: false, extensionStatus: null },
      ],
      sellerOnSaleProducts: [
        { dealUsid: 'deal-exact-other', dealStatus: 'OnSale', priceType: 'Extended', endDateTime: '20260827T0000', productUsid: 'loose' },
        { dealUsid: 'deal-exact', dealStatus: 'OnSale', priceType: 'Normal', endDateTime: '20260827T0000', productUsid: 'wrong-type' },
      ],
      oldDealAuthoritative: true,
      sellerListingAuthoritative: true,
    });
    expect(snapshot.oldDeal).toMatchObject({ present: true, extensionProductExist: false });
    expect(snapshot.extensionListing).toMatchObject({ present: true, linkedDeal: true, priceType: 'Normal', targetNewEnd: true });
    expect(snapshot.extensionListing.productIdPresent).toBe(true);
  });

  test('accepts only the exact linked seller OnSale Extended listing with canonical target newEnd', () => {
    const snapshot = buildRegistrationEvidenceSnapshot(job, {
      capturedAt: '2026-07-24T12:00:00.000Z',
      nearExpirationDeals: [{ dealUsid: 'deal-exact', dealStatus: 'UsingNearExpiration', extensionProductExist: true, extensionStatus: 'Registered' }],
      sellerOnSaleProducts: [{
        dealUsid: 'deal-exact', dealStatus: 'OnSale', priceType: 'Extended', endDateTime: '26. 08. 27', productUsid: 'extension-product',
      }],
      oldDealAuthoritative: true,
      sellerListingAuthoritative: true,
    });
    expect(snapshot.extensionListing).toEqual({
      authoritative: true, present: true, priceType: 'Extended', linkedDeal: true,
      targetNewEnd: true, productIdPresent: true,
    });
  });

  test('accepts previousProductUsid as an explicit relation and rejects malformed provider dates', () => {
    const snapshot = buildRegistrationEvidenceSnapshot(job, {
      capturedAt: '2026-07-24T12:00:00.000Z',
      nearExpirationDeals: [{ dealUsid: 'deal-exact', dealStatus: 'UsingNearExpiration', extensionProductExist: false }],
      sellerOnSaleProducts: [{
        previousProductUsid: 'old-product', dealStatus: 'OnSale', priceType: 'Extended',
        endDateTime: '26. 13. 40', productUsid: 'extension-product',
      }],
      oldDealAuthoritative: true,
      sellerListingAuthoritative: true,
    });
    expect(snapshot.extensionListing).toMatchObject({ present: true, linkedDeal: true, targetNewEnd: false, productIdPresent: true });
  });

  test('conservative composite can expose a conflict but never claims an exact positive link', () => {
    const snapshot = buildRegistrationEvidenceSnapshot(job, {
      capturedAt: '2026-07-24T12:00:00.000Z',
      nearExpirationDeals: [{
        dealUsid: 'deal-exact', dealStatus: 'UsingNearExpiration', extensionProductExist: false,
        productName: 'Netflix renewal', productTypeString: '넷플릭스', purePrice: 12000,
      }],
      sellerOnSaleProducts: [{
        dealStatus: 'OnSale', priceType: 'Extended', endDateTime: '26. 08. 27', productUsid: 'unrelated-product',
        productName: 'Netflix renewal', productTypeString: '넷플릭스', purePrice: 12000,
      }],
      oldDealAuthoritative: true,
      sellerListingAuthoritative: true,
    });
    expect(snapshot.extensionListing).toEqual({
      authoritative: true, present: true, priceType: 'Extended', linkedDeal: false,
      targetNewEnd: true, productIdPresent: true,
    });
    expect(JSON.stringify(snapshot)).not.toContain('unrelated-product');
  });

  test('missing endpoint evidence remains unknown and an authoritative list can prove exact old deal absence', () => {
    const unknown = buildRegistrationEvidenceSnapshot(job, {
      capturedAt: '2026-07-24T12:00:00.000Z',
      oldDealAuthoritative: false,
      sellerListingAuthoritative: false,
    });
    expect(unknown).toMatchObject({
      oldDeal: { authoritative: false, present: false },
      extensionListing: { authoritative: false, present: false, linkedDeal: false },
      error: true,
    });
    const absent = buildRegistrationEvidenceSnapshot(job, {
      capturedAt: '2026-07-24T12:00:00.000Z',
      nearExpirationDeals: [{ dealUsid: 'another-deal' }], sellerOnSaleProducts: [],
      oldDealAuthoritative: true, sellerListingAuthoritative: true,
    });
    expect(absent.oldDeal).toMatchObject({ authoritative: true, present: false, extensionProductExist: null });
    expect(absent.error).toBe(false);
  });
});
