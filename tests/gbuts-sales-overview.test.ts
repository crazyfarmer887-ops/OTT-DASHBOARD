import { describe, expect, test } from 'vitest';
import { buildGbutsSalesOverview } from '../src/lib/gbuts-sales-overview';
import { emptyGbutsOttStore } from '../src/lib/gbuts-ott';
import type { GbutsOttPost } from '../src/lib/gbuts-ott-client';

describe('GButs service overview', () => {
  test('counts current recruitment and existing participants, without expired or fully refunded posts', () => {
    const post = (seq: number, status: string, memberCount: number, subscriptionEndsAt: string): GbutsOttPost => ({
      seq, status, memberCount, subscriptionEndsAt, memberLimit: 4, category1: { seq: 5 }, price: 190, priceType: 'DAY',
    });
    const result = buildGbutsSalesOverview([
      post(1, 'ON_SALE', 1, '2026-12-01'), post(2, 'CLOSED', 2, '2026-12-01'),
      post(3, 'REFUNDED', 4, '2026-12-01'), post(4, 'ON_SALE', 4, '2026-10-01'),
    ], emptyGbutsOttStore(), new Date('2026-10-06T00:00:00Z'));
    expect(result.services.find(service => service.serviceType === '넷플릭스')).toMatchObject({ listings: 2, members: 3, recruiting: 3 });
    expect(result.listings.map(listing => listing.seq)).toEqual([1, 2]);
    expect(result.services.find(service => service.serviceType === '티빙')).toMatchObject({ members: 0, recruiting: 0 });
  });
});
