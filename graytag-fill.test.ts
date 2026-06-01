import { describe, expect, test } from 'vitest';
import { assertAutoDeliveryInput, buildAutoFillDeliveryMemo, buildFillPartyAccessMember, buildFillProductModel, buildFinishedDealsUrl, findExactPasswordForAccount, GRAYTAG_ACCESS_NOTICE_ID, GRAYTAG_ACCESS_NOTICE_PW, isGraytagAccessNoticeCredential, makeDefaultSellingGuide, requireExactAliasMemoForAutoFill } from './src/lib/graytag-fill';
import { makeDefaultProductDescription, makeDefaultProductTitle } from './src/lib/write-default-template';

describe('graytag fill product helpers', () => {
  test('fill-created listings use the shared write default title and selling guide', () => {
    const model = buildFillProductModel({
      category: 'disney',
      endDate: '20260707T2359',
      price: 7970,
      productName: '이전 게시글 제목',
      serviceType: '디즈니플러스',
    });

    expect(model.name).toBe(makeDefaultProductTitle('디즈니플러스'));
    expect(model.sellingGuide).toBe(makeDefaultProductDescription('디즈니플러스'));
    expect(model.sellingGuide).toContain('TV ✅ 이메일 셀프인증 ✅ 프리미엄 ✅');
    expect(model.sellingGuide).toContain('⚠️ 1 1 1 원칙을 꼭 지켜주세요 ⚠️');
    expect(model.sellingGuide).not.toContain('직접 운영하는');
  });

  test('auto delivery requires account id, password, and delivery memo before counting as successful', () => {
    expect(assertAutoDeliveryInput({ keepAcct: 'acct@example.com', keepPasswd: 'pw', keepMemo: 'memo' })).toBeNull();
    expect(assertAutoDeliveryInput({ keepAcct: 'acct@example.com', keepPasswd: '', keepMemo: 'memo' })).toContain('비밀번호');
    expect(assertAutoDeliveryInput({ keepAcct: 'acct@example.com', keepPasswd: 'pw', keepMemo: '' })).toContain('전달 문구');
  });

  test('auto-fill delivery memo uses a short access-link message with the generated URL', () => {
    const memo = buildAutoFillDeliveryMemo('수달이', 'https://example.com/dashboard/access/live-token');

    expect(memo).toContain('계정 업데이트 주소: https://example.com/dashboard/access/live-token');
    expect(memo).toContain('배정 프로필: 수달이');
    expect(memo).toContain('최신 ID/PW/PIN 확인');
    expect(memo).toContain('프로필은 배정된 이름으로만 사용');
    expect(memo).toContain('파티원 현황에 없는 프로필을 삭제');
    expect(memo).not.toContain('{계정 접근 토큰 생성 주소}');
    expect(memo).not.toContain('이용하시기 전 꼭 하셔야 하는 2 STEP');
    expect(memo).not.toContain('이메일 접근 링크 버튼 누르고 핀번호 입력하고 인증 받기');
    expect(memo).not.toContain('계정 업데이트 주소는 다른 파티원들이 파티 탈퇴');
    expect(memo.split('\n').length).toBeLessThanOrEqual(5);
  });

  test('graytag public ID/PW placeholders point buyers back to the access message', () => {
    expect(GRAYTAG_ACCESS_NOTICE_ID).toBe('아래 메세지를 꼭 확인해주세요');
    expect(GRAYTAG_ACCESS_NOTICE_PW).toBe('그래야 계정에 접근할 수 있습니다.');
    expect(isGraytagAccessNoticeCredential('아래 메세지를 꼭 확인해주세요')).toBe(true);
    expect(isGraytagAccessNoticeCredential('아래 메시지를 확인해주세요')).toBe(true);
    expect(isGraytagAccessNoticeCredential('acct@example.com')).toBe(false);
  });

  test('fill-created access links use the created listing id and the selected end date as expiry', () => {
    const member = buildFillPartyAccessMember({
      productUsid: '451893015',
      profileNickname: '오렌지',
      endDateTime: '20260703T2359',
    });

    expect(member).toEqual({
      kind: 'graytag',
      memberId: 'fill:451893015',
      memberName: '구매자',
      profileName: '오렌지',
      status: 'OnSale',
      statusName: '판매 중',
      startDateTime: null,
      endDateTime: '20260703T2359',
    });
  });

  test('management lookup can request both current-only and finished-included deal lists', () => {
    expect(buildFinishedDealsUrl('before', 3)).toContain('findBeforeUsingLenderDeals?finishedDealIncluded=true');
    expect(buildFinishedDealsUrl('after', 2)).toContain('findAfterUsingLenderDeals?finishedDealIncluded=true');
    expect(buildFinishedDealsUrl('before', 1, 500, false)).toContain('findBeforeUsingLenderDeals?finishedDealIncluded=false');
    expect(buildFinishedDealsUrl('after', 1, 500, false)).toContain('findAfterUsingLenderDeals?finishedDealIncluded=false');
  });

  test('password lookup never falls back to another account or service', () => {
    const onSaleByKeepAcct = {
      'acct@example.com': [
        { keepAcct: 'acct@example.com', productType: '넷플릭스', keepPasswd: 'netflix-pw' },
        { keepAcct: 'acct@example.com', productType: '티빙', keepPasswd: 'tving-pw' },
      ],
      'other@example.com': [
        { keepAcct: 'other@example.com', productType: '티빙', keepPasswd: 'other-pw' },
      ],
    };

    expect(findExactPasswordForAccount('acct@example.com', '티빙', [], onSaleByKeepAcct)).toBe('tving-pw');
    expect(findExactPasswordForAccount('acct@example.com', '웨이브', [], onSaleByKeepAcct)).toBe('');
    expect(findExactPasswordForAccount('missing@example.com', '티빙', [], onSaleByKeepAcct)).toBe('');
  });

  test('auto-fill requires an exact email dashboard memo before registering', () => {
    expect(requireExactAliasMemoForAutoFill({ statusOk: true, memo: 'exact memo', expectedMemo: 'exact memo' })).toBeNull();
    expect(requireExactAliasMemoForAutoFill({ statusOk: false, memo: 'fallback memo', expectedMemo: 'fallback memo' })).toContain('이메일/PIN');
    expect(requireExactAliasMemoForAutoFill({ statusOk: true, memo: '', expectedMemo: 'exact memo' })).toContain('전달 문구');
    expect(requireExactAliasMemoForAutoFill({ statusOk: true, memo: 'edited memo', expectedMemo: 'exact memo' })).toContain('변경되어');
  });
});
