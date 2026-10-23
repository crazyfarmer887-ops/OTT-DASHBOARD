import { describe, expect, it, vi } from 'vitest';
import { createCipheriv } from 'node:crypto';
import { classifyNbaLogin } from '../src/monitoring/nba-login';
import { decodeNbaPartyPassword, monitorNba, NBA_CHECK_INTERVAL, type MonitorDependencies, type NbaMonitorState, type NbaTarget } from '../src/monitoring/nba-monitor';
function fixture() {
  let time = Date.parse('2026-10-23T09:00:00Z'); let state: NbaMonitorState = { version: 1, targets: {} };
  const target: NbaTarget = { key: 'account:123', label: 'NBA 프로필 1', email: 'fixture@example.com', password: 'private-password', actionUrl: 'https://email-verify.one/dashboard/linkid' };
  const deps: MonitorDependencies = { now: () => time, read: () => structuredClone(state), write: s => { state = structuredClone(s); },
    targets: vi.fn(async () => [target]), check: vi.fn(async () => 'ok' as const), alert: vi.fn(async () => ({ sent: true as const, reason: 'sent' as const })) };
  return { deps, target, advance(ms: number) { time += ms; }, get state() { return state; } };
}
describe('NBA scheduled login checks', () => {
  it('requires explicit authenticated evidence; a redirect or empty login form is not success', () => {
    const base = { text: 'NBA', passwordVisible: false, authenticated: false, challengeVisible: false };
    expect(classifyNbaLogin(base)).toBe('unknown');
    expect(classifyNbaLogin({ ...base, authenticated: true })).toBe('ok');
    expect(classifyNbaLogin({ ...base, authenticated: true, passwordVisible: true })).toBe('unknown');
    expect(classifyNbaLogin({ ...base, text: 'Invalid email or password' })).toBe('invalid');
    expect(classifyNbaLogin({ ...base, text: 'Incorrect password. Try again.' })).toBe('invalid');
    expect(classifyNbaLogin({ ...base, challengeVisible: true })).toBe('verification');
    expect(classifyNbaLogin({ ...base, text: 'Enter the verification code' })).toBe('verification');
    expect(classifyNbaLogin({ ...base, text: 'Something went wrong' })).toBe('unavailable');
  });
  it('checks once every three hours, remains quiet on success, and keeps scheduling across restart', async () => {
    const f = fixture(); await monitorNba(f.deps); await monitorNba(f.deps);
    expect(f.deps.check).toHaveBeenCalledTimes(1); expect(f.deps.alert).not.toHaveBeenCalled();
    f.advance(NBA_CHECK_INTERVAL - 1); await monitorNba(f.deps); expect(f.deps.check).toHaveBeenCalledTimes(1);
    f.advance(1); await monitorNba(f.deps); expect(f.deps.check).toHaveBeenCalledTimes(2);
  });
  it('notifies the Linkid topic on invalid login without exposing the password, once per incident', async () => {
    const f = fixture(); vi.mocked(f.deps.check).mockResolvedValue('invalid'); await monitorNba(f.deps);
    expect(f.deps.alert).toHaveBeenCalledWith(expect.objectContaining({ provider: 'linkid', title: 'NBA 계정 이상 · 조치 필요' }));
    expect(JSON.stringify(vi.mocked(f.deps.alert).mock.calls)).not.toContain(f.target.password);
    expect(JSON.stringify(f.state)).not.toContain(f.target.password);
    f.advance(NBA_CHECK_INTERVAL); await monitorNba(f.deps); expect(f.deps.alert).toHaveBeenCalledTimes(1);
  });
  it('keeps unavailable/verification failures distinct from rejected credentials', async () => {
    const f = fixture(); vi.mocked(f.deps.check).mockResolvedValue('verification'); await monitorNba(f.deps);
    expect(vi.mocked(f.deps.alert).mock.calls[0][0].body).toContain('비밀번호 오류로 확정한 상태는 아닙니다');
  });
  it('retries a failed Telegram delivery without logging in again', async () => {
    const f = fixture(); vi.mocked(f.deps.check).mockResolvedValue('invalid');
    vi.mocked(f.deps.alert).mockResolvedValueOnce({ sent: false, reason: 'failed' });
    await monitorNba(f.deps); await monitorNba(f.deps);
    expect(f.deps.alert).toHaveBeenCalledTimes(2); expect(f.deps.check).toHaveBeenCalledTimes(1);
  });
  it('checks changed credentials immediately and alerts again after recovery and a later failure', async () => {
    const f = fixture(); vi.mocked(f.deps.check).mockResolvedValue('invalid'); await monitorNba(f.deps);
    f.target.password = 'replacement'; vi.mocked(f.deps.check).mockResolvedValue('ok'); await monitorNba(f.deps);
    expect(f.deps.check).toHaveBeenCalledTimes(2);
    f.advance(NBA_CHECK_INTERVAL); vi.mocked(f.deps.check).mockResolvedValue('invalid'); await monitorNba(f.deps);
    expect(f.deps.alert).toHaveBeenCalledTimes(2);
  });
  it('checks a shared credential once but links alerts to each affected party', async () => {
    const f = fixture(); vi.mocked(f.deps.targets).mockResolvedValue([f.target, { ...f.target, key: 'account:456' }]);
    vi.mocked(f.deps.check).mockResolvedValue('invalid'); await monitorNba(f.deps);
    expect(f.deps.check).toHaveBeenCalledTimes(1); expect(f.deps.alert).toHaveBeenCalledTimes(2);
  });
  it('decodes owner-scoped Linkid password format and rejects damaged data', () => {
    const iv = Buffer.alloc(16); iv.write('peachgrovelinkid');
    const cipher = createCipheriv('aes-192-cbc', Buffer.from('123'.padStart(24, 'f')), iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify({ pw: 'fixture-pw' })), cipher.final()]).toString('hex');
    expect(decodeNbaPartyPassword(encrypted, 123)).toBe('fixture-pw');
    expect(() => decodeNbaPartyPassword(encrypted, 124)).toThrow();
    expect(() => decodeNbaPartyPassword('broken', 123)).toThrow();
  });
});
