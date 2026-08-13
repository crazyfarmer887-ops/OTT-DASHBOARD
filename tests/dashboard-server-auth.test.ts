import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';

vi.mock('@hono/node-server', () => ({ serve: vi.fn() }));
vi.mock('../src/scheduler/auto-sync.ts', () => ({ scheduleAutoSync: vi.fn() }));
vi.mock('../src/scheduler/undercutter.ts', () => ({ startUndercutterScheduler: vi.fn() }));
vi.mock('../src/scheduler/poll-daemon.ts', () => ({ startPollDaemon: vi.fn() }));
vi.mock('../src/scheduler/auto-reply-daemon.ts', () => ({ startAutoReplyDaemon: vi.fn() }));
vi.mock('../src/scheduler/renewal-automation-daemon.ts', () => ({ startRenewalAutomationDaemon: vi.fn() }));

const originalPassword = process.env.DASHBOARD_ADMIN_PASSWORD;
const originalSecret = process.env.DASHBOARD_SESSION_SECRET;
let app: Awaited<typeof import('../server.ts')>['app'];

beforeAll(async () => {
  app = (await import('../server.ts')).app;
});

afterAll(() => {
  if (originalPassword === undefined) delete process.env.DASHBOARD_ADMIN_PASSWORD;
  else process.env.DASHBOARD_ADMIN_PASSWORD = originalPassword;
  if (originalSecret === undefined) delete process.env.DASHBOARD_SESSION_SECRET;
  else process.env.DASHBOARD_SESSION_SECRET = originalSecret;
});

function unsetDashboardAuth() {
  delete process.env.DASHBOARD_ADMIN_PASSWORD;
  delete process.env.DASHBOARD_SESSION_SECRET;
}

describe('dashboard server authentication configuration', () => {
  test.each(['/dashboard', '/dashboard/manage'])('returns a safe 503 for protected HTML when auth is unconfigured: %s', async (path) => {
    unsetDashboardAuth();

    const response = await app.request(path);
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(body).toBe('Dashboard authentication is not configured.');
  });

  test('returns a safe 503 for login and does not accept any fallback password', async () => {
    unsetDashboardAuth();

    const response = await app.request('/dashboard/login', {
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
});
