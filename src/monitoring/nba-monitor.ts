import { createHash, createDecipheriv } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { writeJsonAtomic } from '../lib/graytag-sales-session';
import { readLinkidStore } from '../lib/linkid-store';
import { LinkidClient } from '../lib/linkid-client';
import { sendSellerAlert, type SellerAlertInput, type SellerAlertResult } from '../alerts/telegram';
import { checkNbaLogin, type NbaLoginResult } from './nba-login';
export const NBA_CHECK_INTERVAL = 3 * 60 * 60 * 1000;
export type NbaTarget = { key: string; label: string; email: string; password: string; actionUrl: string };
type RecordState = { checkedAt: number; result: NbaLoginResult; credentialHash: string; incident: number; notifiedIncident?: number; notifiedAt?: number };
export type NbaMonitorState = { version: 1; targets: Record<string, RecordState> };
export type MonitorDependencies = {
  targets(): Promise<NbaTarget[]>; check(email: string, password: string): Promise<NbaLoginResult>;
  alert(input: SellerAlertInput): Promise<SellerAlertResult>; read(): NbaMonitorState; write(state: NbaMonitorState): void; now(): number;
};
export function decodeNbaPartyPassword(ciphertext: string, owner: number): string {
  if (!/^[a-f\d]+$/i.test(ciphertext) || ciphertext.length % 32 !== 0 || !Number.isSafeInteger(owner) || owner < 1) throw new Error('NBA_CREDENTIAL_FORMAT');
  const iv = Buffer.alloc(16); iv.write('peachgrovelinkid');
  const decipher = createDecipheriv('aes-192-cbc', Buffer.from(String(owner).padStart(24, 'f')), iv);
  const decoded = JSON.parse(Buffer.concat([decipher.update(Buffer.from(ciphertext, 'hex')), decipher.final()]).toString('utf8'));
  if (typeof decoded?.pw !== 'string' || !decoded.pw || decoded.pw.length > 512) throw new Error('NBA_CREDENTIAL_FORMAT');
  return decoded.pw;
}
/** Uses an independent Linkid session; never switches the dashboard's active session. */
export async function loadNbaTargets(): Promise<NbaTarget[]> {
  const store = readLinkidStore(); const targets: NbaTarget[] = [];
  const post = async (path: string, data: Record<string, unknown>) => {
    await new Promise(resolve => setTimeout(resolve, 2500));
    const res = await fetch(`https://linkid.pw${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'version-service': '3.0.1', origin: 'https://linkid.pw' }, body: JSON.stringify(data), signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error('NBA_SOURCE_UNAVAILABLE');
    const raw = await res.json() as any; if (raw.result !== undefined && raw.result !== 0) throw new Error('NBA_SOURCE_UNAVAILABLE'); return raw;
  };
  for (const account of store.accounts.filter(a => a.enabled)) {
    const client = new LinkidClient(); const sid = await client.login(account.credentials.provider, account.credentials.providerId);
    const profiles = await client.profiles(sid);
    if (profiles.find(p => p.index === 1)?.uid !== account.profiles.find(p => p.index === 1)?.uid) throw new Error('NBA_SOURCE_IDENTITY');
    for (const profile of profiles) {
      await client.select(sid, profile);
      const list = await post('/api/party/tri_my', { sid });
      if (!Array.isArray(list.party) || list.party.length > 100) throw new Error('NBA_SOURCE_FORMAT');
      // The list can omit service/owner fields, so inspect known NBA parties plus any explicitly marked NBA entries.
      const known = new Set(account.snapshots[String(profile.index)]?.parties.filter(p => p.owner && p.service.includes('NBA')).map(p => p.id));
      for (const entry of list.party.filter((p: any) => known.has(Number(p.partyid)) || Number(p.serv) === 2000)) {
        const raw = await post('/api/party/tri_partyinfo', { sid, partyid: entry.partyid }); const p = raw.party;
        if (!p || Number(p.partyid) !== Number(entry.partyid) || Number(p.serv) !== 2000 || Number(p.ownerid) !== profile.uid) continue;
        if (Number(p.state) !== 1 || Number(p.mystate) !== 8) continue;
        const email = typeof p.servid === 'string' ? p.servid.trim() : '';
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('NBA_CREDENTIAL_FORMAT');
        targets.push({ key: `${account.id}:${p.partyid}`, label: `${account.label} · 프로필 ${profile.index} · NBA 파티 ${p.partyid}`, email,
          password: decodeNbaPartyPassword(p.servpw, profile.uid), actionUrl: `https://email-verify.one/dashboard/linkid?account=${encodeURIComponent(account.id)}&profile=${profile.index}` });
      }
    }
  }
  if (!targets.length) throw new Error('NBA_NO_TARGETS');
  return targets;
}
const messages: Record<Exclude<NbaLoginResult, 'ok'>, string> = {
  invalid: 'NBA 로그인이 거부됐습니다. 계정 정보에 이상이 있으니 Gamsgo에서 확인 후 조치해주세요.',
  verification: 'NBA 보안 인증 또는 접속 제한으로 자동 로그인 확인이 막혔습니다. 비밀번호 오류로 확정한 상태는 아닙니다. 직접 확인 후 조치해주세요.',
  unavailable: 'NBA 접속 또는 점검 실행에 실패했습니다. 계정 오류 여부는 확인되지 않았습니다. 서버와 NBA 접속 상태를 확인해주세요.',
  unknown: 'NBA 로그인 성공 여부를 확인하지 못했습니다. 보안 인증 또는 로그인 화면 변경 여부를 확인해주세요.',
};
export async function monitorNba(deps: MonitorDependencies): Promise<void> {
  const state = deps.read(); const targets = await deps.targets(); const now = deps.now();
  const checks = new Map<string, NbaLoginResult>();
  for (const target of targets) {
    const digest = createHash('sha256').update(target.email.toLowerCase() + '\0' + target.password).digest('hex');
    let record = state.targets[target.key];
    if (!record || digest !== record.credentialHash || now - record.checkedAt >= NBA_CHECK_INTERVAL) {
      const result = checks.get(digest) || await deps.check(target.email, target.password); checks.set(digest, result);
      record = { checkedAt: now, result, credentialHash: digest, incident: record?.incident || 0,
        notifiedIncident: record?.notifiedIncident, notifiedAt: record?.notifiedAt };
      const previous = state.targets[target.key];
      if (result !== 'ok' && (!previous || previous.result === 'ok' || previous.result !== result || previous.credentialHash !== digest)) record.incident++;
      state.targets[target.key] = record; deps.write(state);
    }
    if (record.result === 'ok') continue;
    if (record.notifiedIncident === record.incident && now - (record.notifiedAt || 0) < 24 * 3600000) continue;
    const sent = await deps.alert({ provider: 'linkid', category: 'system', key: `nba-login:${target.key}:${record.incident}:${Math.floor(now / 86400000)}`,
      title: record.result === 'invalid' ? 'NBA 계정 이상 · 조치 필요' : 'NBA 로그인 점검 · 확인 필요',
      body: `${target.label}\n계정: ${target.email}\n${messages[record.result]}\n확인 시각: ${new Date(record.checkedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`,
      actionUrl: target.actionUrl, throttleMs: 24 * 3600000 });
    if (sent.sent || sent.reason === 'throttled') { record.notifiedIncident = record.incident; record.notifiedAt = now; deps.write(state); }
  }
}
export function nbaMonitorStatePath(): string { return process.env.NBA_MONITOR_STATE_PATH || '/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data/nba-login-monitor.json'; }
export function readNbaMonitorState(): NbaMonitorState {
  const path = nbaMonitorStatePath(); if (!existsSync(path)) return { version: 1, targets: {} };
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  if (raw.version !== 1 || !raw.targets || typeof raw.targets !== 'object' || Array.isArray(raw.targets) || Object.values(raw.targets).some((r: any) => !Number.isFinite(r?.checkedAt) || !['ok', 'invalid', 'verification', 'unavailable', 'unknown'].includes(r?.result) || typeof r?.credentialHash !== 'string' || !Number.isFinite(r?.incident))) throw new Error('NBA_STATE_FORMAT');
  return raw;
}
export const nbaMonitorRuntime: MonitorDependencies = { targets: loadNbaTargets, check: checkNbaLogin, alert: sendSellerAlert,
  read: readNbaMonitorState, write: state => writeJsonAtomic(nbaMonitorStatePath(), state), now: Date.now };
