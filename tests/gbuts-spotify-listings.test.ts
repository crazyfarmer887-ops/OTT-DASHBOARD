import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerGbutsSpotifyListingRoutes } from '../src/api/gbuts-spotify-listings';
import { createGbutsOttSellerClient } from '../src/lib/gbuts-ott-client';
import { deletedSpotifyPostSeqs, readSpotifyListings, spotifyPostSeqs } from '../src/lib/gbuts-spotify-listings';

let directory = ''; const env = { ...process.env };
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'spotify-sales-'));
  process.env.GBUTS_SPOTIFY_LISTINGS_PATH = join(directory, 'listings.json');
  process.env.GBUTS_SPOTIFY_SYNC_ENABLED = 'true'; process.env.GBUTS_SPOTIFY_AUTO_MESSAGE_ENABLED = 'true';
  process.env.NOTION_API_TOKEN = 'fixture-notion';
  delete process.env.GBUTS_SPOTIFY_POST_SEQ;
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-18T08:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers(); rmSync(directory, { recursive: true, force: true });
  for (const key of ['GBUTS_SPOTIFY_LISTINGS_PATH', 'GBUTS_SPOTIFY_SYNC_ENABLED', 'GBUTS_SPOTIFY_AUTO_MESSAGE_ENABLED', 'GBUTS_SPOTIFY_POST_SEQ', 'NOTION_API_TOKEN']) {
    if (env[key] === undefined) delete process.env[key]; else process.env[key] = env[key];
  }
});
function fixture() {
  const source = { seq: 15557, category1: { seq: 20 }, subscriptionType: 'INVITE', countries: ['KR'],
    title: JSON.stringify({ ko: '[스포티파이] 기존 제목', en: '' }), description: '기존 판매 내용\n① 내 계정 등록\n② 새 계정 발급',
    noticeBeforeOrder: '기존 구매 전 안내', noticeAfterOrder: null, memberLimit: 5, memberCount: 5,
    status: 'CLOSED', price: 140, priceType: 'DAY', subscriptionStartsAt: '2026-10-02 00:00:00', subscriptionEndsAt: '2027-10-01 00:00:00' };
  const posts: any[] = [source]; const writes: any[] = []; let outcome = 'success'; let closeOutcome = 'success'; let closes = 0;
  const transport = vi.fn(async (url: any, options?: RequestInit) => {
    const parsed = new URL(String(url)); const path = parsed.pathname; let response;
    if (path.endsWith('/list')) response = parsed.searchParams.get('page') === '1' ? posts : [];
    else if (path.endsWith('/view')) response = posts.find(x => x.seq === Number(path.split('/').at(-2)));
    else if (path.endsWith('/closed') && options?.method === 'POST') {
      closes++;
      if (closeOutcome !== 'lost-before-close') posts.find(x => x.seq === Number(path.split('/').at(-2))).status = 'CLOSED';
      if (closeOutcome.startsWith('lost')) throw new Error('close response lost');
      response = true;
    }
    else if (options?.method === 'POST' && path === '/api/subscribe/share') {
      const body = JSON.parse(String(options.body)); writes.push(body);
      if (outcome !== 'lost-before-create') posts.push({ ...body, seq: 17000, category1: { seq: body.category }, memberCount: 0, status: 'ON_SALE' });
      if (outcome.startsWith('lost')) throw new Error('response lost');
      response = outcome === 'no-id' ? null : 17000;
    } else throw new Error('Unexpected endpoint');
    return new Response(JSON.stringify({ success: true, response }));
  });
  const app = new Hono(); registerGbutsSpotifyListingRoutes(app, () => createGbutsOttSellerClient('fixture', transport));
  const body = { requestId: 'spotify-request-1', title: '[스포티파이] 기존 제목', description: source.description,
    noticeBeforeOrder: source.noticeBeforeOrder, noticeAfterOrder: null, startDate: '2026-10-18', endDate: '2027-10-17', dailyPrice: 140, capacity: 5 };
  return { app, source, posts, writes, body, get closes() { return closes; }, set closeOutcome(value: string) { closeOutcome = value; }, set outcome(value: string) { outcome = value; },
    publish: (patch = {}) => app.request('/gbuts/spotify/listings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, ...patch }) }) };
}
it('loads the previous Spotify wording and purchase notices with a new one-year period', async () => {
  const f = fixture(); const response = await f.app.request('/gbuts/spotify/listings');
  expect(await response.json()).toMatchObject({ ok: true, enabled: true, template: { title: f.body.title,
    description: f.source.description, noticeBeforeOrder: f.source.noticeBeforeOrder, noticeAfterOrder: null,
    dailyPrice: 140, capacity: 5, startDate: '2026-10-18', endDate: '2027-10-17' } });
  expect(f.writes).toHaveLength(0);
});
it('publishes an invitation listing and immediately includes it in the existing Spotify monitor', async () => {
  const f = fixture(); expect((await f.publish()).status).toBe(200);
  expect(f.writes).toEqual([expect.objectContaining({ category: 20, subscriptionType: 'INVITE', countries: ['KR'],
    subscriptionPrincipal: null, subscriptionCredential: null, title: f.body.title, description: f.source.description,
    noticeBeforeOrder: f.source.noticeBeforeOrder, noticeAfterOrder: null, price: 140, priceType: 'DAY', memberLimit: 5,
    subscriptionStartsAt: '2026-10-18 00:00:00', subscriptionEndsAt: '2027-10-17 23:59:59' })]);
  expect(spotifyPostSeqs()).toEqual([15557, 17000]);
});
it('serializes duplicate clicks, replays the same request, and refuses changed request IDs', async () => {
  const f = fixture(); const results = await Promise.all([f.publish(), f.publish()]);
  expect(results.map(x => x.status)).toEqual([200, 200]); expect(f.writes).toHaveLength(1);
  expect((await f.publish({ dailyPrice: 150 })).status).toBe(409);
  expect((await f.publish({ requestId: 'spotify-request-2' })).status).toBe(409);
  expect(f.writes).toHaveLength(1);
});
it('reconciles a successful creation whose response was lost without repeating the external write', async () => {
  const f = fixture(); f.outcome = 'lost-after-create';
  expect((await f.publish()).status).toBe(200); expect(f.writes).toHaveLength(1);
  expect(spotifyPostSeqs()).toContain(17000);
});
it('preserves uncertain requests and never reposts when creation cannot be found', async () => {
  const f = fixture(); f.outcome = 'lost-before-create';
  expect((await f.publish()).status).toBe(502);
  expect(readSpotifyListings().listings[f.body.requestId].state).toBe('uncertain');
  expect((await f.publish()).status).toBe(503); expect(f.writes).toHaveLength(1);
  expect(spotifyPostSeqs()).toEqual([15557]);
});
it('can verify a creation response without an ID from the seller list', async () => {
  const f = fixture(); f.outcome = 'no-id'; expect((await f.publish()).status).toBe(200);
});
it('refuses to treat a different live listing as a successful creation', async () => {
  const f = fixture(); f.outcome = 'lost-before-create'; await f.publish();
  f.posts.push({ ...f.source, seq: 17001, status: 'ON_SALE', memberCount: 0,
    title: '다른 판매글', subscriptionStartsAt: '2026-10-18 00:00:00', subscriptionEndsAt: '2027-10-17 23:59:59' });
  const response = await f.app.request(`/gbuts/spotify/listings/${f.body.requestId}/reconcile`, { method: 'POST' });
  expect(response.status).toBe(409); expect(spotifyPostSeqs()).toEqual([15557]); expect(f.writes).toHaveLength(1);
});
it('rejects invalid periods, excess places and disabled buyer automation before external writes', async () => {
  const f = fixture();
  expect((await f.publish({ endDate: '2027-02-30' })).status).toBe(400);
  expect((await f.publish({ capacity: 6 })).status).toBe(400);
  process.env.GBUTS_SPOTIFY_AUTO_MESSAGE_ENABLED = 'false';
  expect((await f.publish()).status).toBe(503); expect(f.writes).toHaveLength(0);
});
it('closes recruitment before hiding the listing and preserves existing buyer monitoring across repeated deletion', async () => {
  const f = fixture(); await f.publish();
  f.posts.find(x => x.seq === 17000).memberCount = 2;
  const remove = () => f.app.request(`/gbuts/spotify/listings/${f.body.requestId}`, { method: 'DELETE' });
  expect((await remove()).status).toBe(200);
  expect(f.posts.find(x => x.seq === 17000).status).toBe('CLOSED');
  expect(readSpotifyListings().listings[f.body.requestId].deletedAt).toBeTruthy();
  expect((await (await f.app.request('/gbuts/spotify/listings')).json()).listings).toEqual([]);
  expect(spotifyPostSeqs()).toEqual([15557, 17000]);
  expect(deletedSpotifyPostSeqs()).toEqual([17000]);
  expect((await remove()).status).toBe(200); expect(f.closes).toBe(1);
  expect((await f.publish()).status).toBe(409); expect(f.writes).toHaveLength(1);
});
it('verifies a lost close response without repeating the close operation', async () => {
  const f = fixture(); await f.publish(); f.closeOutcome = 'lost-after-close';
  expect((await f.app.request(`/gbuts/spotify/listings/${f.body.requestId}`, { method: 'DELETE' })).status).toBe(200);
  expect(f.closes).toBe(1); expect(deletedSpotifyPostSeqs()).toEqual([17000]);
});
it('keeps the post visible when recruitment closure cannot be verified', async () => {
  const f = fixture(); await f.publish(); f.closeOutcome = 'lost-before-close';
  expect((await f.app.request(`/gbuts/spotify/listings/${f.body.requestId}`, { method: 'DELETE' })).status).toBe(502);
  expect(readSpotifyListings().listings[f.body.requestId].deletedAt).toBeUndefined();
  expect((await (await f.app.request('/gbuts/spotify/listings')).json()).listings).toHaveLength(1);
  expect(f.closes).toBe(1); expect(spotifyPostSeqs()).toContain(17000);
});
it('does not close an unverified registration or another unknown seller post', async () => {
  const f = fixture(); f.outcome = 'lost-before-create'; await f.publish();
  expect((await f.app.request(`/gbuts/spotify/listings/${f.body.requestId}`, { method: 'DELETE' })).status).toBe(409);
  expect((await f.app.request('/gbuts/spotify/listings/unknown-post', { method: 'DELETE' })).status).toBe(404);
  expect(f.closes).toBe(0);
});
