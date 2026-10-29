import { describe, expect, it } from 'vitest';
import { evaluateDisneyInventory, type DisneySeatSnapshot } from '../src/lib/disney-cross-platform-inventory';

const now = new Date('2026-10-29T08:00:00.000Z');
const snapshot = (source: string, claims: DisneySeatSnapshot['claims'] = []): DisneySeatSnapshot => ({
  source, complete: true, verifiedAt: '2026-10-29T07:59:50.000Z', claims,
});
const evaluate = (snapshots: DisneySeatSnapshot[], extra: Partial<Parameters<typeof evaluateDisneyInventory>[0]> = {}) =>
  evaluateDisneyInventory({ capacity: 6, requiredSources: ['gbuts', 'everyview'], snapshots, now, maxAgeMs: 60_000, ...extra });

describe('Disney shared seat inventory', () => {
  it('counts existing assigned buyers from both platforms and never changes their profiles', () => {
    const inputs = [snapshot('gbuts', [{ id: 'g1', state: 'active', profileNumber: 1 }, { id: 'g2', state: 'active', profileNumber: 5 }]),
      snapshot('everyview', [{ id: 'e1', state: 'active', profileNumber: 3 }])];
    const before = structuredClone(inputs);
    expect(evaluate(inputs)).toMatchObject({ ok: true, occupiedProfiles: [1, 3, 5], occupied: 3, available: 3, assignableProfiles: [2, 4, 6] });
    expect(inputs).toEqual(before);
  });
  it('reserves pending claims and does not release refunded claims until confirmed released', () => {
    const result = evaluate([snapshot('gbuts', [{ id: 'refund-request', state: 'unknown', profileNumber: 2 },
      { id: 'payment-pending', state: 'pending', profileNumber: 4 }, { id: 'confirmed-refund', state: 'released', profileNumber: 1 }]), snapshot('everyview')]);
    expect(result).toMatchObject({ ok: true, occupied: 2, available: 4, occupiedProfiles: [2, 4], assignableProfiles: [1, 3, 5, 6] });
  });
  it('reserves an unknown profile and closes publication until its actual number is known', () => {
    const result = evaluate([snapshot('gbuts', [{ id: 'g1', state: 'active', profileNumber: 2 }]),
      snapshot('everyview', [{ id: 'pending', state: 'pending' }])]);
    expect(result).toMatchObject({ ok: true, occupied: 2, unnumberedClaims: 1, available: 0, assignableProfiles: [] });
  });
  it('blocks duplicate profile assignments even across platforms', () => {
    const result = evaluate([snapshot('gbuts', [{ id: '1', state: 'active', profileNumber: 2 }]),
      snapshot('everyview', [{ id: '2', state: 'active', profileNumber: 2 }])]);
    expect(result).toMatchObject({ ok: false, available: 0, assignableProfiles: [] });
    expect(result.errors).toContain('PROFILE_CONFLICT');
  });
  it('blocks publication when sources are absent, stale, future-dated, incomplete, or duplicated', () => {
    const g = snapshot('gbuts'), e = snapshot('everyview');
    for (const [items, error] of [
      [[g], 'MISSING_SOURCE'],
      [[g, { ...e, verifiedAt: '2026-10-29T07:58:59.000Z' }], 'STALE_SOURCE'],
      [[g, { ...e, verifiedAt: '2026-10-29T08:00:01.000Z' }], 'STALE_SOURCE'],
      [[g, { ...e, complete: false }], 'INCOMPLETE_SOURCE'],
      [[g, e, e], 'DUPLICATE_SOURCE'],
    ] as const) {
      const result = evaluate([...items]);
      expect(result.errors).toContain(error);
      expect(result.available).toBe(0);
    }
  });
  it('rejects duplicate claim IDs, invalid profiles, over-capacity and invalid config', () => {
    const d = evaluate([snapshot('gbuts', [{ id: 'one', state: 'active', profileNumber: 1 }, { id: 'one', state: 'active', profileNumber: 2 }]), snapshot('everyview')]);
    expect(d.errors).toContain('DUPLICATE_CLAIM');
    expect(evaluate([snapshot('gbuts', [{ id: 'bad', state: 'active', profileNumber: 7 }]), snapshot('everyview')]).errors).toContain('INVALID_CLAIM');
    expect(evaluate([snapshot('gbuts', Array.from({ length: 7 }, (_, i) => ({ id: `${i}`, state: 'pending' as const }))), snapshot('everyview')]).errors).toContain('CAPACITY_EXCEEDED');
    expect(evaluate([snapshot('gbuts'), snapshot('everyview')], { capacity: 7 }).errors).toContain('INVALID_CONFIGURATION');
  });
  it('includes other explicitly mapped platforms and manual claims', () => {
    const result = evaluate([snapshot('gbuts'), snapshot('everyview'), snapshot('graytag', [{ id: 'gt1', state: 'active', profileNumber: 6 }]),
      snapshot('manual', [{ id: 'm1', state: 'active', profileNumber: 1 }])], { requiredSources: ['gbuts', 'everyview', 'graytag', 'manual'] });
    expect(result).toMatchObject({ ok: true, occupiedProfiles: [1, 6], available: 4 });
  });
});
