import {
  createRealtimeChatNotification,
  type RealtimeChatNotification,
  type RealtimeChatNotificationInput,
} from '../lib/realtime-chat-notification';

type ChatNotificationSubscriber = (notification: RealtimeChatNotification) => void;

export class ChatNotificationBroker {
  private readonly subscribers = new Set<ChatNotificationSubscriber>();
  private readonly recent: RealtimeChatNotification[] = [];
  private sequence = 0;

  constructor(
    private readonly capacity = 50,
    private readonly now: () => Date = () => new Date(),
  ) {}

  publish(input: RealtimeChatNotificationInput): RealtimeChatNotification {
    const now = this.now();
    this.sequence += 1;
    const id = `${now.getTime().toString(36)}-${this.sequence.toString(36)}`;
    const notification = createRealtimeChatNotification(input, id, now.toISOString());

    this.recent.push(notification);
    const maxItems = Math.max(1, Math.floor(this.capacity));
    if (this.recent.length > maxItems) this.recent.splice(0, this.recent.length - maxItems);

    for (const subscriber of this.subscribers) {
      try {
        subscriber(notification);
      } catch {
        // One disconnected client must not prevent delivery to the others.
      }
    }
    return notification;
  }

  subscribe(subscriber: ChatNotificationSubscriber): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  eventsAfter(lastEventId: string): RealtimeChatNotification[] {
    const normalizedId = String(lastEventId || '').trim();
    if (!normalizedId) return [];
    const index = this.recent.findIndex((notification) => notification.id === normalizedId);
    return index < 0 ? [] : this.recent.slice(index + 1);
  }

  latestId(): string | null {
    return this.recent.at(-1)?.id ?? null;
  }
}

export const chatNotificationBroker = new ChatNotificationBroker();
