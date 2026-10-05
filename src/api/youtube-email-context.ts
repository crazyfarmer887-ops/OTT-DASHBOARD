import { selectYouTubeEmailWithOpenRouter } from './notion-chat-extraction';
import { isBuyerTextMessage } from './auto-reply-message';
import type { GraytagChatMessage } from './chat-message-summary';
import { isYouTubeDifferentAccountRequest, resolveYouTubeBuyerEmailFromChat, youtubeChatEmailTime, normalizeYouTubeEmailChatMessage } from './youtube-chat-email';
import { explicitYouTubeBuyerEmails, isBuyerEmailWithdrawal } from '../lib/youtube-buyer-email';

type EmailTurn = { role: 'buyer' | 'seller'; text: string };
export type BuyerEmailSelector = (candidates: readonly string[], turns: readonly EmailTurn[]) => Promise<string | null>;

/** All eligible buyer submissions are interpreted by the configured OpenRouter extractor. */
export async function resolveYouTubeBuyerEmailWithContext(room: string, messages: readonly GraytagChatMessage[],
  select: BuyerEmailSelector = selectYouTubeEmailWithOpenRouter): Promise<string[] | null> {
  const fast = resolveYouTubeBuyerEmailFromChat(room, messages);
  const ordered = messages.map((message, index) => ({ message, index }))
    .sort((a, b) => {
      const left = youtubeChatEmailTime(a.message.registeredDateTime || a.message.createdAt || a.message.updatedAt);
      const right = youtubeChatEmailTime(b.message.registeredDateTime || b.message.createdAt || b.message.updatedAt);
      return left && right && left !== right ? left - right : a.index - b.index;
    });
  let turns: EmailTurn[] = [];
  let candidates: string[] = [];
  for (const { message } of ordered) {
    const text = normalizeYouTubeEmailChatMessage(message.message || '');
    if (!text || message.informationMessage || message.isInfo || message.messageType === 'Information') continue;
    const seller = message.owned === true || message.isOwned === true;
    const buyer = !seller && isBuyerTextMessage({ chatRoomUuid: room, ...message, message: text });
    if (!seller && !buyer) continue;
    if ((seller && isYouTubeDifferentAccountRequest(text)) || (buyer && isBuyerEmailWithdrawal(text))) {
      turns = []; candidates = []; continue;
    }
    turns.push({ role: seller ? 'seller' : 'buyer', text: text.slice(0, 3000) });
    if (buyer) candidates = [...new Set([...candidates, ...explicitYouTubeBuyerEmails(text)])];
  }
  if (!candidates.length || candidates.length > 4) return fast;
  const selected = await select(candidates, turns).catch(() => null);
  return selected && candidates.includes(selected) ? [selected] : null;
}
