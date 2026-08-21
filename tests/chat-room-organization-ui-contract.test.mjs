import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const chat = readFileSync(new URL('../src/web/pages/chat.tsx', import.meta.url), 'utf8');
const adminAuth = readFileSync(new URL('../src/web/lib/admin-auth.ts', import.meta.url), 'utf8');

test('chat page loads persistent server organization and exposes folder views with counts', () => {
  assert.match(chat, /fetch\('\/api\/chat\/room-organization'/);
  assert.match(chat, /미해결/);
  assert.match(chat, /미분류/);
  assert.match(chat, /새 폴더/);
  assert.match(chat, /buildChatRoomOrganizationCounts/);
  assert.match(chat, /filterRoomsByOrganizationView/);
  assert.match(chat, /aria-pressed=/);
});

test('chat room rows provide unresolved toggles and folder move or unassign controls', () => {
  assert.match(chat, /미해결로 표시|해결됨으로 표시/);
  assert.match(chat, /폴더 이동/);
  assert.match(chat, /미분류로 이동/);
  assert.match(chat, /room-organization\/rooms/);
  assert.match(chat, /minHeight:44/);
});

test('category CRUD uses server APIs protected by the global admin fetch patch', () => {
  assert.match(chat, /\/api\/chat\/room-categories/);
  assert.match(chat, /method:\s*'POST'/);
  assert.match(chat, /method:\s*'PATCH'/);
  assert.match(chat, /method:\s*'DELETE'/);
  assert.match(adminAuth, /"\/api\/chat\/room-organization"/);
  assert.match(adminAuth, /"\/api\/chat\/room-categories"/);
});

test('existing room selection, URL state, read state, and refresh detection remain wired', () => {
  assert.match(chat, /selectRoom\(room\)/);
  assert.match(chat, /\/dashboard\/chat\?room=/);
  assert.match(chat, /markRoomRead/);
  assert.match(chat, /setInterval/);
  assert.match(chat, /lenderChatUnread/);
});
