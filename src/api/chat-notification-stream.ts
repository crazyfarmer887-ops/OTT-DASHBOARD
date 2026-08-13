import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import {
  chatNotificationBroker,
  type ChatNotificationBroker,
} from '../realtime/chat-notification-broker';
import type { RealtimeChatNotification } from '../lib/realtime-chat-notification';

const HEARTBEAT_INTERVAL_MS = 15_000;

function notificationMessage(notification: RealtimeChatNotification) {
  return {
    event: 'chat',
    id: notification.id,
    data: JSON.stringify(notification),
  };
}

export function createChatNotificationStreamApp(
  broker: ChatNotificationBroker = chatNotificationBroker,
): Hono {
  const streamApp = new Hono();

  streamApp.get('/stream', (c) => {
    c.header('Cache-Control', 'no-cache, no-transform');
    c.header('X-Accel-Buffering', 'no');
    c.header('Connection', 'keep-alive');

    const lastEventId = String(c.req.header('last-event-id') || '').trim();
    const replay = lastEventId ? broker.eventsAfter(lastEventId) : [];
    const initialCursor = lastEventId ? null : broker.latestId();

    return streamSSE(c, async (stream) => {
      let stopped = false;
      let live = false;
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      let resolveDone: (() => void) | undefined;
      let writeChain = Promise.resolve();
      const pending: RealtimeChatNotification[] = [];
      const done = new Promise<void>((resolve) => { resolveDone = resolve; });

      const stop = () => {
        if (stopped) return;
        stopped = true;
        if (heartbeat) clearInterval(heartbeat);
        resolveDone?.();
      };

      const enqueue = (notification: RealtimeChatNotification) => {
        writeChain = writeChain
          .then(() => stream.writeSSE(notificationMessage(notification)))
          .catch(() => stop());
      };

      const unsubscribe = broker.subscribe((notification) => {
        if (live) enqueue(notification);
        else pending.push(notification);
      });
      stream.onAbort(stop);

      try {
        for (const notification of replay) {
          await stream.writeSSE(notificationMessage(notification));
        }
        await stream.writeSSE({
          event: 'ready',
          ...(initialCursor ? { id: initialCursor } : {}),
          retry: 3_000,
          data: JSON.stringify({ connectedAt: new Date().toISOString(), latestEventId: broker.latestId() }),
        });

        live = true;
        for (const notification of pending.splice(0)) enqueue(notification);
        heartbeat = setInterval(() => {
          writeChain = writeChain
            .then(() => stream.write(`: heartbeat ${Date.now()}\n\n`))
            .catch(() => stop());
        }, HEARTBEAT_INTERVAL_MS);

        await done;
      } finally {
        if (heartbeat) clearInterval(heartbeat);
        unsubscribe();
      }
    });
  });

  return streamApp;
}

export default createChatNotificationStreamApp();
