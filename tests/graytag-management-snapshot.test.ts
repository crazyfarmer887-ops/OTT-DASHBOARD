import { describe, expect, it } from 'vitest';
import { dedupeGraytagManagementDeals, verifiedGraytagManagementDeals } from '../src/lib/graytag-management-snapshot';
const sale = (productUsid: string) => ({ dealUsid: null, productUsid, dealStatus: 'OnSale' });
describe('authoritative shared inventory snapshot', () => {
  it('accepts unsold provider listings identified by product rather than a buyer deal', () => {
    const rows = [sale('sale-1'), sale('sale-2')];
    expect(verifiedGraytagManagementDeals({ succeeded: true, data: { lenderDeals: rows } }, true, true)).toEqual(rows);
  });
  it('keeps separate unsold listings and deduplicates their copies across open and finished pages', () => {
    const rows = [sale('sale-1'), sale('sale-2'), sale('sale-1'), { productUsid: 'sale-3', dealUsid: 'paid-1', dealStatus: 'Using' }];
    expect(dedupeGraytagManagementDeals(rows)).toHaveLength(3);
  });
  it('rejects unavailable or unidentified rows rather than returning empty inventory', () => {
    expect(() => verifiedGraytagManagementDeals({ succeeded: true, data: { lenderDeals: [{}] } }, true, true)).toThrow('재고 응답');
    expect(() => verifiedGraytagManagementDeals({ succeeded: true, data: { lenderDeals: [] } }, false, true)).toThrow('재고 응답');
    expect(() => verifiedGraytagManagementDeals({ succeeded: false, data: { lenderDeals: [] } }, true, true)).toThrow('재고 응답');
  });
});
