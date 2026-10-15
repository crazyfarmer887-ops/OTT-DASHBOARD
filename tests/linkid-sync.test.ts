import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectLinkidEvents, syncLinkid, type LinkidSyncDependencies } from '../src/scheduler/linkid-sync';
import { LinkidError, type LinkidSnapshot } from '../src/lib/linkid-client';
import { publicLinkidStore, readLinkidStore, withLinkidLock, writeLinkidStore, type LinkidAccount, type LinkidStore } from '../src/lib/linkid-store';
const connectedAt = '2026-10-12T03:00:00Z';
function account(id = 'login-1'): LinkidAccount { return { id, label: '링키드 1호기', connectedAt, enabled: true,
  credentials: { sid: 'server-secret', provider: 'google', providerId: 'private-id' }, profiles: [
    { index: 1, uid: 11, name: '첫 프로필', money: 0, newAlarm: false }, { index: 2, uid: 22, name: '둘째 프로필', money: 0, newAlarm: false },
  ], snapshots: {}, seen: {}, pending: [] }; }
function snapshot(profile = account().profiles[0]): LinkidSnapshot { return { profile, parties: [], updatedAt: '2026-10-12T03:02:00Z',
  notices: [{ id: 5, type: 10001, title: '새 파티원 가입', partyId: 77, date: '2026-10-12 12:01:00' }],
  rooms: [{ id: 6, partyId: 77, ownerId: profile.uid, memberId: 33, name: '구매자', messages: [
    { id: 7, writer: 33, date: '2026-10-12 12:01:00', text: 'MY_PRIVATE_MESSAGE_AND_PASSWORD' },
    { id: 8, writer: profile.uid, date: '2026-10-12 12:01:00', text: '내가 보낸 메시지' },
    { id: 9, writer: 0, date: '2026-10-12 12:01:00', text: '시스템 메시지' },
  ] }] }; }
function fixture(accounts = [account()]) {
  let store: LinkidStore = { version: 1, accounts }; const saved: LinkidStore[] = [];
  const deps: LinkidSyncDependencies = {
    client: { auth: vi.fn(async () => ({ uid: 11, index: 1, name: '첫 프로필' })), login: vi.fn(async () => 'new-server-secret'),
      profiles: vi.fn(async () => accounts[0].profiles), snapshot: vi.fn(async (_sid, p) => snapshot(p)) },
    read: () => structuredClone(store), write: value => { store = structuredClone(value); saved.push(structuredClone(value)); },
    alert: vi.fn(async () => ({ sent: true, reason: 'sent' as const })), now: () => Date.parse('2026-10-12T03:05:00Z'),
  }; return { deps, saved, get store() { return store; } };
}
describe('Linkid durable event notifications', () => {
  it('baselines old notices/chats, accepts split new messages, and excludes seller/system messages', () => {
    const a = account(); const s = snapshot();
    s.notices.push({ ...s.notices[0], id: 4, date: '2026-10-12 11:59:00' });
    s.rooms[0].messages.push({ ...s.rooms[0].messages[0], id: 6, date: '2026-10-12 11:59:00' });
    collectLinkidEvents(a, s); collectLinkidEvents(a, s);
    expect(a.pending.map(x => x.kind)).toEqual(['notice', 'chat']);
    expect(Object.keys(a.seen)).toHaveLength(2);
    s.rooms[0].messages.push({ ...s.rooms[0].messages[0], id: 10, text: '시간 차로 보낸 후속 메시지' }); collectLinkidEvents(a, s);
    expect(a.pending).toHaveLength(3);
  });
  it('scopes identical provider ids by login account and subprofile', () => {
    const one = account(); const two = account('login-2');
    collectLinkidEvents(one, snapshot()); collectLinkidEvents(one, snapshot(one.profiles[1])); collectLinkidEvents(two, snapshot());
    expect(new Set([...one.pending, ...two.pending].map(x => x.key)).size).toBe(6);
  });
  it('retries failed Telegram delivery and does not resend after a restart', async () => {
    const f = fixture(); vi.mocked(f.deps.alert).mockResolvedValueOnce({ sent: false, reason: 'failed' });
    await syncLinkid(f.deps); expect(f.store.accounts[0].pending.length).toBeGreaterThan(0);
    vi.mocked(f.deps.alert).mockClear(); await syncLinkid(f.deps);
    expect(f.store.accounts[0].pending).toHaveLength(0);
    const bodies = vi.mocked(f.deps.alert).mock.calls.map(x => x[0].body).join('\n');
    expect(bodies).toContain('둘째 프로필'); expect(bodies).toContain('링키드 1호기');
    expect(bodies).toContain('MY_PRIVATE_MESSAGE'); expect(bodies).not.toContain('server-secret');
    vi.mocked(f.deps.alert).mockClear(); await syncLinkid(f.deps); expect(f.deps.alert).not.toHaveBeenCalled();
  });
  it('persists the outbox before delivery and treats sender-side throttle as acknowledged', async () => {
    const f = fixture(); vi.mocked(f.deps.alert).mockImplementation(async () => {
      expect(f.saved.some(x => x.accounts[0].pending.length > 0)).toBe(true); return { sent: false, reason: 'throttled' };
    });
    await syncLinkid(f.deps); expect(f.store.accounts[0].pending).toHaveLength(0); expect(Object.keys(f.store.accounts[0].seen)).toHaveLength(4);
  });
  it('preserves pending alerts when Telegram is disabled', async () => {
    const f = fixture(); vi.mocked(f.deps.alert).mockResolvedValue({ sent: false, reason: 'disabled' });
    await syncLinkid(f.deps); expect(f.store.accounts[0].pending).toHaveLength(4);
  });
  it('persists chat text before sending and resumes long messages after a partial failure', async () => {
    const a = account(); a.profiles = [a.profiles[0]]; const f = fixture([a]);
    const text = '긴문의😊'.repeat(900) + '\n비밀번호: hidden-pass';
    vi.mocked(f.deps.client.snapshot).mockImplementation(async (_sid, p) => { const s = snapshot(p); s.notices = []; s.rooms[0].messages[0].text = text; return s; });
    const delivered = new Set<string>(); const seenBodies: string[] = []; let fail = true;
    vi.mocked(f.deps.alert).mockImplementation(async input => {
      expect(f.store.accounts[0].pending[0].message).toContain('긴문의');
      if (delivered.has(input.key)) return { sent: false, reason: 'throttled' };
      if (input.key.endsWith(':1') && fail) { fail = false; return { sent: false, reason: 'failed' }; }
      delivered.add(input.key); seenBodies.push(input.body); return { sent: true, reason: 'sent' };
    });
    await syncLinkid(f.deps); expect(f.store.accounts[0].pending).toHaveLength(1);
    await syncLinkid(f.deps); expect(f.store.accounts[0].pending).toHaveLength(0);
    expect(seenBodies.join('')).not.toContain('hidden-pass'); expect(seenBodies.every(x => x.length < 3500)).toBe(true);
    expect(delivered.size).toBe(3);
  });
  it('hydrates legacy pending alerts from cached snapshots instead of sending an empty arrival notice', async () => {
    const a = account(); a.profiles = [a.profiles[0]]; const s = snapshot(); a.snapshots['1'] = s;
    a.pending = [{ key: 'login-1:1:chat:6:7', kind: 'chat', title: '새 메시지', profileIndex: 1, partyId: 77, date: s.rooms[0].messages[0].date }];
    const f = fixture([a]); await syncLinkid(f.deps);
    expect(vi.mocked(f.deps.alert).mock.calls[0][0].body).toContain('MY_PRIVATE_MESSAGE');
  });
  it('continues another profile after failure and retains the previous snapshot', async () => {
    const a = account(); a.snapshots['1'] = snapshot(); const f = fixture([a]);
    vi.mocked(f.deps.client.snapshot).mockImplementation(async (_sid, p) => { if (p.index === 1) throw new LinkidError('실패'); return snapshot(p); });
    await syncLinkid(f.deps); expect(f.store.accounts[0].snapshots['1']).toEqual(a.snapshots['1']);
    expect(f.store.accounts[0].snapshots['2']).toBeDefined(); expect(f.store.accounts[0].profileErrors?.['1']).toBe('실패');
    expect(f.store.accounts[0].lastScanStartedAt).toBeUndefined();
  });
  it('backs off on 429 and skips disabled accounts', async () => {
    const a = account(); const disabled = account('disabled'); disabled.enabled = false; const f = fixture([a, disabled]);
    vi.mocked(f.deps.client.auth).mockRejectedValue(new LinkidError('제한', 'rate'));
    await syncLinkid(f.deps); expect(f.store.accounts[0].retryAfter).toBe(f.deps.now() + 300000);
    vi.mocked(f.deps.client.auth).mockClear(); await syncLinkid(f.deps); expect(f.deps.client.auth).not.toHaveBeenCalled();
  });
  it('shows a transient rate error in status but alerts only after a sustained outage', async () => {
    const f = fixture(); let now = Date.parse('2026-10-12T03:05:00Z');
    f.deps.now = () => now;
    vi.mocked(f.deps.client.auth).mockRejectedValue(new LinkidError('링키드 요청 제한', 'rate'));
    await syncLinkid(f.deps);
    expect(f.store.accounts[0].lastError).toContain('요청 제한');
    expect(f.deps.alert).not.toHaveBeenCalled();
    for (let attempt = 0; attempt < 3; attempt++) {
      now += 5 * 60000;
      await syncLinkid(f.deps);
    }
    expect(f.deps.alert).toHaveBeenCalledTimes(1);
    expect(f.store.accounts[0].consecutiveFailures).toBe(4);
    now += 5 * 60000;
    vi.mocked(f.deps.client.auth).mockResolvedValue({ uid: 11, index: 1, name: '첫 프로필' });
    await syncLinkid(f.deps);
    expect(f.store.accounts[0].lastError).toBeUndefined();
    expect(f.store.accounts[0].firstFailureAt).toBeUndefined();
    expect(f.store.accounts[0].consecutiveFailures).toBeUndefined();
  });
  it('alerts immediately when Linkid requires a fresh login', async () => {
    const f = fixture();
    vi.mocked(f.deps.client.auth).mockRejectedValue(new LinkidError('로그인 필요', 'auth'));
    vi.mocked(f.deps.client.login).mockRejectedValue(new LinkidError('로그인 필요', 'auth'));
    await syncLinkid(f.deps);
    expect(f.deps.alert).toHaveBeenCalledWith(expect.objectContaining({ title: '링키드 연결 확인 필요' }));
  });
  it('keeps one transient 404 in the dashboard without a Telegram warning', async () => {
    const f = fixture();
    vi.mocked(f.deps.client.auth).mockRejectedValue(new LinkidError('링키드 /api/users/auth 조회 실패 (404).'));
    await syncLinkid(f.deps);
    expect(f.store.accounts[0].lastError).toContain('/api/users/auth 조회 실패 (404)');
    expect(f.deps.alert).not.toHaveBeenCalled();
  });
  it('refreshes expired dedicated sessions, but rejects another account identity', async () => {
    const f = fixture(); vi.mocked(f.deps.client.auth).mockRejectedValueOnce(new LinkidError('만료', 'auth'));
    await syncLinkid(f.deps); expect(f.store.accounts[0].credentials.sid).toBe('new-server-secret');
    vi.mocked(f.deps.client.profiles).mockResolvedValue([{ ...account().profiles[0], uid: 999 }]);
    await syncLinkid(f.deps); expect(f.store.accounts[0].lastError).toContain('일치하지');
  });
});
describe('Linkid private persistence and lock', () => {
  const directories: string[] = []; afterEach(() => directories.splice(0).forEach(x => rmSync(x, { recursive: true, force: true })));
  it('writes atomically with private permissions and exposes no connection secrets', () => {
    const dir = mkdtempSync(join(tmpdir(), 'linkid-')); directories.push(dir); const path = join(dir, 'store.json'); const store: LinkidStore = { version: 1, accounts: [account()] };
    writeLinkidStore(store, path); expect(statSync(path).mode & 0o777).toBe(0o600); expect(readLinkidStore(path)).toEqual(store);
    const publicJson = JSON.stringify(publicLinkidStore(store)); expect(publicJson).not.toContain('server-secret'); expect(publicJson).not.toContain('private-id');
    writeFileSync(path, '{broken'); expect(() => readLinkidStore(path)).toThrow(); expect(readFileSync(path, 'utf8')).toBe('{broken');
  });
  it('serializes provider work so a profile cannot be switched by a concurrent sync', async () => {
    const order: number[] = []; let release!: () => void;
    const a = withLinkidLock(async () => { order.push(1); await new Promise<void>(resolve => { release = resolve; }); order.push(2); });
    const b = withLinkidLock(async () => { order.push(3); });
    await Promise.resolve(); expect(order).toEqual([1]); release(); await Promise.all([a, b]); expect(order).toEqual([1, 2, 3]);
  });
});
