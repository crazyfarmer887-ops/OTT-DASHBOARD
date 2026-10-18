import { Hono } from 'hono';
import { createHash } from 'node:crypto';
import { gbutsOttClient } from './gbuts-ott';
import { matchesSpotifyListing, readSpotifyListings, spotifyTemplate, validateSpotifyListing, writeSpotifyListings,
  LEGACY_SPOTIFY_POST_SEQ, type SpotifyListing, type SpotifyListingInput } from '../lib/gbuts-spotify-listings';

type Client = ReturnType<typeof gbutsOttClient>;
export function registerGbutsSpotifyListingRoutes(app: Hono, clientFactory: () => Client = gbutsOttClient): void {
  const enabled = () => process.env.GBUTS_SPOTIFY_SYNC_ENABLED === 'true'
    && process.env.GBUTS_SPOTIFY_AUTO_MESSAGE_ENABLED === 'true' && Boolean(process.env.NOTION_API_TOKEN?.trim());
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>) => { const result = queue.then(work, work); queue = result.catch(() => {}); return result; };
  const reconcile = async (listing: SpotifyListing, client: Client) => {
    const store = readSpotifyListings();
    const bound = new Set(Object.values(store.listings).filter(x => x.id !== listing.id).map(x => x.postSeq));
    const candidates = listing.postSeq ? [await client.getPost(listing.postSeq)]
      : (await client.listPosts()).filter(post => !listing.beforePostSeqs.includes(post.seq) && !bound.has(post.seq) && matchesSpotifyListing(post, listing));
    if (candidates.length !== 1 || !matchesSpotifyListing(candidates[0], listing)
      || !['ON_SALE', 'CLOSED'].includes(candidates[0].status)) throw new Error('판매글 등록 결과를 하나로 확인하지 못했습니다. 재등록하지 말고 결과 확인을 눌러주세요.');
    listing.postSeq = candidates[0].seq; listing.state = 'registered'; delete listing.error;
    store.listings[listing.id] = listing; writeSpotifyListings(store);
  };
  app.get('/gbuts/spotify/listings', async c => {
    try {
      const template = spotifyTemplate(await clientFactory().getPost(Number(process.env.GBUTS_SPOTIFY_POST_SEQ || LEGACY_SPOTIFY_POST_SEQ)));
      return c.json({ ok: true, template, listings: Object.values(readSpotifyListings().listings),
        enabled: enabled() });
    } catch (e) { return c.json({ ok: false, error: e instanceof Error ? e.message : '기존 스포티파이 판매글 조회 실패' }, 503); }
  });
  app.post('/gbuts/spotify/listings', async c => {
    const body = await c.req.json().catch(() => ({}));
    return serial(async () => {
      try {
        if (!enabled())
          throw new Error('스포티파이 노션 동기화와 구매자 자동 안내 연결을 먼저 확인해주세요.');
        const id = String(body.requestId || '');
        if (!/^[A-Za-z0-9_-]{8,100}$/.test(id)) return c.json({ ok: false, error: '등록 요청을 확인해주세요.' }, 400);
        const input: SpotifyListingInput = { title: String(body.title || ''), description: String(body.description || ''),
          noticeBeforeOrder: body.noticeBeforeOrder == null || body.noticeBeforeOrder === '' ? null : String(body.noticeBeforeOrder),
          noticeAfterOrder: body.noticeAfterOrder == null || body.noticeAfterOrder === '' ? null : String(body.noticeAfterOrder),
          startDate: String(body.startDate || ''), endDate: String(body.endDate || ''), dailyPrice: Number(body.dailyPrice), capacity: Number(body.capacity) };
        try { validateSpotifyListing(input); } catch (e) { return c.json({ ok: false, error: (e as Error).message }, 400); }
        const requestHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
        const store = readSpotifyListings(); const previous = store.listings[id]; const client = clientFactory();
        if (previous) {
          if (previous.requestHash !== requestHash) return c.json({ ok: false, error: '이미 사용한 등록 요청입니다.' }, 409);
          if (previous.state !== 'registered') await reconcile(previous, client);
          return c.json({ ok: true, listing: readSpotifyListings().listings[id] });
        }
        const [posts, source] = await Promise.all([client.listPosts(), client.getPost(Number(process.env.GBUTS_SPOTIFY_POST_SEQ || LEGACY_SPOTIFY_POST_SEQ))]);
        const template = spotifyTemplate(source);
        if (Object.values(store.listings).some(x => x.requestHash === requestHash && (x.state !== 'registered'
          || !posts.some(post => post.seq === x.postSeq && ['CLOSED', 'REFUNDED'].includes(post.status)))))
          return c.json({ ok: false, error: '같은 내용의 판매글이 이미 등록됐거나 확인 중입니다. 아래 판매글을 확인해주세요.' }, 409);
        const listing: SpotifyListing = { ...input, countries: template.countries, id, requestHash,
          state: 'submitting', beforePostSeqs: posts.map(x => x.seq), createdAt: new Date().toISOString() };
        store.listings[id] = listing; writeSpotifyListings(store);
        try {
          listing.postSeq = (await client.createSpotifyPost(listing)) || undefined;
          listing.state = 'uncertain'; writeSpotifyListings(store);
        } catch { listing.state = 'uncertain'; writeSpotifyListings(store); }
        try {
          await reconcile(listing, client);
          return c.json({ ok: true, listing: readSpotifyListings().listings[id] });
        } catch (e) {
          listing.error = (e as Error).message; store.listings[id] = listing; writeSpotifyListings(store);
          return c.json({ ok: false, listing, error: listing.error }, 502);
        }
      } catch (e) { return c.json({ ok: false, error: e instanceof Error ? e.message : '스포티파이 판매글 등록 실패' }, 503); }
    });
  });
  app.post('/gbuts/spotify/listings/:id/reconcile', c => serial(async () => {
    try {
      const listing = readSpotifyListings().listings[c.req.param('id')];
      if (!listing) return c.json({ ok: false, error: '확인할 등록 요청이 없습니다.' }, 404);
      await reconcile(listing, clientFactory()); return c.json({ ok: true, listing });
    } catch (e) { return c.json({ ok: false, error: e instanceof Error ? e.message : '등록 결과 확인 실패' }, 409); }
  }));
}
