import { describe, expect, test } from 'vitest';
import { parseGeneralPartyDetail, parseHostParties, toManagementGeneralAccount } from '../src/lib/everyview-api';

const GENERAL_PARTY_HTML = `
<div class="myPartyA">
  <div class="platform"><h2>디즈니+</h2><span>( ID : e3607 )</span></div>
  <div class="detail-card-common">
    <p>파티원</p><p><a href="#">파티원1</a></p>
    <p class="detail-card-date-common">참여일 <span class="orange">26/06/17</span></p>
  </div>
  <div class="infoLogin"><strong id="ott_email0">member@example.com</strong></div>
  <h2>파티장 정산 정보</h2>
  <ul class="detail-body">
    <li><span>이용권 종류</span><strong>디즈니+ 프리미엄</strong></li>
    <li><span>정산대상기간</span><strong class="tx-blue">7월 30일 ~ 8월 29일</strong></li>
    <li><span>정산예정액</span><strong class="tx-blue">8,350원</strong></li>
    <li><span>입금일</span><strong class="tx-blue">8월 30일</strong></li>
  </ul>
</div>`;

describe('everyview general managed party', () => {
  test('reads owned cards with current extra classes and reordered attributes', () => {
    const html = `<a class="mypg-gc host is-general" href="/partyLeader_free_detail_type1?id=618" data-search="Spotify family s618 spotify 스포티파이" data-type="general">party</a>
    <a data-type="general" data-search="Spotify family s554 spotify 스포티파이" href="/partyLeader_free_detail_type1?id=554" class="is-general mypg-gc host">party</a>
    <a class="mypg-gc joined" href="/partyLeader_free_detail_type1?id=999" data-search="other s999 spotify 스포티파이">not owned</a>`;
    expect(parseHostParties(html).map(p => ({ id: p.partyId, type: p.partyType, service: p.serviceCode }))).toEqual([
      { id: 618, type: 'free', service: 'spotify' }, { id: 554, type: 'free', service: 'spotify' },
    ]);
  });
  test('parses member and settlement fields from the everyview managed-party HTML', () => {
    const detail = parseGeneralPartyDetail(GENERAL_PARTY_HTML, 3607);
    expect(detail).toMatchObject({
      partyId: 3607,
      serviceName: '디즈니+',
      servicePlan: '디즈니+ 프리미엄',
      settlementPeriod: '7월 30일 ~ 8월 29일',
      expectedSettlement: 8350,
      expectedSettlementLabel: '8,350원',
      depositDate: '8월 30일',
    });
    expect(detail.members).toEqual([{ name: '파티원1', joinedAt: '26/06/17', inviteEmail: 'member@example.com' }]);
  });

  test('maps to a management card without leaking the invite email', () => {
    const detail = parseGeneralPartyDetail(GENERAL_PARTY_HTML, 3607);
    const account = toManagementGeneralAccount(detail, {
      partyId: 3607,
      partyType: 'general',
      title: '디즈니+ premium 공유',
      serviceCode: 'disney_plus_new',
      serviceName: '디즈니+',
    });
    expect(account.partyType).toBe('general');
    expect(account.usingCount).toBe(1);
    expect(account.expectedSettlement).toBe(8350);
    expect(JSON.stringify(account)).not.toContain('member@example.com');
  });
});
