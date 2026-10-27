import { readFileSync, mkdirSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadGbutsSession } from '../src/lib/gbuts-session';
import { createGbutsOttSellerClient } from '../src/lib/gbuts-ott-client';
import { readYouTubeRenewals } from '../src/scheduler/gbuts-youtube-renewal';
import { collectFamilyOrders, runFamilyInvites, validateFamilyJournal, type FamilyJournal } from '../src/monitoring/gbuts-google-invites';
import { googleCookieImport, googleFamilyDriver, withSteelFamilyBrowser } from '../src/monitoring/google-family-steel';

const root = process.env.GBUTS_GOOGLE_INVITE_ROOT;
if (!root || !root.startsWith('/')) throw Error('INVITE_ROOT_REQUIRED');
const journalPath = `${root}/state.json`, cookiePath = `${root}/cookies.json`, statusPath = `${root}/status.json`;
function durable(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.tmp`, fd = openSync(tmp, 'wx', 0o600);
  try { writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fsyncSync(fd); } finally { closeSync(fd); }
  try { renameSync(tmp, path); chmodSync(path, 0o600); const dir = openSync(dirname(path), 'r'); try { fsyncSync(dir); } finally { closeSync(dir); } }
  catch (e) { try { unlinkSync(tmp); } catch {} throw e; }
}
function allowed(): boolean {
  try {
    if (!validateFamilyJournal(JSON.parse(readFileSync(journalPath, 'utf8'))).enabled) return false;
    const pid = execFileSync('/usr/bin/systemctl', ['show', 'aio-dashboard', '-p', 'MainPID', '--value'], { encoding: 'utf8', timeout: 5000 }).trim();
    if (!/^\d+$/.test(pid) || Number(pid) < 1) return false;
    const env = Object.fromEntries(readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0').filter(x => x.includes('=')).map(x => [x.slice(0, x.indexOf('=')), x.slice(x.indexOf('=') + 1)]));
    if (env.GBUTS_OTT_SYNC_ENABLED !== 'true') return false;
    const p = env.SAFE_MODE_PATH || '/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data/safe-mode.json';
    return JSON.parse(readFileSync(p, 'utf8')).enabled === false;
  } catch { return false; }
}
const checkedAt = new Date().toISOString();
try {
  const j: FamilyJournal = validateFamilyJournal(JSON.parse(readFileSync(journalPath, 'utf8')));
  const session = loadGbutsSession();
  if (!session) throw Error('GBUTS_SESSION_REQUIRED');
  const scan = () => collectFamilyOrders(createGbutsOttSellerClient(session.token), readYouTubeRenewals());
  const orders = allowed() && j.enabled ? await scan() : [];
  const needsBrowser = process.argv.includes('--check-google') || Object.values(j.orders).some(x => x.state === 'attempted') || orders.some(x => x.conflict || x.email && (!j.orders[x.key] || j.orders[x.key].email !== x.email));
  const deps = { journal: j, save: (value: FamilyJournal) => durable(journalPath, value), allowed, scan, checkOnly: process.argv.includes('--check-google') };
  const result = needsBrowser && allowed() && j.enabled
    ? await withSteelFamilyBrowser(googleCookieImport(JSON.parse(readFileSync(cookiePath, 'utf8'))), async browser => {
      const page = await browser.newPage(); await page.emulateTimezone('Asia/Seoul');
      return runFamilyInvites({ ...deps, driver: googleFamilyDriver(page) });
    }, cookies => durable(cookiePath, cookies))
    : await runFamilyInvites({ ...deps, driver: { inspect: async () => { throw Error('BROWSER_REQUIRED'); }, invite: async () => { throw Error('BROWSER_REQUIRED'); } } });
  const prior = (() => { try { return JSON.parse(readFileSync(statusPath, 'utf8')); } catch { return {}; } })();
  durable(statusPath, { ...result, checkedAt, completedAt: new Date().toISOString(), lastError: null, consecutiveErrors: 0,
    lastInviteAt: result.sent ? new Date().toISOString() : prior.lastInviteAt || null,
    lastGoogleCheckAt: result.state === 'checked' || result.sent || result.adopted ? new Date().toISOString() : prior.lastGoogleCheckAt || null });
  console.log(JSON.stringify({ event: 'GbutsGoogleInvites', ...result }));
} catch (e) {
  const code = e instanceof Error && /^[A-Z][A-Z0-9_]{3,80}$/.test(e.message) ? e.message : 'INVITE_RUN_FAILED';
  const prior = (() => { try { return JSON.parse(readFileSync(statusPath, 'utf8')); } catch { return {}; } })();
  durable(statusPath, { ...prior, checkedAt, completedAt: new Date().toISOString(), state: 'error', lastError: code, consecutiveErrors: Number(prior.consecutiveErrors || 0) + 1 });
  console.log(JSON.stringify({ event: 'GbutsGoogleInvites', state: 'error', code })); process.exitCode = 1;
}
