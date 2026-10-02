/** GButs Spotify orders are joined by the member record, never by an email alone. */
export interface GbutsSpotifyMember {
  seq: number;
  userSeq: number;
  productId: number;
  status: string;
  cancelStatus: string | null;
}

export interface GbutsChatMessage {
  senderSeq: number;
  message: string;
  messageType: string;
  createdAt: string;
}

export interface SpotifyCredentials {
  email: string;
  password: string;
  receivedAt: string;
}

export function gbutsSpotifyOrderKey(postSeq: number, member: GbutsSpotifyMember): string {
  if (!Number.isSafeInteger(postSeq) || postSeq <= 0 || !Number.isSafeInteger(member.seq) || member.seq <= 0)
    throw new Error('GButs member identity invalid');
  return `${postSeq}:${member.seq}`;
}

export function isActiveGbutsSpotifyMember(member: GbutsSpotifyMember): boolean {
  return member.status === 'APPLY' && (member.cancelStatus == null || member.cancelStatus === 'REFUND_REJECTED');
}

function spotifyEmail(value: string): string | null {
  const cleaned = value.trim().replace(/^[<([{\s]+|[>)}\].,;\s]+$/g, '').toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned) && cleaned.length <= 254 ? cleaned : null;
}

/** Require labeled Spotify login and password in the buyer's own messages. */
export function extractGbutsSpotifyCredentials(
  messages: readonly GbutsChatMessage[], buyerUserSeq: number,
): SpotifyCredentials | null {
  const buyerMessages = messages.filter((message) => message.senderSeq === buyerUserSeq
    && message.messageType === 'TEXT' && typeof message.message === 'string')
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  let email: string | null = null;
  let password: string | null = null;
  let receivedAt = '';
  for (const entry of buyerMessages) {
    const content = entry.message.trim();
    if (/\b(?:google|apple|facebook|kakao)\s*(?:login|account|로그인|계정)\b/i.test(content)) continue;
    const emailMatch = content.match(/(?:spotify\s*(?:account|id|email|계정|아이디|이메일)|스포티파이\s*(?:계정|아이디|이메일)|(?:^|\n)\s*(?:id|email|아이디|이메일))\s*[:：=]\s*([^\s,;]+)/im);
    const passwordMatch = content.match(/(?:password|passwd|pass|pwd|비밀번호|비번)\s*[:：=]\s*([^\s]+)/i);
    if (emailMatch) {
      const parsed = spotifyEmail(emailMatch[1]);
      if (!parsed) { email = null; password = null; continue; }
      email = parsed;
      password = null; // A new account invalidates the old password.
      receivedAt = entry.createdAt;
    }
    if (passwordMatch && email) {
      const candidate = passwordMatch[1].trim();
      if (candidate.length >= 6 && candidate.length <= 128) {
        password = candidate;
        receivedAt = entry.createdAt;
      }
    }
  }
  return email && password ? { email, password, receivedAt } : null;
}
