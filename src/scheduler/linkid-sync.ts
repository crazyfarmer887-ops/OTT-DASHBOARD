import { createHash } from 'node:crypto';
import { LinkidClient, LinkidError, linkidTime, type LinkidSnapshot } from '../lib/linkid-client';
import { readLinkidStore, writeLinkidStore, withLinkidLock, type LinkidAccount, type LinkidEvent, type LinkidStore } from '../lib/linkid-store';
import { sendSellerAlert, type SellerAlertInput, type SellerAlertResult } from '../alerts/telegram';

export function collectLinkidEvents(account: LinkidAccount, snapshot: LinkidSnapshot): void {
  const index = snapshot.profile.index; const floor = Date.parse(account.connectedAt);
  const pendingKeys = new Set(account.pending.map(x => x.key));
  const add = (event: LinkidEvent) => {
    if (account.seen[event.key] || pendingKeys.has(event.key)) return;
    const timestamp = linkidTime(event.date);
    if (!Number.isFinite(timestamp)) throw new LinkidError('알림 또는 채팅의 발송 시각을 확인하지 못했습니다.', 'schema');
    if (timestamp < floor) { account.seen[event.key] = snapshot.updatedAt; return; }
    account.pending.push(event); pendingKeys.add(event.key);
  };
  const hasIncomingChats = snapshot.rooms.some(room => room.messages.some(x => x.writer > 0 && x.writer !== snapshot.profile.uid && linkidTime(x.date) >= floor));
  for (const notice of snapshot.notices) {
    const key = `${account.id}:${index}:notice:${notice.id}`;
    if (hasIncomingChats && /채팅|메시지/.test(notice.title)) { account.seen[key] = snapshot.updatedAt; continue; }
    add({ key, kind: 'notice', profileIndex: index, title: notice.title, partyId: notice.partyId, date: notice.date });
  }
  for (const room of snapshot.rooms) for (const message of room.messages) {
    if (message.writer <= 0 || message.writer === snapshot.profile.uid) continue;
    add({ key: `${account.id}:${index}:chat:${room.id}:${message.id}`, kind: 'chat', profileIndex: index,
      title: '새 1:1 채팅 메시지', partyId: room.partyId, date: message.date });
  }
}
export type LinkidSyncDependencies = {
  client: Pick<LinkidClient, 'auth' | 'login' | 'profiles' | 'snapshot'>;
  read(): LinkidStore; write(store: LinkidStore): void;
  alert(input: SellerAlertInput): Promise<SellerAlertResult>;
  now(): number;
};
export const linkidRuntime: LinkidSyncDependencies = {
  client: new LinkidClient(), read: readLinkidStore, write: writeLinkidStore, alert: sendSellerAlert, now: Date.now,
};
async function deliverPending(store: LinkidStore, account: LinkidAccount, deps: LinkidSyncDependencies) {
  for (const event of [...account.pending]) {
    const profile = account.profiles.find(x => x.index === event.profileIndex);
    const key = `linkid-${createHash('sha256').update(event.key).digest('hex').slice(0, 40)}`;
    const result = await deps.alert({ key, title: `링키드 · ${event.title}`, category: event.kind === 'chat' ? 'inquiry' : /가입|파티원|매칭|구매/.test(event.title) ? 'purchase' : 'system',
      body: [`로그인 계정: ${account.label}`, `프로필 ${event.profileIndex}: ${profile?.name || '확인 필요'}`,
        event.partyId ? `파티: ${event.partyId}` : '', event.date,
        event.kind === 'chat' ? '새 메시지가 도착했습니다. 내용은 대시보드에서 확인해주세요.' : '링키드에 새 알림이 도착했습니다.',
        `https://email-verify.one/dashboard/linkid?account=${encodeURIComponent(account.id)}&profile=${event.profileIndex}`].filter(Boolean).join('\n'),
      throttleMs: 365 * 24 * 60 * 60 * 1000 });
    if (result.sent || result.reason === 'throttled') {
      account.seen[event.key] = new Date(deps.now()).toISOString(); account.pending = account.pending.filter(x => x.key !== event.key); deps.write(store);
    } else return false;
  }
  return true;
}
export async function syncLinkid(deps: LinkidSyncDependencies = linkidRuntime, onlyAccount?: string): Promise<void> {
  const store = deps.read();
  for (const account of store.accounts.filter(x => x.enabled && (!onlyAccount || x.id === onlyAccount))) {
    if ((account.retryAfter || 0) > deps.now()) continue;
    // Saved pending events can be delivered even when the provider is temporarily unavailable.
    const canSend = await deliverPending(store, account, deps);
    const startedAt = new Date(deps.now()).toISOString(); let allSucceeded = true;
    try {
      try { await deps.client.auth(account.credentials.sid); }
      catch (e) {
        if (!(e instanceof LinkidError) || e.kind !== 'auth') throw e;
        account.credentials.sid = await deps.client.login(account.credentials.provider, account.credentials.providerId);
        deps.write(store);
      }
      const profiles = await deps.client.profiles(account.credentials.sid);
      const primary = account.profiles.find(x => x.index === 1);
      if (!primary || profiles.find(x => x.index === 1)?.uid !== primary.uid) throw new LinkidError('로그인 계정이 일치하지 않아 자동 감시를 중단했습니다.', 'auth');
      account.profiles = profiles; account.profileErrors = {};
      for (const profile of profiles) {
        try {
          const snapshot = await deps.client.snapshot(account.credentials.sid, profile,
            Math.max(Date.parse(account.connectedAt), Date.parse(account.lastScanStartedAt || account.connectedAt) - 120000));
          collectLinkidEvents(account, snapshot);
          account.snapshots[String(profile.index)] = snapshot; deps.write(store);
        } catch (e) {
          allSucceeded = false;
          account.profileErrors[String(profile.index)] = e instanceof LinkidError ? e.message : '프로필을 조회하지 못했습니다. 다음 조회에서 다시 확인합니다.';
          if (e instanceof LinkidError && e.kind === 'rate') throw e;
        }
      }
      if (canSend) await deliverPending(store, account, deps);
      if (allSucceeded) {
        account.lastScanStartedAt = startedAt; account.lastSuccess = new Date(deps.now()).toISOString(); delete account.lastError; delete account.retryAfter;
      } else account.lastError = '일부 프로필 조회가 지연되고 있습니다. 마지막 확인 정보를 표시합니다.';
    } catch (e) {
      account.lastError = e instanceof LinkidError ? e.message : '링키드 연결을 확인하지 못했습니다.';
      account.retryAfter = deps.now() + (e instanceof LinkidError && e.kind === 'rate' ? 5 * 60000 : 90000);
      await deps.alert({ key: `linkid-connection-${account.id}`, category: 'system', title: '링키드 연결 확인 필요',
        body: `${account.label}\n${account.lastError}\nhttps://email-verify.one/dashboard/linkid`, throttleMs: 60 * 60000 });
    }
    deps.write(store);
  }
}
let running = false;
export function runLinkidSync(accountId?: string): Promise<void> {
  if (process.env.LINKID_SYNC_ENABLED === 'false') return Promise.resolve();
  return withLinkidLock(async () => { running = true; try { await syncLinkid(linkidRuntime, accountId); } finally { running = false; } });
}
export function linkidSyncRunning(): boolean { return running; }
export function startLinkidSync(): (() => void) | undefined {
  if (process.env.LINKID_SYNC_ENABLED === 'false') return;
  const run = () => { if (running) return; void runLinkidSync().catch(() => console.error('[linkid] 연결 기록 점검 필요')); };
  const first = setTimeout(run, 3000); const interval = setInterval(run, 90000);
  first.unref(); interval.unref(); return () => { clearTimeout(first); clearInterval(interval); };
}
