import { describe, expect, test, vi } from 'vitest';
import {
  fetchGraytagReadWithFallback,
  selectGraytagSellerRoute,
} from '../src/api/graytag-seller-transport';

const url = 'https://graytag.co.kr/ws/lender/findBeforeUsingLenderDeals?page=1&rows=1';
const authoritative = () => new Response(JSON.stringify({ succeeded: true, data: { lenderDeals: [] } }), { status: 200 });

describe('GrayTag seller transport', () => {
  test('falls back to direct access only for a safe read denied by the proxy', async () => {
    const direct = vi.fn(async () => authoritative());
    const proxy = vi.fn(async () => new Response('Forbidden', { status: 403 }));
    const proxyUrl = 'http://denied-proxy.invalid';
    const result = await fetchGraytagReadWithFallback(url, { method: 'GET' }, proxyUrl, direct, proxy);
    expect(result.status).toBe(200);
    expect(proxy).toHaveBeenCalledOnce();
    expect(direct).toHaveBeenCalledOnce();
    expect((await fetchGraytagReadWithFallback(url, { method: 'GET' }, proxyUrl, direct, proxy)).status).toBe(200);
    expect(proxy).toHaveBeenCalledOnce();
    await expect(fetchGraytagReadWithFallback(url, { method: 'POST', body: 'model' }, proxyUrl, direct, proxy))
      .rejects.toThrow(/read only/i);
    expect(direct).toHaveBeenCalledTimes(2);
  });

  test('selects one currently authoritative route before any product write', async () => {
    const direct = vi.fn(async () => authoritative());
    const proxy = vi.fn(async () => new Response('Forbidden', { status: 403 }));
    expect(await selectGraytagSellerRoute(url, {}, 'http://proxy.invalid', direct, proxy)).toBe('direct');
    expect(proxy).not.toHaveBeenCalled();
    direct.mockResolvedValueOnce(new Response('Forbidden', { status: 403 }));
    proxy.mockResolvedValueOnce(authoritative());
    expect(await selectGraytagSellerRoute(url, {}, 'http://proxy.invalid', direct, proxy)).toBe('proxy');
    direct.mockResolvedValueOnce(new Response('Forbidden', { status: 403 }));
    expect(await selectGraytagSellerRoute(url, {}, 'http://proxy.invalid', direct, proxy)).toBeNull();
  });

  test('a 200 response without an authoritative seller list cannot authorize a write', async () => {
    const direct = vi.fn(async () => new Response('<html>login</html>', { status: 200 }));
    const proxy = vi.fn(async () => new Response(JSON.stringify({ succeeded: true, data: {} }), { status: 200 }));
    expect(await selectGraytagSellerRoute(url, {}, 'http://proxy.invalid', direct, proxy)).toBeNull();
  });
});
