import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let tempDir: string;
const originalStorePath = process.env.CHAT_ROOM_ORGANIZATION_PATH;
const originalAdminToken = process.env.AIO_ADMIN_TOKEN;

beforeEach(() => {
  vi.resetModules();
  tempDir = mkdtempSync(join(tmpdir(), 'chat-room-organization-'));
  process.env.CHAT_ROOM_ORGANIZATION_PATH = join(tempDir, 'organization.json');
  process.env.AIO_ADMIN_TOKEN = 'test-admin-token';
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(tempDir, { recursive: true, force: true });
  if (originalStorePath === undefined) delete process.env.CHAT_ROOM_ORGANIZATION_PATH;
  else process.env.CHAT_ROOM_ORGANIZATION_PATH = originalStorePath;
  if (originalAdminToken === undefined) delete process.env.AIO_ADMIN_TOKEN;
  else process.env.AIO_ADMIN_TOKEN = originalAdminToken;
});

describe('chat room organization store', () => {
  it('creates normalized categories and persists them with an atomic JSON write', async () => {
    const { createChatRoomCategory, loadChatRoomOrganization } = await import('../src/lib/chat-room-organization.ts');

    const created = createChatRoomCategory('  긴급   응대  ', '2026-08-21T10:00:00.000Z');

    expect(created.name).toBe('긴급 응대');
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(loadChatRoomOrganization()).toEqual({
      version: 1,
      categories: [created],
      rooms: {},
    });
    expect(JSON.parse(readFileSync(process.env.CHAT_ROOM_ORGANIZATION_PATH!, 'utf8'))).toEqual({
      version: 1,
      categories: [created],
      rooms: {},
    });
  });

  it('rejects unsafe or duplicate category names before writing', async () => {
    const { createChatRoomCategory } = await import('../src/lib/chat-room-organization.ts');
    createChatRoomCategory('결제 확인');

    expect(() => createChatRoomCategory('  결제   확인 ')).toThrow('이미 존재');
    expect(() => createChatRoomCategory('../private')).toThrow('올바르지');
    expect(() => createChatRoomCategory('a'.repeat(41))).toThrow('40자');
    expect(() => createChatRoomCategory('   ')).toThrow('입력');
  });

  it('renames and deletes categories while safely unassigning their rooms', async () => {
    const {
      createChatRoomCategory,
      deleteChatRoomCategory,
      loadChatRoomOrganization,
      renameChatRoomCategory,
      updateChatRoomOrganizationEntry,
    } = await import('../src/lib/chat-room-organization.ts');
    const category = createChatRoomCategory('환불');
    updateChatRoomOrganizationEntry('room-123', { categoryId: category.id, unresolved: true }, '2026-08-21T11:00:00.000Z');
    updateChatRoomOrganizationEntry('room-resolved', { categoryId: category.id, unresolved: false }, '2026-08-21T11:00:00.000Z');

    expect(renameChatRoomCategory(category.id, '환불 완료', '2026-08-21T12:00:00.000Z')).toMatchObject({
      id: category.id,
      name: '환불 완료',
      updatedAt: '2026-08-21T12:00:00.000Z',
    });
    deleteChatRoomCategory(category.id);

    expect(loadChatRoomOrganization()).toEqual({
      version: 1,
      categories: [],
      rooms: {
        'room-123': { unresolved: true, updatedAt: expect.any(String) },
      },
    });
  });

  it('moves, unassigns, and resolves a room without retaining empty records', async () => {
    const {
      createChatRoomCategory,
      loadChatRoomOrganization,
      updateChatRoomOrganizationEntry,
    } = await import('../src/lib/chat-room-organization.ts');
    const category = createChatRoomCategory('답변 필요');

    expect(updateChatRoomOrganizationEntry('room:abc-123', { unresolved: true, categoryId: category.id })).toMatchObject({
      unresolved: true,
      categoryId: category.id,
    });
    expect(updateChatRoomOrganizationEntry('room:abc-123', { categoryId: null })).toMatchObject({ unresolved: true });
    expect(updateChatRoomOrganizationEntry('room:abc-123', { unresolved: false })).toBeNull();
    expect(loadChatRoomOrganization().rooms).toEqual({});
    expect(() => updateChatRoomOrganizationEntry('../room', { unresolved: true })).toThrow('채팅방');
    expect(() => updateChatRoomOrganizationEntry('room-1', { categoryId: 'missing' })).toThrow('카테고리');
  });

  it('exposes authenticated category and room organization APIs with safe validation', async () => {
    const app = (await import('../src/api/index.ts')).default;
    const adminHeaders = { 'content-type': 'application/json', 'x-admin-token': 'test-admin-token' };

    const forbidden = await app.request('/api/chat/room-organization');
    expect(forbidden.status).toBe(403);

    const createdResponse = await app.request('/api/chat/room-categories', {
      method: 'POST', headers: adminHeaders, body: JSON.stringify({ name: '  답변   필요 ' }),
    });
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json() as any).category;
    expect(created.name).toBe('답변 필요');

    const moved = await app.request('/api/chat/room-organization/rooms/room-456', {
      method: 'PATCH', headers: adminHeaders, body: JSON.stringify({ categoryId: created.id, unresolved: true }),
    });
    expect(moved.status).toBe(200);
    expect(await moved.json()).toMatchObject({ ok: true, room: { categoryId: created.id, unresolved: true } });

    const listed = await app.request('/api/chat/room-organization', { headers: { 'x-admin-token': 'test-admin-token' } });
    expect(listed.status).toBe(200);
    expect(await listed.json()).toMatchObject({
      version: 1,
      categories: [expect.objectContaining({ id: created.id, name: '답변 필요' })],
      rooms: { 'room-456': expect.objectContaining({ categoryId: created.id, unresolved: true }) },
    });

    const renamed = await app.request(`/api/chat/room-categories/${created.id}`, {
      method: 'PATCH', headers: adminHeaders, body: JSON.stringify({ name: '처리 중' }),
    });
    expect(renamed.status).toBe(200);
    expect(await renamed.json()).toMatchObject({ category: { id: created.id, name: '처리 중' } });

    const invalid = await app.request('/api/chat/room-categories', {
      method: 'POST', headers: adminHeaders, body: JSON.stringify({ name: '../unsafe' }),
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ ok: false });

    const removed = await app.request(`/api/chat/room-categories/${created.id}`, {
      method: 'DELETE', headers: { 'x-admin-token': 'test-admin-token' },
    });
    expect(removed.status).toBe(200);
    expect(await removed.json()).toMatchObject({ ok: true, store: { categories: [], rooms: { 'room-456': { unresolved: true } } } });
  });

  it('rejects malformed room organization patches', async () => {
    const app = (await import('../src/api/index.ts')).default;
    const response = await app.request('/api/chat/room-organization/rooms/room-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-admin-token': 'test-admin-token' },
      body: JSON.stringify({ unresolved: 'yes' }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false, error: expect.any(String) });
  });
});
