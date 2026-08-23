import { createHmac, timingSafeEqual } from 'node:crypto';

export const DASHBOARD_SESSION_COOKIE = 'graytag_dashboard_session';
export const DASHBOARD_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_DASHBOARD_SESSION_SECRET_LENGTH = 32;

export interface DashboardEnvLike {
  DASHBOARD_ADMIN_PASSWORD?: string;
  DASHBOARD_SESSION_SECRET?: string;
}

interface TokenOptions {
  password: string;
  now?: number;
  ttlMs?: number;
  secret?: string;
}

interface VerifyOptions {
  password: string;
  now?: number;
  secret?: string;
}

function safeEqual(left: string, right: string): boolean {
  const l = Buffer.from(left, 'hex');
  const r = Buffer.from(right, 'hex');
  return l.length === r.length && timingSafeEqual(l, r);
}

export function dashboardAdminPassword(env: DashboardEnvLike = process.env): string {
  const configured = env.DASHBOARD_ADMIN_PASSWORD?.trim();
  if (!configured) throw new Error('DASHBOARD_ADMIN_PASSWORD is required');
  return configured;
}

export function dashboardSessionSecret(password: string, env: DashboardEnvLike = process.env): string {
  const configured = env.DASHBOARD_SESSION_SECRET?.trim();
  if (!configured) throw new Error('DASHBOARD_SESSION_SECRET is required');
  if (configured.length < MIN_DASHBOARD_SESSION_SECRET_LENGTH || configured === password.trim()) {
    throw new Error('DASHBOARD_SESSION_SECRET must be separate from the password and at least 32 characters');
  }
  return configured;
}

function resolveSessionSecret(password: string, explicitSecret?: string): string {
  return dashboardSessionSecret(password, { DASHBOARD_SESSION_SECRET: explicitSecret ?? process.env.DASHBOARD_SESSION_SECRET });
}

export function createDashboardSessionToken(options: TokenOptions): string {
  const now = options.now ?? Date.now();
  const ttlMs = options.ttlMs ?? DASHBOARD_SESSION_TTL_MS;
  const expiresAt = now + ttlMs;
  const payload = Buffer.from(JSON.stringify({ exp: expiresAt })).toString('base64url');
  const secret = resolveSessionSecret(options.password, options.secret);
  const sig = createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

export function verifyDashboardSessionToken(token: string | null | undefined, options: VerifyOptions): boolean {
  if (!token) return false;
  const dot = token.lastIndexOf('.');
  if (dot < 0) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  try {
    const secret = resolveSessionSecret(options.password, options.secret);
    const expected = createHmac('sha256', secret).update(payload).digest('hex');
    if (!safeEqual(sig, expected)) return false;
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: unknown };
    const exp = Number(claims.exp);
    const now = options.now ?? Date.now();
    return Number.isFinite(exp) && exp > now;
  } catch {
    return false;
  }
}

export function parseCookieHeader(cookieHeader: string | null | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;
  for (const part of cookieHeader.split(/;\s*/)) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (!key) continue;
    try { cookies[key] = decodeURIComponent(value); }
    catch { cookies[key] = value; }
  }
  return cookies;
}

export function verifyDashboardSessionCookie(
  cookieHeader: string | null | undefined,
  password: string,
  secret?: string,
): boolean {
  const cookies = parseCookieHeader(cookieHeader);
  return verifyDashboardSessionToken(cookies[DASHBOARD_SESSION_COOKIE], { password, secret });
}

export function isDashboardHtmlPath(pathname: string): boolean {
  if (pathname === '/dashboard' || pathname === '/dashboard/') return true;
  if (pathname === '/dashboard/access' || pathname.startsWith('/dashboard/access/')) return false;
  if (pathname.startsWith('/dashboard/assets/')) return false;
  if (pathname.startsWith('/dashboard/')) {
    const last = pathname.split('/').pop() || '';
    return !last.includes('.');
  }
  // Nginx proxies /dashboard/ with a trailing-slash proxy_pass, which strips
  // the prefix before the request reaches this server. Keep these canonical
  // SPA routes protected without capturing unrelated root services/assets.
  return new Set(['/', '/write', '/manage', '/youtube-invites', '/renewals', '/everyview']).has(pathname);
}

export function dashboardSessionCookie(token: string, maxAgeSeconds = Math.floor(DASHBOARD_SESSION_TTL_MS / 1000), secure = false): string {
  return `${DASHBOARD_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure ? '; Secure' : ''}`;
}
