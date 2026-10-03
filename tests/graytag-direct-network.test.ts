import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { expect, test, vi } from 'vitest';

test('posting uses direct transport even when the former subscription returns a dead proxy', async () => {
  const source = readFileSync('src/api/index.ts', 'utf8');
  const start = source.indexOf('let _proxyList') >= 0 ? source.indexOf('let _proxyList') : source.indexOf('let _lastGraytagRequest');
  const block = source.slice(start, source.indexOf('function extractLenderDeals', start));
  const fetch = vi.fn(async (url: string) => new Response(url.includes('webshare') ? '127.0.0.1:8080:expired:expired' : '{"succeeded":true}'));
  const proxy = vi.fn(async () => { throw new Error('CONNECT tunnel failed: 407'); });
  const context = { process: { env: {} }, fetch, curlFetch: proxy, Response, AbortSignal, console: { log() {}, warn() {} }, setInterval() {}, setTimeout, Date };
  const js = ts.transpile(block + '\nglobalThis.send = rateLimitedFetch;', { target: ts.ScriptTarget.ES2022 });
  runInNewContext(js, context);
  await new Promise(resolve => setTimeout(resolve, 0));
  const options = { method: 'POST', body: 'multipart body', redirect: 'manual' };
  const result = await (context as any).send('https://graytag.co.kr/ws/lender/registerProduct', options, true);
  expect(result.status).toBe(200);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledWith('https://graytag.co.kr/ws/lender/registerProduct', options);
  expect(proxy).not.toHaveBeenCalled();
});

test('configured proxy handles a write once without direct fallback or secret leakage', async () => {
  const source = readFileSync('src/api/index.ts', 'utf8');
  const block = source.slice(source.indexOf('let _lastGraytagRequest'), source.indexOf('function extractLenderDeals'));
  const fetch = vi.fn();
  const proxy = vi.fn(async () => { throw new Error('GrayTag proxy connection failed'); });
  const context = { process: { env: { GRAYTAG_PROXY_URL: 'http://test:secret@proxy.invalid:8000' } }, fetch, curlFetch: proxy, Response, setTimeout, Date };
  runInNewContext(ts.transpile(block + '\nglobalThis.send = rateLimitedFetch;', { target: ts.ScriptTarget.ES2022 }), context);
  const options = { method: 'POST', body: 'multipart body', redirect: 'manual' };
  await expect((context as any).send('https://graytag.co.kr/ws/lender/registerProduct', options, true)).rejects.toThrow('GrayTag proxy connection failed');
  expect(proxy).toHaveBeenCalledTimes(1);
  expect(proxy).toHaveBeenCalledWith('https://graytag.co.kr/ws/lender/registerProduct', options, context.process.env.GRAYTAG_PROXY_URL);
  expect(fetch).not.toHaveBeenCalled();
});
