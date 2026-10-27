import { beforeEach, it, expect, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ connect: vi.fn(), disconnect: vi.fn(), terminate: vi.fn(), setCookie: vi.fn(), cookies: vi.fn() }));
vi.mock('puppeteer-core', () => ({ default: { connect: mocks.connect } }));
vi.mock('ws', () => ({ default: class {
  send() {} terminate = mocks.terminate;
  on() { return this; }
  once(event: string, callback: () => void) { if (event === 'open') queueMicrotask(callback); return this; }
} }));
import { withSteelFamilyBrowser } from '../src/monitoring/google-family-steel';
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv('STEEL_API_KEY', 'private-test-provider-key');
  mocks.cookies.mockResolvedValue([{ name: 'cookie', value: 'private', domain: '.google.com', path: '/' }, { name: 'other', value: 'private', domain: '.other.com', path: '/' }]);
  mocks.connect.mockResolvedValue({ disconnect: mocks.disconnect, defaultBrowserContext: () => ({ setCookie: mocks.setCookie, cookies: mocks.cookies }) });
});
it('allocates a separate owned session and releases only that session after successful inspection', async () => {
  const requests: Array<{ url: string; body?: any }> = [];
  vi.stubGlobal('fetch', vi.fn(async (url, init) => { const body = init.body && JSON.parse(init.body); requests.push({ url, body }); return new Response(JSON.stringify({ id: body?.sessionId }), { status: 200 }); }));
  const save = vi.fn();
  expect(await withSteelFamilyBrowser([{ name: 'cookie', value: 'private', domain: '.google.com' }], async () => 'checked', save)).toBe('checked');
  expect(requests[0].body).toMatchObject({ useProxy: false, solveCaptcha: false, persistProfile: false });
  expect(requests[1].url).toBe(`https://api.steel.dev/v1/sessions/${requests[0].body.sessionId}/release`);
  expect(save.mock.calls[0][0]).toHaveLength(1); expect(mocks.disconnect).toHaveBeenCalledTimes(1); expect(mocks.terminate).toHaveBeenCalledTimes(1);
});
it('releases its session and does not refresh cookies on Google inspection failure', async () => {
  const fetch = vi.fn(async (_url, init) => new Response(JSON.stringify({ id: init.body ? JSON.parse(init.body).sessionId : null }), { status: 200 })); vi.stubGlobal('fetch', fetch);
  const save = vi.fn(); await expect(withSteelFamilyBrowser([], async () => { throw Error('GOOGLE_ACCOUNT_MISMATCH'); }, save)).rejects.toThrow('GOOGLE_ACCOUNT_MISMATCH');
  expect(fetch).toHaveBeenCalledTimes(2); expect(save).not.toHaveBeenCalled(); expect(mocks.disconnect).toHaveBeenCalled();
});
it('rejects an unrelated create response but still cleans up its preallocated session', async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ id: 'unrelated-session' }), { status: 200 })); vi.stubGlobal('fetch', fetch);
  await expect(withSteelFamilyBrowser([], async () => {}, vi.fn())).rejects.toThrow('STEEL_SESSION_INVALID');
  expect(fetch).toHaveBeenCalledTimes(2); expect(String(fetch.mock.calls[1][0])).not.toContain('unrelated-session'); expect(mocks.connect).not.toHaveBeenCalled();
});
