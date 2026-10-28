import { createHash } from 'node:crypto';
import { LinkidClient, LinkidError, linkidTime, type LinkidSnapshot } from '../lib/linkid-client';
import { readLinkidStore, writeLinkidStore, withLinkidLock, type LinkidAccount, type LinkidEvent, type LinkidStore } from '../lib/linkid-store';
import { sendSellerAlert, type SellerAlertInput, type SellerAlertResult } from '../alerts/telegram';
import { sendChatContentAlert, splitTelegramChatText } from '../alerts/chat-content';

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
      title: '새 1:1 채팅 메시지', partyId: room.partyId, date: message.date,
      message: splitTelegramChatText(message.text).join(''), buyerName: room.name });
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
    const actionUrl = `https://email-verify.one/dashboard/linkid?account=${encodeURIComponent(account.id)}&profile=${event.profileIndex}`;
    const context = [`로그인 계정: ${account.label.slice(0, 80)}`, `프로필 ${event.profileIndex}: ${profile?.name.slice(0, 80) || '확인 필요'}`,
      event.partyId ? `파티: ${event.partyId}` : '', `시간: ${new Date(linkidTime(event.date)).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`];
    let result: SellerAlertResult;
    if (event.kind === 'chat') {
      if (!event.message) {
        const match = event.key.match(/:chat:(\d+):(\d+)$/);
        const room = account.snapshots[String(event.profileIndex)]?.rooms.find(r => r.id === Number(match?.[1]));
        const message = room?.messages.find(m => m.id === Number(match?.[2]) && m.writer > 0 && m.writer !== profile?.uid);
        if (!message?.text) continue; // Keep legacy events pending until their text can be read.
        event.message = splitTelegramChatText(message.text).join(''); event.buyerName = room?.name; deps.write(store);
      }
      result = await sendChatContentAlert({ provider: 'linkid', key, attention: 'action-required', nextAction: '이 구매자 채팅을 열어 직접 답변해주세요. 링키드 문의는 자동 답변하지 않습니다.', title: `링키드 · ${event.title}`, body: [...context,
        `구매자: ${(event.buyerName || '파티 채팅').slice(0, 80)}`].join('\n'), message: event.message,
        actionUrl, category: 'inquiry', throttleMs: 365 * 86400000 }, deps.alert);
    } else result = await deps.alert({ provider: 'linkid', key,
      attention: /초대 요청|채팅 확인 요청/.test(event.title) ? 'action-required' : 'notice',
      nextAction: /초대 요청/.test(event.title) ? '해당 파티에서 초대 요청과 이미 처리한 내역을 대조하고 필요한 초대를 직접 진행해주세요.'
        : /채팅 확인 요청/.test(event.title) ? '해당 구매자 채팅을 열어 직접 확인해주세요. 링키드 문의는 자동 답변하지 않습니다.'
        : '즉시 조치 요청 없음 · 링키드에서 발생한 상태 알림입니다. 처리 완료 여부는 원본 화면에서 확인할 수 있습니다.',
      title: `링키드 · ${event.title}`,
      category: /가입|파티원|매칭|구매/.test(event.title) ? 'purchase' : 'system',
      body: [...context, '링키드에 새 알림이 도착했습니다.', actionUrl].join('\n'), actionUrl, throttleMs: 365 * 86400000 });
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
          const pendingFloor = account.pending.filter(e => e.kind === 'chat' && !e.message && e.profileIndex === profile.index)
            .reduce((floor, e) => Math.min(floor, linkidTime(e.date) - 1000), Infinity);
          const snapshot = await deps.client.snapshot(account.credentials.sid, profile,
            Math.max(Date.parse(account.connectedAt), Math.min(Date.parse(account.lastScanStartedAt || account.connectedAt) - 120000, pendingFloor)));
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
        delete account.firstFailureAt; delete account.consecutiveFailures;
      } else account.lastError = '일부 프로필 조회가 지연되고 있습니다. 마지막 확인 정보를 표시합니다.';
    } catch (e) {
      const failedAt = deps.now();
      account.firstFailureAt ||= new Date(failedAt).toISOString();
      account.consecutiveFailures = (account.consecutiveFailures || 0) + 1;
      account.lastError = e instanceof LinkidError ? e.message : '링키드 연결을 확인하지 못했습니다.';
      account.retryAfter = failedAt + (e instanceof LinkidError && e.kind === 'rate' ? 5 * 60000 : 90000);
      const sustained = account.consecutiveFailures >= 3 && failedAt - Date.parse(account.firstFailureAt) >= 15 * 60000;
      if ((e instanceof LinkidError && e.kind === 'auth') || sustained) {
        await deps.alert({ provider: 'linkid', key: `linkid-connection-${account.id}`, category: 'system', attention: 'action-required', nextAction: '링키드 대시보드에서 해당 로그인 계정을 다시 연결해주세요.', automationStatus: '이 계정의 조회가 중단되어 새 요청을 놓칠 수 있습니다.', title: '링키드 연결 확인 필요',
          body: `${account.label}\n${account.lastError}\nhttps://email-verify.one/dashboard/linkid`, throttleMs: 60 * 60000 });
      }
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
  const first = setTimeout(run, 3000); const interval = setInterval(run, 180000);
  first.unref(); interval.unref(); return () => { clearTimeout(first); clearInterval(interval); };
}
