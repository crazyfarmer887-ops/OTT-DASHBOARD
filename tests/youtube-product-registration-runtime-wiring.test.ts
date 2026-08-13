import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const source = readFileSync(new URL('../src/api/index.ts', import.meta.url), 'utf8');

describe('YouTube reconciliation runtime mount', () => {
  test('injects the authoritative seller reconciliation dependency into the canonical app', () => {
    const mount = source.match(/createYouTubeInvitationsApp\(\{[\s\S]*?\n\}\);/)?.[0] || '';
    expect(mount).toContain('reconcileProductRegistration: reconcileYouTubeProductRegistrationFromSeller');
  });
});
