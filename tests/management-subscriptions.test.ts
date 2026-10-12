import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadManagementSubscriptions, normalizeManagementSubscription, upsertManagementSubscription } from '../src/lib/management-subscriptions';
import { accountSubscription, cancellationSummary } from '../src/web/lib/management-subscriptions';

const base = { serviceType: '웨이브', accountEmail: 'Owner@example.com', status: 'cancelled', confirmedAt: '2026-10-11', accessUntil: '2026-11-11', monthlyAmount: 19500, newlyCancelled: true };
let dir: string;
const originalPath = process.env.MANAGEMENT_SUBSCRIPTIONS_PATH;
const originalToken = process.env.AIO_ADMIN_TOKEN;
const originalAudit = process.env.AUDIT_LOG_PATH;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'subscriptions-'));
  process.env.MANAGEMENT_SUBSCRIPTIONS_PATH = join(dir, 'subscriptions.json');
  process.env.AIO_ADMIN_TOKEN = 'test-subscription-admin';
  process.env.AUDIT_LOG_PATH = join(dir, 'audit.jsonl');
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  for (const [key, value] of Object.entries({ MANAGEMENT_SUBSCRIPTIONS_PATH: originalPath, AIO_ADMIN_TOKEN: originalToken, AUDIT_LOG_PATH: originalAudit })) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

describe('confirmed cancellation records', () => {
  it('retains prepaid access and leaves unknown end dates unknown', () => {
    expect(normalizeManagementSubscription(base)).toMatchObject({ status:'cancelled', accessUntil:'2026-11-11' });
    expect(normalizeManagementSubscription({ ...base, accessUntil: null }).accessUntil).toBeNull();
    for (const change of [{ confirmedAt:'2026-02-30' }, { accessUntil:'tomorrow' }, { monthlyAmount:-1 }, { monthlyAmount:1.5 }, { status:'paid' }, { serviceType:'unknown' }]) {
      expect(() => normalizeManagementSubscription({ ...base, ...change })).toThrow();
    }
  });
  it('persists separately and never stores supplied credentials or alters another account', () => {
    upsertManagementSubscription({ ...base, password:'do-not-persist', pin:'123456' });
    upsertManagementSubscription({ ...base, accountEmail:'another@example.com', newlyCancelled:false });
    const store = loadManagementSubscriptions();
    expect(Object.keys(store)).toHaveLength(2);
    expect(accountSubscription(store, '웨이브', ' OWNER@example.com ')).toMatchObject({ newlyCancelled:true });
    expect(readFileSync(process.env.MANAGEMENT_SUBSCRIPTIONS_PATH!, 'utf8')).not.toContain('do-not-persist');
    expect(readFileSync(process.env.MANAGEMENT_SUBSCRIPTIONS_PATH!, 'utf8')).not.toContain('123456');
  });
  it('does not double count linked bundle accounts or previously cancelled subscriptions', () => {
    upsertManagementSubscription(base);
    upsertManagementSubscription({ ...base, accountEmail:'old@example.com', newlyCancelled:false });
    upsertManagementSubscription({ ...base, serviceType:'티빙', accountEmail:'linked-id', monthlyAmount:0, newlyCancelled:false, billingOwnerKey:'웨이브:owner@example.com' });
    const summary = cancellationSummary(loadManagementSubscriptions());
    expect(summary.accounts).toHaveLength(2);
    expect(summary.newMonthlySavings).toBe(19500);
    expect(summary.totalStoppedMonthlyBilling).toBe(39000);
    expect(() => normalizeManagementSubscription({ ...base, billingOwnerKey:'웨이브:owner@example.com' })).toThrow(/duplicate/);
  });
  it('fails on corrupt data instead of showing an empty cancellation list', () => {
    writeFileSync(process.env.MANAGEMENT_SUBSCRIPTIONS_PATH!, '{broken');
    expect(loadManagementSubscriptions).toThrow();
    writeFileSync(process.env.MANAGEMENT_SUBSCRIPTIONS_PATH!, JSON.stringify({ invalid:{ ...base, monthlyAmount:-20 } }));
    expect(loadManagementSubscriptions).toThrow();
  });
  it('requires authentication and exposes saved records via the same API used by the UI', async () => {
    const app = (await import('../src/api/index')).default;
    expect((await app.request('/management-subscriptions')).status).toBe(403);
    expect((await app.request('/management-subscriptions', { method:'PUT', body:JSON.stringify(base), headers:{'content-type':'application/json'} })).status).toBe(403);
    const headers = { 'content-type':'application/json', 'x-admin-token':'test-subscription-admin' };
    expect((await app.request('/management-subscriptions', { method:'PUT', headers, body:JSON.stringify({ ...base, monthlyAmount:-1 }) })).status).toBe(400);
    expect((await app.request('/management-subscriptions', { method:'PUT', headers, body:JSON.stringify(base) })).status).toBe(200);
    const response = await app.request('/management-subscriptions', { headers });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ store:{ '웨이브:owner@example.com':{ status:'cancelled', accessUntil:'2026-11-11' } } });
    const otherHeaders = { ...headers, 'x-graytag-account':'youtube-invite-sales' };
    expect(await (await app.request('/management-subscriptions', { headers:otherHeaders })).json()).toEqual({ store:{} });
    expect((await app.request('/management-subscriptions', { method:'PUT', headers:otherHeaders, body:JSON.stringify(base) })).status).toBe(409);
  });
});
