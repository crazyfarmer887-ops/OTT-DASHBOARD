import { describe, expect, it } from 'vitest';
import {
  buildChatRoomOrganizationCounts,
  captureChatRoomOrganizationRead,
  filterRoomsByOrganizationView,
  invalidateChatRoomOrganizationReads,
  isChatRoomOrganizationReadCurrent,
  type ChatRoomOrganization,
} from '../src/web/lib/chat-room-organization.ts';

const organization: ChatRoomOrganization = {
  version: 1,
  categories: [
    { id: 'urgent', name: '긴급', createdAt: '2026-08-21', updatedAt: '2026-08-21' },
    { id: 'billing', name: '결제', createdAt: '2026-08-21', updatedAt: '2026-08-21' },
  ],
  rooms: {
    a: { categoryId: 'urgent', unresolved: true, updatedAt: '2026-08-21' },
    b: { categoryId: 'urgent', unresolved: false, updatedAt: '2026-08-21' },
    c: { unresolved: true, updatedAt: '2026-08-21' },
    stale: { categoryId: 'billing', unresolved: true, updatedAt: '2026-08-21' },
  },
};
const rooms = [
  { chatRoomUuid: 'a', label: 'A' },
  { chatRoomUuid: 'b', label: 'B' },
  { chatRoomUuid: 'c', label: 'C' },
  { chatRoomUuid: 'd', label: 'D' },
];

describe('chat room organization UI helpers', () => {
  it('counts only currently visible chat rooms by folder and resolution state', () => {
    expect(buildChatRoomOrganizationCounts(rooms, organization)).toEqual({
      total: 4,
      unresolved: 2,
      unassigned: 2,
      byCategory: { urgent: 2, billing: 0 },
    });
  });

  it('invalidates organization GET snapshots when a mutation starts', () => {
    const generation = { current: 4 };
    const pendingRead = captureChatRoomOrganizationRead(generation);

    invalidateChatRoomOrganizationReads(generation);

    expect(isChatRoomOrganizationReadCurrent(generation, pendingRead)).toBe(false);
    expect(isChatRoomOrganizationReadCurrent(generation, captureChatRoomOrganizationRead(generation))).toBe(true);
  });

  it('filters all, unresolved, unassigned, and category views without changing room order', () => {
    expect(filterRoomsByOrganizationView(rooms, organization, 'all').map((room) => room.label)).toEqual(['A', 'B', 'C', 'D']);
    expect(filterRoomsByOrganizationView(rooms, organization, 'unresolved').map((room) => room.label)).toEqual(['A', 'C']);
    expect(filterRoomsByOrganizationView(rooms, organization, 'unassigned').map((room) => room.label)).toEqual(['C', 'D']);
    expect(filterRoomsByOrganizationView(rooms, organization, 'category:urgent').map((room) => room.label)).toEqual(['A', 'B']);
    expect(filterRoomsByOrganizationView(rooms, organization, 'category:missing')).toEqual([]);
  });
});
