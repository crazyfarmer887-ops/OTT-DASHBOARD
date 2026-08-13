import { describe, expect, test } from 'vitest';
import {
  YOUTUBE_INVITE_EMAIL_REQUEST_MESSAGE,
  buildYouTubeInviteEmailRequestMessage,
  maskYouTubeInviteEmail,
  parseYouTubeInviteEmailCandidates,
} from '../src/lib/youtube-invite-email';

describe('parseYouTubeInviteEmailCandidates', () => {
  test('returns one normalized but unconfirmed candidate from buyer chat', () => {
    const result = parseYouTubeInviteEmailCandidates('제 Google 계정은   Buyer@Example.com   입니다');

    expect(result).toEqual({
      kind: 'single_candidate',
      candidate: 'buyer@example.com',
      masked: 'b***r@e*****e.com',
    });
    expect(result).not.toHaveProperty('confirmed');
  });

  test('deduplicates independently valid repeated candidates case-insensitively', () => {
    expect(parseYouTubeInviteEmailCandidates('Buyer@Example.com buyer@example.COM')).toEqual({
      kind: 'single_candidate',
      candidate: 'buyer@example.com',
      masked: 'b***r@e*****e.com',
    });
  });

  test('ignores an unrelated emoji variation selector while detecting a plain email token', () => {
    expect(parseYouTubeInviteEmailCandidates('감사합니다 ❤️ buyer@example.com')).toEqual({
      kind: 'single_candidate',
      candidate: 'buyer@example.com',
      masked: 'b***r@e*****e.com',
    });
  });

  test('ignores an unrelated decomposed-word token while detecting a plain email token', () => {
    expect(parseYouTubeInviteEmailCandidates('cafe\u0301 buyer@example.com')).toEqual({
      kind: 'single_candidate',
      candidate: 'buyer@example.com',
      masked: 'b***r@e*****e.com',
    });
  });

  test('keeps an ASCII apostrophe as part of the whole local-part', () => {
    expect(parseYouTubeInviteEmailCandidates("o'connor@example.com")).toEqual({
      kind: 'single_candidate',
      candidate: "o'connor@example.com",
      masked: "o***r@e*****e.com",
    });
  });

  test('supports a known email label before repeated balanced wrappers', () => {
    expect(parseYouTubeInviteEmailCandidates('이메일:Buyer@Example.com')).toEqual({
      kind: 'single_candidate',
      candidate: 'buyer@example.com',
      masked: 'b***r@e*****e.com',
    });
    expect(parseYouTubeInviteEmailCandidates('email:[“Buyer@Example.com”]')).toEqual({
      kind: 'single_candidate',
      candidate: 'buyer@example.com',
      masked: 'b***r@e*****e.com',
    });
  });

  test.each([
    '(buyer@example.com)',
    '[buyer@example.com]',
    '{buyer@example.com}',
    '<buyer@example.com>',
    '"buyer@example.com"',
    "'buyer@example.com'",
    '“buyer@example.com”',
    '‘buyer@example.com’',
    '((buyer@example.com))',
  ])('strips only balanced whole-token wrappers: %s', text => {
    expect(parseYouTubeInviteEmailCandidates(text)).toEqual({
      kind: 'single_candidate',
      candidate: 'buyer@example.com',
      masked: 'b***r@e*****e.com',
    });
  });

  test.each([
    'bad’victim@example.com',
    'bad“victim@example.com',
    'bad"victim@example.com',
    'bad:victim@example.com',
    'bad,victim@example.com',
    'bad(victim@example.com',
    '(victim@example.com]',
  ])('does not extract an email suffix through internal punctuation: %s', text => {
    expect(parseYouTubeInviteEmailCandidates(text)).toEqual({ kind: 'none' });
  });

  test('returns only masked candidates when distinct addresses are ambiguous', () => {
    const result = parseYouTubeInviteEmailCandidates('first@gmail.com 또는 Second@work-example.org');

    expect(result).toEqual({
      kind: 'ambiguous',
      maskedCandidates: ['f***t@g***l.com', 's***d@w**********e.org'],
    });
    expect(result).not.toHaveProperty('candidate');
    expect(result).not.toHaveProperty('confirmed');
    expect(JSON.stringify(result)).not.toContain('first@gmail.com');
    expect(JSON.stringify(result)).not.toContain('second@work-example.org');
  });

  test('ignores addresses embedded in URL paths and query parameters', () => {
    expect(parseYouTubeInviteEmailCandidates(
      'https://example.com/user@url.test?next=user@query.test standalone@googlemail.com',
    )).toEqual({
      kind: 'single_candidate',
      candidate: 'standalone@googlemail.com',
      masked: 's***e@g********l.com',
    });
    expect(parseYouTubeInviteEmailCandidates('https://example.com/?email=buyer@example.com')).toEqual({ kind: 'none' });
    expect(parseYouTubeInviteEmailCandidates('mailto:buyer@example.com')).toEqual({ kind: 'none' });
  });

  test.each([
    '?email=buyer@example.com',
    'email=buyer@example.com',
    '?email=%20buyer@example.com',
  ])('rejects standalone query-like input %s', text => {
    expect(parseYouTubeInviteEmailCandidates(text)).toEqual({ kind: 'none' });
  });

  test('extracts from a normal Korean sentence and accepts one trailing sentence mark', () => {
    expect(parseYouTubeInviteEmailCandidates('초대 주소는 buyer@example.com 입니다.')).toEqual({
      kind: 'single_candidate',
      candidate: 'buyer@example.com',
      masked: 'b***r@e*****e.com',
    });
    expect(parseYouTubeInviteEmailCandidates('초대 주소는 buyer@example.com. 입니다')).toEqual({
      kind: 'single_candidate',
      candidate: 'buyer@example.com',
      masked: 'b***r@e*****e.com',
    });
    expect(parseYouTubeInviteEmailCandidates('buyer@example.com!')).toEqual({
      kind: 'single_candidate',
      candidate: 'buyer@example.com',
      masked: 'b***r@e*****e.com',
    });
  });

  test('normalizes multiline unrelated text without joining a split address', () => {
    expect(parseYouTubeInviteEmailCandidates('안녕하세요.\n초대 이메일은 buyer@example.com 입니다.\r\n감사합니다.')).toEqual({
      kind: 'single_candidate',
      candidate: 'buyer@example.com',
      masked: 'b***r@e*****e.com',
    });
    expect(parseYouTubeInviteEmailCandidates('buyer@\nexample.com')).toEqual({ kind: 'none' });
  });

  test.each([
    'missing-at.example.com',
    'a..b@example.com',
    '.buyer@example.com',
    'buyer@-example.com',
    'buyer@example',
    'buyer@example..com',
    'buyer@example.com..evil',
    'buyer@example.com.-evil',
    'buyer@example.com._evil',
  ])('rejects malformed address %s', text => {
    expect(parseYouTubeInviteEmailCandidates(text)).toEqual({ kind: 'none' });
  });

  test.each([
    'bu©yer@example.com',
    'bu🙂yer@example.com',
    '🙂buyer@example.com',
    'buyer@example.com🙂evil',
    'buyer@example.com©',
    'buyer@example.com—evil',
    'buyer@example.com/evil',
    'buyer@example.com.!',
    'buyer@example.com._evil',
    'buyer@example.com.-evil',
    'buyer@example.com..evil',
    'buyer@example.com+evil',
  ])('does not suffix-extract through a symbol or malformed continuation: %s', text => {
    expect(parseYouTubeInviteEmailCandidates(text)).toEqual({ kind: 'none' });
  });

  test('fails closed when disallowed controls split an address', () => {
    expect(parseYouTubeInviteEmailCandidates('buyer@\u0000example.com')).toEqual({ kind: 'none' });
  });

  test('does not extract an ASCII suffix from a Unicode-confusable address', () => {
    expect(parseYouTubeInviteEmailCandidates('buуer@example.com')).toEqual({ kind: 'none' });
    expect(parseYouTubeInviteEmailCandidates('📧 safe.user@example.dev 감사합니다')).toEqual({
      kind: 'single_candidate',
      candidate: 'safe.user@example.dev',
      masked: 's***r@e*****e.dev',
    });
  });

  test.each([
    'bu\u200Dyer@example.com',
    'bu\u0301yer@example.com',
  ])('fails closed for an address obfuscated with a Unicode format or mark character: %s', text => {
    expect(parseYouTubeInviteEmailCandidates(text)).toEqual({ kind: 'none' });
  });

  test('fails closed for impossible overlong or non-string input', () => {
    expect(parseYouTubeInviteEmailCandidates(`${'x'.repeat(10_001)} buyer@example.com`)).toEqual({ kind: 'none' });
    expect(parseYouTubeInviteEmailCandidates(null as unknown as string)).toEqual({ kind: 'none' });
  });
});

describe('maskYouTubeInviteEmail', () => {
  test('normalizes and masks the local and registrable-domain labels', () => {
    expect(maskYouTubeInviteEmail(' Buyer.Name@Sub.Example.COM ')).toBe('b***e@s*b.e*****e.com');
    expect(maskYouTubeInviteEmail('a@x.io')).toBe('a***@x***.io');
  });

  test.each([
    'not-an-email',
    'a b@example.com',
    'bu©yer@example.com',
    'bu🙂yer@example.com',
    'a..b@example.com',
    'buyer@-example.com',
    'buyer@example',
  ])('returns an opaque fallback for malformed or obstructed input: %s', email => {
    expect(maskYouTubeInviteEmail(email)).toBe('***');
  });
});

describe('buildYouTubeInviteEmailRequestMessage', () => {
  test('returns the approved payment-confirmed request exactly', () => {
    const expected = '결제가 확인됐습니다. 유튜브 가족 초대를 받을 Google 이메일 주소를 채팅에 남겨주세요. 초대 메일을 받으면 수락 후 알려주세요.';

    expect(YOUTUBE_INVITE_EMAIL_REQUEST_MESSAGE).toBe(expected);
    expect(buildYouTubeInviteEmailRequestMessage()).toBe(expected);
  });
});
