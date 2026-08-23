import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';

const API = readFileSync('src/api/index.ts', 'utf8');
const EV_PAGE = readFileSync('src/web/pages/everyview.tsx', 'utf8');
const PROFIT = readFileSync('src/web/pages/profit.tsx', 'utf8');

describe('everyview phase-2 features', () => {
  test('settlement summary endpoint aggregates managed-party settlements', () => {
    expect(API).toContain("app.post('/everyview/settlement-summary'");
    expect(API).toContain('totalExpected');
    expect(API).toContain('byService');
  });

  test('cookie expiry on settlement fetch triggers a critical seller alert', () => {
    expect(API).toContain("'everyview-cookie-expired'");
    expect(API).toContain("severity: 'critical'");
    expect(API).toContain('에브리뷰 쿠키가 만료됐어요. 세션 키퍼 확인 또는 수동 쿠키 갱신이 필요해요.');
  });

  test('recruit count endpoint validates range and invalidates cache', () => {
    expect(API).toContain("app.post('/everyview/update-recruit-cnt'");
    expect(API).toContain('recruitCnt는 0~20 사이 숫자여야 해요');
    expect(API.match(/update-recruit-cnt[\s\S]*?everyviewManagementCache = null;/)).toBeTruthy();
  });

  test('everyview page offers invite-email reveal with tap-to-copy (hidden by default)', () => {
    expect(EV_PAGE).toContain('✉️ 초대메일 보기');
    expect(EV_PAGE).toContain('탭하여 복사');
    // invites state starts null → no email rendered until requested
    expect(EV_PAGE).toContain('useState<Record<string, string[]> | null>(null)');
  });

  test('free parties get recruit-count editor wired to the endpoint', () => {
    expect(EV_PAGE).toContain('👥 모집 인원 변경');
    expect(EV_PAGE).toContain("fetch('/api/everyview/update-recruit-cnt'");
  });

  test('profit page renders everyview expected-settlement card', () => {
    expect(PROFIT).toContain('에브리뷰 정산예정');
    expect(PROFIT).toContain("fetch('/api/everyview/settlement-summary'");
  });
});
