import { parseYouTubeInviteEmailCandidates } from './youtube-invite-email';

/** Normalize explicitly written email separators, without changing address letters. */
export function normalizeYouTubeEmailWording(text: string): string {
  return text.replace(/＠/g, '@').replace(/[。．]/g, '.')
    .replace(/([a-z0-9.!#$%'*+/^_`{|}~-])\s*(?:@|골뱅이|\[at\]|\(at\))\s*([a-z0-9])/gi, '$1@$2')
    .replace(/([a-z0-9])\s+(?:\.|점|닷|\[dot\]|\(dot\))\s*([a-z0-9])/gi, '$1.$2');
}

/** Collect only complete buyer-written addresses. URLs, queries and malformed tokens stay excluded. */
export function explicitYouTubeBuyerEmails(text: string): string[] {
  const emails = new Set<string>();
  if (text.length > 10_000) return [];
  for (let token of normalizeYouTubeEmailWording(text).split(/\s+/u)) {
    if (/(?:[a-z][a-z0-9+.-]*:\/\/|mailto:|www\.)|[?&=]/i.test(token)) continue;
    token = token.replace(/^(?:id|아이디|계정|주소|메일)[:：]/i, '').replace(/^[가-힣]+(?=[([{<“‘])/u, '').replace(/[,;]$/, '');
    const parsed = parseYouTubeInviteEmailCandidates(token);
    if (parsed.kind === 'single_candidate') { emails.add(parsed.candidate); continue; }
    if ((token.match(/@/g) || []).length < 2) continue;
    const parts = token.split(/[,;]|[가-힣]+/u).filter(Boolean).map(parseYouTubeInviteEmailCandidates);
    if (parts.length && parts.every(part => part.kind === 'single_candidate'))
      for (const part of parts) if (part.kind === 'single_candidate') emails.add(part.candidate);
  }
  return [...emails];
}

export function isBuyerEmailWithdrawal(text: string): boolean {
  const count = explicitYouTubeBuyerEmails(text).length;
  return /(?:취소|환불)\s*(?:할|해|부탁|요청|원)/.test(text)
    || (count <= 1 && /말고\s*(?:다른|새|다시)[^.!?]{0,30}(?:보낼|보내|드릴|알려)/.test(text))
    || (count === 0 && /(?:다른|새|새로운)\s*(?:계정|이메일|메일|주소)[^.!?]{0,30}(?:바꿀|변경할|보낼|보내드|드릴|알려드)/.test(text))
    || (count === 1 && /아니에요|아닙니다|잘못\s*보냈|틀린\s*(?:주소|메일)/.test(text));
}

export function parseYouTubeBuyerEmailSubmission(text: string):
  { kind: 'none' | 'ambiguous' } | { kind: 'single_candidate'; candidate: string } {
  if (isBuyerEmailWithdrawal(text)) return { kind: 'ambiguous' };
  const candidates = explicitYouTubeBuyerEmails(text);
  if (!candidates.length) return { kind: 'none' };
  if (candidates.length === 1) return { kind: 'single_candidate', candidate: candidates[0] };
  if (candidates.length === 2 && !/아니면|또는|혹은|어느|둘\s*중/.test(text)) {
    const normalized = normalizeYouTubeEmailWording(text).toLowerCase();
    const left = normalized.indexOf(candidates[0]);
    const right = normalized.indexOf(candidates[1], left + candidates[0].length);
    if (left >= 0 && right > left && /말고|아니고|아니라|대신/.test(normalized.slice(left + candidates[0].length, right)))
      return { kind: 'single_candidate', candidate: candidates[1] };
  }
  return { kind: 'ambiguous' };
}
