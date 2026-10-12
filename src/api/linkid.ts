import { createHash } from 'node:crypto';
import type { Hono } from 'hono';
import { LinkidClient, LinkidError, parseLinkidCredentials } from '../lib/linkid-client';
import { publicLinkidStore, readLinkidStore, writeLinkidStore, withLinkidLock } from '../lib/linkid-store';
import { linkidSyncRunning, runLinkidSync } from '../scheduler/linkid-sync';
export function registerLinkidRoutes(app: Hono, client = new LinkidClient(), sync = runLinkidSync): void {
  app.get('/linkid', c => {
    try { return c.json({ ok: true, ...publicLinkidStore(readLinkidStore()), syncing: linkidSyncRunning() }); }
    catch { return c.json({ ok: false, error: '링키드 연결 기록 점검이 필요합니다.' }, 503); }
  });
  app.post('/linkid/connect', c => withLinkidLock(async () => {
    try {
      const body = await c.req.json(); const credentials = parseLinkidCredentials(body.cookies);
      const identity = await client.auth(credentials.token);
      const profiles = await client.profiles(credentials.token);
      if (!profiles.some(x => x.uid === identity.uid)) throw new LinkidError('현재 로그인 계정을 확인하지 못했습니다.', 'auth');
      const primary = profiles.find(x => x.index === 1);
      if (!primary) throw new LinkidError('주계정 프로필을 확인하지 못했습니다.', 'schema');
      const sid = await client.login(credentials.provider, credentials.providerId);
      if (sid === credentials.token) throw new LinkidError('독립적인 서버 세션을 만들지 못했습니다.', 'auth');
      const serverProfiles = await client.profiles(sid);
      if (serverProfiles.find(x => x.index === 1)?.uid !== primary.uid) throw new LinkidError('서버 연결 계정이 다릅니다.', 'auth');
      const store = readLinkidStore(); const id = createHash('sha256').update(`linkid:${primary.uid}`).digest('hex').slice(0, 20);
      const existing = store.accounts.find(x => x.id === id);
      const label = String(body.label || `${primary.name} 로그인`).trim().slice(0, 80);
      if (!label) return c.json({ ok: false, error: '로그인 계정 이름을 입력해주세요.' }, 400);
      const session = { sid, provider: credentials.provider, providerId: credentials.providerId };
      if (existing) { existing.credentials = session; existing.label = label; existing.enabled = true; existing.profiles = serverProfiles; delete existing.retryAfter; }
      else store.accounts.push({ id, label, enabled: true, connectedAt: new Date().toISOString(), credentials: session,
        profiles: serverProfiles, snapshots: {}, seen: {}, pending: [] });
      writeLinkidStore(store);
      setTimeout(() => { void sync(id).catch(() => undefined); }, 0);
      return c.json({ ok: true, accountId: id, profiles: serverProfiles.length });
    } catch (e) { return c.json({ ok: false, error: e instanceof LinkidError ? e.message : '링키드 연결에 실패했습니다.' }, 400); }
  }));
  app.post('/linkid/sync', async c => {
    const body = await c.req.json().catch(() => ({}));
    if (linkidSyncRunning()) return c.json({ ok: true, syncing: true });
    if (process.env.LINKID_SYNC_ENABLED === 'false') return c.json({ ok: false, error: '링키드 자동 감시가 꺼져 있습니다.' }, 409);
    const store = readLinkidStore();
    if (body.accountId && !store.accounts.some(x => x.id === body.accountId)) return c.json({ ok: false, error: '계정을 확인해주세요.' }, 404);
    void sync(body.accountId).catch(() => undefined);
    return c.json({ ok: true, syncing: true });
  });
  app.put('/linkid/accounts/:id', c => withLinkidLock(async () => {
    const body = await c.req.json(); const store = readLinkidStore(); const account = store.accounts.find(x => x.id === c.req.param('id'));
    if (!account) return c.json({ ok: false, error: '계정을 찾지 못했습니다.' }, 404);
    if (typeof body.enabled !== 'boolean') return c.json({ ok: false, error: '알림 감시 상태를 선택해주세요.' }, 400);
    account.enabled = body.enabled; writeLinkidStore(store);
    return c.json({ ok: true });
  }));
}
