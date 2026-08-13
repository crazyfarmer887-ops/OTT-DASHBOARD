import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let dir: string;
const saved = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  dir = mkdtempSync(join(tmpdir(), 'renewal-policy-api-'));
  process.env.AIO_ADMIN_TOKEN = 'policy-token';
  process.env.AIO_ADMIN_ACTOR = 'operator@example.com';
  process.env.RENEWAL_AUTOMATION_JOBS_PATH = join(dir, 'jobs.json');
  process.env.SAFE_MODE_PATH = join(dir, 'safe-mode.json');
  process.env.AUDIT_LOG_PATH = join(dir, 'audit.jsonl');
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  for (const key of ['AIO_ADMIN_TOKEN', 'AIO_ADMIN_ACTOR', 'RENEWAL_AUTOMATION_JOBS_PATH', 'SAFE_MODE_PATH', 'AUDIT_LOG_PATH']) {
    if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
  }
});

describe('renewal message policy API', () => {
  test('GET is admin protected and PUT is schema/safe-mode protected with authenticated actor audit', async () => {
    const app = (await import('../src/api/index.ts')).default;
    expect((await app.request('/renewal-automation/message-policy')).status).toBe(403);

    const headers = { 'content-type': 'application/json', 'x-admin-token': 'policy-token' };
    const initial = await app.request('/renewal-automation/message-policy', { headers });
    expect(initial.status).toBe(200);
    expect(await initial.json()).toMatchObject({ ok: true, policy: { enabled: true, targetCount: 5, sentCount: 0, reservedCount: 0, remaining: 5 } });

    const invalid = await app.request('/renewal-automation/message-policy', { method: 'PUT', headers, body: JSON.stringify({ enabled: true, targetCount: 101 }) });
    expect(invalid.status).toBe(400);

    writeFileSync(process.env.SAFE_MODE_PATH!, JSON.stringify({ enabled: true, reason: 'test', updatedAt: new Date().toISOString(), updatedBy: 'test' }));
    const blocked = await app.request('/renewal-automation/message-policy', { method: 'PUT', headers, body: JSON.stringify({ enabled: false, targetCount: 4 }) });
    expect(blocked.status).toBe(423);

    writeFileSync(process.env.SAFE_MODE_PATH!, JSON.stringify({ enabled: false, reason: '', updatedAt: new Date().toISOString(), updatedBy: 'test' }));
    const updated = await app.request('/renewal-automation/message-policy', { method: 'PUT', headers, body: JSON.stringify({ enabled: false, targetCount: 4 }) });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({ ok: true, policy: { enabled: false, targetCount: 4, updatedBy: 'operator@example.com' } });
    const root = JSON.parse(readFileSync(process.env.RENEWAL_AUTOMATION_JOBS_PATH!, 'utf8'));
    expect(root.messagePolicy.audit.at(-1)).toMatchObject({ actor: 'operator@example.com', after: { enabled: false, targetCount: 4 } });
    expect(readFileSync(process.env.AUDIT_LOG_PATH!, 'utf8')).toContain('renewal.message-policy.update');
  });
});
