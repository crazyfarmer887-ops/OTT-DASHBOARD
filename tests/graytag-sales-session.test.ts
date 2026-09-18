import { describe, expect, test } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadGraytagAuthCookies,
  parseGraytagCookieImport,
  writeGraytagAuthCookiesAtomic,
} from '../src/lib/graytag-sales-session';

const requiredCookies = [
  { domain: 'graytag.co.kr', name: 'AWSALB', value: 'alb-value' },
  { domain: 'graytag.co.kr', name: 'AWSALBCORS', value: 'cors-value' },
  { domain: 'graytag.co.kr', name: 'JSESSIONID', value: 'session-value' },
];

describe('GrayTag YouTube sales session storage', () => {
  test('keeps only the three server-side authentication cookies from a browser export', () => {
    const parsed = parseGraytagCookieImport([
      { domain: '.graytag.co.kr', name: '_ga', value: 'analytics' },
      ...requiredCookies,
      { domain: '.graytag.co.kr', name: '_gid', value: 'analytics-too' },
    ]);

    expect(parsed).toEqual({
      AWSALB: 'alb-value',
      AWSALBCORS: 'cors-value',
      JSESSIONID: 'session-value',
    });
    expect(JSON.stringify(parsed)).not.toContain('analytics');
  });

  test('accepts a JSON string and rejects missing, conflicting, or foreign-domain authentication cookies', () => {
    expect(parseGraytagCookieImport(JSON.stringify(requiredCookies))).toMatchObject({ JSESSIONID: 'session-value' });
    expect(() => parseGraytagCookieImport(requiredCookies.filter((cookie) => cookie.name !== 'JSESSIONID'))).toThrow(/JSESSIONID/);
    expect(() => parseGraytagCookieImport([
      ...requiredCookies,
      { domain: 'graytag.co.kr', name: 'JSESSIONID', value: 'different-session' },
    ])).toThrow(/conflicting/i);
    expect(() => parseGraytagCookieImport(requiredCookies.map((cookie) => ({ ...cookie, domain: 'example.com' })))).toThrow(/domain/i);
  });

  test('writes atomically with owner-only permissions and loads the same auth values', () => {
    const dir = mkdtempSync(join(tmpdir(), 'graytag-youtube-session-'));
    const path = join(dir, 'youtube-sales-cookies.json');
    try {
      const cookies = parseGraytagCookieImport(requiredCookies);
      writeGraytagAuthCookiesAtomic(path, cookies);

      expect(loadGraytagAuthCookies(path)).toEqual(cookies);
      expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(cookies);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
