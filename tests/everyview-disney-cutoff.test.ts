import { describe, expect, it, vi } from 'vitest';
import { runEveryviewDisneyCutoff, type EveryviewDisneyCutoffConfig, type EveryviewDisneyCutoffDeps, type EveryviewDisneyCutoffJournal } from '../src/scheduler/everyview-disney-cutoff';

const party = { partyId: 123, accountEmail: 'disney@example.com', accountEndDate: '2027-01-24', usageDays: 30, enabled: true };
const now = new Date('2026-12-25T00:00:00+09:00');
function fixture() {
  let config: EveryviewDisneyCutoffConfig = { version: 1, enabled: true, parties: [party] };
  let state: EveryviewDisneyCutoffJournal = { version: 1, parties: {} };
  let safe = true, visible = true, session = true, bound = true;
  const actions: string[] = [], alert = vi.fn(async () => undefined);
  const deps: EveryviewDisneyCutoffDeps = { config: () => config, read: () => structuredClone(state),
    write: s => { state = structuredClone(s); actions.push(`write:${s.parties['123']?.state || 'empty'}`); },
    cookie: () => 'private-session', safeToRun: () => safe, sessionValid: async () => session,
    accountExpiries: async () => ({ 'disney@example.com': '2027-01-24' }),
    verifyBinding: async () => bound, visibility: async () => visible,
    hide: async () => { actions.push('hide');visible = false;return { ok: true, visible: false, verified: true }; },
    alert, now: () => now };
  return { deps, actions, alert, state: () => state, setSafe: (value: boolean) => { safe = value; },
    setVisible: (value: boolean) => { visible = value; }, setSession: (value: boolean) => { session = value; },
    setBound: (value: boolean) => { bound = value; }, setConfig: (value: EveryviewDisneyCutoffConfig) => { config = value; } };
}

describe('Everyview Disney rolling cutoff worker', () => {
  it('persists the intent before hiding and confirms the server-read result', async () => {
    const f = fixture();
    expect(await runEveryviewDisneyCutoff(f.deps)).toBe('checked');
    expect(f.actions).toEqual(['write:attempted', 'hide', 'write:confirmed']);
    expect(f.state().parties['123']).toMatchObject({ state: 'confirmed', attemptedAt: now.toISOString(), confirmedAt: now.toISOString() });
    expect(f.alert).not.toHaveBeenCalled();
    expect(await runEveryviewDisneyCutoff(f.deps)).toBe('checked');
    expect(f.actions.filter(a => a === 'hide')).toHaveLength(1);
  });
  it('reconciles an uncertain hide without repeating the request', async () => {
    const f = fixture(); let writes = 0;
    f.deps.hide = async () => { writes++; return { ok: false, code: 'VISIBILITY_UNCONFIRMED', needsAttention: true }; };
    expect(await runEveryviewDisneyCutoff(f.deps)).toBe('error');
    expect(f.state().parties['123']).toMatchObject({ state: 'attempted', error: 'VISIBILITY_UNCONFIRMED' });
    expect(await runEveryviewDisneyCutoff(f.deps)).toBe('error');
    expect(writes).toBe(1);
    f.setVisible(false);
    expect(await runEveryviewDisneyCutoff(f.deps)).toBe('checked');
    expect(f.state().parties['123'].state).toBe('confirmed');
    expect(writes).toBe(1);
  });
  it('does nothing before the cutoff or when safety mode is active', async () => {
    const f = fixture();f.deps.now = () => new Date('2026-12-24T23:59:59+09:00');
    expect(await runEveryviewDisneyCutoff(f.deps)).toBe('checked');expect(f.actions).toEqual([]);
    f.deps.now = () => now;f.setSafe(false);
    expect(await runEveryviewDisneyCutoff(f.deps)).toBe('paused');expect(f.actions).toEqual([]);
    expect(f.alert).not.toHaveBeenCalled();
  });
  it('does not act with an invalid session, an unverified account, or changed config', async () => {
    const f = fixture();f.setSession(false);
    expect(await runEveryviewDisneyCutoff(f.deps)).toBe('error');expect(f.actions).toEqual([]);
    f.setSession(true);f.setBound(false);
    expect(await runEveryviewDisneyCutoff(f.deps)).toBe('error');expect(f.actions).toEqual([]);
    f.setBound(true);f.deps.verifyBinding = async () => { f.setConfig({ version: 1, enabled: false, parties: [party] });return true; };
    expect(await runEveryviewDisneyCutoff(f.deps)).toBe('paused');expect(f.actions).toEqual([]);
  });
  it('closes and alerts when an allowed party has an invalid end date', async () => {
    const f = fixture();f.setConfig({ version: 1, enabled: true, parties: [{ ...party, accountEndDate: '2027-02-30' }] });
    expect(await runEveryviewDisneyCutoff(f.deps)).toBe('error');
    expect(f.actions).toContain('hide');expect(f.alert).toHaveBeenCalledWith('CUTOFF_INVALID', 123);
  });
  it('uses the earlier live account expiry and hides immediately if that moves the cutoff forward', async () => {
    const f = fixture();f.deps.now = () => new Date('2026-11-30T00:00:00+09:00');
    f.deps.accountExpiries = async () => ({ 'disney@example.com': '2026-12-30' });
    expect(await runEveryviewDisneyCutoff(f.deps)).toBe('checked');expect(f.actions).toContain('hide');
  });
  it('does not extend the configured cutoff when the live account expiry is later', async () => {
    const f = fixture();f.deps.accountExpiries = async () => ({ 'disney@example.com': '2027-03-01' });
    expect(await runEveryviewDisneyCutoff(f.deps)).toBe('checked');expect(f.actions).toContain('hide');
  });
  it('alerts about uncertain visibility and hides a verified party if live expiry cannot be read', async () => {
    const f = fixture();f.deps.accountExpiries = async () => { throw Error('unavailable'); };
    expect(await runEveryviewDisneyCutoff(f.deps)).toBe('error');
    expect(f.alert).toHaveBeenCalledWith('EXPIRY_UNAVAILABLE', 123);expect(f.actions).toContain('hide');
  });
  it('does not mutate unrelated or individually disabled parties', async () => {
    const f = fixture();f.setConfig({ version: 1, enabled: true, parties: [{ ...party, enabled: false }] });
    expect(await runEveryviewDisneyCutoff(f.deps)).toBe('checked');expect(f.actions).toEqual([]);
  });
  it('fails before sending when the durable intent cannot be saved', async () => {
    const f = fixture();f.deps.write = () => { throw Error('disk failure'); };
    await expect(runEveryviewDisneyCutoff(f.deps)).rejects.toThrow();
    expect(f.actions).not.toContain('hide');
  });
});
