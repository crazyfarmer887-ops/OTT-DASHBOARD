import { describe, expect, it } from 'vitest';
import { extractGbutsSpotifyCredentials, gbutsSpotifyOrderKey, isActiveGbutsSpotifyMember,
  isSpotifyAccountForBuyer, jamkkangudokSpotifyEmail } from '../src/lib/gbuts-spotify';

const buyer = 42;
const message = (senderSeq: number, text: string, createdAt: string) => ({
  senderSeq, message: text, messageType: 'TEXT', createdAt,
});

describe('GButs Spotify invitation matching', () => {
  it('keys a buyer by the seller listing and member identity', () => {
    expect(gbutsSpotifyOrderKey(15557, { seq: 9, userSeq: buyer, productId: '100', status: 'APPLY', cancelStatus: null }))
      .toBe('15557:9');
  });

  it('skips cancelled and refunded members', () => {
    const member = { seq: 9, userSeq: buyer, productId: '100', status: 'APPLY', cancelStatus: null };
    expect(isActiveGbutsSpotifyMember(member)).toBe(true);
    expect(isActiveGbutsSpotifyMember({ ...member, cancelStatus: 'REFUND_REJECTED' })).toBe(true);
    expect(isActiveGbutsSpotifyMember({ ...member, cancelStatus: 'REFUND_REQUESTED' })).toBe(false);
    expect(isActiveGbutsSpotifyMember({ ...member, status: 'CANCELLED' })).toBe(false);
  });

  it('requires buyer supplied labeled Spotify account and password', () => {
    const result = extractGbutsSpotifyCredentials([
      message(7, 'Spotify email: seller@example.com\nPassword: sellerpass', '2026-10-02T10:00:00Z'),
      message(buyer, '스포티파이 아이디: Buyer@Example.com\n비밀번호: secret123', '2026-10-02T10:01:00Z'),
    ], buyer);
    expect(result).toEqual({ email: 'buyer@example.com', password: 'secret123', receivedAt: '2026-10-02T10:01:00Z' });
  });

  it('recognizes an email and password sent as separate replies to the seller request', () => {
    const result = extractGbutsSpotifyCredentials([
      message(7, '패밀리 플랜 들어가실 아이디 비밀번호 여기에 남겨주세요.', '2026-10-03T10:31:00Z'),
      message(buyer, 'buyer@example.com', '2026-10-03T10:32:00Z'),
      message(buyer, 'samplepass42!@#', '2026-10-03T10:32:01Z'),
      message(buyer, 'ID 비번 남겼습니다 확인부탁드려요', '2026-10-03T10:33:00Z'),
    ], buyer);
    expect(result).toEqual({ email: 'buyer@example.com', password: 'samplepass42!@#',
      receivedAt: '2026-10-03T10:32:01Z' });
  });

  it('does not guess an unlabeled password without a seller request or from a later reply', () => {
    const buyerReplies = [
      message(buyer, 'buyer@example.com', '2026-10-03T10:32:00Z'),
      message(buyer, 'samplepass42!@#', '2026-10-03T10:32:01Z'),
    ];
    expect(extractGbutsSpotifyCredentials(buyerReplies, buyer)).toBeNull();
    expect(extractGbutsSpotifyCredentials([
      message(7, '아이디 비밀번호 남겨주세요.', '2026-10-03T10:31:00Z'),
      buyerReplies[0],
      message(buyer, '잠시만요', '2026-10-03T10:32:01Z'),
      buyerReplies[1],
    ], buyer)).toBeNull();
    expect(extractGbutsSpotifyCredentials([
      message(7, '아이디 비밀번호 남겨주세요.', '2026-10-03T10:31:00Z'),
      buyerReplies[0],
      message(buyer, '123456', '2026-10-03T10:32:01Z'),
    ], buyer)).toBeNull();
  });

  it('requires a new password when the buyer changes the login', () => {
    expect(extractGbutsSpotifyCredentials([
      message(buyer, 'Spotify email: first@example.com\nPassword: firstpass', '2026-10-02T10:00:00Z'),
      message(buyer, 'Spotify email: next@example.com', '2026-10-02T10:01:00Z'),
    ], buyer)).toBeNull();
  });

  it('does not take credentials from unlabeled text or a social login without a labeled pair', () => {
    expect(extractGbutsSpotifyCredentials([
      message(buyer, 'myemail@example.com / secret123', '2026-10-02T10:00:00Z'),
    ], buyer)).toBeNull();
    expect(extractGbutsSpotifyCredentials([
      message(buyer, 'Google login\nSpotify email: x@example.com', '2026-10-02T10:00:00Z'),
    ], buyer)).toBeNull();
  });

  it('accepts an explicitly supplied social-login email and password for manual new-account registration', () => {
    expect(extractGbutsSpotifyCredentials([
      message(buyer, 'Google login\nSpotify email: abc123@gmail.com\nPassword: abc123', '2026-10-02T10:00:00Z'),
    ], buyer)).toEqual({ email: 'abc123@gmail.com', password: 'abc123', receivedAt: '2026-10-02T10:00:00Z' });
    expect(jamkkangudokSpotifyEmail('abc123@gmail.com')).toBe('abc123@jamkkangudok.com');
    expect(isSpotifyAccountForBuyer('abc123@jamkkangudok.com', 'abc123@gmail.com')).toBe(true);
    expect(isSpotifyAccountForBuyer('other@jamkkangudok.com', 'abc123@gmail.com')).toBe(false);
  });
});
