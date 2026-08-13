export interface RealtimeChatNotificationInput {
  chatRoomUuid: string;
  dealUsid?: string;
  buyerName?: string;
  serviceType?: string;
  productName?: string;
  accountLabel?: string;
  message: string;
  messageAt?: string;
}

export interface RealtimeChatNotification {
  id: string;
  chatRoomUuid: string;
  dealUsid: string;
  buyerName: string;
  serviceType: string;
  productName: string;
  accountLabel: string;
  message: string;
  messageAt: string;
  receivedAt: string;
}

function boundedText(value: unknown, maxLength: number, fallback = ''): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return (text || fallback).slice(0, maxLength);
}

export function createRealtimeChatNotification(
  input: RealtimeChatNotificationInput,
  id: string,
  receivedAt: string,
): RealtimeChatNotification {
  const chatRoomUuid = boundedText(input.chatRoomUuid, 160);
  if (!chatRoomUuid) throw new TypeError('chatRoomUuid is required');

  const serviceType = boundedText(input.serviceType, 80, '기타');
  return {
    id: boundedText(id, 120),
    chatRoomUuid,
    dealUsid: boundedText(input.dealUsid, 120),
    buyerName: boundedText(input.buyerName, 80, '구매자'),
    serviceType,
    productName: boundedText(input.productName, 160, serviceType),
    accountLabel: boundedText(input.accountLabel, 160, '(직접전달)'),
    message: boundedText(input.message, 800, '메시지 내용을 확인해 주세요.'),
    messageAt: boundedText(input.messageAt, 80, receivedAt),
    receivedAt,
  };
}

export function isRealtimeChatNotification(value: unknown): value is RealtimeChatNotification {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return [
    'id',
    'chatRoomUuid',
    'dealUsid',
    'buyerName',
    'serviceType',
    'productName',
    'accountLabel',
    'message',
    'messageAt',
    'receivedAt',
  ].every((key) => typeof candidate[key] === 'string');
}
