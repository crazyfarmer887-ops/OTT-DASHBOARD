import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveGbutsOttDirectCredentials } from '../src/lib/gbuts-ott-credentials';
import { createPartyAccessLinkRecord, partyAccessAccountKey } from '../src/lib/party-access';
import { mergePartyMaintenanceChecklistState } from '../src/lib/party-maintenance-checklist';
import { emptyGbutsOttStore } from '../src/lib/gbuts-ott';
import { readGbutsOttStore, writeGbutsOttStore } from '../src/lib/gbuts-ott-store';
import { fixtureListing, fixtureOrder } from './fixtures/gbuts-ott';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-05T06:00:00Z')); });
afterEach(() => vi.useRealTimers());
function fixture() {
  const listing = fixtureListing();
  const order = fixtureOrder({ profileName: '4', profileNumber: 4, delivery: 'confirmed' });
  const inventory = emptyGbutsOttStore(); inventory.listings[listing.id] = listing; inventory.orders[order.key] = order;
  const record = createPartyAccessLinkRecord({ token: 'credential-resolver-test', serviceType: listing.serviceType, accountEmail: listing.accountEmail,
    profileName: '4', fallbackPassword: 'old-password', member: { kind: 'gbuts', memberId: order.key, memberName: 'buyer', status: 'active',
      startDateTime: order.startDate, endDateTime: order.endDate, verifiedAt: new Date().toISOString() } });
  const data = { inventory, accessRecords: { [record.tokenHash]: record }, maintenance: {}, generated: {} };
  return { order, listing, record, data };
}
test('direct delivery resolves current maintenance ID and password from the same records as the access page', () => {
  const f = fixture();
  f.data.maintenance = mergePartyMaintenanceChecklistState({}, partyAccessAccountKey(f.listing.serviceType, f.listing.accountEmail),
    { changedAccountEmail: 'new-login@example.com', changedPassword: 'new-password' }, 'test');
  expect(resolveGbutsOttDirectCredentials(f.order, f.listing, f.data)).toEqual({ id: 'new-login@example.com', password: 'new-password' });
});
test.each(['account', 'profile', 'buyer', 'revoked', 'refunded'])(
  'direct delivery refuses an invalid %s binding', mismatch => {
    const f = fixture();
    if (mismatch === 'account') f.record.accountEmail = 'other@example.com';
    if (mismatch === 'profile') f.record.profileName = '5';
    if (mismatch === 'buyer') f.record.member.memberId = '100:2';
    if (mismatch === 'revoked') f.record.revokedAt = new Date().toISOString();
    if (mismatch === 'refunded') f.order.cancelStatus = 'REFUNDED';
    expect(() => resolveGbutsOttDirectCredentials(f.order, f.listing, f.data)).toThrow();
  });
test('direct delivery request state survives the real private journal and contains no plaintext credentials', () => {
  const f = fixture(); const dir = mkdtempSync(join(tmpdir(), 'gbuts-direct-journal-')); const path = join(dir, 'orders.json');
  try {
    f.order.directDelivery = { requestAt: new Date().toISOString(), requestKey: 'a'.repeat(64), state: 'attempted', messageHash: 'b'.repeat(64), attemptedAt: new Date().toISOString() };
    writeGbutsOttStore(f.data.inventory, path);
    const restored = readGbutsOttStore(path);
    expect(restored.orders[f.order.key].directDelivery).toEqual(f.order.directDelivery);
    expect(JSON.stringify(restored)).not.toContain('old-password');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
