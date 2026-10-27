import { createDecipheriv, createHash } from 'node:crypto';

/** Matches the seller form's published libraries-Doe4yRCW.js decoder.
 * The provider returns encrypted fields even to its authenticated seller API.
 */
export function decodeGbutsSubscriptionCredential(value: unknown): string {
  return tryDecodeGbutsSubscriptionCredential(value) ?? '';
}

/** An empty decoded value is valid for invitation posts; null means decoding failed. */
export function tryDecodeGbutsSubscriptionCredential(value: unknown): string | null {
  if (typeof value !== 'string' || !/^(?:[a-f\d]{32})+$/i.test(value)) return null;
  try {
    const ascii = Buffer.from(createHash('sha512').update('kkmouke0917').digest('hex'), 'utf8');
    const key = Buffer.alloc(16);
    for (let i = 0; i < ascii.length; i++) key[i % 16] ^= ascii[i];
    const decipher = createDecipheriv('aes-128-ecb', key, null);
    return Buffer.concat([decipher.update(Buffer.from(value, 'hex')), decipher.final()]).toString('utf8');
  } catch { return null; }
}
