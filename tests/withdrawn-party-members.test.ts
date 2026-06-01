import { describe, expect, test } from 'vitest';
import { buildWithdrawnPartyMembers } from '../src/web/lib/withdrawn-party-members';

describe('buildWithdrawnPartyMembers', () => {
  test('groups former Graytag members by party and sorts by withdrawal date newest first with per-member credential snapshot', () => {
    const rows = buildWithdrawnPartyMembers({
      account: {
        serviceType: '웨이브',
        email: 'wavve@example.com',
        members: [
          { dealUsid: 'active-1', productUsid: 'party-a', name: '활성', status: 'Using', statusName: '이용중', startDateTime: '2026. 05. 01', endDateTime: '2026. 06. 01', remainderDays: 20, price: '1000원', lastPassword: 'active-password', lastPin: '111111' },
          { dealUsid: 'old-1', productUsid: 'party-a', name: '먼저나감', status: 'FinishedByBorrowerRequest', statusName: '중도 종료', startDateTime: '2026. 04. 01', endDateTime: '2026. 05. 01', remainderDays: 0, price: '1000원', lastPassword: 'old-password-a', lastPin: '222222' },
          { dealUsid: 'old-2', productUsid: 'party-b', name: '만료됨', status: 'Using', statusName: '이용중', startDateTime: '2026. 03. 01', endDateTime: '2026. 04. 20', remainderDays: -1, price: '2000원', lastPassword: 'old-password-b', lastPin: '333333' },
          { dealUsid: 'old-3', productUsid: 'party-b', name: '취소됨', status: 'CancelByNoShow', statusName: '취소', startDateTime: '2026. 03. 01', endDateTime: '2026. 04. 10', remainderDays: 0, price: '3000원', lastPassword: 'old-password-c', lastPin: '444444' },
        ],
      },
      password: 'current-changed-password',
      pin: '999999',
      now: '2026-05-06T00:00:00.000Z',
    });

    expect(rows.map(row => row.memberName)).toEqual(['먼저나감', '만료됨']);
    expect(rows.map(row => row.partyKey)).toEqual(['party-a', 'party-b']);
    expect(rows[0]).toMatchObject({
      withdrawnDate: '2026-05-01',
      password: 'old-password-a',
      pin: '222222',
      credentialAdvice: 'PW/PIN 둘 다 점검',
      statusLabel: '중도 종료',
    });
    expect(rows.map(row => row.password)).not.toContain('current-changed-password');
    expect(rows.map(row => row.pin)).not.toContain('999999');
  });

  test('does not treat account-checking active members as withdrawn', () => {
    const rows = buildWithdrawnPartyMembers({
      account: {
        serviceType: '티빙',
        email: 'gtwavve7',
        members: [
          { dealUsid: 'checking-1', productUsid: 'party-c', name: '확인중', status: 'DeliveredAndCheckPrepaid', statusName: '계정확인중', startDateTime: null, endDateTime: '2026. 05. 20', remainderDays: 14, price: '1000원' },
        ],
      },
      password: '',
      pin: '',
      now: '2026-05-06T00:00:00.000Z',
    });

    expect(rows).toEqual([]);
  });

  test('counts cancelled Graytag deals only from 2026-05-06 onward', () => {
    const rows = buildWithdrawnPartyMembers({
      account: {
        serviceType: '웨이브',
        email: 'wavve@example.com',
        members: [
          { dealUsid: 'cancel-old', productUsid: 'party-a', name: '오래된취소', status: 'CancelByNoShow', statusName: '거래취소', startDateTime: '2026. 04. 22', endDateTime: '2026. 04. 22', remainderDays: 0, price: '4500원' },
          { dealUsid: 'cancel-cutoff', productUsid: 'party-b', name: '기준일취소', status: 'CancelByNoShow', statusName: '거래취소', startDateTime: '2026. 05. 06', endDateTime: '2026. 05. 06', remainderDays: 0, price: '4500원' },
          { dealUsid: 'cancel-new', productUsid: 'party-c', name: '새취소', status: 'CancelByDepositRejection', statusName: '거래 취소', startDateTime: '2026. 05. 07', endDateTime: '2026. 05. 07', remainderDays: 0, price: '4500원' },
        ],
      },
      now: '2026-05-13T00:00:00.000Z',
    });

    expect(rows.map(row => row.memberName)).toEqual(['새취소', '기준일취소']);
    expect(rows.map(row => row.withdrawnDate)).toEqual(['2026-05-07', '2026-05-06']);
  });
});
