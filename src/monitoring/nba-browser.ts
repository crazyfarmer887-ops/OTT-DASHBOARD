import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import puppeteer, { type Browser, type ConnectionTransport } from 'puppeteer-core';
import WebSocket from 'ws';

export function nbaBrowserPath(): string {
  if (process.env.NBA_CHROME_PATH) return process.env.NBA_CHROME_PATH;
  for (const path of ['/opt/google/chrome/chrome', '/usr/bin/google-chrome-stable']) if (existsSync(path)) return path;
  const cache = join(homedir(), '.cache/puppeteer/chrome');
  if (existsSync(cache)) for (const v of readdirSync(cache).sort().reverse()) {
    const candidate = join(cache, v, 'chrome-linux64/chrome'); if (existsSync(candidate)) return candidate;
  }
  for (const path of ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']) if (existsSync(path)) return path;
  throw new Error('NBA_BROWSER_UNAVAILABLE');
}
/** Owns the browser lifetime so every login outcome closes only its own session. */
export async function withNbaBrowser<T>(check: (browser: Browser) => Promise<T>): Promise<T> {
  const provider = process.env.NBA_BROWSER_PROVIDER || 'local';
  if (provider === 'local') {
    const browser = await puppeteer.launch({ executablePath: nbaBrowserPath(), headless: false,
      args: ['--disable-dev-shm-usage'], timeout: 30000 });
    try { return await check(browser); }
    finally { await browser.close(); }
  }
  if (provider !== 'steel') throw new Error('NBA_BROWSER_PROVIDER_INVALID');
  const key = process.env.STEEL_API_KEY?.trim();
  if (!key || /[\r\n]/.test(key)) throw new Error('NBA_STEEL_KEY_REQUIRED');
  // Allocate the ID before creation: a lost create response must still allow scoped cleanup.
  const sessionId = randomUUID();
  let browser: Browser | undefined;
  let socket: WebSocket | undefined;
  const request = async (path: string, body?: object) => {
    const response = await fetch(`https://api.steel.dev/v1/sessions${path}`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(path ? 10000 : 30000),
      headers: { 'steel-api-key': key, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    // Never surface provider error bodies: they may contain access URLs or secrets.
    if (!response.ok) throw new Error('NBA_STEEL_REQUEST_FAILED');
    return response;
  };
  try {
    const response = await request('', { sessionId, timeout: 180000, inactivityTimeout: 60000,
      headless: false, useProxy: false, solveCaptcha: false, persistProfile: false,
      stealthConfig: { skipFingerprintInjection: true, humanizeInteractions: false },
      debugConfig: { interactive: false } });
    const session: unknown = await response.json();
    if (!session || typeof session !== 'object' || !('id' in session) || session.id !== sessionId) {
      throw new Error('NBA_STEEL_SESSION_INVALID');
    }
    const endpoint = new URL('wss://connect.steel.dev');
    endpoint.searchParams.set('apiKey', key); endpoint.searchParams.set('sessionId', sessionId);
    socket = new WebSocket(endpoint, { handshakeTimeout: 30000, followRedirects: false, perMessageDeflate: false });
    const transport: ConnectionTransport = {
      send: message => socket!.send(message), close: () => socket!.terminate(),
    };
    socket.on('message', data => transport.onmessage?.(data.toString()));
    socket.on('close', () => transport.onclose?.());
    await new Promise<void>((resolve, reject) => {
      socket!.once('open', resolve);
      socket!.on('error', () => reject(new Error('NBA_STEEL_SOCKET_FAILED')));
      socket!.once('close', () => reject(new Error('NBA_STEEL_SOCKET_CLOSED')));
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    // CDP timeout is per command; terminate the actual socket if initial attachment stalls.
    const connection = puppeteer.connect({ transport, protocolTimeout: 30000 });
    try {
      browser = await Promise.race([connection, new Promise<never>((_, reject) => {
        timer = setTimeout(() => { socket!.terminate(); reject(new Error('NBA_STEEL_CONNECT_TIMEOUT')); }, 30000);
      })]);
    } finally { clearTimeout(timer); }
    return await check(browser);
  } finally {
    try { browser?.disconnect(); }
    finally {
      try { socket?.terminate(); }
      finally { await request(`/${sessionId}/release`); }
    }
  }
}
