import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/api/index.ts', import.meta.url), 'utf8');

test('successful YouTube sales-account product deletion settles the durable registration', () => {
  const start = source.indexOf("app.post('/my/delete-products'");
  const end = source.indexOf('// ─── 상품 가격 일괄 변경', start);
  const route = source.slice(start, end);

  assert.match(route, /const accountId = graytagAccountIdFromRequest\(c\)/);
  assert.match(route, /accountId === 'youtube-invite-sales'/);
  assert.match(route, /markDeletedProducts\(deletedProductUsids/);
  assert.match(route, /provider-delete-succeeded/);
});
