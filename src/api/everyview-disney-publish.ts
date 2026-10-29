import type { Hono } from 'hono';
import { timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { gbutsOttClient } from './gbuts-ott';
import { createEveryviewParty, checkEveryviewSession, fetchEveryviewHostParties, loadEveryviewCookieHeader } from '../lib/everyview-api';
import { createEveryviewDisneyPublishEvidenceAdapter } from '../lib/everyview-disney-publish-evidence';
import { correlatedOwnedPartyReader,correlatedSavedTitleReader } from '../lib/everyview-disney-correlation-reader';
import { isAioDashboardMainProcess } from '../lib/aio-main-process';
import { disneyReadinessRuntimeDependencies, inspectDisneyPublicationReadiness } from '../lib/everyview-disney-readiness';
import { readGbutsOttStore, withGbutsOttInventory, writeGbutsOttStore } from '../lib/gbuts-ott-store';
import { publishEveryviewDisneySeat, readEveryviewDisneyPublishJournal, writeEveryviewDisneyPublishJournal,
  type EveryviewDisneyPublishDeps, type EveryviewDisneyPublishRequest } from '../scheduler/everyview-disney-publish';
import type { GbutsOttRuntimeDependencies } from '../scheduler/gbuts-ott-sync';

/** A malformed safety configuration never enables publication. */
export function everyviewDisneyPublicationAllowed(): boolean {
  if (process.env.EVERYVIEW_DISNEY_PUBLISH_ENABLED !== 'true') return false;
  const path = process.env.SAFE_MODE_PATH || '/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data/safe-mode.json';
  if (!existsSync(path)) return true;
  try { const value = JSON.parse(readFileSync(path, 'utf8'));return typeof value?.enabled === 'boolean' && value.enabled === false; }
  catch { return false; }
}

/**
 * Existing listing-intent, monitoring and cutoff configs cannot yet bind a
 * not-yet-created party ID. Never infer readiness from env flags or tests.
 * The true-state implementation must be added only after a durable handoff
 * from publication to all workers and crash recovery have been proven.
 */
export async function everyviewDisneyPublicationReadiness(request?: EveryviewDisneyPublishRequest, gbuts?: GbutsOttRuntimeDependencies) {
  if (!request) return { syncReady: false, cutoffReady: false, profileDeliveryReady: false };
  const { syncReady, cutoffReady, profileDeliveryReady } = await inspectDisneyPublicationReadiness(request,disneyReadinessRuntimeDependencies(gbuts));
  return { syncReady, cutoffReady, profileDeliveryReady };
}

export function everyviewDisneyPublicationRuntime(request: EveryviewDisneyPublishRequest, gbuts: GbutsOttRuntimeDependencies): EveryviewDisneyPublishDeps {
  const client = gbutsOttClient();
  const cookie = () => loadEveryviewCookieHeader();
  const evidence = createEveryviewDisneyPublishEvidenceAdapter({
    sources: { gbuts, listPosts: () => client.listPosts(), getPost: seq => client.getPost(seq), listMembers: seq => client.listOttMembers(seq), now: () => new Date() },
    readStore: readGbutsOttStore, cookie, readiness: current => everyviewDisneyPublicationReadiness(current,gbuts),
  });
  return { withInventory: withGbutsOttInventory, readInventory: readGbutsOttStore, writeInventory: writeGbutsOttStore,
    readJournal: readEveryviewDisneyPublishJournal, writeJournal: writeEveryviewDisneyPublishJournal,
    preflight: evidence.preflight, credentials: evidence.credentials,
    correlation: { snapshot: correlatedOwnedPartyReader(cookie), savedTitle: correlatedSavedTitleReader(cookie) },
    verify: (partyId, expected) => evidence.verify(partyId, request, expected),
    // A missing returned party ID cannot be attributed by date/account alone.
    // Query owned listings for diagnostics only, then leave it unresolved.
    recover: async () => { const session = cookie();if(session)await fetchEveryviewHostParties(session);return null; },
    submit: async input => {
      if (!isAioDashboardMainProcess() || !everyviewDisneyPublicationAllowed()) return { ok: false };
      const session = cookie();if(!session || !(await checkEveryviewSession(session)).valid
        || !isAioDashboardMainProcess() || !everyviewDisneyPublicationAllowed()) return { ok: false };
      return createEveryviewParty(session,input);
    }, safeToRun: everyviewDisneyPublicationAllowed, now: () => new Date() };
}

function authorized(header: string | undefined): boolean {
  const configured = process.env.AIO_ADMIN_TOKEN?.trim() || '', provided = header?.trim() || '';
  const a = Buffer.from(configured), b = Buffer.from(provided);
  return a.length > 0 && a.length === b.length && timingSafeEqual(a,b);
}

/** Explicit auth here as well as the parent app's admin middleware. */
export function registerEveryviewDisneyPublicationRoutes(app: Hono, gbuts: GbutsOttRuntimeDependencies,
  runtime = everyviewDisneyPublicationRuntime, isOwner = isAioDashboardMainProcess): void {
  app.post('/everyview/disney/publish', async c => {
    c.header('Cache-Control','no-store');
    const bearer = c.req.header('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!authorized(bearer || c.req.header('x-admin-token'))) return c.json({ ok:false, error:'forbidden' },403);
    if (!everyviewDisneyPublicationAllowed()) return c.json({ ok:false, state:'held', reason:'PAUSED' },423);
    if (!isOwner()) return c.json({ ok:false, state:'held', reason:'AIO_MAIN_PROCESS_REQUIRED' },423);
    if (Number(c.req.header('content-length') || 0) > 4096) return c.json({ ok:false, error:'REQUEST_INVALID' },400);
    const raw = await c.req.text();
    if (Buffer.byteLength(raw,'utf8') > 4096) return c.json({ ok:false, error:'REQUEST_INVALID' },400);
    let body: any;
    try { body=JSON.parse(raw); } catch { return c.json({ ok:false, error:'REQUEST_INVALID' },400); }
    if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.accountEmail !== 'string'
      || typeof body.accountEndDate !== 'string' || typeof body.title !== 'string' || typeof body.description !== 'string'
      || body.profileNumber !== 6) return c.json({ ok:false, error:'REQUEST_INVALID' },400);
    const request: EveryviewDisneyPublishRequest = { accountEmail:body.accountEmail, accountEndDate:body.accountEndDate,
      title:body.title, description:body.description, profileNumber:6 };
    try {
      const result = await publishEveryviewDisneySeat(request,runtime(request,gbuts));
      if (result.state === 'confirmed') {
        const ready = await everyviewDisneyPublicationReadiness(request,gbuts);
        if (!ready.syncReady || !ready.cutoffReady || !ready.profileDeliveryReady)
          return c.json({ ok:false,state:'held',reason:'MONITOR_HANDOFF_PENDING',partyId:result.partyId },409);
        return c.json({ ok:true,state:'confirmed',partyId:result.partyId });
      }
      const readiness=await inspectDisneyPublicationReadiness(request,disneyReadinessRuntimeDependencies(gbuts));
      return c.json({ ok:false,state:'held',reason:result.reason,diagnostics:readiness.diagnostics },409);
    } catch { return c.json({ ok:false,state:'held',reason:'PUBLICATION_UNAVAILABLE' },503); }
  });
}
