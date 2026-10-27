import type { Hono } from 'hono';
import { loadSafeModeConfig } from './safe-mode';
import { withGbutsOttInventory } from '../lib/gbuts-ott-store';
import { bindYouTubeRenewal, readYouTubeRenewals, writeYouTubeRenewals, renewYouTubeInvites, youtubeOccupied, type InviteClient } from '../scheduler/gbuts-youtube-renewal';

export function registerGbutsYouTubeRenewalRoutes(app: Hono, client: () => InviteClient) {
  const active = () => process.env.GBUTS_OTT_SYNC_ENABLED === 'true' && !loadSafeModeConfig().enabled;
  app.get('/gbuts/youtube/renewals', c => {
    try { const s = readYouTubeRenewals(); return c.json({ ok: true, enabled: process.env.GBUTS_OTT_SYNC_ENABLED === 'true', safeMode: loadSafeModeConfig().enabled,
      renewals: Object.values(s.policies).map(p => ({ ...p, serviceType: '유튜브', occupied: youtubeOccupied(p), pendingId: p.pending ? `youtube:${p.seedPostSeq}:${p.pending.afterSeq}` : null })) }); }
    catch { return c.json({ ok: false, error: '유튜브 재등록 기록 확인 필요' }, 503); }
  });
  app.post('/gbuts/youtube/renewals', c => withGbutsOttInventory(async () => {
    try {
      const body = await c.req.json(); if (!Number.isSafeInteger(body.postSeq) || body.postSeq < 1 || typeof body.enabled !== 'boolean') throw Error('판매글과 감시 상태를 확인해주세요.');
      if (body.enabled && !active()) throw Error('판매 자동화가 일시정지 상태입니다.');
      const s = readYouTubeRenewals(); const p = bindYouTubeRenewal(s, await client().getPost(body.postSeq), body.enabled); writeYouTubeRenewals(s);
      return c.json({ ok: true, seedPostSeq: p.seedPostSeq, currentPostSeq: p.currentPostSeq, enabled: p.enabled, trigger: p.trigger, rankThreshold: p.rankThreshold });
    } catch (e) { return c.json({ ok: false, error: e instanceof Error ? e.message : '유튜브 설정 확인 필요' }, 409); }
  }));
  app.post('/gbuts/youtube/renewals/run', c => withGbutsOttInventory(async () => {
    if (!active()) return c.json({ ok: false, error: '판매 자동화가 일시정지 상태입니다.' }, 409);
    try { const r = await renewYouTubeInvites(client(),{allowed:active}); return c.json({ ok: r.errors === 0, ...r }); }
    catch { return c.json({ ok: false, error: '유튜브 재등록 확인 필요' }, 503); }
  }));
}
