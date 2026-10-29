import { describe, expect, it, vi } from 'vitest';
import { everyviewDisneyRecruitmentAction, parseEveryviewDisneyObservation } from '../src/lib/everyview-disney-observation';
import { runEveryviewDisneyObservation, type EveryviewDisneyWatchState } from '../src/scheduler/everyview-disney-observation';

const binding = { partyId: 10, accountEmail: 'disney@example.com' };
const html = `<div class="pld-slot-name pld-slot-name-host">host</div>
<div class="pld-slot" data-user-id="20" onclick="openGeneralPartyChat(10,30)"><div class="pld-slot-name member">buyer</div></div>
<div class="pld-slot-name pld-slot-name-empty">available</div>
<span class="pld-login-svc-name">디즈니플러스</span>
<div data-svc-id="4" data-share-type="ACCOUNT"></div>
<input class="login-accountId" value="disney@example.com">
<input class="login-accountPassword" value="never-record-this">`;

describe('Everyview Disney snapshots', () => {
  it('requires an exact account binding and records identities without credentials', () => {
    const result = parseEveryviewDisneyObservation(html, binding, new Date('2026-10-29T00:00:00Z'));
    expect(result).toEqual({ partyId: 10, observedAt: '2026-10-29T00:00:00.000Z', members: [{ memberSeq: 30, userSeq: 20 }], visibleEmptySlots: 1 });
    expect(JSON.stringify(result)).not.toContain('never-record-this');
    expect(() => parseEveryviewDisneyObservation(html, { ...binding, accountEmail: 'other@example.com' })).toThrow('PARTY_BINDING_UNVERIFIED');
  });
  it('fails closed for incomplete or ambiguous buyer identities', () => {
    expect(() => parseEveryviewDisneyObservation(html.replace('data-user-id="20"', ''), binding)).toThrow('ROSTER_INCOMPLETE');
    expect(() => parseEveryviewDisneyObservation(html.replace('openGeneralPartyChat(10,30)', 'openGeneralPartyChat(11,30)'), binding)).toThrow('MEMBER_IDENTITY_UNVERIFIED');
    const duplicate = html.replace('<div class="pld-slot-name pld-slot-name-empty">', '<div class="pld-slot" data-user-id="20" onclick="openGeneralPartyChat(10,31)"><div class="pld-slot-name member">other</div></div><div class="pld-slot-name pld-slot-name-empty">');
    expect(() => parseEveryviewDisneyObservation(duplicate, binding)).toThrow('ROSTER_INCOMPLETE');
  });
  it('does not write recruitment counts before provider semantics are proven', () => {
    expect(everyviewDisneyRecruitmentAction()).toEqual({ state: 'blocked', reason: 'RECRUITMENT_SEMANTICS_UNVERIFIED' });
  });
});

describe('Everyview Disney observation cycle', () => {
  it('retains a missing buyer as held and alerts only when the error changes', async () => {
    let state: EveryviewDisneyWatchState = { version: 1, parties: {} };
    const snapshot = parseEveryviewDisneyObservation(html, binding, new Date('2026-10-29T00:00:00Z'));
    const observe = vi.fn(async () => snapshot), alert = vi.fn(async () => undefined);
    const deps = { config: () => ({ enabled: true, parties: [binding] }), read: () => state,
      write: (s: EveryviewDisneyWatchState) => { state = s; }, cookie: () => 'session', safeToRun: () => true,
      observe, alert, now: () => new Date('2026-10-29T00:00:00Z') };
    expect(await runEveryviewDisneyObservation(deps)).toBe('checked');
    observe.mockResolvedValueOnce({ ...snapshot, members: [] });
    expect(await runEveryviewDisneyObservation(deps)).toBe('checked');
    expect(state.parties['10'].members['30']).toMatchObject({ userSeq: 20, currentlyVisible: false });
    observe.mockRejectedValue(new Error('ROSTER_INCOMPLETE'));
    expect(await runEveryviewDisneyObservation(deps)).toBe('error');
    expect(await runEveryviewDisneyObservation(deps)).toBe('error');
    expect(state.parties['10'].members['30']).toMatchObject({ userSeq: 20, currentlyVisible: false });
    expect(alert).toHaveBeenCalledTimes(1);
  });
  it('rejects a changed buyer identity and preserves the previous journal', async () => {
    const snapshot = parseEveryviewDisneyObservation(html, binding, new Date('2026-10-29T00:00:00Z'));
    let state: EveryviewDisneyWatchState = { version: 1, parties: {} };
    const observe = vi.fn(async () => snapshot);
    const deps = { config: () => ({ enabled: true, parties: [binding] }), read: () => state,
      write: (s: EveryviewDisneyWatchState) => { state = s; }, cookie: () => 'session', safeToRun: () => true,
      observe, alert: vi.fn(async () => undefined), now: () => new Date('2026-10-29T00:00:00Z') };
    await runEveryviewDisneyObservation(deps);
    observe.mockResolvedValueOnce({ ...snapshot, members: [{ memberSeq: 30, userSeq: 21 }] });
    expect(await runEveryviewDisneyObservation(deps)).toBe('error');
    expect(state.parties['10'].members['30'].userSeq).toBe(20);
  });
});
