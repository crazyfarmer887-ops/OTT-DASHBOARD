export function buildGraytagChatUrl(chatRoomUuid: string): string {
  return `https://graytag.co.kr/chat/${encodeURIComponent(String(chatRoomUuid || '').trim())}`;
}
