import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const manage = readFileSync(new URL('../src/web/pages/manage.tsx', import.meta.url), 'utf8');

test('manage page integrates YouTube Premium into the CATEGORIES-ordered service section map', () => {
  assert.doesNotMatch(manage, /youtube-premium-management-card/);
  assert.doesNotMatch(manage, /youtube-management-service/);
  assert.match(manage, /const serviceSections: ManagementServiceSection\[\]/);
  assert.match(manage, /CATEGORIES\.findIndex/);
  assert.match(manage, /kind: 'youtube'/);
  assert.match(manage, /serviceSections\.map\(section =>/);
  assert.match(manage, /className="management-service-group"/);
  assert.match(manage, /className="management-service-toggle management-touch-target"/);
  assert.match(manage, /className="management-account-grid youtube-family-group-grid"/);
  assert.match(manage, /유튜브 프리미엄/);
  assert.match(manage, /가족 그룹 \{youtubeFamilyGroups\.length\}개/);
  assert.match(manage, /aria-expanded=\{isYouTubeServiceOpen\}/);
  assert.match(manage, /aria-controls="management-service-youtube"/);
  assert.match(manage, /aria-label="유튜브 프리미엄 초대 관리로 이동"/);
  assert.match(manage, /role="region" aria-label="유튜브 프리미엄 가족 그룹 목록"/);
});

test('YouTube family-group cards use the generic account-card header, metrics, actions, and details structure', () => {
  assert.match(manage, /managerEmailMasked/);
  assert.match(manage, /summarizeYouTubeFamilyGroup/);
  assert.match(manage, /className="youtube-family-group-card management-account-card"/);
  assert.match(manage, /className="management-account-header"/);
  assert.match(manage, /className="management-account-logo"/);
  assert.match(manage, /youtubeSlotStates\.map/);
  assert.match(manage, /\{group\.activeCount\}\/\{group\.sellableSeats\}/);
  assert.match(manage, /className="management-account-metrics"/);
  assert.match(manage, />사용 \/ 슬롯</);
  assert.match(manage, />만료일</);
  assert.match(manage, />등록 판매글</);
  assert.match(manage, />초대 \/ 파티원</);
  assert.match(manage, /className="management-account-actions youtube-family-group-actions"/);
  assert.match(manage, />상세보기</);
  assert.match(manage, />초대 관리</);
  assert.match(manage, />수정</);
  assert.match(manage, /비활성화/);
  assert.match(manage, /className="management-account-details youtube-family-member-list"/);
  assert.doesNotMatch(manage, /className="youtube-family-group-head"/);
  assert.doesNotMatch(manage, /className="youtube-family-actions"/);
  assert.match(manage, /구매자 이메일/);
  assert.match(manage, /YOUTUBE_EMAIL_CONFIRMED_STATUSES/);
  assert.match(manage, /aria-expanded=\{isGroupOpen\}/);
  assert.match(manage, /aria-controls=\{groupPanelId\}/);
  assert.match(manage, /navigate\('\/youtube-invites'\)/);
  assert.match(manage, /그룹 추가/);
  assert.match(manage, /기능이 비활성화되어 있습니다/);
  assert.match(manage, /가족 그룹을 불러오는 중/);
});

test('manage page fetches family groups and invitation members with admin auth', () => {
  assert.match(manage, /fetch\('\/api\/youtube\/family-groups'/);
  assert.match(manage, /fetch\('\/api\/youtube\/invitations'/);
  assert.match(manage, /fetch\('\/api\/youtube\/products\/registrations'/);
  assert.match(manage, /Promise\.all/);
  assert.match(manage, /parseYouTubeInvitationsResponse/);
  assert.match(manage, /parseYouTubeProductRegistrationsResponse/);
  assert.match(manage, /buildYouTubeFamilyGroupCreateBody/);
  assert.match(manage, /buildYouTubeFamilyGroupPatchBody/);
  assert.match(manage, /operator family group create/);
  assert.match(manage, /operator family group update/);
  assert.match(manage, /'x-audit-reason': 'operator family group disable'/);
  assert.match(manage, /변경할 때만 입력/);
  assert.match(manage, /사용 중인 좌석/);
  assert.match(manage, /window\.confirm\('이 가족 그룹을 비활성화할까요\?/);
  assert.doesNotMatch(manage, /console\.(?:log|warn|error)\([^\n]*managerEmail/);
});

test('overlapping YouTube refreshes allow only the latest generation to update request state', () => {
  assert.match(manage, /useRef/);
  assert.match(manage, /youtubeGroupsFetchGeneration\.current \+= 1/);
  assert.match(manage, /generation !== youtubeGroupsFetchGeneration\.current/);
});

test('YouTube cards show only registered Graytag product links and separate non-link registration states', () => {
  assert.match(manage, /제목 코드 \{group\.listingCode\}/);
  assert.match(manage, /youtubeRegisteredListingCount/);
  assert.match(manage, /youtubeRegistrationRecordCount/);
  assert.match(manage, /group\.registrations\s*\.filter\(registration => registration\.status === 'registered'\)/);
  assert.match(manage, /https:\/\/graytag\.co\.kr\/product\/detail\?productUsid=\$\{encodeURIComponent\(registration\.productUsid/);
  assert.match(manage, /유튜브 프리미엄 \{group\.listingCode\} · 게시물 \{index \+ 1\}/);
  assert.match(manage, /className="youtube-registration-statuses"/);
  assert.match(manage, /처리중/);
  assert.match(manage, /확인필요/);
  assert.match(manage, /실패/);
  assert.match(manage, />등록 기록<\/h3>/);
  assert.match(manage, /파티원\/초대/);
  assert.match(manage, /getYouTubeRegistrationDisplayLabel/);
  assert.match(manage, /등록일/);
  assert.match(manage, /상품 그룹 매칭 필요 · 등록 기록 \{unmappedYouTubeRegistrationCount\}건/);
  assert.doesNotMatch(manage, /registration\.idempotencyKey/);
});

test('manage page keeps YouTube out of credential and quick-account flows', () => {
  assert.match(manage, /partitionYouTubeManagementServices/);
  assert.match(manage, /kind: 'credentials'/);
  assert.match(manage, /serviceSections\.map/);
  assert.match(manage, /unmappedYouTubeServices/);
  assert.match(manage, /그룹 매핑 필요/);
  assert.match(manage, /ID\/PW · PIN · 프로필 · 접근 링크 작업을 제공하지 않습니다/);
  assert.match(manage, /cat\.label !== '유튜브'/);
  assert.doesNotMatch(manage, /유튜브 · 거래 \{service\.accounts/);
});

test('YouTube service folder and family cards preserve responsive 44px accessibility contracts', () => {
  const css = readFileSync(new URL('../src/web/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.management-service-group[^}]*min-width:\s*0/s);
  assert.doesNotMatch(css, /\.youtube-management-service/);
  assert.match(css, /\.youtube-family-group-grid[^}]*repeat\(3,\s*minmax\(0,\s*1fr\)\)/s);
  assert.match(css, /\.management-touch-target[^}]*min-height:\s*44px/s);
  assert.match(css, /\.youtube-family-member[^}]*overflow-wrap:\s*anywhere/s);
  assert.match(css, /@media\s*\(max-width:\s*1100px\)[\s\S]*\.youtube-family-group-grid[^}]*repeat\(2,/);
  assert.match(css, /@media\s*\(max-width:\s*700px\)[\s\S]*\.youtube-family-group-grid[^}]*minmax\(0,\s*1fr\)/);
});

test('write page exposes invitation UX and bypasses credential delivery for YouTube', () => {
  const write = readFileSync(new URL('../src/web/pages/write.tsx', import.meta.url), 'utf8');
  assert.match(write, /구매 후 초대/);
  assert.match(write, /ID\/PW는 전달하지 않아요/);
  assert.match(write, /결제 후 구매자의 Google 이메일을 받아 수동으로 가족 초대/);
  assert.match(write, /최대 \{youtubeRepeatMax\}개/);
  assert.match(write, /getSeoulTomorrow/);
  assert.match(write, /getYouTubePostRegistrationStep/);
  assert.match(write, /선택 가족 그룹/);
  assert.match(write, /안전 중단/);
  assert.match(write, /결과 불확실/);
});
