import { curlFetch } from './http-transport';

export type GraytagSellerRoute = 'direct' | 'proxy';
type DirectFetch = (url: string, options?: RequestInit) => Promise<Response>;
type ProxyFetch = (url: string, options: RequestInit, proxyUrl: string) => Promise<Response>;
const PROXY_DENIAL_COOLDOWN_MS = 60_000;
const proxyDeniedUntil = new Map<string, number>();

/** A denied read can safely use the other route. Writes must never be retried here. */
export async function fetchGraytagReadWithFallback(
  url: string,
  options: RequestInit = {},
  proxyUrl: string | undefined,
  direct: DirectFetch = fetch,
  viaProxy: ProxyFetch = curlFetch,
): Promise<Response> {
  if ((options.method || 'GET').toUpperCase() !== 'GET') throw new TypeError('read only GrayTag fallback');
  if (!proxyUrl) return direct(url, options);
  if ((proxyDeniedUntil.get(proxyUrl) || 0) > Date.now()) {
    try {
      const directResponse = await direct(url, options);
      if (directResponse.ok) return directResponse;
    } catch { /* Check whether the proxy has recovered. */ }
  }
  let proxied: Response;
  try { proxied = await viaProxy(url, options, proxyUrl); }
  catch { return direct(url, options); }
  if (proxied.status !== 403) {
    proxyDeniedUntil.delete(proxyUrl);
    return proxied;
  }
  proxyDeniedUntil.set(proxyUrl, Date.now() + PROXY_DENIAL_COOLDOWN_MS);
  try {
    const directResponse = await direct(url, options);
    return directResponse.ok ? directResponse : proxied;
  } catch { return proxied; }
}

async function isAuthoritativeSellerResponse(response: Response): Promise<boolean> {
  if (!response.ok || response.redirected) return false;
  try {
    const payload = await response.json() as any;
    const deals = payload?.data?.data?.lenderDeals ?? payload?.data?.lenderDeals ?? payload?.lenderDeals;
    return payload?.succeeded === true && Array.isArray(deals);
  } catch { return false; }
}

/** Probe read-only seller data before choosing the route for a single product POST. */
export async function selectGraytagSellerRoute(
  url: string,
  options: RequestInit,
  proxyUrl: string | undefined,
  direct: DirectFetch = fetch,
  viaProxy: ProxyFetch = curlFetch,
): Promise<GraytagSellerRoute | null> {
  try {
    if (await isAuthoritativeSellerResponse(await direct(url, options))) return 'direct';
  } catch { /* The configured proxy may still work. */ }
  if (!proxyUrl) return null;
  try {
    if (await isAuthoritativeSellerResponse(await viaProxy(url, options, proxyUrl))) return 'proxy';
  } catch { /* Neither route produced an authoritative seller response. */ }
  return null;
}
