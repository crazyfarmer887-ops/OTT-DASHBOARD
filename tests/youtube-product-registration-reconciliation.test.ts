import { describe, expect, test, vi } from 'vitest';
import { fingerprintYouTubeProductRegistration } from '../src/lib/youtube-product-registrations';
import {
  reconcileYouTubeProductRegistration,
  readAuthoritativeYouTubeSellerProducts,
} from '../src/lib/youtube-product-registration-reconciliation';

const claim = {
  attemptId: 'attempt-secret',
  familyGroupId: 'group-1',
  requestFingerprint: fingerprintYouTubeProductRegistration('group-1', {
    tempProductCategory: 'youtube', endDate: '20260831T2359', priceType: 'Normal',
    price: '7900', name: '유튜브', sellingGuide: '안내',
  }),
};
const matchingRow = {
  dealStatus: 'OnSale', productTypeString: '유튜브', endDateTime: '20260831T2359',
  priceType: 'Normal', purePrice: 7900, productName: ' 유튜브 ', sellingGuide: ' 안내 ',
  productUsid: 'product-valid_1',
};

describe('YouTube registration reconciliation', () => {
  test('returns registered only for exactly one fingerprint match with a valid productUsid', () => {
    expect(reconcileYouTubeProductRegistration(claim, { authoritative: true, rows: [matchingRow] }))
      .toEqual({ status: 'registered', productUsid: 'product-valid_1' });
  });

  test.each([
    ['zero matches', []],
    ['multiple matches', [matchingRow, { ...matchingRow, productUsid: 'product-valid_2' }]],
    ['invalid product id', [{ ...matchingRow, productUsid: '../provider-secret' }]],
    ['non-authoritative rows', [matchingRow], false],
  ])('returns uncertain for %s', (_label, rows, authoritative = true) => {
    expect(reconcileYouTubeProductRegistration(claim, { authoritative, rows }))
      .toEqual({ status: 'uncertain' });
  });

  test('performs one GET-only seller read and accepts only a complete authoritative schema', async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => new Response(JSON.stringify({
      succeeded: true, data: { lenderDeals: [matchingRow] },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    await expect(readAuthoritativeYouTubeSellerProducts(fetcher, { Cookie: 'secret' }))
      .resolves.toEqual({ authoritative: true, rows: [matchingRow] });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'GET', redirect: 'manual' });
    expect(fetcher.mock.calls[0][1]).not.toHaveProperty('body');
  });

  test.each([
    ['redirect', new Response('', { status: 302 })],
    ['bad schema', new Response(JSON.stringify({ succeeded: true, data: [] }), { status: 200 })],
    ['provider rejection', new Response(JSON.stringify({ succeeded: false, details: 'raw-secret' }), { status: 200 })],
  ])('treats %s as non-authoritative without exposing provider details', async (_label, response) => {
    const result = await readAuthoritativeYouTubeSellerProducts(vi.fn(async () => response), {});
    expect(result).toEqual({ authoritative: false, rows: [] });
    expect(JSON.stringify(result)).not.toContain('raw-secret');
    expect(JSON.stringify(result)).not.toContain(claim.attemptId);
  });

  test('treats transport errors as non-authoritative without leaking errors', async () => {
    const result = await readAuthoritativeYouTubeSellerProducts(vi.fn(async () => { throw new Error('raw-provider-secret'); }), {});
    expect(result).toEqual({ authoritative: false, rows: [] });
    expect(JSON.stringify(result)).not.toContain('raw-provider-secret');
  });
});
