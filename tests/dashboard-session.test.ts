import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  createDashboardSessionToken,
  dashboardAdminPassword,
  dashboardSessionSecret,
  isDashboardHtmlPath,
  verifyDashboardSessionToken,
} from '../src/lib/dashboard-session';

const TEST_PASSWORD = 'configured-dashboard-password';
const TEST_SESSION_SECRET = 'separate-session-secret-at-least-32-characters';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('dashboard password session', () => {
  test.each([undefined, '', '   '])('fails closed when dashboard password is not configured (%j)', (value) => {
    const env: Record<string, string | undefined> = { DASHBOARD_ADMIN_PASSWORD: value };

    expect(() => dashboardAdminPassword(env)).toThrowError('DASHBOARD_ADMIN_PASSWORD is required');
  });

  test('returns the trimmed explicitly configured dashboard password', () => {
    expect(dashboardAdminPassword({ DASHBOARD_ADMIN_PASSWORD: `  ${TEST_PASSWORD}  ` })).toBe(TEST_PASSWORD);
  });

  test.each([undefined, '', '   '])('fails closed when session secret is not configured (%j)', (value) => {
    const env: Record<string, string | undefined> = { DASHBOARD_SESSION_SECRET: value };

    expect(() => dashboardSessionSecret(TEST_PASSWORD, env)).toThrowError('DASHBOARD_SESSION_SECRET is required');
  });

  test('rejects a session secret that is the password or too short without exposing either value', () => {
    for (const secret of [TEST_PASSWORD, 'too-short']) {
      try {
        dashboardSessionSecret(TEST_PASSWORD, { DASHBOARD_SESSION_SECRET: secret });
        throw new Error('expected configuration rejection');
      } catch (error) {
        const message = String(error);
        expect(message).toContain('DASHBOARD_SESSION_SECRET');
        expect(message).not.toContain(TEST_PASSWORD);
        expect(message).not.toContain(secret);
      }
    }
  });

  test('signs dashboard cookies only with an explicit separate secret and rejects tampered or expired tokens', () => {
    const now = Date.parse('2026-05-03T00:00:00.000Z');
    const token = createDashboardSessionToken({ password: TEST_PASSWORD, secret: TEST_SESSION_SECRET, now, ttlMs: 60_000 });

    expect(verifyDashboardSessionToken(token, { password: TEST_PASSWORD, secret: TEST_SESSION_SECRET, now: now + 1000 })).toBe(true);
    expect(verifyDashboardSessionToken(token.replace(/.$/, '0'), { password: TEST_PASSWORD, secret: TEST_SESSION_SECRET, now: now + 1000 })).toBe(false);
    expect(verifyDashboardSessionToken(token, { password: TEST_PASSWORD, secret: TEST_SESSION_SECRET, now: now + 120_000 })).toBe(false);
  });

  test('session creation and verification fail closed without a valid separate session secret', () => {
    vi.stubEnv('DASHBOARD_SESSION_SECRET', '');

    expect(() => createDashboardSessionToken({ password: TEST_PASSWORD })).toThrowError('DASHBOARD_SESSION_SECRET is required');
    expect(verifyDashboardSessionToken('payload.signature', { password: TEST_PASSWORD })).toBe(false);
  });

  test('requires the password gate for dashboard HTML routes but not party access, assets, or APIs', () => {
    expect(isDashboardHtmlPath('/dashboard')).toBe(true);
    expect(isDashboardHtmlPath('/dashboard/')).toBe(true);
    expect(isDashboardHtmlPath('/dashboard/manage')).toBe(true);
    expect(isDashboardHtmlPath('/dashboard/access/test-token')).toBe(false);
    expect(isDashboardHtmlPath('/dashboard/assets/index-abc123.js')).toBe(false);
    expect(isDashboardHtmlPath('/api/ping')).toBe(false);
  });
});
