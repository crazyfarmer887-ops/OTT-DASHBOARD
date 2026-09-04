import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';

vi.mock('@hono/node-server', () => ({ serve: vi.fn() }));
vi.mock('../src/scheduler/auto-sync.ts', () => ({ scheduleAutoSync: vi.fn() }));
vi.mock('../src/scheduler/undercutter.ts', () => ({ startUndercutterScheduler: vi.fn() }));
vi.mock('../src/scheduler/poll-daemon.ts', () => ({ startPollDaemon: vi.fn() }));
vi.mock('../src/scheduler/auto-reply-daemon.ts', () => ({ startAutoReplyDaemon: vi.fn() }));
vi.mock('../src/scheduler/renewal-automation-daemon.ts', () => ({ startRenewalAutomationDaemon: vi.fn() }));

const originalPassword = process.env.DASHBOARD_ADMIN_PASSWORD;
const originalSecret = process.env.DASHBOARD_SESSION_SECRET;
const originalAdminToken = process.env.AIO_ADMIN_TOKEN;
let app: Awaited<typeof import('../server.ts')>['app'];

beforeAll(async () => {
  app = (await import('../server.ts')).app;
});

afterAll(() => {
  if (originalPassword === undefined) delete process.env.DASHBOARD_ADMIN_PASSWORD;
  else process.env.DASHBOARD_ADMIN_PASSWORD = originalPassword;
  if (originalSecret === undefined) delete process.env.DASHBOARD_SESSION_SECRET;
  else process.env.DASHBOARD_SESSION_SECRET = originalSecret;
  if (originalAdminToken === undefined) delete process.env.AIO_ADMIN_TOKEN;
  else process.env.AIO_ADMIN_TOKEN = originalAdminToken;
});

function unsetDashboardAuth() {
  delete process.env.DASHBOARD_ADMIN_PASSWORD;
  delete process.env.DASHBOARD_SESSION_SECRET;
}

describe('dashboard server authentication configuration', () => {
  test.each(['/dashboard', '/dashboard/manage', '/', '/manage', '/youtube-invites', '/renewals'])('returns a safe 503 for protected HTML when auth is unconfigured: %s', async (path) => {
    unsetDashboardAuth();

    const response = await app.request(path);
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(body).toBe('Dashboard authentication is not configured.');
  });

  test.each(['/dashboard/login', '/login'])('returns a safe 503 for login and does not accept any fallback password: %s', async (path) => {
    unsetDashboardAuth();

    const response = await app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'password=any-fallback-attempt',
    });

    expect(response.status).toBe(503);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(await response.text()).toBe('Dashboard authentication is not configured.');
  });

  test('fails closed when the session secret is missing or equals the configured password', async () => {
    process.env.DASHBOARD_ADMIN_PASSWORD = 'configured-dashboard-password';
    for (const secret of ['', 'configured-dashboard-password']) {
      process.env.DASHBOARD_SESSION_SECRET = secret;
      const response = await app.request('/dashboard');
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain(process.env.DASHBOARD_ADMIN_PASSWORD);
    }
  });

  test('keeps party access routes outside the dashboard authentication gate', async () => {
    unsetDashboardAuth();

    const dashboardPartyAccess = await app.request('/dashboard/access/test-token');
    const rootPartyAccess = await app.request('/access/test-token');

    expect(dashboardPartyAccess.status).toBe(200);
    expect(rootPartyAccess.status).toBe(200);
  });

  test('bridges a valid dashboard session to same-origin protected API requests', async () => {
    process.env.DASHBOARD_ADMIN_PASSWORD = 'configured-dashboard-password';
    process.env.DASHBOARD_SESSION_SECRET = 'separate-session-secret-at-least-32-characters';
    process.env.AIO_ADMIN_TOKEN = 'internal-admin-token';

    const login = await app.request('/dashboard/login', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'password=configured-dashboard-password',
    });
    const sessionCookie = login.headers.get('set-cookie')?.split(';', 1)[0];
    expect(sessionCookie).toBeTruthy();

    const response = await app.request('/api/session/cookies', {
      headers: {
        cookie: sessionCookie!,
        origin: 'https://email-verify.one',
        'sec-fetch-site': 'same-origin',
        'x-forwarded-host': 'email-verify.one',
        'x-forwarded-proto': 'https',
      },
    });

    expect(response.status).toBe(200);
  });

  test('does not bridge missing, invalid, or cross-origin dashboard sessions', async () => {
    process.env.DASHBOARD_ADMIN_PASSWORD = 'configured-dashboard-password';
    process.env.DASHBOARD_SESSION_SECRET = 'separate-session-secret-at-least-32-characters';
    process.env.AIO_ADMIN_TOKEN = 'internal-admin-token';

    const login = await app.request('/dashboard/login', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'password=configured-dashboard-password',
    });
    const sessionCookie = login.headers.get('set-cookie')?.split(';', 1)[0];
    expect(sessionCookie).toBeTruthy();

    await expect(app.request('/api/session/cookies')).resolves.toHaveProperty('status', 403);
    await expect(app.request('/api/session/cookies', {
      headers: { cookie: 'graytag_dashboard_session=invalid' },
    })).resolves.toHaveProperty('status', 403);
    await expect(app.request('/api/session/cookies', {
      headers: { cookie: sessionCookie!, origin: 'https://attacker.example' },
    })).resolves.toHaveProperty('status', 403);
  });
});
