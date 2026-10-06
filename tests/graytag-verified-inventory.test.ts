import { afterEach, expect, test, vi } from 'vitest';
import { readVerifiedGraytagManagementSnapshot } from '../src/lib/graytag-management-snapshot';
const ok = (rows: any[] = []) => new Response(JSON.stringify({ succeeded: true, data: { lenderDeals: rows } }));
afterEach(() => vi.useRealTimers());
test('reads all verified inventory streams sequentially without overlapping requests', async () => {
  let active = 0; let peak = 0;
  const read = vi.fn(async () => { active++; peak = Math.max(peak, active); await Promise.resolve(); active--; return ok(); });
  expect(await readVerifiedGraytagManagementSnapshot(read)).toEqual({ afterOpenDeals: [], afterFinishedDeals: [], beforeOpenDeals: [], beforeFinishedDeals: [] });
  expect(read.mock.calls).toEqual([['after', false, 1], ['after', true, 1], ['before', false, 1], ['before', true, 1]]);
  expect(peak).toBe(1);
});
test('recovers a transient denied read and preserves all rows', async () => {
  vi.useFakeTimers();
  const row = { dealUsid: 'paid-1', dealStatus: 'Using' };
  const read = vi.fn().mockResolvedValueOnce(new Response('Forbidden', { status: 403 })).mockResolvedValueOnce(ok([row])).mockImplementation(async () => ok());
  const task = readVerifiedGraytagManagementSnapshot(read);
  await vi.runAllTimersAsync();
  expect((await task).afterOpenDeals).toEqual([row]); expect(read).toHaveBeenCalledTimes(5);
});
test('honors rate-limit Retry-After then succeeds without inventing empty inventory', async () => {
  vi.useFakeTimers();
  const read = vi.fn().mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '5' } })).mockImplementation(async () => ok());
  const task = readVerifiedGraytagManagementSnapshot(read);
  await vi.advanceTimersByTimeAsync(4999); expect(read).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1); await task; expect(read).toHaveBeenCalledTimes(5);
});
test('persistent denial stops after bounded attempts and exposes status', async () => {
  vi.useFakeTimers();
  const read = vi.fn(async () => new Response('Forbidden', { status: 403 }));
  const assertion = expect(readVerifiedGraytagManagementSnapshot(read)).rejects.toThrow('403');
  await vi.runAllTimersAsync(); await assertion; expect(read).toHaveBeenCalledTimes(3);
});
test.each([302, 401])('does not retry authentication or redirect response %s', async status => {
  const read = vi.fn(async () => new Response('', { status }));
  await expect(readVerifiedGraytagManagementSnapshot(read)).rejects.toThrow('로그인'); expect(read).toHaveBeenCalledOnce();
});
test('malformed successful responses stop without accepting partial earlier pages', async () => {
  const read = vi.fn().mockResolvedValueOnce(ok([{ productUsid: 'sale1', dealStatus: 'OnSale' }])).mockResolvedValueOnce(new Response('<html>login</html>'));
  await expect(readVerifiedGraytagManagementSnapshot(read)).rejects.toThrow('응답'); expect(read).toHaveBeenCalledTimes(2);
});
test('retries connection failures using the same read page', async () => {
  vi.useFakeTimers();
  const read = vi.fn().mockRejectedValueOnce(new Error('socket failed')).mockImplementation(async () => ok());
  const task = readVerifiedGraytagManagementSnapshot(read); await vi.runAllTimersAsync(); await task;
  expect(read.mock.calls.slice(0, 2)).toEqual([['after', false, 1], ['after', false, 1]]);
});
test('finishes every full page before moving to another stream', async () => {
  const row = { productUsid: 'sale', dealStatus: 'OnSale' };
  const read = vi.fn().mockResolvedValueOnce(ok(Array.from({ length: 500 }, (_, i) => ({ ...row, productUsid: `sale${i}` })))).mockImplementation(async () => ok());
  expect((await readVerifiedGraytagManagementSnapshot(read)).afterOpenDeals).toHaveLength(500);
  expect(read.mock.calls.slice(0, 3)).toEqual([['after', false, 1], ['after', false, 2], ['after', true, 1]]);
});
