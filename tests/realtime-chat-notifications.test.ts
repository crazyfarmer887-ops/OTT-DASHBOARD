import { describe, expect, test, vi } from 'vitest';
import { isRealtimeChatNotification } from '../src/lib/realtime-chat-notification';
import { ChatNotificationBroker } from '../src/realtime/chat-notification-broker';
import { parseSseBuffer } from '../src/web/lib/sse';

const notificationInput = (room: string, message = '로그인이 안 돼요') => ({
  chatRoomUuid: room,
  dealUsid: `deal-${room}`,
  buyerName: ' 홍 길동 ',
  serviceType: '넷플릭스',
  productName: '넷플릭스 프리미엄',
  accountLabel: 'netflix@example.com',
  message,
  messageAt: '2026-08-06T03:00:00.000Z',
});

describe('realtime chat notification broker', () => {
  test('publishes a normalized notification to active subscribers', () => {
    const broker = new ChatNotificationBroker(5, () => new Date('2026-08-06T03:00:01.000Z'));
    const subscriber = vi.fn();
    const unsubscribe = broker.subscribe(subscriber);

    const notification = broker.publish(notificationInput('room-1', '  비밀번호를\n확인해 주세요  '));

    expect(notification).toMatchObject({
      chatRoomUuid: 'room-1',
      buyerName: '홍 길동',
      message: '비밀번호를 확인해 주세요',
      receivedAt: '2026-08-06T03:00:01.000Z',
    });
    expect(isRealtimeChatNotification(notification)).toBe(true);
    expect(subscriber).toHaveBeenCalledOnce();
    expect(subscriber).toHaveBeenCalledWith(notification);

    unsubscribe();
    broker.publish(notificationInput('room-2'));
    expect(subscriber).toHaveBeenCalledOnce();
  });

  test('replays only events after a known cursor and keeps a bounded buffer', () => {
    const broker = new ChatNotificationBroker(2, () => new Date('2026-08-06T03:00:01.000Z'));
    const first = broker.publish(notificationInput('room-1'));
    const second = broker.publish(notificationInput('room-2'));
    const third = broker.publish(notificationInput('room-3'));

    expect(broker.latestId()).toBe(third.id);
    expect(broker.eventsAfter(second.id)).toEqual([third]);
    expect(broker.eventsAfter(third.id)).toEqual([]);
    expect(broker.eventsAfter(first.id)).toEqual([]);
    expect(broker.eventsAfter('unknown-server-cursor')).toEqual([]);
  });

  test('isolates a broken subscriber so other browser streams still receive the event', () => {
    const broker = new ChatNotificationBroker();
    broker.subscribe(() => { throw new Error('disconnected'); });
    const healthySubscriber = vi.fn();
    broker.subscribe(healthySubscriber);

    const notification = broker.publish(notificationInput('room-healthy'));

    expect(healthySubscriber).toHaveBeenCalledWith(notification);
  });
});

describe('SSE frame parsing', () => {
  test('parses CRLF frames split across network chunks and ignores heartbeat comments', () => {
    const broker = new ChatNotificationBroker(5, () => new Date('2026-08-06T03:00:01.000Z'));
    const notification = broker.publish(notificationInput('room-stream'));
    const chunks = [
      ': heartbeat\r\n\r\nevent: ready\r\nid: baseline\r\ndata: {"connected":',
      'true}\r\n\r\nevent: chat\r\nid: ',
      `${notification.id}\r\ndata: ${JSON.stringify(notification)}\r\n\r\npartial`,
    ];
    let buffer = '';
    const frames = [];

    for (const chunk of chunks) {
      buffer += chunk;
      const parsed = parseSseBuffer(buffer);
      frames.push(...parsed.frames);
      buffer = parsed.remainder;
    }

    expect(frames).toHaveLength(2);
    expect(frames[0]).toEqual({ event: 'ready', id: 'baseline', data: '{"connected":true}' });
    expect(frames[1]).toMatchObject({ event: 'chat', id: notification.id });
    expect(JSON.parse(frames[1].data)).toEqual(notification);
    expect(buffer).toBe('partial');
  });

  test('joins multiple data lines according to the SSE contract', () => {
    const parsed = parseSseBuffer('event: message\ndata: first\ndata: second\n\n');
    expect(parsed.frames).toEqual([{ event: 'message', data: 'first\nsecond' }]);
    expect(parsed.remainder).toBe('');
  });
});
