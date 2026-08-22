import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import {
  buildCalendarEvents,
  calcMemberIncome,
  calcServiceProfits,
  groupCalendarEventsByAccount,
} from '../src/web/pages/profit.tsx';

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), 'utf8');

const sampleGraytagData = {
  services: [{
    serviceType: '넷플릭스',
    totalUsingMembers: 1,
    totalActiveMembers: 1,
    totalIncome: 30000,
    totalRealized: 0,
    accounts: [{
      email: 'netflix1.test@aleeas.com',
      serviceType: '넷플릭스',
      usingCount: 1,
      activeCount: 1,
      totalSlots: 5,
      totalIncome: 30000,
      totalRealizedIncome: 0,
      expiryDate: '2026. 07. 01',
      members: [{
        dealUsid: 'deal-1',
        name: '구매자A',
        status: 'Using',
        statusName: '이용 중',
        price: '30,000원',
        purePrice: 30000,
        realizedSum: 0,
        progressRatio: '0',
        startDateTime: '2026. 06. 01',
        endDateTime: '2026. 07. 01',
        remainderDays: 30,
        source: 'after',
      }],
    }],
  }],
  summary: { totalUsingMembers: 1, totalActiveMembers: 1, totalIncome: 30000, totalRealized: 0, totalAccounts: 1 },
  updatedAt: '2026-06-01T00:00:00Z',
};

const emptyPersonalSub = { netflix: false, tving: false, disney: false, netflixDay: 1, tvingDay: 1, disneyDay: 1 };

test('shared UI primitives exist for dashboard pages', () => {
  for (const file of [
    'src/web/components/ui/page-shell.tsx',
    'src/web/components/ui/card.tsx',
    'src/web/components/ui/status-badge.tsx',
    'src/web/components/ui/empty-state.tsx',
  ]) {
    assert.equal(existsSync(join(root, file)), true, `${file} should exist`);
  }
});

test('management UI distinguishes configured hash-only PINs from missing PINs', () => {
  const manage = read('src/web/pages/manage.tsx');
  assert.match(manage, /interface ExistingPinCacheEntry \{[^}]*pinConfigured: boolean;[^}]*pinRecoverable: boolean;/s);
  assert.match(manage, /const pinConfigured = json\.pinConfigured === true \|\| Boolean\(pin\)/);
  assert.match(manage, /const pinRecoverable = json\.pinRecoverable === true && Boolean\(pin\)/);
  assert.match(manage, /existingPinRecord\?\.checked && existingPinRecord\.pinConfigured && !existingPinRecord\.pinRecoverable/);
  assert.match(manage, /PIN 설정됨 · 기존 번호 확인 불가/);
  assert.match(manage, /existingPinRecord\?\.checked && !existingPinRecord\.pinConfigured/);
  assert.doesNotMatch(manage, /existingPinRecord\?\.checked && !existingPinRecord\.pin && \(/);
  const configuredBranch = manage.indexOf("data?.pinConfigured");
  const missingPinBranch = manage.indexOf("missing.includes('pin')", configuredBranch);
  assert.ok(configuredBranch > -1 && missingPinBranch > configuredBranch, 'fill memo lookup should prioritize configured hash-only status before missing PIN');
});

test('global realtime chat notifications are mounted with actionable alert controls', () => {
  const app = read('src/web/app.tsx');
  const notifier = read('src/web/components/realtime-chat-notifier.tsx');
  assert.match(app, /<RealtimeChatNotifier \/>/);
  assert.match(notifier, /\/api\/chat\/notifications\/stream/);
  assert.match(notifier, /실시간 채팅 알림/);
  assert.match(notifier, /채팅방 바로가기/);
  assert.match(notifier, /브라우저 알림 켜기/);
  assert.match(notifier, /소리 켜기/);
  assert.match(notifier, /Last-Event-ID/);
});

test('graytag calendar income is accrued daily over the full usage period, not monthly on start date', () => {
  const profits = calcServiceProfits(sampleGraytagData, 'snapshot', new Date('2026-06-16T00:00:00Z'), () => 1, () => false);
  const events = buildCalendarEvents(profits, 'snapshot', new Date('2026-06-16T00:00:00Z'), 2026, 5, () => 1, emptyPersonalSub, () => false);

  const june16Income = events.filter((event) => event.day === 16 && event.type === 'income');
  assert.equal(june16Income.length, 1);
  assert.equal(june16Income[0].amount, 900);
  assert.doesNotMatch(june16Income[0].label, /\[30일분\]|월정산/);

  const june1Income = events.filter((event) => event.day === 1 && event.type === 'income');
  assert.equal(june1Income.reduce((sum, event) => sum + event.amount, 0), 900);

  const monthTotalIncome = events.filter((event) => event.type !== 'expense').reduce((sum, event) => sum + event.amount, 0);
  assert.equal(monthTotalIncome, 27000);

  const grouped = groupCalendarEventsByAccount(june16Income);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].amount, 900);
  assert.equal(grouped[0].memberCount, 1);
  assert.equal(grouped[0].accountLabel, 'netflix1.test');
});

test('thismonth graytag profit uses overlap days times daily rate', () => {
  const member = sampleGraytagData.services[0].accounts[0].members[0];
  assert.equal(calcMemberIncome(member, 'thismonth', new Date('2026-06-16T00:00:00Z')), 30000);
  assert.equal(calcMemberIncome(member, 'thismonth', new Date('2026-07-16T00:00:00Z')), 0);

  const crossMonthMember = { ...member, purePrice: 31000, startDateTime: '2026. 05. 15', endDateTime: '2026. 06. 15' };
  assert.equal(calcMemberIncome(crossMonthMember, 'thismonth', new Date('2026-06-16T00:00:00Z')), 14000);
});

test('current 30-day extension excludes OnSale-only accounts from both income and subscription cost', () => {
  const active = sampleGraytagData.services[0].accounts[0];
  const paidLegacyOnSaleOnly = {
    ...active,
    email: 'paid-legacy@example.com',
    usingCount: 0,
    activeCount: 0,
    totalIncome: 0,
    totalRealizedIncome: 0,
    onSaleAccount: { productCount: 1, source: 'graytag-on-sale' },
    members: [{
      ...active.members[0], dealUsid: 'historical-deal', status: 'NormalFinished', statusName: '완료',
      startDateTime: '2026. 04. 01', endDateTime: '2026. 05. 01', realizedSum: 20000,
    }],
  };
  const pendingGeneratedOnSaleOnly = {
    ...active,
    email: 'pending@example.com',
    usingCount: 0,
    activeCount: 0,
    totalIncome: 0,
    totalRealizedIncome: 0,
    onSaleAccount: { productCount: 1, source: 'graytag-on-sale' },
    generatedAccount: { paymentStatus: 'pending', paidAt: null, createdAt: '2026-05-01T00:00:00Z' },
    members: [],
  };
  const data = {
    ...sampleGraytagData,
    services: [{ ...sampleGraytagData.services[0], accounts: [active, paidLegacyOnSaleOnly, pendingGeneratedOnSaleOnly] }],
  };

  const current = calcServiceProfits(data, 'monthly30', new Date('2026-06-16T00:00:00Z'), () => 1)[0];
  assert.equal(current.revenueAccountCount, 1);
  assert.equal(current.maintainedAccountCount, 1);
  assert.equal(current.partyIncome, 30000);
  assert.equal(current.subscriptionCost, 17000);
  assert.equal(current.netProfit, 10000);

  const snapshot = calcServiceProfits(data, 'snapshot', new Date('2026-06-16T00:00:00Z'), () => 1)[0];
  assert.equal(snapshot.revenueAccountCount, 1);
  assert.equal(snapshot.maintainedAccountCount, 1);
  assert.equal(snapshot.subscriptionCost, 17000);
});

test('profit page has no extra-share or personal extra-subscription feature contract', () => {
  const profit = read('src/web/pages/profit.tsx');
  assert.doesNotMatch(profit, /extra-share|ExtraShareMap|EXTRA_COST|EXTRA_INCOME|isExtraShareOn|extraShareMemos/);
  assert.doesNotMatch(profit, /graytag_personal_sub_v1|PersonalSubSettings|PERSONAL_SUB_COSTS/);
  assert.doesNotMatch(profit, /추가\s*공유|추가공유|추가\s*파티|개인\s*추가\s*구독|자리\s*공유/);
  assert.doesNotMatch(profit, /extraIncome|extraCostTotal|extraProfit/);
  assert.match(profit, /기존 파티 그대로 30일 연장/);
  assert.match(profit, /판매 중 슬롯·미판매 계정 제외/);
});

test('global tokens include semantic dashboard states', () => {
  const css = read('src/web/styles.css');
  for (const token of ['--success', '--warning', '--danger', '--info', '--surface-raised', '--text-muted']) {
    assert.match(css, new RegExp(token.replace('--', '--')), `${token} token should exist`);
  }
});

test('OTT home and navigation use the refreshed UI structure', () => {
  const home = read('src/web/pages/home.tsx');
  const nav = read('src/web/components/bottom-nav.tsx');
  const admin = read('src/web/components/admin-token-control.tsx');
  assert.match(home, /parseJsonResponse/);
  assert.match(home, /\/api\/my\/management 응답이 JSON이 아니에요|parseJsonResponse<any>\(manageRes, '\/api\/my\/management'\)/);
  assert.doesNotMatch(home, /\.json\(\) as/);
  assert.match(home, /오늘 상태/);
  assert.match(home, /위험 알림/);
  assert.match(home, /바로가기/);
  assert.match(home, /파티 재정비 대상/);
  assert.match(home, /파티원 먼저 만료/);
  assert.match(home, /완료한 파티 재정비 대상/);
  assert.match(home, /해당 계정으로 또 다시 파티 모집을 진행할건가/);
  assert.match(home, /기존 구독이 유지됐는가/);
  assert.match(home, /구독 결제일은 매달 몇일인가/);
  assert.match(home, /subscriptionBillingDay/);
  assert.match(home, /랜덤 12자리 비밀번호 생성/);
  assert.match(home, /변경 예정 비밀번호/);
  assert.match(home, /PIN 번호를 변경했는가/);
  assert.match(home, /공지 했는가/);
  assert.match(home, /파티 비번 & PIN 알림/);
  assert.match(home, /남은 파티원 공지 템플릿/);
  assert.match(home, /복사/);
  assert.match(home, /전체공지 발송/);
  assert.match(home, /buildPartyNoticeTemplate/);
  assert.match(home, /excludeDealUsids/);
  assert.match(home, /noticeSent/);
  assert.match(home, /변경된 PIN/);
  assert.match(home, /PIN 변경 확인됨/);
  assert.match(home, /이메일 새탭 열기/);
  assert.match(home, /기존 파티원 프로필을 제거했는가/);
  assert.match(home, /구독을 해지했는가/);
  assert.match(home, /파티 재시작 YES 시 완료 탭으로 이동/);
  assert.match(home, /splitPartyMaintenanceChecklistItems\(items\)/);
  assert.match(home, /대상 복귀/);
  assert.match(home, /이용중 0명|7일 이내 만료/);
  assert.match(home, /buildPartyMaintenanceTargets\(data/);
  assert.match(home, /party-maintenance-checklists/);
  const write = read('src/web/pages/write.tsx');
  const quickAccountModal = read('src/web/components/quick-account-created-modal.tsx');
  assert.match(write, /WRITE_PRODUCT_PRESET_KEY/);
  assert.match(write, /makeDefaultProductTitle/);
  assert.match(write, /makeDefaultProductDescription/);
  const writeDefaults = read('src/lib/write-default-template.ts');
  assert.match(writeDefaults, /TV ✅ 이메일 셀프인증 ✅ 프리미엄 ✅/);
  assert.match(writeDefaults, /⚠️ 1 1 1 원칙을 꼭 지켜주세요 ⚠️/);
  assert.match(write, /글 기본값 프리셋/);
  assert.match(write, /현재 제목·설명 기본값으로 저장/);
  assert.match(write, /기본값 불러오기/);
  assert.match(write, /기본값 초기화/);
  assert.match(write, /loadWriteProductPresets/);
  assert.match(write, /saveCurrentAsPreset/);
  assert.match(write, /applyPresetForService/);
  assert.match(write, /resetPresetForService/);
  assert.match(write, /재정비 DB 자동 불러오기/);
  assert.match(write, /findMaintenanceCredentialForAlias/);
  assert.match(write, /maintenanceCredentialStore/);
  assert.match(write, /setKeepPasswd\(credential\.password\)/);
  assert.match(write, /setKeepPasswd\(''\)/);
  assert.match(write, /랜덤 프로필명/);
  assert.match(write, /profileNickname/);
  const partyTemplate = read('src/lib/party-access-template.ts');
  const partyAccess = read('src/web/pages/party-access.tsx');
  assert.match(write, /PARTY_ACCESS_URL_PLACEHOLDER/);
  assert.match(partyTemplate, /계정 접근 토큰 생성 주소/);
  assert.match(partyTemplate, /기타 문의사항은 연락 주시면 감사하겠습니다/);
  assert.match(partyAccess, /100dvh/);
  assert.match(partyAccess, /env\(safe-area-inset-bottom\)/);
  assert.match(partyAccess, /WebkitOverflowScrolling/);
  assert.match(partyAccess, /overscrollBehavior:'contain'/);
  assert.match(partyAccess, /scrollIntoView\(\{ block:'center', behavior:'smooth' \}\)/);
  assert.match(partyAccess, /scrollMarginBottom:'150px'/);
  assert.match(partyAccess, /3개 내용 모두 동의하고 계정정보 보기/);
  assert.match(partyAccess, /onPaste=\{blockConsentPaste\}/);
  assert.match(partyAccess, /\{completedConsentCount\}\/3/);
  assert.match(partyAccess, /complaint-case\.jpg/);
  assert.match(partyAccess, /disney-profiles\.jpg/);
  assert.match(write, /profile-assignments/);
  assert.match(write, /계정 접근 링크 템플릿/);
  assert.doesNotMatch(home, /최근 만료 파티 체크리스트/);
  assert.doesNotMatch(home, /expired-party-checklists/);
  assert.match(home, /실시간 채팅 알림/);
  assert.match(home, /최신 메시지 10개/);
  assert.doesNotMatch(home, /안 읽은 문의 내용/);
  assert.match(home, /메시지 도착/);
  assert.match(home, /계정/);
  assert.match(home, /내용 확인 필요/);
  assert.match(home, /캐시 표시중/);
  assert.match(home, /rateLimited/);
  assert.match(home, /messageHydrationFailedCount/);
  assert.match(home, /buildLatestChatMessages\(json\.rooms \|\| \[\], 10\)/);
  assert.doesNotMatch(home, /buildUnreadChatAlerts\(json\.rooms \|\| \[\], 5\)/);
  assert.doesNotMatch(home, /buildChatAlerts\(json\.rooms \|\| \[\], 5\)/);
  assert.match(home, /fetch\('\/api\/chat\/rooms'\)/);
  const chat = read('src/web/pages/chat.tsx');
  assert.match(chat, /isMobile/);
  assert.match(chat, /안읽음만 보기/);
  assert.match(chat, /구매자 메시지 최신순/);
  assert.match(chat, /계정별 정리/);
  assert.match(chat, /useState<ChatSortMode>\('latest'\)/);
  assert.match(chat, /읽음 처리/);
  assert.match(chat, /window\.history\.replaceState\(null, '', `\/dashboard\/chat\?room=\$\{encodeURIComponent\(room\.chatRoomUuid\)\}`\)/);
  assert.match(chat, /locallyReadRoomsRef/);
  assert.match(chat, /markRoomRead\(room, \{ silent: true \}\)/);
  assert.match(chat, /json\.ok === false/);
  assert.match(chat, /목록/);
  assert.match(chat, /mobileChatHidden/);
  assert.match(home, /buildServiceStats\(data, manuals\)/);
  assert.match(home, /buildMonthlyNetProfitSummary\(data, manuals\)/);
  assert.match(home, /오늘 일 순수익/);
  assert.match(home, /매일 고정비 차감 후 실제 손에 쥐는 금액/);
  assert.match(home, /일 수입/);
  assert.match(home, /구독료\/일/);
  assert.match(home, /추가\/일/);
  assert.match(home, /30일 환산 ≈/);
  assert.match(home, /확정 수입 \(정산완료\)/);
  assert.match(home, /월 예상 순수익/);
  assert.match(home, /전체 기간의 총 손익/);
  assert.match(home, /계약 전액, 구독료는 기간 내 월 횟수만큼/);
  assert.doesNotMatch(home, /이번 달 기준으로 보는 수익/);
  assert.match(home, /currentMonthLabel/);
  assert.match(home, /파티유지비용/);
  assert.match(home, /수수료\(10%\)/);
  assert.doesNotMatch(home, /식: 그레이태그 30일 수익×0\.9 \+ 수동 30일 수익 - 구독료/);
  assert.doesNotMatch(home, /풀파티시/);
  assert.doesNotMatch(home, /fullPartyNetProfit \/ 10000/);
  assert.doesNotMatch(home, /일단가×30×인원×0\.9 - 구독료/);
  assert.doesNotMatch(home, /FULL_PARTY_NET_EXTRA/);
  assert.match(home, /buildDailyInflow\(data, manuals, \{ days: range \}\)/);
  assert.match(home, /serviceKeys/);
  assert.match(home, /서비스별 누적 막대/);
  assert.match(home, /계정 확인중/);
  assert.match(home, /운영센터/);
  assert.match(home, /프로필 정리 · 수동 고객 · 카카오톡 응대 큐/);
  assert.match(home, /fetch\('\/api\/operations-center\/summary'\)/);
  assert.match(home, /채팅\/초안 확인/);
  assert.match(home, /계정·프로필 정리/);
  const homeManageCtaIndex = home.indexOf('계정 관리 열기');
  const homeSafeModeIndex = home.indexOf('{safeMode &&');
  assert.ok(homeManageCtaIndex > -1 && homeSafeModeIndex > -1 && homeManageCtaIndex < homeSafeModeIndex, 'Home should show a lightweight account-management CTA before status panels');
  const dashboardStats = read('src/web/lib/dashboard-stats.ts');
  assert.match(dashboardStats, /OTT_MONTHLY_SUBSCRIPTION_COST/);
  assert.match(dashboardStats, /activeMemberDailyRate/);
  assert.match(dashboardStats, /activeMemberProjectedGross/);
  assert.match(dashboardStats, /overlapDays/);
  assert.match(dashboardStats, /GRAYTAG_NET_RATE = 0\.9/);
  assert.doesNotMatch(dashboardStats, /return member\.purePrice;\s*\n/);
  assert.doesNotMatch(dashboardStats, /member\.purePrice \/ days \* 30/);
  assert.match(dashboardStats, /source: 'manual'/);
  assert.match(read('src/lib/account-check-inflow.ts'), /firstSeenDate/);
  assert.match(read('src/lib/account-check-inflow.ts'), /isCancelledOrRemovedDeal/);
  assert.match(nav, /운영/);
  assert.match(nav, /자동화/);
  assert.match(admin, /인증됨|잠김|오류/);
  const manage = read('src/web/pages/manage.tsx');
  assert.doesNotMatch(manage, /<ManualResponseQueuePanel \/>/);
  assert.doesNotMatch(manage, /일주일 이내 만료되는 파티원 명단/);
  assert.doesNotMatch(manage, /expiringSoonMembers/);
  assert.doesNotMatch(manage, /weekEnd\.setDate\(weekEnd\.getDate\(\) \+ 7\)/);
  // 취소 데이터·백엔드는 유지하고 화면 블록만 제거 (absence contract)
  assert.doesNotMatch(manage, /최근 7일 거래 취소 명단/);
  assert.doesNotMatch(manage, /cancelledRecent/);
  assert.doesNotMatch(manage, /cancellationDateTime/);
  assert.doesNotMatch(manage, /isCancelledStatus/);
  assert.doesNotMatch(manage, /<ProfileAuditPanel/);
  assert.doesNotMatch(manage, /프로필 수 검증/);
  assert.doesNotMatch(manage, /수동 고객\/카카오톡 응대 큐/);
  assert.match(manage, /findExactPasswordForAccount/);
  assert.match(manage, /requireExactAliasMemoForAutoFill/);
  assert.match(manage, /buildAutoFillDeliveryMemo/);
  assert.match(manage, /배정된 프로필 이름/);
  assert.match(manage, /storedProfileByRef/);
  assert.match(manage, /usedProfiles/);
  assert.match(manage, /!usedProfiles\.has\(storedProfileName\)/);
  const apiIndex = read('src/api/index.ts');
  assert.match(apiIndex, /profileName: mappedProfileName/);
  assert.match(apiIndex, /buildProfileAssignmentByProductUsid/);
  assert.match(apiIndex, /profileAssignmentByProductUsid\.get\(productUsid\)/);
  assert.match(apiIndex, /assignmentAccountEmail/);
  assert.match(apiIndex, /findGeneratedAccountForManagement/);
  assert.match(apiIndex, /snapshotByOnSaleProductUsid/);
  assert.match(apiIndex, /uniqueOnSaleSnapshotForService/);
  assert.match(apiIndex, /keepAcctSetting\?productUsid/);
  assert.match(apiIndex, /findPartyAccessSnapshotsFromText/);
  assert.match(apiIndex, /nextPartyAccessStore: PartyAccessLinkStore/);
  assert.match(apiIndex, /management-\$\{entry\.serviceType\}-\$\{entry\.email\}-\$\{memberId\}/);
  assert.match(apiIndex, /partyAccessStoreChanged/);
  assert.match(manage, /const displayAccountEmail = isAccessNoticeCredentialValue\(acct\.email\) \? '계정 매핑 필요' : acct\.email/);
  assert.match(manage, /\{displayAccountEmail\}/);
  assert.match(manage, /isAccessNoticeCredentialValue\(acct\.email\) \? '' : acct\.email/);
  assert.match(manage, /isAccessNoticeCredentialValue\(credential\?\.password \|\| acct\.keepPasswd \|\| ''\)/);
  assert.match(apiIndex, /assignedProfileNameFromHistory/);
  assert.doesNotMatch(apiIndex, /const assignedProfileNameFromProduct = profileNameByProductUsid\.get\(String\(deal\.productUsid/);
  assert.match(manage, /계정 접근 링크 템플릿/);
  assert.match(manage, /fillProfileNickname/);
  assert.match(manage, /generateUniqueProfileNicknames/);
  assert.match(manage, /handleBulkFillAll/);
  assert.match(manage, /countBulkFillTargets\(svc\.serviceType\)/);
  assert.match(manage, /handleBulkFillAll\(svc\.serviceType\)/);
  assert.match(manage, /카테고리 메꾸기/);
  assert.match(manage, /전체 메꾸기중/);
  assert.doesNotMatch(manage, /전체 메꾸기 미리보기 필요/);
  const editPrice = read('src/web/pages/edit-price.tsx');
  assert.match(editPrice, /카테고리별 마지노선 직접 입력/);
  assert.match(editPrice, /마지노선 저장하고 미리보기/);
  assert.match(editPrice, /floorDailyByCategory/);
  assert.match(editPrice, /211원이 1등이면 210원/);
  assert.match(editPrice, /const priceForProduct = \(p: Product\)/);
  assert.match(editPrice, /return inputDailyPrice \* p\.remainderDays/);
  assert.match(editPrice, /price: String\(priceForProduct\(p\)\)/);
  const generatedAccounts = read('src/lib/generated-accounts.ts');
  assert.match(manage, /계정 생성/);
  assert.match(manage, /getGeneratedAccountCreationCopy\(accountCreateService\)/);
  assert.match(manage, /빠른 계정 생성/);
  assert.match(manage, /quick-account-generator-form/);
  assert.match(manage, /Prefix를 비워두면 다음 번호를 자동으로 선택합니다/);
  assert.doesNotMatch(manage, /accountCreateCopy\.description/);
  assert.doesNotMatch(manage, /accountCreateCopy\.prefixHelp/);
  assert.match(generatedAccounts, /웨이브 19,500원 더블 플랜/);
  assert.match(generatedAccounts, /티빙 로그인 ID는 gtwavveN/);
  assert.match(generatedAccounts, /웨이브 로그인은 같은 prefix의 Email alias/);
  assert.match(generatedAccounts, /더블플랜 번호 \/ 티빙 로그인 ID/);
  assert.match(generatedAccounts, /Email 대시보드 alias/);
  assert.match(generatedAccounts, /티빙\+웨이브/);
  assert.match(generatedAccounts, /더블이용권 묶음 관리/);
  assert.doesNotMatch(manage, /티빙 연결됨/);
  assert.doesNotMatch(manage, /웨이브 연결됨/);
  assert.doesNotMatch(manage, /doublePassBundle/);
  assert.match(manage, /generated-accounts\/create/);
  assert.match(generatedAccounts, /alias prefix 직접 설정/);
  assert.match(manage, /accountCreatePrefix/);
  assert.match(manage, /aliasPrefix: accountCreatePrefix\.trim\(\)/);
  assert.match(manage, /mergeGeneratedAccountsIntoManagement/);
  assert.match(manage, /setEmailAliases/);
  assert.match(manage, /SimpleLogin 반영 확인 중/);
  assert.match(manage, /void doFetch\(undefined, \{ forceRefresh: true, silent: true \}\)/);
  const generatedAccountHandler = manage.slice(manage.indexOf('const handleCreateGeneratedAccount'), manage.indexOf('const toggleGeneratedAccountPaid'));
  assert.doesNotMatch(generatedAccountHandler, /await doFetch\(undefined, \{ forceRefresh: true, silent: true \}\)/);
  assert.match(manage, /계정 관리에 바로 표시됨/);
  assert.match(manage, /QuickAccountCreatedModal/);
  assert.match(quickAccountModal, /정보 전체 복사/);
  assert.match(quickAccountModal, /결제 완료로 체크/);
  assert.match(quickAccountModal, /글쓰기 바로 시작/);
  assert.doesNotMatch(manage, /accountCreateCopy\.featureLabels\.map/);
  assert.match(manage, /findQuickPostAccount\(data\?\.services \|\| \[\], quick\.id, quick\.serviceType\)/);
  assert.match(manage, /await openFillModalForAccount\(target, vacancyInfo\)/);
  assert.doesNotMatch(manage, /navigate\('\/write'\)/);
  assert.doesNotMatch(write, /consumeQuickWriteDraft/);
  assert.match(generatedAccounts, /비워두면 서비스별 다음 번호를 자동 생성/);
  assert.match(manage, /생성만 완료/);
  assert.match(manage, /결제 완료/);
  assert.match(manage, /findEmailAliasId\(acct\)/);
  assert.match(manage, /resolveDoublePassBundleNo\(\{ serviceType: acct\.serviceType/);
  assert.match(manage, /resolveDoublePassBundleNo\(\{ serviceType: '웨이브'/);
  assert.match(manage, /확인중 \${serviceVerifyingCount}명/);
  assert.match(manage, /계정 확인중\(파란색 추적\)/);
  assert.match(manage, /isAccountCheckingMember/);
  assert.match(manage, /includes\('계정확인중'\)/);
  assert.match(manage, /'#2563EB'/);
  assert.match(manage, /openEmailDashboardForAccount\(acct\)/);
  assert.match(manage, /이메일 대시보드 새 탭 열기/);
  assert.match(manage, /https:\/\/email-verify\.one\/email\/mail/);
  assert.match(manage, /계정별 파티원 공지/);
  assert.match(manage, /공지 메시지/);
  assert.match(manage, /보낼 사람 선택/);
  assert.match(manage, /공지 템플릿/);
  assert.match(manage, /계정 변경 템플릿/);
  assert.match(manage, /템플릿 이름/);
  assert.match(manage, /현재 메시지를 전역 템플릿으로 추가/);
  assert.match(manage, /GLOBAL_NOTICE_TEMPLATE_STORAGE_KEY/);
  assert.match(manage, /저장된 템플릿은 모든 카테고리 공지에서 같이 사용돼요/);
  assert.match(manage, /수정한 정보로 저장하기/);
  assert.doesNotMatch(manage, /수정한 정보를 보냈나요/);
  assert.match(manage, /\/api\/chat\/notice\/send/);
  assert.match(manage, /excludeDealUsids/);
  assert.match(manage, /checklistKey/);
  assert.doesNotMatch(manage, /최근 7일 거래 취소 명단/);
  assert.doesNotMatch(manage, /cancelledRecentMembers/);
  assert.match(manage, /선택한 파티원에게 공지 발송/);
  assert.match(manage, /생성계정 게시글 작성/);
  assert.match(manage, /\$\{vi\.unfilled\}자리 게시글 작성/);
  assert.match(manage, /관리자 전용 ID · PW · PIN/);
  assert.match(manage, /계정 클릭 시에만 표시/);
  assert.match(manage, /복붙용/);
  assert.match(apiIndex, /mergeArchivedAccountsIntoManagement/);
  assert.match(manage, /acct\.archivedAccount/);
  assert.match(manage, /만료 · 보관 계정/);
  assert.match(manage, /archivedCredential/);
  assert.match(manage, /보관된 실제 ID\/PW/);
  assert.match(manage, /paymentCard\?: ManagementPaymentCard/);
  assert.match(manage, /결제 카드:/);
  assert.match(manage, /••••/);
  assert.match(manage, /카드 별칭/);
  assert.match(manage, /카드사/);
  assert.match(manage, /끝 4자리/);
  assert.match(manage, /카드 전체번호 · CVV · 유효기간은 입력하거나 저장하지 않아요/);
  assert.match(manage, /\/api\/management-payment-cards/);
  assert.match(manage, /method: 'PUT'/);
  assert.match(manage, /method: 'DELETE'/);
  assert.match(manage, /maxLength=\{60\}/);
  assert.match(manage, /inputMode="numeric"/);
  assert.match(manage, /\^\\d\{4\}\$/);
  assert.match(manage, /결제 카드 정보를 저장했어요/);
  assert.match(manage, /결제 카드 정보를 지웠어요/);
  assert.match(manage, /구독 갱신일/);
  assert.match(manage, /매월 \$\{acct\.paymentCard\.renewalDay\}일 갱신/);
  assert.match(manage, /isNetflixManagementService\(acct\.serviceType\)/);
  assert.match(manage, /type="number"/);
  assert.match(manage, /min=\{1\}/);
  assert.match(manage, /max=\{31\}/);
  assert.match(manage, /renewalDay:/);
  assert.doesNotMatch(manage, /탈퇴한 파티원 · 파티별 정리/);
  assert.doesNotMatch(manage, /탈퇴 날짜 최신순/);
  assert.doesNotMatch(manage, /buildWithdrawnPartyMembers/);
  assert.doesNotMatch(manage, /password: credentialRows\[1\]\.value/);
  assert.doesNotMatch(manage, /pin: credentialRows\[2\]\.value/);
  assert.match(read('src/api/index.ts'), /lastPassword: mappedPassword/);
  assert.match(read('src/api/index.ts'), /lastPin: mappedPin/);
  assert.match(read('src/api/index.ts'), /resolveEmailAliasFill\(\{ accountEmail: enriched\.accountEmail, serviceType: enriched\.serviceType, aliases \}\)/);
  // 탈퇴한 파티원 정리 UI 삭제 (데이터·백엔드 유지) — 마지막 PW/PIN/제안후보는 계정 카드 자격증명 행에서 계속 사용

  assert.match(read('src/web/lib/withdrawn-party-members.ts'), /credentialAdvice/);
  assert.match(manage, /PIN 번호 재설정/);
  assert.match(manage, /handleGeneratePasswordDraft/);
  assert.match(manage, /generateMaintenancePassword/);
  assert.match(manage, /비밀번호 재설정/);
  assert.match(manage, /새 비밀번호를 입력했습니다/);
  assert.match(manage, /최신 ID\/PW를 저장했습니다/);
  assert.match(manage, /PIN 번호를 재설정했습니다/);
  assert.match(manage, /showToast/);
  assert.match(manage, /toast\.message/);
  assert.doesNotMatch(manage, /setPinResetNoticeKey\(key\);\s*await doFetch\(undefined, true\);/);
  assert.match(manage, /loadExistingPinForAccount/);
  assert.match(manage, /existingPinCache/);
  assert.match(manage, /\/api\/email-alias-fill\?email=/);
  assert.match(manage, /기존 PIN 로딩중/);
  assert.match(manage, /기존 PIN 로드 완료/);
  assert.match(manage, /수정한 정보로 저장하기/);
  assert.match(manage, /최신 비밀번호 저장/);
  assert.match(manage, /파티원 전용 계정정보 링크/);
  assert.doesNotMatch(manage, /퇴장 정리 체크리스트/);
  assert.doesNotMatch(manage, /updateAccountExitChecklist/);
  // 만료 · 보관 계정: 하단 collapsed <details> 접힘 UI 계약
  assert.match(manage, /<details className="management-archived-accounts"/);
  assert.match(manage, /만료 · 보관 계정 \(\{archivedAccounts\.length\}\)/);
  assert.match(manage, /archivedAccounts\.map\(acct => archivedAccountSummaryRow\(acct\)\)/);
  // 빠른 계정 생성 즉시반영 + 실패 시에만 재조회 fallback
  const quickCreateBlock = manage.slice(manage.indexOf('const handleCreateGeneratedAccount'), manage.indexOf('const markQuickCreatedAccountPaid'));
  assert.match(quickCreateBlock, /mergeGeneratedAccountsIntoManagement\(prev, \{ \[account\.id\]: account \}\)/);
  const quickCreateSuccessPath = quickCreateBlock.slice(0, quickCreateBlock.indexOf('} catch'));
  assert.doesNotMatch(quickCreateSuccessPath, /doFetch/);
  assert.match(quickCreateBlock, /빠른 계정 생성 반영 실패/);
  // 매꾸기 성공 응답 optimistic 반영 pure helper
  assert.match(manage, /applyCreatedProductsToManageData/);
  assert.match(manage, /rollbackCreatedProductsFromManageData/);
  assert.match(manage, /void doFetch\(undefined, \{ forceRefresh: true, silent: true \}\)/);
  assert.match(manage, /수동 전달 템플릿 복사/);
  assert.match(manage, /copyMode: 'url' \| 'admin-url' \| 'template'/);
  assert.match(manage, /manualTemplateKey/);
  assert.match(manage, /profileNameForMember/);
  assert.match(manage, /generateUniqueProfileNicknames/);
  assert.match(read('src/lib/party-access-template.ts'), /기타 문의사항은 연락 주시면 감사하겠습니다/);
  assert.doesNotMatch(manage, /createManualPartyAccessTemplate/);
  assert.doesNotMatch(manage, /manual-template/);
  assert.match(read('src/lib/party-access-template.ts'), /계정 업데이트 주소/);
  assert.match(read('src/lib/party-access-template.ts'), /이용하시기 전 꼭 하셔야 하는 2 STEP/);
  assert.match(read('src/lib/party-access-template.ts'), /이메일 접근 링크 버튼 누르고 핀번호 입력하고 인증 받기/);
  assert.match(read('src/lib/party-access-template.ts'), /꼭 정해진 프로필 이름으로 만들어주세요/);
  assert.match(read('src/lib/party-access-template.ts'), /로그인이 안될 때마다 직접 묻지 마시고/);
  assert.match(manage, /emailAccessUrl/);
  assert.match(manage, /profileName/);
  assert.match(manage, /접근 링크 만들기/);
  assert.match(manage, /party-access-links/);
  assert.match(manage, /createPartyAccessLink/);
  assert.match(manage, /buildFillPartyAccessMember/);
  assert.match(manage, /fetch\('\/api\/party-access-links'/);
  assert.match(manage, /buildAutoFillDeliveryMemo\(usidProfileNickname, accessJson\.url\)/);
  assert.match(manage, /GRAYTAG_ACCESS_NOTICE_ID/);
  assert.match(manage, /GRAYTAG_ACCESS_NOTICE_PW/);
  assert.match(read('src/web/pages/write.tsx'), /GRAYTAG_ACCESS_NOTICE_ID/);
  assert.match(read('src/web/pages/write.tsx'), /GRAYTAG_ACCESS_NOTICE_PW/);
  const graytagFill = read('src/lib/graytag-fill.ts');
  assert.match(graytagFill, /프로필 생성 시 만약 꽉차거나 지금 화면에 안보이는 프로필들이 있다면 매칭되지 않는 프로필 아무거나 하나 삭제해주세요\./);
  assert.match(graytagFill, /만약 반대로 정해진 프로필 이름대로 생성 안하면 삭제될 수도 있으니 정확히 만들어주세요\./);
  assert.ok(graytagFill.indexOf('프로필 생성 시 만약 꽉차거나') < graytagFill.indexOf('계정 업데이트 주소:'));
  assert.match(graytagFill, /아래 메세지를 꼭 확인해주세요/);
  assert.match(graytagFill, /그래야 계정에 접근할 수 있습니다/);
  assert.match(manage, /productName: makeDefaultProductTitle\(fillModal\.serviceType\)/);
  assert.match(manage, /sellingGuide: makeDefaultProductDescription\(fillModal\.serviceType\)/);
  assert.match(manage, /fallbackPin: fillAliasStatus\?\.pin/);
  assert.match(manage, /endDateTime: toGraytagDate\(fillEndDate\)/);
  assert.doesNotMatch(manage, /buildAutoFillDeliveryMemo\(usidProfileNickname, fillAliasStatus\?\.memo \|\| fillKeepMemo\)/);
  assert.match(read('src/web/app.tsx'), /AccessWrapped/);
  assert.match(read('src/web/app.tsx'), /\/access\/:token/);
  assert.match(read('src/web/app.tsx'), /\/dashboard\/access\/:token/);
  const partyAccessPage = read('src/web/pages/party-access.tsx');
  const partyAccessShell = read('src/lib/party-access-page-html.ts');
  const server = read('server.ts');
  assert.match(partyAccessPage, /이용기간 중에만 계정 정보를 확인할 수 있어요/);
  assert.match(partyAccessPage, /fetch\(`\/api\/party-access\/\$\{encodeURIComponent\(token\)\}`,[\s\S]*cache: 'no-store'/);
  assert.match(read('src/api/index.ts'), /Cache-Control', 'no-store/);
  assert.match(partyAccessPage, /최신 ID · PW · PIN/);
  assert.match(read('src/web/app.tsx'), /const isAccess = location\.startsWith\("\/access\/"\) \|\| location\.startsWith\("\/dashboard\/access\/"\)/);
  assert.match(read('src/web/app.tsx'), /!isChat && <AdminTokenControl/);
  assert.match(read('src/web/app.tsx'), /!isChat && !isAccess && <BottomNav/);
  assert.match(read('src/web/lib/admin-auth.ts'), /"\/api\/party-access"/);
  assert.match(partyAccessPage, /이용 전 필수 동의/);
  assert.match(partyAccessPage, /계정 정보 수정 금지/);
  assert.match(partyAccessPage, /비밀번호·이메일·프로필 잠금·결제 설정은 바꾸지 마세요/);
  assert.match(partyAccessPage, /로그인이 안 되면 먼저 이 페이지를 새로고침해 확인하세요/);
  assert.match(partyAccessPage, /배정된 1개 프로필만 사용하겠습니다/);
  assert.match(partyAccessPage, /고소장 실제사례 이미지/);
  assert.match(partyAccessPage, /프로필 수정 화면 예시/);
  assert.match(partyAccessPage, /진행 상황: \{completedConsentCount\}\/3/);
  assert.match(partyAccessPage, /복사\/붙여넣기 없이 직접 입력/);
  assert.match(partyAccessPage, /onPaste=\{blockConsentPaste\}/);
  assert.match(partyAccessPage, /누가 시청할까요\?/);
  assert.match(partyAccessPage, /getProfileAvatarTheme/);
  assert.match(partyAccessPage, /profile\.isCurrentMember/);
  assert.ok(partyAccessPage.indexOf('누가 시청할까요?') < partyAccessPage.indexOf('credentialRows(payload).map'));
  assert.match(partyAccessPage, /프로필이 꽉 찼다면 위 현황에 없는 프로필을 삭제/);
  assert.match(partyAccessPage, /access-consent-v3:/);
  assert.match(partyAccessPage, /\/consent/);
  assert.match(partyAccessPage, /payload\.profileName/);
  assert.match(partyAccessPage, /이메일 확인하러 가기/);
  assert.match(partyAccessPage, /role="dialog"/);
  assert.match(partyAccessPage, /aria-modal="true"/);
  assert.match(partyAccessPage, /PIN을 먼저 확인해 주세요/);
  assert.match(partyAccessPage, /등록된 PIN이 없어요/);
  assert.match(partyAccessPage, /복사했어요/);
  assert.match(partyAccessPage, /target="_blank"/);
  assert.match(partyAccessPage, /rel="noreferrer"/);
  assert.doesNotMatch(partyAccessPage, /이메일 인증\/핀번호 확인 링크/);
  assert.doesNotMatch(partyAccessPage, /현재 파티원 프로필 현황/);
  assert.match(partyAccessPage, /EMAIL/);
  assert.match(partyAccessPage, /textarea/);
  assert.match(partyAccessShell, /buildPartyAccessHtml/);
  assert.match(partyAccessShell, /fetch\('\/api\/party-access\/'/);
  assert.match(partyAccessShell, /계정 정보 수정 금지/);
  assert.match(partyAccessShell, /고소장 실제사례 이미지/);
  assert.match(partyAccessShell, /프로필 수정 화면 예시/);
  assert.match(partyAccessShell, /complaint-case\.jpg/);
  assert.match(partyAccessShell, /disney-profiles\.jpg/);
  assert.match(partyAccessShell, /복사\/붙여넣기 없이 직접 입력/);
  assert.match(partyAccessShell, /access-consent-v3:/);
  assert.match(partyAccessShell, /\/consent/);
  assert.match(partyAccessPage, /adminAccess/);
  assert.match(partyAccessPage, /관리자 인증으로 동의 절차를 건너뛰었습니다/);
  assert.match(partyAccessShell, /getAdminToken/);
  assert.match(partyAccessShell, /admin_token/);
  assert.match(partyAccessShell, /x-admin-token/);
  assert.match(partyAccessShell, /adminAccess/);
  assert.match(partyAccessShell, /관리자 인증으로 동의 절차를 건너뛰었습니다/);
  assert.match(partyAccessShell, /누가 시청할까요\?/);
  assert.match(partyAccessShell, /profile-avatar-grid/);
  assert.match(partyAccessShell, /PIN을 먼저 확인해 주세요/);
  assert.match(partyAccessShell, /등록된 PIN이 없어요/);
  assert.match(partyAccessShell, /이메일 확인하러 가기/);
  assert.match(partyAccessShell, /setAttribute\('role','dialog'\)/);
  assert.match(partyAccessShell, /setAttribute\('aria-modal','true'\)/);
  assert.doesNotMatch(partyAccessShell, /이메일 인증\/핀번호 확인 링크/);
  assert.doesNotMatch(partyAccessShell, /현재 파티원 프로필 현황/);
  assert.ok(partyAccessShell.indexOf("card.appendChild(renderProfilePicker") < partyAccessShell.indexOf("card.appendChild(rows)"));
  assert.match(server, /app\.get\('\/dashboard\/access\/:token'/);
  assert.match(server, /app\.get\('\/access\/:token'/);
  assert.match(server, /buildPartyAccessHtml/);
  assert.match(server, /app\.get\('\/access-notice-assets\/:name'/);
  assert.match(server, /app\.get\('\/dashboard\/access-notice-assets\/:name'/);
  assert.match(server, /accessNoticeAssetsDir/);
  assert.match(server, /cache-control': 'public, max-age=31536000, immutable'/);
  assert.match(manage, /수동 전달 템플릿 복사/);
  assert.match(manage, /admin-url/);
  assert.match(manage, /\(인증 무시\)바로 접근 링크 만들기/);
  assert.match(manage, /admin_token/);
  assert.match(read('src/api/index.ts'), /emailAccessUrl/);
  assert.match(read('src/api/index.ts'), /profileName/);
  assert.match(read('src/api/index.ts'), /PARTY_ACCESS_LINKS_PATH/);
  assert.match(read('src/api/index.ts'), /app\.post\('\/party-access-links'/);
  assert.match(read('src/api/index.ts'), /app\.get\('\/party-access\/:token'/);
  assert.match(read('src/lib/party-access.ts'), /partyAccessTokenHash/);
  assert.match(read('src/lib/party-access.ts'), /buildPartyAccessPublicPayload/);
  assert.match(manage, /Y/);
  assert.match(manage, /N/);
  assert.match(manage, /결제\/가입 완료/);
  assert.match(manage, /paymentStatus === 'paid'/);
  assert.match(manage, /maintenanceChecklistStore/);
  assert.match(manage, /findMaintenanceCredentialForAccount/);
  assert.match(manage, /credential\?\.password/);
  assert.match(manage, /credential\?\.pin/);
  assert.match(manage, /serviceUsingWithManual/);
  assert.match(manage, /totalManualUsingCount/);
  assert.match(manage, /forceRefresh: true/);
  assert.match(manage, /silent: true/);
  assert.match(manage, /if \(forceRefresh\) headers\['Cache-Control'\] = 'no-cache'/);
  assert.doesNotMatch(manage, /forceRefresh \? 'no-cache' : 'no-store'/);
  assert.match(home, /fetchData\(\{ silent: true \}\)/);
  assert.match(manage, /판매 게시물 없이도 계정 관리에 유지/);
  assert.match(manage, /방금 생성한 계정 삭제/);
  assert.match(manage, /method:'DELETE'/);
  assert.match(manage, /handleDeleteGeneratedAccount/);
  assert.match(read('src/api/index.ts'), /app\.delete\('\/generated-accounts\/:id'/);
  assert.match(read('src/api/index.ts'), /createSimpleLoginCustomAlias/);
  assert.doesNotMatch(read('src/api/index.ts'), /graytag-account-generator/);
  assert.match(read('src/api/index.ts'), /nextGeneratedAliasPrefix/);
  assert.match(read('src/api/index.ts'), /excludeDealUsids/);
  assert.match(read('src/api/index.ts'), /noticeSent: true/);
  assert.match(read('src/api/index.ts'), /manualPrefix: aliasPrefix/);
  assert.match(read('src/api/index.ts'), /normalizeManualAliasPrefix/);
  assert.match(read('src/api/index.ts'), /api\/v2\/alias\/custom\/new/);
  assert.match(read('src/api/index.ts'), /DELETE.*api\/aliases/);
  assert.match(read('src/api/index.ts'), /mergeGeneratedAccountsIntoManagement/);
  assert.match(read('src/api/index.ts'), /mergeOnSaleAccountsIntoManagement\(withGeneratedAccounts, onSaleByKeepAcct\)/);
  assert.match(read('src/api/index.ts'), /applyManagementHiddenAccounts/);
  assert.match(read('src/api/index.ts'), /MANAGEMENT_HIDDEN_ACCOUNTS_PATH/);
  assert.match(read('src/api/index.ts'), /managementCache\.clear\('auto-session'\)/);
  assert.doesNotMatch(read('src/api/index.ts'), /mergeTvingWavveServicesForManagement/);
  assert.match(read('src/api/index.ts'), /shouldHydrateDeliveredAccountFromChat/);
  assert.match(read('src/api/index.ts'), /extractDeliveredAccountFromChats/);
  assert.match(read('src/api/index.ts'), /extractGraytagChats\(msgData\)/);
  assert.match(read('src/api/index.ts'), /findBeforeUsingLenderDeals/);
  assert.match(read('src/api/index.ts'), /계정확인중 포함/);
  assert.match(read('src/api/index.ts'), /extractLenderDeals/);
  assert.match(read('src/api/index.ts'), /isAccountCheckingDeal/);
  assert.match(read('src/api/index.ts'), /ACCOUNT_CHECK_INFLOW_PATH/);
  assert.match(read('src/api/index.ts'), /buildAccountCheckInflowStore/);
  assert.match(read('src/api/index.ts'), /accountCheckInflow\.inflowDateByDealUsid/);
  assert.match(chat, /new URLSearchParams\(window\.location\.search\)\.get\('room'\)/);
  assert.doesNotMatch(manage, /ANY product with a password from ANY account/);
});

test('website shell includes dollar emoji icon', () => {
  const html = read('index.html');
  assert.match(html, /<title>OTT Dashboard<\/title>/);
  assert.match(html, /rel="icon"/);
  assert.match(html, /💵|%F0%9F%92%B5|\$%EF%B8%8F|💲/);
});

test('selected YouTube service tile keeps its invitation badge horizontal on narrow screens', () => {
  const write = read('src/web/pages/write.tsx');
  assert.match(write, /position: service === s\.key && s\.key === 'youtube' \? 'relative' : undefined/);
  assert.match(write, /paddingBottom: service === s\.key && s\.key === 'youtube' \? 34 : 10/);
  assert.match(write, /position:'absolute', bottom:5, right:5/);
  assert.match(write, /whiteSpace:'nowrap'/);
});

test('dashboard startup stays lightweight and serves subpath assets directly', () => {
  const app = read('src/web/app.tsx');
  const home = read('src/web/pages/home.tsx');
  const server = read('server.ts');

  assert.match(app, /lazy\(\(\) => import\("\.\/pages\/manage"\)\)/);
  assert.match(app, /<Suspense/);
  assert.doesNotMatch(app, /import ManagePage from "\.\/pages\/manage"/);
  assert.doesNotMatch(app, /import ProfitPage from "\.\/pages\/profit"/);

  assert.doesNotMatch(home, /import ManagePage from "\.\/manage"/);
  assert.doesNotMatch(home, /<ManagePage \/>/);
  assert.match(home, /계정 관리 열기/);
  assert.match(home, /lazy\(\(\) => import\("\.\/profit"\)/);

  assert.match(server, /normalizeDashboardAssetPath/);
  assert.match(server, /pathname\.startsWith\('\/dashboard\/assets\/'\)/);
});
