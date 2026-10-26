import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkNbaLogin } from '../src/monitoring/nba-login';
import puppeteer from 'puppeteer-core';
import WebSocket from 'ws';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';

vi.mock('ws', () => ({ default: vi.fn() }));
vi.mock('puppeteer-core', () => ({ default: { connect: vi.fn(), launch: vi.fn() } }));
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetAllMocks(); });
function fixture() {
  vi.stubEnv('NBA_BROWSER_PROVIDER', 'steel');
  vi.stubEnv('STEEL_API_KEY', 'fixture-steel-key');
  const socket = Object.assign(new EventEmitter(), { send: vi.fn(), terminate: vi.fn() });
  vi.mocked(WebSocket).mockImplementation(function () { queueMicrotask(() => socket.emit('open')); return socket as never; });
  const page = {
    setDefaultTimeout: vi.fn(), setDefaultNavigationTimeout: vi.fn(),
    goto: vi.fn(async () => ({ status: () => 403 })),
  };
  const context = { newPage: vi.fn(async () => page) };
  const browser = { createBrowserContext: vi.fn(async () => context), disconnect: vi.fn(), close: vi.fn() };
  vi.mocked(puppeteer.connect).mockResolvedValue(browser as never);
  const requests: { url: string; options: RequestInit }[] = [];
  const request = vi.fn(async (url: string | URL | Request, options?: RequestInit) => {
    requests.push({ url: String(url), options: options || {} });
    if (String(url).endsWith('/release')) return Response.json({ status: 'released' });
    return Response.json({ id: JSON.parse(String(options?.body)).sessionId });
  });
  vi.stubGlobal('fetch', request);
  return { page, browser, context, socket, request, requests };
}
describe('NBA login through Steel', () => {
  it('uses an owned cloud session, keeps a block distinct from bad credentials, and releases the session', async () => {
    const f = fixture();
    expect(await checkNbaLogin('fixture@example.com', 'private-password')).toBe('blocked');
    expect(puppeteer.launch).not.toHaveBeenCalled();
    expect(f.requests).toHaveLength(2);
    const create = f.requests[0];
    expect(create.url).toBe('https://api.steel.dev/v1/sessions');
    expect(create.options).toMatchObject({ method: 'POST', redirect: 'error', headers: { 'steel-api-key': 'fixture-steel-key' } });
    const body = JSON.parse(String(create.options.body));
    expect(body).toMatchObject({ timeout: 180000, inactivityTimeout: 60000, headless: false, useProxy: false, solveCaptcha: false, persistProfile: false,
      stealthConfig: { skipFingerprintInjection: true, humanizeInteractions: false }, debugConfig: { interactive: false } });
    expect(JSON.stringify(f.requests)).not.toContain('private-password');
    expect(JSON.stringify(f.requests)).not.toContain('fixture@example.com');
    const endpoint = new URL(String(vi.mocked(WebSocket).mock.calls[0][0]));
    expect(vi.mocked(WebSocket).mock.calls[0][1]).toMatchObject({ handshakeTimeout: 30000, followRedirects: false });
    expect(endpoint.origin).toBe('wss://connect.steel.dev');
    expect(endpoint.searchParams.get('apiKey')).toBe('fixture-steel-key');
    expect(endpoint.searchParams.get('sessionId')).toBe(body.sessionId);
    expect(f.requests[1].url).toBe(`https://api.steel.dev/v1/sessions/${body.sessionId}/release`);
    expect(f.browser.disconnect).toHaveBeenCalledOnce();
    expect(f.socket.terminate).toHaveBeenCalled();
    expect(f.browser.close).not.toHaveBeenCalled();
    expect(f.browser.createBrowserContext).toHaveBeenCalledOnce();
  });
  it('submits the current password in a fresh context and requires authenticated evidence', async () => {
    const f = fixture();
    const emailInput = { type: vi.fn() };
    const page = Object.assign(f.page, {
      goto: vi.fn(async () => ({ status: () => 200 })),
      evaluate: vi.fn().mockResolvedValueOnce({ text: 'Sign in', passwordVisible: false, authenticated: false, challengeVisible: false })
        .mockResolvedValue({ text: 'Sign out', passwordVisible: false, authenticated: true, challengeVisible: false }),
      $: vi.fn(async () => null), waitForSelector: vi.fn(async () => emailInput),
      click: vi.fn(), type: vi.fn(), waitForNetworkIdle: vi.fn(async () => undefined), locator: vi.fn(() => ({ click: vi.fn() })),
    });
    expect(await checkNbaLogin('fixture@example.com', 'private-password')).toBe('ok');
    expect(emailInput.type).toHaveBeenCalledWith('fixture@example.com');
    expect(page.type).toHaveBeenCalledWith('input[type="password"]', 'private-password');
    expect(page.locator).toHaveBeenCalledOnce();
    expect(f.requests.at(-1)?.url).toMatch(/\/release$/);
    const first = JSON.parse(String(f.requests[0].options.body)).sessionId;
    expect(await checkNbaLogin('fixture@example.com', 'private-password')).toBe('ok');
    expect(f.browser.createBrowserContext).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(f.requests[2].options.body)).sessionId).not.toBe(first);
  });
  it('releases a challenge or failed navigation without converting it into an invalid password', async () => {
    const f = fixture();
    Object.assign(f.page, { goto: vi.fn(async () => ({ status: () => 200 })),
      evaluate: vi.fn(async () => ({ text: 'Verification', passwordVisible: false, authenticated: false, challengeVisible: true })) });
    expect(await checkNbaLogin('fixture@example.com', 'private-password')).toBe('verification');
    f.page.goto.mockRejectedValueOnce(new Error('private-password fixture-steel-key'));
    expect(await checkNbaLogin('fixture@example.com', 'private-password')).toBe('unavailable');
    expect(f.requests.filter(r => r.url.endsWith('/release'))).toHaveLength(2);
    expect(puppeteer.launch).not.toHaveBeenCalled();
  });
  it.each(['connect', 'create', 'response', 'release', 'disconnect'])('cleans up its owned session after %s failure without local fallback', async failure => {
    const f = fixture();
    if (failure === 'connect') vi.mocked(puppeteer.connect).mockRejectedValueOnce(new Error('fixture-steel-key'));
    if (failure === 'create') f.request.mockRejectedValueOnce(new Error('fixture-steel-key'));
    if (failure === 'response') f.request.mockResolvedValueOnce(Response.json({ id: 'someone-elses-session', websocketUrl: 'wss://untrusted.invalid' }));
    if (failure === 'release') f.request.mockImplementationOnce(async (url, options) => {
      f.requests.push({ url: String(url), options: options || {} });
      f.request.mockImplementationOnce(async (releaseUrl, releaseOptions) => {
        f.requests.push({ url: String(releaseUrl), options: releaseOptions || {} });
        return new Response('fixture-steel-key', { status: 500 });
      });
      return Response.json({ id: JSON.parse(String(options?.body)).sessionId });
    });
    if (failure === 'disconnect') f.browser.disconnect.mockImplementationOnce(() => { throw new Error('fixture-steel-key'); });
    const errorLog = vi.spyOn(console, 'error');
    expect(await checkNbaLogin('fixture@example.com', 'private-password')).toBe('unavailable');
    const calls = f.request.mock.calls;
    const ownId = JSON.parse(String(calls[0][1]?.body)).sessionId;
    expect(String(calls.at(-1)?.[0])).toBe(`https://api.steel.dev/v1/sessions/${ownId}/release`);
    expect(puppeteer.launch).not.toHaveBeenCalled();
    expect(errorLog).not.toHaveBeenCalled();
    errorLog.mockRestore();
  });
  it('terminates the real transport when CDP attachment stalls, then releases the owned session', async () => {
    const f = fixture(); vi.useFakeTimers();
    vi.mocked(puppeteer.connect).mockImplementationOnce(() => new Promise(() => {}));
    try {
      const result = checkNbaLogin('fixture@example.com', 'private-password');
      await vi.advanceTimersByTimeAsync(30001);
      expect(await result).toBe('unavailable');
      expect(f.socket.terminate).toHaveBeenCalled();
      expect(f.requests.at(-1)?.url).toMatch(/\/release$/);
      expect(f.page.goto).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
  it('releases after a failed WebSocket handshake without leaking the provider error', async () => {
    const f = fixture();
    vi.mocked(WebSocket).mockImplementationOnce(function () {
      queueMicrotask(() => f.socket.emit('error', new Error('fixture-steel-key')));
      return f.socket as never;
    });
    expect(await checkNbaLogin('fixture@example.com', 'private-password')).toBe('unavailable');
    expect(f.socket.terminate).toHaveBeenCalled();
    expect(f.requests.at(-1)?.url).toMatch(/\/release$/);
    expect(puppeteer.connect).not.toHaveBeenCalled();
  });
  it('closes an actual stalled HTTP upgrade at the configured handshake deadline', async () => {
    const f = fixture();
    const RealWebSocket = (await vi.importActual<typeof import('ws')>('ws')).default;
    const server = createServer();
    const peers = new Set<import('node:stream').Duplex>();
    let upgraded!: () => void;
    const upgrade = new Promise<void>(resolve => { upgraded = resolve; });
    server.on('upgrade', (_request, peer) => { peers.add(peer); peer.resume(); peer.on('end', () => peer.end()); peer.on('close', () => peers.delete(peer)); upgraded(); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('TEST_SERVER_ADDRESS');
    vi.mocked(WebSocket).mockImplementationOnce(function (_endpoint, options) {
      expect(options).toMatchObject({ handshakeTimeout: 30000, followRedirects: false });
      return new RealWebSocket(`ws://127.0.0.1:${address.port}`, { ...options as object, handshakeTimeout: 100 });
    });
    try {
      const result = checkNbaLogin('fixture@example.com', 'private-password');
      await upgrade;
      expect(await result).toBe('unavailable');
      await vi.waitFor(() => expect(peers.size).toBe(0));
      expect(f.requests.at(-1)?.url).toMatch(/\/release$/);
      expect(puppeteer.connect).not.toHaveBeenCalled();
    } finally { for (const peer of peers) peer.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
  it.each(['', 'wrong-provider'])('fails closed without credentials or with an unknown provider (%s)', async provider => {
    const f = fixture();
    if (provider) vi.stubEnv('NBA_BROWSER_PROVIDER', provider);
    else vi.stubEnv('STEEL_API_KEY', '');
    expect(await checkNbaLogin('fixture@example.com', 'private-password')).toBe('unavailable');
    expect(f.request).not.toHaveBeenCalled(); expect(puppeteer.connect).not.toHaveBeenCalled();
    expect(puppeteer.launch).not.toHaveBeenCalled();
  });
  it('keeps existing local deployments working and closes their local browser', async () => {
    const f = fixture(); vi.stubEnv('NBA_BROWSER_PROVIDER', ''); vi.stubEnv('NBA_CHROME_PATH', '/fixture/chrome');
    vi.mocked(puppeteer.launch).mockResolvedValue(f.browser as never);
    expect(await checkNbaLogin('fixture@example.com', 'private-password')).toBe('blocked');
    expect(f.browser.close).toHaveBeenCalledOnce(); expect(f.browser.disconnect).not.toHaveBeenCalled();
    expect(f.request).not.toHaveBeenCalled(); expect(puppeteer.connect).not.toHaveBeenCalled();
  });

});
