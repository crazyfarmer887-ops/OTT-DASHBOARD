import { describe, it, expect, vi } from 'vitest';
import { applyDedicatedEveryviewDisneySeat, applyEveryviewDisneyObservation } from '../src/lib/everyview-disney-inventory-bridge';
import { disneyEveryviewAccountKey, disneyEveryviewInventory } from '../src/lib/gbuts-disney-everyview';
import { evaluateDisneyInventory } from '../src/lib/disney-cross-platform-inventory';
import { emptyGbutsOttStore } from '../src/lib/gbuts-ott';
import { allocateDisneyProfilesForSync } from '../src/lib/gbuts-disney-profiles';
import { fixtureListing, fixtureOrder } from './fixtures/gbuts-ott';
import type { EveryviewDisneyWatchState } from '../src/scheduler/everyview-disney-observation';
import { runDisneyDedicatedBridge } from '../src/scheduler/everyview-disney-inventory-bridge';

const email = 'disney@example.com', key = disneyEveryviewAccountKey(email), partyId = 10;
const now = new Date('2026-10-29T00:01:00.000Z'), observedAt = '2026-10-29T00:00:30.000Z';
const makeStore = () => ({ ...emptyGbutsOttStore(), disneyEveryview: { [key]: { partyIds: [partyId], snapshots: {} } } });
const makeWatch = (members: EveryviewDisneyWatchState['parties'][string]['members'] = {}): EveryviewDisneyWatchState => ({
  version: 1, parties: { [String(partyId)]: { accountHash: key, observedAt, visibleEmptySlots: 1, members } },
});
const makeEvidence = () => ({ partyId, accountHash: key, rosterObservedAt: observedAt,
  checkedAt: '2026-10-29T00:00:40.000Z', buyerCapacity: 1 as const, advertisedVacancies: 1 as const });
const makeMember = (userSeq = 20, currentlyVisible = true) => ({ userSeq, currentlyVisible, firstObservedAt: observedAt, lastObservedAt: observedAt });
const apply = (extra: Partial<Parameters<typeof applyDedicatedEveryviewDisneySeat>[0]> = {}) =>
  applyDedicatedEveryviewDisneySeat({ store: makeStore(), accountEmail: email, partyId, profileNumber: 6,
    watch: makeWatch(), evidence: makeEvidence(), now, ...extra });

describe('dedicated Everyview Disney inventory', () => {
  it('requires an explicit existing mapping before creating a snapshot', () => {
    expect(() => apply({ store: emptyGbutsOttStore() })).toThrow('PARTY_MAPPING_REQUIRED');
  });
  it('reserves profile 6 and records one independently verified advertised vacancy', () => {
    const original = makeStore(); const result = apply({ store: original });
    expect(result.complete).toBe(true);
    const snap = result.store.disneyEveryview![key].snapshots['10'];
    expect(snap).toMatchObject({ complete: true, advertisedVacancies: 1, claims: [{ profileNumber: 6, kind: 'advertised' }] });
    expect(original.disneyEveryview[key].snapshots).toEqual({});
    expect(evaluateDisneyInventory({ capacity: 6, requiredSources: [snap.source], snapshots: [snap], now, maxAgeMs: 120000 }))
      .toMatchObject({ ok: true, occupied: 1, available: 5 });
  });
  it('keeps the same seat held when sold, hidden, or unconfirmed', () => {
    const sold = apply({ watch: makeWatch({ '30': makeMember() }), evidence: { ...makeEvidence(), advertisedVacancies: 0 } });
    expect(sold.complete).toBe(true);
    expect(sold.store.disneyEveryview![key].snapshots['10'].claims[0]).toMatchObject({ profileNumber: 6, kind: 'buyer', state: 'active' });
    const hidden = apply({ evidence: { ...makeEvidence(), advertisedVacancies: 0 } });
    expect(hidden.store.disneyEveryview![key].snapshots['10'].claims[0]).toMatchObject({ profileNumber: 6, kind: 'reserved', state: 'pending' });
    const failed = apply({ evidence: undefined });
    expect(failed).toMatchObject({ complete: false });
    expect(failed.store.disneyEveryview![key].snapshots['10'].claims[0]).toMatchObject({ profileNumber: 6, state: 'unknown' });
  });
  it('does not turn a missing or replaced buyer into an available advertisement', () => {
    const sold = apply({ watch: makeWatch({ '30': makeMember() }), evidence: { ...makeEvidence(), advertisedVacancies: 0 } });
    for (const watch of [makeWatch(), makeWatch({ '31': makeMember(21) }), makeWatch({ '30': makeMember(20, false) })]) {
      const next = apply({ store: sold.store, watch, evidence: { ...makeEvidence(), advertisedVacancies: 0 } });
      expect(next.complete).toBe(false);
      expect(next.store.disneyEveryview![key].snapshots['10'].claims[0]).toMatchObject({ profileNumber: 6, state: 'unknown' });
    }
  });
  it('fails closed for stale/wrong-party evidence, multiple buyers and a buyer plus open advertisement', () => {
    for (const opts of [
      { evidence: { ...makeEvidence(), checkedAt: '2026-10-28T00:00:00Z' } },
      { evidence: { ...makeEvidence(), partyId: 11 } },
      { watch: makeWatch({ '30': makeMember(), '31': makeMember(21) }), evidence: { ...makeEvidence(), advertisedVacancies: 0 as const } },
      { watch: makeWatch({ '30': makeMember() }) },
      { watch: { ...makeWatch(), lastError: 'SESSION_REQUIRED' as const } },
    ]) expect(apply(opts).complete).toBe(false);
  });
  it('does not discard old unrecognized holds', () => {
    const store = makeStore();
    store.disneyEveryview[key].snapshots['10'] = { source: 'everyview:10', complete: true, verifiedAt: observedAt,
      advertisedVacancies: 0, claims: [{ id: 'legacy', state: 'active', kind: 'buyer', profileNumber: 4 }] };
    const result = apply({ store });
    expect(result.complete).toBe(false);
    expect(result.store.disneyEveryview![key].snapshots['10'].claims).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'legacy', profileNumber: 4, state: 'unknown' }),
      expect.objectContaining({ profileNumber: 6 }),
    ]));
  });
  it('uses six real profiles and keeps the GButs limit at five', () => {
    const initial = makeStore();
    initial.listings['request-1'] = fixtureListing({ serviceType: '디즈니플러스', accountEmail: email, capacity: 5, deliveryMode: 'disney-numbered-password' });
    const bound = apply({ store: initial }).store;
    bound.disneyEveryview![key].accountCapacity = 6;
    for (let n=1;n<=4;n++) bound.orders[`100:${n}`] = fixtureOrder({ key:`100:${n}`, memberSeq:n, userSeq:10+n, profileNumber:n, profileName:String(n), delivery:'confirmed' });
    bound.orders['100:5'] = fixtureOrder({ key:'100:5', memberSeq:5, userSeq:15 });
    const listing=bound.listings['request-1'];
    expect(disneyEveryviewInventory(bound, listing, now, {ignoreUnassignedNewGbuts:true})).toMatchObject({ ok:true, capacity:6, occupiedProfiles:[1,2,3,4,6], available:1 });
    const management={services:[{serviceType:'디즈니플러스',accounts:[{email,serviceType:'디즈니플러스',totalSlots:6,members:[],expiryDate:'2026-12-31',generatedAccount:{paymentStatus:'paid'}}]}],onSaleByKeepAcct:{}};
    expect(allocateDisneyProfilesForSync(bound, management as any, [], now).size).toBe(0);
    expect(bound.orders['100:5'].profileNumber).toBe(5);
    bound.orders['100:6']=fixtureOrder({ key:'100:6',memberSeq:6,userSeq:16 });
    expect(allocateDisneyProfilesForSync(bound, management as any, [], now).size).toBe(1);
    expect(bound.orders['100:6'].profileNumber).toBeUndefined();
  });
  it('fails closed if the explicit account capacity is below the GButs limit', () => {
    const store = apply().store;
    store.listings['request-1'] = fixtureListing({ serviceType:'디즈니플러스',accountEmail:email,capacity:5,deliveryMode:'disney-numbered-password' });
    store.disneyEveryview![key].accountCapacity = 4;
    expect(disneyEveryviewInventory(store, store.listings['request-1'], now)).toMatchObject({ ok:false, available:0 });
  });
});

describe('independent observed inventory bridge', () => {
  it('never derives advertised vacancies from the HTML empty count', () => {
    const result = applyEveryviewDisneyObservation({ store: makeStore(), accountEmail: email, partyId, watch: makeWatch(), now });
    expect(result.complete).toBe(false);
    expect(result.store.disneyEveryview![key].snapshots['10'].advertisedVacancies).toBe(0);
  });
  it('holds an unknown buyer without guessing their profile', () => {
    const watch = makeWatch({ '30': makeMember() });
    const evidence = { partyId, accountHash: key, observedAt, checkedAt: '2026-10-29T00:00:40.000Z', buyers: {}, advertisements: [] };
    const result = applyEveryviewDisneyObservation({ store: makeStore(), accountEmail: email, partyId, watch, evidence, now });
    expect(result.complete).toBe(false);
    expect(result.store.disneyEveryview![key].snapshots['10'].claims).toContainEqual(expect.objectContaining({ id: 'buyer_30', profileNumber: undefined }));
  });
});

describe('dedicated seat bridge writer', () => {
  it('writes held snapshots under the shared lock and marks a source failure incomplete', async () => {
    let store = makeStore(), locked = false;
    const write = vi.fn((next: typeof store) => { expect(locked).toBe(true); store = next; });
    const evidence = vi.fn(async () => makeEvidence()), alert = vi.fn(async () => undefined);
    const config = { enabled: true, bindings: [{ partyId, accountEmail: email, profileNumber: 6 }] };
    const deps = { config: () => config, readWatch: () => makeWatch(),
      withInventory: async <T>(fn: () => Promise<T>) => { locked = true; try { return await fn(); } finally { locked = false; } },
      readInventory: () => store, writeInventory: write, evidence, safeToRun: () => true, alert, now: () => now };
    expect(await runDisneyDedicatedBridge(deps)).toBe('checked');
    expect(store.disneyEveryview[key].snapshots['10'].claims[0]).toMatchObject({ profileNumber: 6, kind: 'advertised' });
    evidence.mockRejectedValueOnce(new Error('provider unavailable'));
    expect(await runDisneyDedicatedBridge(deps)).toBe('held');
    expect(store.disneyEveryview[key].snapshots['10']).toMatchObject({ complete: false });
    expect(store.disneyEveryview[key].snapshots['10'].claims[0]).toMatchObject({ profileNumber: 6, state: 'unknown' });
    expect(alert).toHaveBeenCalledWith('SNAPSHOT_INCOMPLETE');
  });
  it('does not overwrite inventory if configuration changes during evidence collection', async () => {
    let enabled = true;
    const write = vi.fn(), alert = vi.fn(async () => undefined);
    const deps = { config: () => ({ enabled, bindings: [{ partyId, accountEmail: email, profileNumber: 6 }] }), readWatch: () => makeWatch(),
      withInventory: async <T>(fn: () => Promise<T>) => fn(), readInventory: makeStore, writeInventory: write,
      evidence: async () => { enabled = false; return makeEvidence(); }, safeToRun: () => true, alert, now: () => now };
    expect(await runDisneyDedicatedBridge(deps)).toBe('paused');
    expect(write).not.toHaveBeenCalled();
  });
  it('does not invent a party mapping if it is missing', async () => {
    const write = vi.fn(), alert = vi.fn(async () => undefined);
    const deps = { config: () => ({ enabled: true, bindings: [{ partyId, accountEmail: email, profileNumber: 6 }] }), readWatch: () => makeWatch(),
      withInventory: async <T>(fn: () => Promise<T>) => fn(), readInventory: emptyGbutsOttStore, writeInventory: write,
      evidence: async () => makeEvidence(), safeToRun: () => true, alert, now: () => now };
    expect(await runDisneyDedicatedBridge(deps)).toBe('held');
    expect(write).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith('BINDING_UNVERIFIED');
  });
});
