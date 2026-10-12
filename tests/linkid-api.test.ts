import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerLinkidRoutes } from '../src/api/linkid';
import { LinkidClient } from '../src/lib/linkid-client';
import { readLinkidStore, writeLinkidStore } from '../src/lib/linkid-store';
let dir: string; const env = { ...process.env };
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'linkid-api-')); process.env.LINKID_STORE_PATH = join(dir, 'store.json'); process.env.AIO_ADMIN_TOKEN = 'linkid-test-admin'; });
afterEach(() => { vi.useRealTimers(); rmSync(dir, { recursive: true, force: true }); for (const key of ['LINKID_STORE_PATH', 'AIO_ADMIN_TOKEN']) { if (env[key] === undefined) delete process.env[key]; else process.env[key] = env[key]; } });
function setup(wrongIdentity = false, sharedSession = false) {
  const calls: string[] = [];
  const client = new LinkidClient(async (url, init) => {
    const path = new URL(String(url)).pathname; calls.push(path); const body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify(path.endsWith('/auth') ? { result: 0, uid: 11, acc_idx: 1, nickname: 'one' }
      : path.endsWith('/login') ? { result: 0, sid: sharedSession ? 'browser-session' : 'dedicated-server-secret' }
        : { result: 0, userlist: [1, 2, 3, 4, 5].map(index => ({ acc_idx: index, uid: body.sid === 'dedicated-server-secret' && wrongIdentity ? index + 100 : index + 10, nickname: `profile ${index}`, money: 0 })) }));
  }, 0);
  const app = new Hono(); const sync = vi.fn(async () => undefined); registerLinkidRoutes(app, client, sync);
  return { app, sync, calls, connect: () => app.request('/linkid/connect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ label: 'test login', cookies: { token: 'browser-session', provider: 'google', providerId: 'private-provider' } }) }) };
}
describe('Linkid account connection', () => {
  it('connects all five subprofiles once, stores only the dedicated session, and exposes no secrets', async () => {
    vi.useFakeTimers(); const f = setup(); const result = await f.connect(); expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ ok: true, profiles: 5 });
    const stored = readFileSync(process.env.LINKID_STORE_PATH!, 'utf8'); expect(stored).toContain('dedicated-server-secret'); expect(stored).not.toContain('browser-session');
    const account = readLinkidStore().accounts[0]; account.seen.old = '2026-10-11'; writeLinkidStore({ version: 1, accounts: [account] });
    await f.connect(); expect(readLinkidStore().accounts).toHaveLength(1); expect(readLinkidStore().accounts[0].seen.old).toBe('2026-10-11');
    const publicData = await (await f.app.request('/linkid')).text(); expect(publicData).not.toContain('dedicated-server-secret'); expect(publicData).not.toContain('private-provider');
    await vi.runAllTimersAsync(); expect(f.sync).toHaveBeenCalled();
    expect(f.calls).not.toContain('/api/users/change_subaccount');
  });
  it('rejects a mismatched login or a session shared with the browser before persistence', async () => {
    for (const f of [setup(true), setup(false, true)]) { expect((await f.connect()).status).toBe(400); expect(readLinkidStore().accounts).toHaveLength(0); }
  });
  it('requires admin authentication for all Linkid reads and mutations in the actual API router', async () => {
    const app = (await import('../src/api/index')).default;
    for (const [path, method] of [['/linkid', 'GET'], ['/linkid/connect', 'POST'], ['/linkid/sync', 'POST'], ['/linkid/accounts/missing', 'PUT']]) {
      expect((await app.request(path, { method, body: method === 'GET' ? undefined : '{}' })).status).toBe(403);
    }
    expect((await app.request('/linkid', { headers: { 'x-admin-token': 'linkid-test-admin' } })).status).toBe(200);
  });
});
