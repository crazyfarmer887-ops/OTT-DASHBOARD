import { afterEach, describe, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createEveryviewParty, EVERYVIEW_CREATE_SERVICES } from '../src/lib/everyview-api';

const API = readFileSync('src/api/index.ts', 'utf8');
const EV_PAGE = readFileSync('src/web/pages/everyview.tsx', 'utf8');

const validInput = {
  recruitTitle: '유튜브 프리미엄 4인 팟',
  recruitInfo: '가족요금제 공유입니다.',
  disallowRules: ['※ 중도 환불 불가'],
  paymentType: 'PERIOD' as const,
  oneDayUsageFee: 167,
  monthUsageFee: 5000,
  shareEndDate: '2026-09-30',
  shareUserCnt: 4,
  services: [{
    serviceCode: 'youtube', serviceName: '유튜브', serviceOptionCode: 'direct', serviceOptionName: '',
    shareType: 'ACCOUNT' as const, userId: 'test@example.com', userPassword: 'pw1234',
    sharingDescription: '', additionalInfo: '',
  }],
};

describe('everyview party creation (write)', () => {
  afterEach(() => vi.unstubAllGlobals());
  test('create endpoint exists and invalidates management cache on success', () => {
    expect(API).toContain("app.post('/everyview/create-party'");
    expect(API).toMatch(/create-party[\s\S]*?everyviewManagementCache = null;/);
  });

  test('adapter rejects invalid input before hitting the network', async () => {
    const noTitle = await createEveryviewParty('cookie', { ...validInput, recruitTitle: '' });
    expect(noTitle.ok).toBe(false);
    expect(noTitle.msg).toContain('모집 제목');
    const badSlots = await createEveryviewParty('cookie', { ...validInput, shareUserCnt: 0 });
    expect(badSlots.msg).toContain('모집 인원');
    const accountNoPw = await createEveryviewParty('cookie', { ...validInput, services: [{ ...validInput.services[0], userPassword: '' }] });
    expect(accountNoPw.msg).toContain('아이디/비밀번호');
    const periodNoEnd = await createEveryviewParty('cookie', { ...validInput, shareEndDate: null });
    expect(periodNoEnd.msg).toContain('종료일');
  });

  test('service catalog matches everyview makeParty selector snapshot', () => {
    const yt = EVERYVIEW_CREATE_SERVICES.find(s => s.code === 'youtube');
    const dp = EVERYVIEW_CREATE_SERVICES.find(s => s.code === 'disney_plus');
    expect(yt?.id).toBe(1);
    expect(dp?.id).toBe(4);
  });

  test('sends 30-day participation-based terms matching the official form', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ result: '200', partyId: 123 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await createEveryviewParty('cookie', { ...validInput, periodTermType: 'ROLLING', usageDays: 30,
      totalUsageFee: 2910, shareEndDate: null, oneDayUsageFee: 97, monthUsageFee: 2910 });
    expect(result).toEqual({ ok: true, partyId: 123 });
    const options = fetchMock.mock.calls[0][1] as RequestInit;
    const payment = JSON.parse((options.body as FormData).get('partyData') as string).payment;
    expect(payment).toEqual({ paymentType: 'PERIOD', periodTermType: 'ROLLING', usageDays: 30,
      totalUsageFee: 2910, oneDayUsageFee: 97, monthUsageFee: 2910, shareEndDate: null, shareUserCnt: 4 });
  });

  test('rejects missing, invalid, contradictory or inconsistent rolling period data before network', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const valid = { ...validInput, periodTermType: 'ROLLING' as const, usageDays: 30,
      totalUsageFee: 2910, shareEndDate: null, oneDayUsageFee: 97, monthUsageFee: 2910 };
    for (const patch of [
      { usageDays: null }, { usageDays: 0 }, { usageDays: 731 }, { usageDays: 1.5 },
      { totalUsageFee: null }, { totalUsageFee: 0 }, { shareEndDate: '2027-01-24' },
      { oneDayUsageFee: 96 }, { monthUsageFee: 2900 }, { periodTermType: 'INVALID' },
      { paymentType: 'RECURRING' },
    ]) {
      const result = await createEveryviewParty('cookie', { ...valid, ...patch } as any);
      expect(result.ok).toBe(false);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('keeps existing fixed and recurring payloads unchanged', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ result: '200', partyId: 123 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await createEveryviewParty('cookie', validInput);
    await createEveryviewParty('cookie', { ...validInput, paymentType: 'RECURRING' });
    const payments = fetchMock.mock.calls.map((call) => JSON.parse(((call[1] as RequestInit).body as FormData).get('partyData') as string).payment);
    expect(payments[0]).toEqual({ paymentType: 'PERIOD', oneDayUsageFee: 167, monthUsageFee: 5000,
      shareEndDate: '2026-09-30', shareUserCnt: 4 });
    expect(payments[1]).toEqual({ paymentType: 'RECURRING', oneDayUsageFee: 167, monthUsageFee: 5000,
      shareEndDate: null, shareUserCnt: 4 });
  });

  test('page renders write form with confirm gate and all key fields', () => {
    expect(EV_PAGE).toContain('✏️ 새 파티 글 작성');
    expect(EV_PAGE).toContain('에브리뷰에 실제 등록돼요');
    expect(EV_PAGE).toContain("fetch('/api/everyview/create-party'");
    expect(EV_PAGE).toContain('🚀 개설하기');
  });
});
