import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const read = (url) => readFileSync(new URL(url, import.meta.url), 'utf8');

test('renewals dashboard route and navigation entry exist', () => {
  assert.equal(existsSync(new URL('../src/web/pages/renewals.tsx', import.meta.url)), true);
  assert.match(read('../src/web/app.tsx'), /RenewalsPage/);
  assert.match(read('../src/web/app.tsx'), /path="\/renewals"/);
  assert.match(read('../src/web/components/bottom-nav.tsx'), /path: "\/renewals"/);
});

test('renewals page contains selection safety, responsive contracts and partial result states', () => {
  const source = read('../src/web/pages/renewals.tsx');
  assert.match(source, /현재 필터 전체 선택/);
  assert.match(source, /카테고리 전체 선택/);
  assert.match(source, /literalConfirm === '연장'/);
  assert.match(source, /선택한 \{selected\.size\}건/);
  assert.match(source, /enabled && flags\.live && !flags\.safeMode/);
  assert.match(source, /message_error/);
  assert.match(source, /uncertain/);
  assert.match(source, /aria-label/);
  assert.match(source, /renewal-mobile-card/);
  assert.match(source, /results\.map/);
});

test('desktop renewal table renders every safety-critical field in header order', () => {
  const source = read('../src/web/pages/renewals.tsx');
  const desktopTable = source.match(/<table className="renewal-table">[\s\S]*?<\/table>/)?.[0] || '';
  assert.ok(desktopTable, 'desktop renewal table must exist');
  for (const field of [
    /<td>\{row\.service\}<\/td>/,
    /<td>\{maskIdentifier\(row\.buyer\)\}\s*·\s*\{maskIdentifier\(row\.account\)\}<\/td>/,
    /<td>\{formatDate\(row\.oldEnd\)\}\s*→\s*\{formatDate\(row\.newEnd\)\}<\/td>/,
    /<td>\{Number\(row\.price\s*\|\|\s*0\)\.toLocaleString\('ko-KR'\)\}원<\/td>/,
  ]) assert.match(desktopTable, field);
  assert.equal((desktopTable.match(/<th(?:\s|>)/g) || []).length, 7);
  const rowSource = desktopTable.match(/return <tr[\s\S]*?<\/tr>/)?.[0] || '';
  assert.equal((rowSource.match(/<td/g) || []).length, 7);
});

test('safe failed registration card exposes one guarded retry with fresh-revalidation confirmation', () => {
  const source = read('../src/web/pages/renewals.tsx');
  assert.match(source, /연장 다시 등록/);
  assert.match(source, /retry-registration/);
  assert.match(source, /window\.confirm\([^)]*최신 후보[^)]*한 번의 등록 요청/s);
  assert.match(source, /enabled && flags\.live && !flags\.safeMode/);
  assert.match(source, /row\.jobStatus === 'registration_failed_safe'/);
});

test('review inbox labels manual issue clearly and exposes guarded actions, links and audit timeline', () => {
  const source = read('../src/web/pages/renewals.tsx');
  for (const phrase of ['관리자 후기 검수함', '확인 필요', '후기 확인', '반려', '쿠폰 승인', '수동 지급 완료', '자동 발급/전송이 아닙니다', '감사 기록']) {
    assert.match(source, new RegExp(phrase));
  }
  assert.match(source, /review_confirm/);
  assert.match(source, /coupon_approve/);
  assert.match(source, /mark_issued/);
  assert.match(source, /chatUrl/);
  assert.match(source, /transactionUrl/);
});

test('renewals page exposes compact persistent message policy controls and skipped reasons', () => {
  const source = read('../src/web/pages/renewals.tsx');
  assert.match(source, /\/api\/renewal-automation\/message-policy/);
  for (const phrase of ['메시지 발송', '목표', '발송 / 예약', '남은 목표', '저장', '목표에 도달하면 메시지는 자동으로 생략됩니다', '메시지 생략', '정책 비활성', '목표 도달']) {
    assert.match(source, new RegExp(phrase));
  }
  assert.match(source, /method:\s*'PUT'/);
  assert.match(source, /targetCount/);
  assert.match(source, /message_skipped/);
  assert.match(source, /skipReason/);
});
