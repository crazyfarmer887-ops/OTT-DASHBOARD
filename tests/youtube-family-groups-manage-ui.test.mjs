import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const manage = readFileSync(new URL('../src/web/pages/manage.tsx', import.meta.url), 'utf8');

test('manage page integrates YouTube Premium into the service folder list instead of a top standalone area', () => {
  assert.doesNotMatch(manage, /youtube-premium-management-card/);
  assert.match(manage, /className="management-service-group youtube-management-service"/);
  assert.match(manage, /className="management-service-toggle management-touch-target"/);
  assert.match(manage, /유튜브 프리미엄/);
  assert.match(manage, /가족 그룹 \{youtubeFamilyGroups\.length\}개/);
  assert.match(manage, /aria-expanded=\{isYouTubeServiceOpen\}/);
  assert.match(manage, /aria-controls="management-service-youtube"/);
  assert.match(manage, /aria-label="유튜브 프리미엄 초대 관리로 이동"/);
  assert.match(manage, /role="region" aria-label="유튜브 프리미엄 가족 그룹 목록"/);
});

test('YouTube family-group account cards expose invitation-specific capacity and party state', () => {
  assert.match(manage, /managerEmailMasked/);
  assert.match(manage, /summarizeYouTubeFamilyGroup/);
  assert.match(manage, /현재 파티원/);
  assert.match(manage, /초대 대기/);
  assert.match(manage, /수락\/검수/);
  assert.match(manage, /실패/);
  assert.match(manage, /빈자리/);
  assert.match(manage, /이용 종료일/);
  assert.match(manage, /구매자 이메일/);
  assert.match(manage, /확인 완료/);
  assert.match(manage, /확인 대기/);
  assert.match(manage, /확인 여부 불명/);
  assert.match(manage, /YOUTUBE_EMAIL_CONFIRMED_STATUSES/);
  assert.match(manage, /className="youtube-family-group-card management-account-card"/);
  assert.match(manage, /className="youtube-family-member-list"/);
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
  assert.match(manage, /Promise\.all/);
  assert.match(manage, /parseYouTubeInvitationsResponse/);
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

test('manage page keeps YouTube out of credential and quick-account flows', () => {
  assert.match(manage, /partitionYouTubeManagementServices/);
  assert.match(manage, /credentialServices\.map/);
  assert.match(manage, /unmappedYouTubeServices/);
  assert.match(manage, /그룹 매핑 필요/);
  assert.match(manage, /ID\/PW · PIN · 프로필 · 접근 링크 작업을 제공하지 않습니다/);
  assert.match(manage, /cat\.label !== '유튜브'/);
  assert.doesNotMatch(manage, /유튜브 · 거래 \{service\.accounts/);
});

test('YouTube service folder and family cards preserve responsive 44px accessibility contracts', () => {
  const css = readFileSync(new URL('../src/web/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.youtube-management-service[^}]*min-width:\s*0/s);
  assert.match(css, /\.youtube-family-group-grid[^}]*repeat\(3,\s*minmax\(0,\s*1fr\)\)/s);
  assert.match(css, /\.youtube-family-group-toggle[^}]*min-height:\s*44px/s);
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
