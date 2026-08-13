import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const manage = readFileSync(new URL('../src/web/pages/manage.tsx', import.meta.url), 'utf8');

test('manage page exposes safe YouTube family-group cards and navigation', () => {
  assert.match(manage, /유튜브 가족 그룹/);
  assert.match(manage, /managerEmailMasked/);
  assert.match(manage, /availableSeats/);
  assert.match(manage, /sellableSeats/);
  assert.match(manage, /navigate\('\/youtube-invites'\)/);
  assert.match(manage, /기능이 비활성화되어 있습니다/);
  assert.match(manage, /가족 그룹을 불러오는 중/);
});

test('manage page fetches with admin auth and uses audited exact CRUD body helpers', () => {
  assert.match(manage, /fetch\('\/api\/youtube\/family-groups'/);
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
