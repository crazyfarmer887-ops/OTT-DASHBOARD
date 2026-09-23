import { normalizeBuyerMessage, isBuyerTextMessage } from './auto-reply-message';
import type { GraytagChatMessage } from './chat-message-summary';
import { parseYouTubeInviteEmailCandidates } from '../lib/youtube-invite-email';

const DIFFERENT_ACCOUNT = /(?:다른|새로운|새)\s*(?:(?:구글|Google)\s*)?(?:계정|이메일|메일|주소)|(?:계정|이메일|메일|주소)[^.!?\n]{0,30}(?:초대\s*(?:불가|불가능|안\s*됨|못)|사용\s*(?:불가|불가능))/i;
const CORRECTION = /정정|수정|대신|말고|아니라|바꿔|변경|이걸로|이\s*(?:계정|이메일|주소)으로/i;
const PROCEED_WITH_ORIGINAL = /(?:기존|처음|원래|앞서\s*(?:주신|보내주신))\s*(?:계정|이메일|메일|주소)[^.!?\n]{0,30}초대/i;

function sortTime(value?: string): number {
  const dotted = /^(\d{4})\.(\d{1,2})\.(\d{1,2})\s+(\d{1,2}):(\d{1,2})/.exec(value || '');
  if (dotted) return Date.UTC(Number(dotted[1]), Number(dotted[2]) - 1, Number(dotted[3]), Number(dotted[4]), Number(dotted[5])) - 9 * 60 * 60_000;
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Return one usable buyer-authored address, [] if none, or null while a correction is unresolved. */
export function resolveYouTubeBuyerEmailFromChat(
  chatRoomUuid: string,
  messages: readonly GraytagChatMessage[],
  allowSellerResumption = false,
  settleMs = 0,
  now = Date.now(),
): string[] | null {
  const ordered = messages.map((message, index) => ({ message, index })).sort((a, b) => {
    const left = sortTime(a.message.registeredDateTime || a.message.createdAt || a.message.updatedAt);
    const right = sortTime(b.message.registeredDateTime || b.message.createdAt || b.message.updatedAt);
    return left && right && left !== right ? left - right : a.index - b.index;
  });
  let selected: string | null = null;
  let selectedAt = 0;
  let prior: string | null = null;
  let unresolved = false;
  for (const { message } of ordered) {
    const text = normalizeBuyerMessage(String(message.message || ''));
    if (!text || message.informationMessage || message.isInfo || message.messageType === 'Information') continue;
    if (message.owned === true || message.isOwned === true) {
      if (DIFFERENT_ACCOUNT.test(text)) {
        prior = selected;
        selected = null;
        selectedAt = 0;
        unresolved = true;
      } else if (allowSellerResumption && unresolved && prior && PROCEED_WITH_ORIGINAL.test(text)) {
        selected = prior;
        unresolved = false;
      }
      continue;
    }
    if (!isBuyerTextMessage({ chatRoomUuid, ...message, message: text })) continue;
    const parsed = parseYouTubeInviteEmailCandidates(text);
    if (parsed.kind === 'none') continue;
    if (parsed.kind === 'ambiguous') {
      selected = null;
      selectedAt = 0;
      unresolved = true;
      continue;
    }
    if (unresolved || !selected || selected === parsed.candidate || CORRECTION.test(text)) {
      selected = parsed.candidate;
      selectedAt = sortTime(message.registeredDateTime || message.createdAt || message.updatedAt);
      unresolved = false;
    } else {
      selected = null;
      selectedAt = 0;
      unresolved = true;
    }
  }
  // GrayTag timestamps have minute precision. An extra minute guarantees the
  // full settling window even when a message arrived at the end of its minute.
  if (selected && settleMs > 0 && (!selectedAt || selectedAt > now || now - selectedAt < settleMs + 60_000)) return null;
  return selected ? [selected] : unresolved ? null : [];
}
