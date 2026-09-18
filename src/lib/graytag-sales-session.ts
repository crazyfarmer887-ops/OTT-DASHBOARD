import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';

export interface GraytagAuthCookies {
  AWSALB: string;
  AWSALBCORS: string;
  JSESSIONID: string;
}

interface BrowserCookie {
  domain?: unknown;
  name?: unknown;
  value?: unknown;
}

const AUTH_COOKIE_NAMES = ['AWSALB', 'AWSALBCORS', 'JSESSIONID'] as const;
const MAX_COOKIE_VALUE_LENGTH = 4096;

export const YOUTUBE_SALES_SESSION_COOKIE_PATH =
  process.env.YOUTUBE_GRAYTAG_SESSION_COOKIE_PATH || '/home/ubuntu/graytag-session/youtube-sales-cookies.json';

export const YOUTUBE_SALES_SESSION_STATUS_PATH =
  process.env.YOUTUBE_GRAYTAG_SESSION_STATUS_PATH || '/home/ubuntu/graytag-session/youtube-sales-session-status.json';

function parsePayload(payload: unknown): unknown {
  if (typeof payload !== 'string') return payload;
  try {
    return JSON.parse(payload);
  } catch {
    throw new Error('Cookie export must be valid JSON.');
  }
}

function isGraytagDomain(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return true;
  return String(value).trim().replace(/^\./, '').toLowerCase() === 'graytag.co.kr';
}

function validateValue(name: string, value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > MAX_COOKIE_VALUE_LENGTH || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`${name} has an invalid value.`);
  }
  return value;
}

export function parseGraytagCookieImport(payload: unknown): GraytagAuthCookies {
  const parsed = parsePayload(payload);
  const cookies: BrowserCookie[] = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? Object.entries(parsed as Record<string, unknown>).map(([name, value]) => ({ name, value }))
      : [];

  if (cookies.length === 0) throw new Error('Cookie export must be a non-empty array or object.');

  const selected = new Map<string, string>();
  for (const cookie of cookies) {
    const name = typeof cookie?.name === 'string' ? cookie.name : '';
    if (!AUTH_COOKIE_NAMES.includes(name as (typeof AUTH_COOKIE_NAMES)[number])) continue;
    if (!isGraytagDomain(cookie.domain)) throw new Error(`${name} has an invalid GrayTag domain.`);
    const value = validateValue(name, cookie.value);
    const previous = selected.get(name);
    if (previous !== undefined && previous !== value) throw new Error(`${name} has conflicting values.`);
    selected.set(name, value);
  }

  if (!selected.get('JSESSIONID')) throw new Error('JSESSIONID is required.');

  return {
    AWSALB: selected.get('AWSALB') || '',
    AWSALBCORS: selected.get('AWSALBCORS') || '',
    JSESSIONID: selected.get('JSESSIONID')!,
  };
}

export function loadGraytagAuthCookies(path = YOUTUBE_SALES_SESSION_COOKIE_PATH): GraytagAuthCookies | null {
  try {
    if (!existsSync(path)) return null;
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<GraytagAuthCookies>;
    if (!raw || typeof raw !== 'object' || typeof raw.JSESSIONID !== 'string' || !raw.JSESSIONID) return null;
    return {
      AWSALB: typeof raw.AWSALB === 'string' ? raw.AWSALB : '',
      AWSALBCORS: typeof raw.AWSALBCORS === 'string' ? raw.AWSALBCORS : '',
      JSESSIONID: raw.JSESSIONID,
    };
  } catch {
    return null;
  }
}

export function writeJsonAtomic(path: string, value: unknown): void {
  const slash = path.lastIndexOf('/');
  const dir = slash > 0 ? path.slice(0, slash) : '.';
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    renameSync(tempPath, path);
    chmodSync(path, 0o600);
  } catch (error) {
    try { rmSync(tempPath, { force: true }); } catch {}
    throw error;
  }
}

export function writeGraytagAuthCookiesAtomic(path: string, cookies: GraytagAuthCookies): void {
  writeJsonAtomic(path, {
    AWSALB: cookies.AWSALB,
    AWSALBCORS: cookies.AWSALBCORS,
    JSESSIONID: cookies.JSESSIONID,
  });
}

export function buildGraytagCookieHeader(cookies: GraytagAuthCookies): string {
  return [
    cookies.AWSALB ? `AWSALB=${cookies.AWSALB}` : '',
    cookies.AWSALBCORS ? `AWSALBCORS=${cookies.AWSALBCORS}` : '',
    `JSESSIONID=${cookies.JSESSIONID}`,
  ].filter(Boolean).join('; ');
}
