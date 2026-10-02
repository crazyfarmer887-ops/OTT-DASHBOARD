import { describe, expect, it } from 'vitest';
import { extractGbutsSpotifyCredentials, gbutsSpotifyOrderKey, isActiveGbutsSpotifyMember } from '../src/lib/gbuts-spotify';

const buyer = 42;
const message = (senderSeq: number, text: string, createdAt: string) => ({
  senderSeq, message: text, messageType: 'TEXT', createdAt,
});

describe('GButs Spotify invitation matching', () => {
  it('keys a buyer by the seller listing and member identity', () => {
    expect(gbutsSpotifyOrderKey(15557, { seq: 9, userSeq: buyer, productId: 100, status: 'APPLY', cancelStatus: null }))
      .toBe('15557:9');
  });

  it('skips cancelled and refunded members', () => {
    const member = { seq: 9, userSeq: buyer, productId: 100, status: 'APPLY', cancelStatus: null };
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

  it('requires a new password when the buyer changes the login', () => {
    expect(extractGbutsSpotifyCredentials([
      message(buyer, 'Spotify email: first@example.com\nPassword: firstpass', '2026-10-02T10:00:00Z'),
      message(buyer, 'Spotify email: next@example.com', '2026-10-02T10:01:00Z'),
    ], buyer)).toBeNull();
  });

  it('does not take credentials from unlabeled text or social login', () => {
    expect(extractGbutsSpotifyCredentials([
      message(buyer, 'myemail@example.com / secret123', '2026-10-02T10:00:00Z'),
    ], buyer)).toBeNull();
    expect(extractGbutsSpotifyCredentials([
      message(buyer, 'Google login\nSpotify email: x@example.com\nPassword: secret123', '2026-10-02T10:00:00Z'),
    ], buyer)).toBeNull();
  });
});
