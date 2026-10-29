import { afterEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadEveryviewCookieHeader } from '../src/lib/everyview-api';
import { everyviewDisneyCutoffRuntimeDependencies, readEveryviewDisneyCutoffConfig, readEveryviewDisneyCutoffJournal,
  runEveryviewDisneyCutoff, startEveryviewDisneyCutoffFromEnv } from '../src/scheduler/everyview-disney-cutoff';

const dirs: string[] = [];
const temp = () => { const dir = mkdtempSync(join(tmpdir(), 'ev-cutoff-'));dirs.push(dir);return dir; };
const privateFile = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value), { mode: 0o600 });
afterEach(() => { vi.useRealTimers();vi.unstubAllEnvs();for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe('Everyview Disney cutoff runtime', () => {
  it('does not construct or schedule the worker unless explicitly enabled', () => {
    vi.stubEnv('EVERYVIEW_DISNEY_CUTOFF_ENABLED', '');
    const factory = vi.fn(everyviewDisneyCutoffRuntimeDependencies);
    expect(startEveryviewDisneyCutoffFromEnv(factory)).toBeUndefined();expect(factory).not.toHaveBeenCalled();
    vi.stubEnv('EVERYVIEW_DISNEY_CUTOFF_ENABLED', 'true');vi.useFakeTimers();
    const stop = startEveryviewDisneyCutoffFromEnv(factory);
    expect(factory).toHaveBeenCalledOnce();expect(stop).toBeTypeOf('function');stop?.();
  });
  it('requires owner-only permissions for configuration and durable journal', () => {
    const dir = temp(), conf = join(dir, 'config.json'), journal = join(dir, 'journal.json');
    vi.stubEnv('EVERYVIEW_DISNEY_CUTOFF_CONFIG_PATH', conf);vi.stubEnv('EVERYVIEW_DISNEY_CUTOFF_JOURNAL_PATH', journal);
    expect(readEveryviewDisneyCutoffConfig()).toBeNull();
    expect(readEveryviewDisneyCutoffJournal()).toEqual({ version: 1, parties: {} });
    privateFile(conf, { version: 1, enabled: false, parties: [] });
    expect(readEveryviewDisneyCutoffConfig()).toMatchObject({ enabled: false });
    chmodSync(conf, 0o644);expect(() => readEveryviewDisneyCutoffConfig()).toThrow('PRIVATE_FILE_REQUIRED');
    chmodSync(conf, 0o600);
    const deps = everyviewDisneyCutoffRuntimeDependencies();deps.write({ version: 1, parties: {} });
    expect(statSync(journal).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(journal, 'utf8'))).toEqual({ version: 1, parties: {} });
    chmodSync(journal, 0o644);expect(() => readEveryviewDisneyCutoffJournal()).toThrow('PRIVATE_FILE_REQUIRED');
  });
  it('wires the existing session loader and fails closed when safety state is invalid', async () => {
    const dir = temp(), conf = join(dir, 'config.json'), safePath = join(dir, 'safe.json');
    privateFile(conf, { version: 1, enabled: true, parties: [] });
    vi.stubEnv('EVERYVIEW_DISNEY_CUTOFF_ENABLED', 'true');vi.stubEnv('EVERYVIEW_DISNEY_CUTOFF_CONFIG_PATH', conf);
    vi.stubEnv('EVERYVIEW_DISNEY_CUTOFF_JOURNAL_PATH', join(dir, 'journal.json'));vi.stubEnv('SAFE_MODE_PATH', safePath);
    const deps = everyviewDisneyCutoffRuntimeDependencies();expect(deps.cookie).toBe(loadEveryviewCookieHeader);
    deps.alert = vi.fn(async () => undefined);deps.sessionValid = vi.fn(async () => true);
    privateFile(safePath, { enabled: true });expect(await runEveryviewDisneyCutoff(deps)).toBe('paused');
    expect(deps.sessionValid).not.toHaveBeenCalled();expect(deps.alert).not.toHaveBeenCalled();
    writeFileSync(safePath, '{');expect(await runEveryviewDisneyCutoff(deps)).toBe('error');
    expect(deps.alert).toHaveBeenCalledWith('CONFIG_OR_JOURNAL_INVALID');expect(deps.sessionValid).not.toHaveBeenCalled();
    privateFile(safePath, { enabled: false });deps.cookie = () => null;
    expect(await runEveryviewDisneyCutoff(deps)).toBe('error');expect(deps.alert).toHaveBeenCalledWith('SESSION_REQUIRED');
  });
  it('forces a fresh account-expiry read and isolates incomplete accounts', async () => {
    const management=vi.fn(async()=>({services:[{serviceType:'디즈니플러스',accounts:[
      {email:'a@example.com',serviceType:'디즈니플러스',members:[],totalSlots:6,expiryDate:'2027-01-24'},
      {email:'b@example.com',serviceType:'디즈니플러스',members:[],totalSlots:6,expiryDate:null},
    ]}],onSaleByKeepAcct:{}}));
    const deps=everyviewDisneyCutoffRuntimeDependencies(management);
    expect(await deps.accountExpiries()).toEqual({'a@example.com':'2027-01-24','b@example.com':''});
    expect(management).toHaveBeenCalledWith({forceRefresh:true});
  });
});
