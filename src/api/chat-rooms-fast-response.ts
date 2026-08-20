import { findLatestBuyerInquiryMessage, type GraytagChatMessage } from './chat-message-summary';

export interface FastChatRoom {
  dealUsid: string;
  chatRoomUuid: string;
  borrowerName: string;
  borrowerThumbnail: string;
  productType: string;
  productName: string;
  dealStatus: string;
  statusName: string;
  remainderDays: number;
  endDateTime?: string;
  lenderChatUnread: boolean;
  price: string;
  keepAcct: string;
  lastMessage?: string;
  lastMessageTime?: string;
  lastMessageFetchOk: boolean;
  lastMessageMissingReason?: string;
}

export interface FastChatRoomsSnapshot {
  rooms: FastChatRoom[];
  totalRooms: number;
  unreadCount: number;
  updatedAt: string;
  fromCache: boolean;
  rateLimited: boolean;
  messageHydrationPending: boolean;
  messageHydratedCount: number;
  messageHydrationFailedCount: number;
}

type PreviousRoomSummary = Pick<FastChatRoom, 'chatRoomUuid' | 'lastMessage' | 'lastMessageTime' | 'lastMessageFetchOk' | 'lastMessageMissingReason'>;

export function buildChatRoomsSnapshot(
  deals: readonly any[],
  updatedAt = new Date().toISOString(),
  previousRooms: readonly PreviousRoomSummary[] = [],
): FastChatRoomsSnapshot {
  const previousByUuid = new Map(previousRooms.map(room => [String(room.chatRoomUuid), room]));
  const rooms = deals
    .filter(deal => String(deal?.chatRoomUuid || '').trim())
    .map((deal): FastChatRoom => {
      const chatRoomUuid = String(deal.chatRoomUuid).trim();
      const previous = previousByUuid.get(chatRoomUuid);
      const hasPreviousSummary = Boolean(previous?.lastMessageFetchOk);
      return {
        dealUsid: String(deal.dealUsid || ''),
        chatRoomUuid,
        borrowerName: String(deal.borrowerName || '').trim(),
        borrowerThumbnail: String(deal.borrowerThumbnailImageUrl || deal.borrowerThumbnail || ''),
        productType: String(deal.productTypeString || deal.productType || ''),
        productName: String(deal.productName || ''),
        dealStatus: String(deal.dealStatus || ''),
        statusName: String(deal.lenderDealStatusName || deal.statusName || ''),
        remainderDays: Number(deal.remainderDays || 0),
        endDateTime: deal.endDateTime ? String(deal.endDateTime) : undefined,
        lenderChatUnread: Boolean(deal.lenderChatUnread || deal.dealDetail?.lenderChatUnread),
        price: String(deal.price || ''),
        keepAcct: String(deal.keepAcct || ''),
        lastMessage: previous?.lastMessage,
        lastMessageTime: previous?.lastMessageTime,
        lastMessageFetchOk: hasPreviousSummary,
        lastMessageMissingReason: hasPreviousSummary ? previous?.lastMessageMissingReason : 'pending',
      };
    });

  const pendingRooms = rooms.filter(room => room.lenderChatUnread && !room.lastMessageFetchOk);
  return {
    rooms,
    totalRooms: rooms.length,
    unreadCount: rooms.filter(room => room.lenderChatUnread).length,
    updatedAt,
    fromCache: false,
    rateLimited: false,
    messageHydrationPending: pendingRooms.length > 0,
    messageHydratedCount: rooms.filter(room => room.lastMessageFetchOk && Boolean(room.lastMessage)).length,
    messageHydrationFailedCount: 0,
  };
}

export async function startChatRoomMessageHydration(
  snapshot: FastChatRoomsSnapshot,
  fetchMessages: (room: FastChatRoom) => Promise<readonly GraytagChatMessage[]>,
): Promise<FastChatRoomsSnapshot> {
  let hydratedCount = snapshot.messageHydratedCount;
  let failedCount = 0;
  const rooms = await Promise.all(snapshot.rooms.map(async room => {
    if (!room.lenderChatUnread || room.lastMessageFetchOk) return room;
    try {
      const latest = findLatestBuyerInquiryMessage(await fetchMessages(room));
      if (!latest) {
        failedCount += 1;
        return { ...room, lastMessageFetchOk: true, lastMessageMissingReason: 'no_buyer_message' };
      }
      hydratedCount += 1;
      return {
        ...room,
        lastMessage: String(latest.message || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').trim().slice(0, 50),
        lastMessageTime: latest.registeredDateTime || latest.createdAt || latest.updatedAt,
        lastMessageFetchOk: true,
        lastMessageMissingReason: undefined,
      };
    } catch (error: any) {
      failedCount += 1;
      return {
        ...room,
        lastMessageFetchOk: false,
        lastMessageMissingReason: error?.name === 'TimeoutError' ? 'timeout' : 'fetch_failed',
      };
    }
  }));

  return {
    ...snapshot,
    rooms,
    messageHydrationPending: false,
    messageHydratedCount: hydratedCount,
    messageHydrationFailedCount: failedCount,
  };
}
