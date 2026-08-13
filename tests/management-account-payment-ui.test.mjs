import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const manage = readFileSync(new URL('../src/web/pages/manage.tsx', import.meta.url), 'utf8');

test('manage page exposes exactly the paid and unpaid account tabs', () => {
  assert.match(manage, /type FilterMode = 'unpaid'\|'paid'|import[^;]*type FilterMode[^;]*management-account-order/);
  assert.match(manage, /label:'미결제 계정'/);
  assert.match(manage, /label:'결제 계정'/);
  assert.doesNotMatch(manage, /\{ key:'using',\s+label:'이용 중' \}/);
  assert.doesNotMatch(manage, /\{ key:'active', label:'전체 활성' \}/);
  assert.doesNotMatch(manage, /\{ key:'all',\s+label:'전체 내역' \}/);
  assert.doesNotMatch(manage, /type FilterMode = 'using'\|'active'\|'all'/);
});

test('manage page filters and sorts accounts through the pure helper without filtering member history', () => {
  assert.match(manage, /getVisibleManagementAccounts/);
  assert.match(manage, /const visibleAccounts = getVisibleManagementAccounts\(svc\.accounts, filter\)/);
  assert.match(manage, /visibleAccounts\.map\(acct =>/);
  assert.match(manage, /const filteredMembers = acct\.members;/);
  assert.doesNotMatch(manage, /acct\.members\.filter\(m => \{\s*if \(filter===/);
  assert.match(manage, /계정 \{visibleAccounts\.length\}개/);
});
