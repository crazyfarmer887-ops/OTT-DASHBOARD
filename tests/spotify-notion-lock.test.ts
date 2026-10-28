import { describe, expect, it, vi } from 'vitest';
let busy = false;
vi.mock('../src/scheduler/poll-daemon', () => ({
  runWithExclusivePollLock: async (_path: string, work: () => Promise<void>) => {
    if (busy) return false;
    busy = true;
    try { await work(); return true; } finally { busy = false; }
  },
}));
import { runWithSpotifyNotionLock } from '../src/scheduler/spotify-notion-lock';

describe('shared Spotify worker admission', () => {
  it('waits in arrival order rather than dropping Everyview while GButs is busy', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const order: string[] = [];
    const first = runWithSpotifyNotionLock(async () => { order.push('gbuts'); await gate; });
    await Promise.resolve();
    const next = runWithSpotifyNotionLock(async () => { order.push('everyview'); });
    const later = runWithSpotifyNotionLock(async () => { order.push('gbuts-next'); });
    release();
    expect(await Promise.all([first, next, later])).toEqual([true, true, true]);
    expect(order).toEqual(['gbuts', 'everyview', 'gbuts-next']);
  });
  it('releases the queue after a worker throws', async () => {
    await expect(runWithSpotifyNotionLock(async () => { throw Error('read failed'); })).rejects.toThrow('read failed');
    await expect(runWithSpotifyNotionLock(async () => {})).resolves.toBe(true);
  });
});
