import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { buildChatRoomsSnapshot, startChatRoomMessageHydration } from '../src/api/chat-rooms-fast-response';
import { buildGraytagChatUrl } from '../src/web/lib/graytag-chat-url';

const deal = (overrides: Record<string, unknown> = {}) => ({
  dealUsid: 'deal-1',
  chatRoomUuid: 'room-1',
  borrowerName: ' 구매자 ',
  productTypeString: '웨이브',
  lenderChatUnread: true,
  ...overrides,
});

describe('chat rooms fast response', () => {
  test('builds the initial room snapshot without waiting for message hydration', () => {
    const snapshot = buildChatRoomsSnapshot([deal(), deal({ dealUsid: 'no-room', chatRoomUuid: '' })], '2026-08-20T00:00:00.000Z');

    expect(snapshot).toMatchObject({
      totalRooms: 1,
      unreadCount: 1,
      messageHydrationPending: true,
      messageHydratedCount: 0,
      messageHydrationFailedCount: 0,
      updatedAt: '2026-08-20T00:00:00.000Z',
    });
    expect(snapshot.rooms[0]).toMatchObject({
      dealUsid: 'deal-1',
      chatRoomUuid: 'room-1',
      borrowerName: '구매자',
      lastMessageFetchOk: false,
      lastMessageMissingReason: 'pending',
    });
  });

  test('hydrates only unread rooms and reports the finished snapshot', async () => {
    const snapshot = buildChatRoomsSnapshot([
      deal(),
      deal({ dealUsid: 'deal-2', chatRoomUuid: 'room-2', lenderChatUnread: false }),
    ], '2026-08-20T00:00:00.000Z');
    const requested: string[] = [];
    const hydrated = await startChatRoomMessageHydration(snapshot, async (room) => {
      requested.push(room.chatRoomUuid);
      return [{ message: '새 문의', registeredDateTime: '2026-08-20T00:01:00.000Z', owned: false }];
    });

    expect(requested).toEqual(['room-1']);
    expect(hydrated).toMatchObject({ messageHydrationPending: false, messageHydratedCount: 1, messageHydrationFailedCount: 0 });
    expect(hydrated.rooms.find(room => room.chatRoomUuid === 'room-1')).toMatchObject({ lastMessage: '새 문의', lastMessageFetchOk: true });
  });

  test('builds encoded Graytag links and exposes a direct-link control for every room', () => {
    expect(buildGraytagChatUrl('room/한글')).toBe('https://graytag.co.kr/chat/room%2F%ED%95%9C%EA%B8%80');
    const chatPage = readFileSync(new URL('../src/web/pages/chat.tsx', import.meta.url), 'utf8');
    expect(chatPage).toContain('그레이태그 채팅방 바로가기');
    expect(chatPage).toContain('buildGraytagChatUrl(room.chatRoomUuid)');
    expect(chatPage).toContain('buildGraytagChatUrl(selectedRoom.chatRoomUuid)');
    expect(chatPage).toContain('loading="lazy"');
    expect(chatPage).toContain('decoding="async"');
  });
});
