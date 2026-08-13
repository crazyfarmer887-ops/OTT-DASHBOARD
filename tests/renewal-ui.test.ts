import { describe, expect, test } from 'vitest';
import { filterRenewalRows, selectionAfterScopeChange } from '../src/web/lib/renewal-management';

const rows = [
  { idempotencyKey: 'n', category: 'Netflix', service: '넷플릭스', buyer: '홍*동', account: 'ne***@x.com', eligible: true, jobStatus: null, couponStatus: 'not_started' },
  { idempotencyKey: 't', category: 'tving', service: '티빙', buyer: '김*수', account: 'tv***@x.com', eligible: false, jobStatus: 'message_error', couponStatus: 'awaiting_review' },
] as any;

describe('renewal management filtering and selection', () => {
  test('combines category, search and status filters without reordering', () => {
    expect(filterRenewalRows(rows, { category: 'tving', search: '김', status: 'message_error' }).map((row) => row.idempotencyKey)).toEqual(['t']);
    expect(filterRenewalRows(rows, { category: 'all', search: 'x.com', status: 'all' }).map((row) => row.idempotencyKey)).toEqual(['n', 't']);
  });
  test('resets selection whenever filters or refreshed data revision changes', () => {
    expect(selectionAfterScopeChange(new Set(['n']), 'all||all', 'Netflix||all', 1, 1).size).toBe(0);
    expect(selectionAfterScopeChange(new Set(['n']), 'all||all', 'all||all', 1, 2).size).toBe(0);
  });
});
