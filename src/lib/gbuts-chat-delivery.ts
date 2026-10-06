/** The web UI caps text at 500 characters. Production also rejected our large
 * Korean payload without ERROR; keep each part within 500 UTF-8 bytes as well.
 * Paragraph boundaries make the plan stable across restarts and history reads. */
export function splitGbutsChatText(text: string): string[] {
  const parts: string[] = [];
  for (const paragraph of text.trim().split(/\n\s*\n/)) {
    let remaining = paragraph.trim();
    while (Buffer.byteLength(remaining) > 500) {
      let prefix = ''; let bytes = 0;
      for (const character of remaining) {
        bytes += Buffer.byteLength(character);
        if (bytes > 500) break;
        prefix += character;
      }
      const boundary = Math.max(prefix.lastIndexOf('\n'), prefix.lastIndexOf(' '));
      // Never break credentials or private URLs in the middle of a word.
      if (boundary <= 0) throw new Error('벗츠 채팅의 한 단어가 전송 제한을 초과했습니다.');
      parts.push(prefix.slice(0, boundary).trim());
      remaining = remaining.slice(boundary).trim();
    }
    if (remaining) parts.push(remaining);
  }
  return parts;
}
export interface GbutsTextMessage { senderSeq: number; messageType: string; message: string }
export function gbutsChatContainsText(messages: readonly GbutsTextMessage[], sellerSeq: number, text: string): boolean {
  const sellerTexts = messages.filter(x => x.senderSeq === sellerSeq && x.messageType === 'TEXT').map(x => x.message.trim());
  return sellerTexts.includes(text.trim()) || splitGbutsChatText(text).every(part => sellerTexts.includes(part));
}
/** Only a failure before any SEND is safe to retry without an uncertain outcome. */
export class GbutsChatDeliveryError extends Error {
  constructor(message: string, readonly submitted: boolean, readonly retryable = !submitted) { super(message); this.name = 'GbutsChatDeliveryError'; }
}
