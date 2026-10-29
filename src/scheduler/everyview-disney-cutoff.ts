import { existsSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { sendSellerAlert } from '../alerts/telegram';
import { checkEveryviewSession, fetchEveryviewHostParties, fetchEveryviewPartyDetail, loadEveryviewCookieHeader } from '../lib/everyview-api';
import { writeJsonAtomic } from '../lib/graytag-sales-session';
import { everyviewRollingCutoff, hideEveryviewRecruitment, readEveryviewRecruitmentVisibility, type EveryviewHideResult } from '../lib/everyview-recruitment-safety';
import { ottDate, type GbutsOttManagement } from '../lib/gbuts-ott';
import { markDisneyWorker } from '../lib/everyview-disney-worker-health';

export type EveryviewDisneyCutoffParty = { partyId: number; accountEmail: string; accountEndDate: string; usageDays: number; enabled: boolean };
export interface EveryviewDisneyCutoffConfig { version: 1; enabled: boolean; parties: EveryviewDisneyCutoffParty[] }
export interface EveryviewDisneyCutoffRecord {
  accountHash: string; state: 'attempted' | 'confirmed'; attemptedAt: string; confirmedAt?: string;
  error?: 'VISIBILITY_UNCONFIRMED';
}
export interface EveryviewDisneyCutoffJournal { version: 1; parties: Record<string, EveryviewDisneyCutoffRecord> }
export interface EveryviewDisneyCutoffDeps {
  config(): EveryviewDisneyCutoffConfig | null;
  read(): EveryviewDisneyCutoffJournal;
  write(journal: EveryviewDisneyCutoffJournal): void;
  cookie(): string | null;
  safeToRun(): boolean;
  sessionValid(cookie: string): Promise<boolean>;
  accountExpiries(): Promise<Record<string, string>>;
  verifyBinding(cookie: string, party: EveryviewDisneyCutoffParty): Promise<boolean>;
  visibility(cookie: string, partyId: number): Promise<boolean>;
  hide(cookie: string, partyId: number, maySubmit: () => boolean): Promise<EveryviewHideResult>;
  alert(code: string, partyId?: number): Promise<unknown>;
  now(): Date;
}
const configPath = () => process.env.EVERYVIEW_DISNEY_CUTOFF_CONFIG_PATH || '/home/ubuntu/.config/gbuts/everyview-disney-cutoff.json';
const journalPath = () => process.env.EVERYVIEW_DISNEY_CUTOFF_JOURNAL_PATH || '/home/ubuntu/.config/gbuts/everyview-disney-cutoff-journal.json';
const hashAccount = (email: string) => createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
const validParty = (p: EveryviewDisneyCutoffParty) => p && Number.isSafeInteger(p.partyId) && p.partyId > 0
  && typeof p.accountEmail === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.accountEmail)
  && typeof p.accountEndDate === 'string' && typeof p.enabled === 'boolean';
function privateJson(path: string): unknown {
  if (statSync(path).mode & 0o077) throw Error('PRIVATE_FILE_REQUIRED');
  return JSON.parse(readFileSync(path, 'utf8'));
}
function cutoffSafeToRun(): boolean {
  if (process.env.EVERYVIEW_DISNEY_CUTOFF_ENABLED !== 'true') return false;
  const path = process.env.SAFE_MODE_PATH || '/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data/safe-mode.json';
  if (!existsSync(path)) return true; // Same absent-file default as the existing safety configuration.
  const config = JSON.parse(readFileSync(path, 'utf8')) as { enabled?: unknown };
  if (!config || typeof config.enabled !== 'boolean') throw Error('SAFE_MODE_INVALID');
  return !config.enabled;
}
export function readEveryviewDisneyCutoffConfig(): EveryviewDisneyCutoffConfig | null {
  const path = configPath(); if (!existsSync(path)) return null;
  const c = privateJson(path) as EveryviewDisneyCutoffConfig;
  if (!c || c.version !== 1 || typeof c.enabled !== 'boolean' || !Array.isArray(c.parties)
    || !c.parties.every(validParty) || new Set(c.parties.map(p => p.partyId)).size !== c.parties.length)
    throw Error('CUTOFF_CONFIG_INVALID');
  return c;
}
export function readEveryviewDisneyCutoffJournal(): EveryviewDisneyCutoffJournal {
  const path = journalPath(); if (!existsSync(path)) return { version: 1, parties: {} };
  const j = privateJson(path) as EveryviewDisneyCutoffJournal;
  if (!j || j.version !== 1 || !j.parties || typeof j.parties !== 'object' || Array.isArray(j.parties)
    || Object.entries(j.parties).some(([id,r]) => !/^[1-9]\d*$/.test(id) || !r || !/^[a-f0-9]{64}$/.test(r.accountHash)
      || !['attempted','confirmed'].includes(r.state) || !Number.isFinite(Date.parse(r.attemptedAt))
      || (r.state === 'confirmed' && !Number.isFinite(Date.parse(r.confirmedAt || ''))))) throw Error('CUTOFF_JOURNAL_INVALID');
  return j;
}

async function verifyPartyBinding(cookie: string, party: EveryviewDisneyCutoffParty): Promise<boolean> {
  const owned = (await fetchEveryviewHostParties(cookie)).filter(p => p.partyType === 'free' && p.partyId === party.partyId);
  if (owned.length !== 1) return false;
  const detail = await fetchEveryviewPartyDetail(cookie, party.partyId);
  return !!detail.hostName && !!detail.serviceName && /디즈니|disney/i.test(detail.serviceName)
    && detail.loginInfo.length === 1 && detail.loginInfo[0].shareType === 'ACCOUNT'
    && detail.loginInfo[0].accountId?.trim().toLowerCase() === party.accountEmail.trim().toLowerCase();
}
export function everyviewDisneyCutoffRuntimeDependencies(management?: (options?: { forceRefresh: boolean }) => Promise<GbutsOttManagement>): EveryviewDisneyCutoffDeps {
  return { config: readEveryviewDisneyCutoffConfig, read: readEveryviewDisneyCutoffJournal,
    write: value => writeJsonAtomic(journalPath(), value), cookie: loadEveryviewCookieHeader,
    safeToRun: cutoffSafeToRun,
    sessionValid: async cookie => (await checkEveryviewSession(cookie)).valid,
    accountExpiries: async () => {
      if (!management) throw Error('EXPIRY_SOURCE_UNAVAILABLE');
      const snapshot = await management({ forceRefresh: true }), result: Record<string, string> = {};
      if (!Array.isArray(snapshot.services)) throw Error('EXPIRY_SOURCE_UNAVAILABLE');
      for (const service of snapshot.services) if (service.serviceType === '디즈니플러스') {
        if (!Array.isArray(service.accounts)) throw Error('EXPIRY_SOURCE_UNAVAILABLE');
        for (const account of service.accounts) {
          const key = account.email?.trim().toLowerCase(), date = ottDate(account.expiryDate);
          if (!key) continue;
          // Missing or duplicate account data blocks only that mapped account.
          result[key] = Object.prototype.hasOwnProperty.call(result, key) ? '' : date;
        }
      }
      return result;
    },
    verifyBinding: verifyPartyBinding, visibility: readEveryviewRecruitmentVisibility, hide: hideEveryviewRecruitment,
    alert: (code, partyId) => sendSellerAlert({ category: 'system', attention: 'action-required',
      key: `everyview-disney-cutoff:${partyId || 'global'}:${code}`, title: '에브리뷰 디즈니 모집 종료 확인 필요',
      body: code === 'EXPIRY_UNAVAILABLE'
        ? '계정의 최신 유효기간을 확인하지 못해 모집이 계속 노출될 위험이 있습니다. 에브리뷰에서 모집 상태를 직접 확인해주세요.'
        : '계정 이용기간과 모집 종료 상태를 확인하지 못했습니다. 구매자의 기존 이용 및 채팅은 변경하지 않았습니다.',
      nextAction: '에브리뷰 세션과 해당 파티의 모집 노출 상태를 확인해주세요.',
      ...(partyId ? { actionUrl: `https://everyview.kr/partyLeader_free_detail_type1?id=${partyId}` } : {}),
      throttleMs: 30 * 60_000 }), now: () => new Date() };
}

/** Never resubmit an unconfirmed write; later cycles only read back its outcome. */
export async function runEveryviewDisneyCutoff(deps: EveryviewDisneyCutoffDeps): Promise<'paused'|'checked'|'error'> {
  let config: EveryviewDisneyCutoffConfig | null;
  let journal: EveryviewDisneyCutoffJournal;
  try { config = deps.config(); if (!config?.enabled || !deps.safeToRun()) return 'paused'; journal = deps.read(); }
  catch { await deps.alert('CONFIG_OR_JOURNAL_INVALID').catch(() => undefined); return 'error'; }
  const initial = JSON.stringify(config), cookie = deps.cookie();
  const allowed = () => deps.safeToRun() && JSON.stringify(deps.config()) === initial;
  if (!cookie || !await deps.sessionValid(cookie).catch(() => false)) {
    await deps.alert('SESSION_REQUIRED').catch(() => undefined); return 'error';
  }
  let expiries: Record<string, string> | undefined;
  try { expiries = await deps.accountExpiries(); } catch { /* Every enabled party fails closed below. */ }
  let failed = false;
  for (const party of config.parties.filter(x => x.enabled)) {
    try {
      if (!allowed()) return 'paused';
      const record = journal.parties[String(party.partyId)];
      if (record && record.accountHash !== hashAccount(party.accountEmail)) throw Error('BINDING_CHANGED');
      if (!await deps.verifyBinding(cookie, party)) throw Error('BINDING_UNVERIFIED');
      const configuredCutoff = everyviewRollingCutoff(party.accountEndDate, party.usageDays, deps.now());
      const liveEnd = expiries?.[party.accountEmail.trim().toLowerCase()];
      const liveCutoff = liveEnd ? everyviewRollingCutoff(liveEnd, party.usageDays, deps.now()) : null;
      const unavailable = !liveCutoff || liveCutoff.state === 'blocked';
      if (unavailable) { failed = true; await deps.alert('EXPIRY_UNAVAILABLE', party.partyId).catch(() => undefined); }
      const effectiveEnd = configuredCutoff.state !== 'blocked' && !unavailable && liveEnd! < party.accountEndDate ? liveEnd! : party.accountEndDate;
      const cutoff = configuredCutoff.state === 'blocked' ? configuredCutoff : everyviewRollingCutoff(effectiveEnd, party.usageDays, deps.now());
      // An invalid term or end date is a risk: close the verified party and alert.
      const invalid = unavailable || cutoff.state === 'blocked';
      if (cutoff.state === 'blocked') { failed = true; await deps.alert('CUTOFF_INVALID', party.partyId).catch(() => undefined); }
      if (!invalid && cutoff.state === 'open' && !record) continue;
      const visible = await deps.visibility(cookie, party.partyId);
      if (!visible) {
        if (record?.state === 'attempted') { record.state = 'confirmed'; record.confirmedAt = deps.now().toISOString(); delete record.error; deps.write(journal); }
        continue;
      }
      if (record?.state === 'attempted') throw Error('VISIBILITY_UNCONFIRMED');
      if (!allowed()) return 'paused';
      journal.parties[String(party.partyId)] = { accountHash: hashAccount(party.accountEmail), state: 'attempted', attemptedAt: deps.now().toISOString() };
      deps.write(journal); // Must be durable before any external mutation.
      const result = await deps.hide(cookie, party.partyId, allowed);
      if (!result.ok || !result.verified || result.visible !== false) throw Error('VISIBILITY_UNCONFIRMED');
      journal.parties[String(party.partyId)].state = 'confirmed';
      journal.parties[String(party.partyId)].confirmedAt = deps.now().toISOString();
      delete journal.parties[String(party.partyId)].error; deps.write(journal);
    } catch {
      failed = true;
      const record = journal.parties[String(party.partyId)];
      if (record?.state === 'attempted') { record.error = 'VISIBILITY_UNCONFIRMED'; deps.write(journal); }
      await deps.alert('CUTOFF_CHECK_FAILED', party.partyId).catch(() => undefined);
    }
  }
  return failed ? 'error' : 'checked';
}

export function startEveryviewDisneyCutoff(deps: EveryviewDisneyCutoffDeps, intervalMs = 60_000) {
  let active = false,stopped=false;markDisneyWorker('cutoff','starting');
  const run = () => { if (active) return; active = true;
    void runEveryviewDisneyCutoff(deps).then(state=>{if(!stopped)markDisneyWorker('cutoff',state);})
      .catch(() => {if(!stopped)markDisneyWorker('cutoff','error');return deps.alert('WORKER_FAILED').catch(() => undefined);}).finally(() => { active = false; }); };
  const first = setTimeout(run, 5_000), timer = setInterval(run, intervalMs); first.unref(); timer.unref();
  return () => { stopped=true;clearTimeout(first); clearInterval(timer); markDisneyWorker('cutoff','stopped'); };
}

/** Server startup is opt-in; disabled by default and never enables a configured party implicitly. */
export function startEveryviewDisneyCutoffFromEnv(depsFactory = everyviewDisneyCutoffRuntimeDependencies) {
  if (process.env.EVERYVIEW_DISNEY_CUTOFF_ENABLED !== 'true') return undefined;
  return startEveryviewDisneyCutoff(depsFactory());
}
