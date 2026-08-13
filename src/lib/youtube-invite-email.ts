export const YOUTUBE_INVITE_EMAIL_MAX_INPUT_LENGTH = 10_000;
export const YOUTUBE_INVITE_EMAIL_REQUEST_MESSAGE = '결제가 확인됐습니다. 유튜브 가족 초대를 받을 Google 이메일 주소를 채팅에 남겨주세요. 초대 메일을 받으면 수락 후 알려주세요.';

export function buildYouTubeInviteEmailRequestMessage(): string {
  return YOUTUBE_INVITE_EMAIL_REQUEST_MESSAGE;
}

export type YouTubeInviteEmailCandidateResult =
  | { kind: 'none' }
  | { kind: 'single_candidate'; candidate: string; masked: string }
  | { kind: 'ambiguous'; maskedCandidates: string[] };

const LOCAL_ATOM = "A-Z0-9!#$%'*+/^_`{|}~-";
const STRICT_EMAIL_PATTERN = new RegExp(
  `^(?=.{1,64}@)(?=.{3,254}$)[${LOCAL_ATOM}]+(?:\\.[${LOCAL_ATOM}]+)*@`
  + '(?:[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?\\.)+'
  + '(?:[A-Z]{2,63}|XN--[A-Z0-9](?:[A-Z0-9-]{0,57}[A-Z0-9]))$',
  'i',
);
const DISALLOWED_CONTROL_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;
const UNICODE_OBFUSCATION_PATTERN = /[\p{Cf}\p{M}]/u;
const EXCLUDED_TOKEN_PATTERN = /(?:^|[,;:\[\](){}<>"'“”‘’])(?:[a-z][a-z0-9+.-]*:\/\/|mailto:|www\.)/i;
const QUERY_LIKE_PATTERN = /[?&=]/;
const KNOWN_EMAIL_LABEL_PATTERN = /^(?:이메일|email):/i;
const TRAILING_SENTENCE_PUNCTUATION_PATTERN = /[.!]$/;
const OUTER_WRAPPER_PAIRS: Readonly<Record<string, string>> = {
  '(': ')',
  '[': ']',
  '{': '}',
  '<': '>',
  '"': '"',
  "'": "'",
  '“': '”',
  '‘': '’',
};

function isValidEmail(email: string): boolean {
  return STRICT_EMAIL_PATTERN.test(email);
}

export function maskYouTubeInviteEmail(email: string): string {
  if (typeof email !== 'string') return '***';
  const normalized = email.trim().toLowerCase();
  if (!isValidEmail(normalized)) return '***';

  const [local, domain] = normalized.split('@');
  const labels = domain.split('.');
  const topLevelDomain = labels.pop() ?? '';
  const maskLabel = (label: string): string => label.length <= 2
    ? `${label.slice(0, 1)}***`
    : `${label[0]}${'*'.repeat(label.length - 2)}${label.at(-1)}`;
  const maskedLocal = local.length <= 2
    ? `${local.slice(0, 1)}***`
    : `${local[0]}***${local.at(-1)}`;
  return `${maskedLocal}@${labels.map(maskLabel).join('.')}.${topLevelDomain}`;
}

function cleanCandidateToken(token: string): string {
  let cleaned = token.replace(KNOWN_EMAIL_LABEL_PATTERN, '');

  while (cleaned.length >= 2 && OUTER_WRAPPER_PAIRS[cleaned[0]] === cleaned.at(-1)) {
    cleaned = cleaned.slice(1, -1);
  }

  if (TRAILING_SENTENCE_PUNCTUATION_PATTERN.test(cleaned)) {
    cleaned = cleaned.slice(0, -1);
  }

  return isValidEmail(cleaned) ? cleaned : '';
}

export function parseYouTubeInviteEmailCandidates(text: string): YouTubeInviteEmailCandidateResult {
  if (typeof text !== 'string' || text.length > YOUTUBE_INVITE_EMAIL_MAX_INPUT_LENGTH) return { kind: 'none' };
  if (DISALLOWED_CONTROL_PATTERN.test(text)) return { kind: 'none' };

  const normalizedText = text.replace(/[\r\n\t]+/g, ' ');
  const candidates = new Set<string>();

  for (const whitespaceToken of normalizedText.split(/\s+/u)) {
    if (
      whitespaceToken.length === 0
      || (whitespaceToken.includes('@') && UNICODE_OBFUSCATION_PATTERN.test(whitespaceToken))
      || EXCLUDED_TOKEN_PATTERN.test(whitespaceToken)
      || QUERY_LIKE_PATTERN.test(whitespaceToken)
    ) continue;

    const candidate = cleanCandidateToken(whitespaceToken).toLowerCase();
    if (candidate) candidates.add(candidate);
  }

  if (candidates.size === 0) return { kind: 'none' };
  const values = [...candidates];
  if (values.length > 1) {
    return { kind: 'ambiguous', maskedCandidates: values.map(maskYouTubeInviteEmail) };
  }
  const candidate = values[0];
  return { kind: 'single_candidate', candidate, masked: maskYouTubeInviteEmail(candidate) };
}
