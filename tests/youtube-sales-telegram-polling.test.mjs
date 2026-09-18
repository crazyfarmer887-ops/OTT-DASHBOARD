import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/scheduler/poll-daemon.ts', import.meta.url), 'utf8');

test('dedicated YouTube sales polling emits account-scoped purchase, inquiry, and invitation alerts', () => {
  assert.match(source, /YOUTUBE_SALES_KNOWN_DEALS_PATH/);
  assert.match(source, /YOUTUBE_SALES_KNOWN_CHAT_MESSAGES_PATH/);
  assert.match(source, /buildNewDealStatusAlerts\(dedicatedYouTubeSources\.before/);
  assert.match(source, /sendNewChatMessageAlerts\(\s*\[\.\.\.dedicatedYouTubeSources\.before, \.\.\.dedicatedYouTubeSources\.after\]/);
  assert.match(source, /accountLabel:\s*'유튜브 판매 전용'/);
  assert.match(source, /sendInvitationEmailAlert:\s*true/);
  const dedicatedPoll = source.indexOf('await pollDedicatedYouTubeAccount()');
  const primarySessionGate = source.indexOf('const cookies = loadSessionCookies();', dedicatedPoll);
  assert.ok(dedicatedPoll >= 0 && primarySessionGate > dedicatedPoll, 'dedicated polling must run before the primary-session gate');
});
