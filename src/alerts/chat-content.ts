import { redactAlertText, sendSellerAlert, type SellerAlertInput, type SellerAlertResult } from './telegram';

export function splitTelegramChatText(content: string): string[] {
  const redacted = redactAlertText(content.replace(/((?:비밀번호|비번|암호|pwd)\s*[:：=]\s*)[^\s\n]+/gi, '$1[redacted]'));
  const parts: string[] = []; let chunk = '';
  for (const character of redacted) {
    if (chunk.length + character.length > 1800) { parts.push(chunk); chunk = ''; }
    chunk += character;
  }
  if (chunk) parts.push(chunk);
  return parts;
}

/** Stable part keys let a retried message resume without repeating successful parts. */
export async function sendChatContentAlert(input: SellerAlertInput & { message: string; actionUrl: string },
  sender: (input: SellerAlertInput) => Promise<SellerAlertResult> = sendSellerAlert): Promise<SellerAlertResult> {
  const { message, ...alert } = input;
  const parts = splitTelegramChatText(message);
  if (!parts.length) return { sent: false, reason: 'failed' };
  let sent = false;
  for (let index = 0; index < parts.length; index++) {
    const result = await sender({ ...alert, key: `${input.key}:content:${index}`, category: input.category || 'inquiry',
      throttleMs: input.throttleMs || 30 * 86400000,
      body: [input.body.slice(0, 1000), parts.length > 1 ? `메시지 ${index + 1}/${parts.length}` : '메시지:',
        parts[index], input.actionUrl].filter(Boolean).join('\n\n') });
    if (!result.sent && result.reason !== 'throttled') return result;
    if (result.sent) sent = true;
  }
  return sent ? { sent: true, reason: 'sent' } : { sent: false, reason: 'throttled' };
}
