import { existsSync, mkdtempSync, readFileSync, rmSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import {
  buildPollAfterUsingDealsUrl,
  buildPollDealsUrl,
  buildNewChatAlertCandidate,
  buildNewDealStatusAlerts,
  createSingleFlightRunner,
  isPollSessionAlertEnabled,
  parseGraytagMessageTime,
  persistAndSendDealAlerts,
  reserveAndSendChatAlert,
  runWithExclusivePollLock,
  saveKnownChatMessagesAtomically,
  saveKnownDealsAtomically,
} from '../src/scheduler/poll-daemon';

describe('PollDaemon Graytag deal list URL', () => {
  test('uses the finished-included selling list that matches the updated 판매내역 toggle behavior', () => {
    const url = buildPollDealsUrl();

    expect(url).toContain('/ws/lender/findBeforeUsingLenderDeals');
    expect(url).toContain('finishedDealIncluded=true');
    expect(url).not.toContain('finishedDealIncluded=false');
    expect(url).toContain('sorting=Latest');
    expect(url).toContain('page=1');
    expect(url).toContain('rows=50');
  });

  test('also polls active deals so unread Graytag chats can trigger Telegram alerts', () => {
    const url = buildPollAfterUsingDealsUrl();
    expect(url).toContain('/ws/lender/findAfterUsingLenderDeals');
    expect(url).toContain('finishedDealIncluded=false');
    expect(url).toContain('rows=50');
  });

  test('can disable only stale/missing session-cookie PollDaemon alerts by env', () => {
    expect(isPollSessionAlertEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(isPollSessionAlertEnabled({ POLL_SESSION_ALERTS_ENABLED: '0' } as NodeJS.ProcessEnv)).toBe(false);
    expect(isPollSessionAlertEnabled({ POLL_SESSION_ALERTS_ENABLED: 'false' } as NodeJS.ProcessEnv)).toBe(false);
    expect(isPollSessionAlertEnabled({ POLL_SESSION_ALERTS_ENABLED: 'off' } as NodeJS.ProcessEnv)).toBe(false);
  });

  test('builds one Telegram chat alert fingerprint per new buyer message and dedupes known messages', () => {
    const deal = {
      dealUsid: 'deal-1',
      chatRoomUuid: 'room-1',
      borrowerName: '홍길동',
      productTypeString: '넷플릭스',
      productName: '넷플릭스 3개월',
      keepAcct: 'netflix@example.com',
    };
    const message = {
      message: '<b>비밀번호</b><br>재설정 문자 왔나요?',
      registeredDateTime: '2026-05-01T12:00:00Z',
      owned: false,
      informationMessage: false,
    };

    const options = { nowMs: Date.parse('2026-05-01T12:05:00Z'), maxAgeMs: 15 * 60_000 };
    const alert = buildNewChatAlertCandidate(deal, message, {}, options);
    expect(alert).toMatchObject({
      chatRoomUuid: 'room-1',
      dealUsid: 'deal-1',
      borrowerName: '홍길동',
      productType: '넷플릭스',
      keepAcct: 'netflix@example.com',
      text: '비밀번호 재설정 문자 왔나요?',
      timestamp: '2026-05-01T12:00:00Z',
    });
    expect(buildNewChatAlertCandidate(deal, message, { [alert!.fingerprint]: alert!.timestamp }, options)).toBeNull();
  });

  test('parses Graytag dotted timestamps as Korea time and parses ISO timestamps exactly', () => {
    expect(parseGraytagMessageTime('2026.05.01 21:00')).toBe(Date.parse('2026-05-01T12:00:00.000Z'));
    expect(parseGraytagMessageTime('2026-05-01T12:00:00.000Z')).toBe(Date.parse('2026-05-01T12:00:00.000Z'));
    expect(parseGraytagMessageTime('2026.02.30 12:00')).toBeNull();
    expect(parseGraytagMessageTime('2026-02-30T12:00:00.000Z')).toBeNull();
    expect(parseGraytagMessageTime('not-a-date')).toBeNull();
  });

  test('rejects stale or timestamp-less unread buyer messages even when known state is empty', () => {
    const deal = { dealUsid: 'deal-1', chatRoomUuid: 'room-1', borrowerName: '구매자' };
    const nowMs = Date.parse('2026-05-08T12:00:00Z');

    expect(buildNewChatAlertCandidate(deal, {
      message: '일주일 전 문의',
      registeredDateTime: '2026.05.01 21:00',
    }, {}, { nowMs, maxAgeMs: 15 * 60_000 })).toBeNull();
    expect(buildNewChatAlertCandidate(deal, { message: '발생시각 없는 문의' }, {}, {
      nowMs,
      maxAgeMs: 15 * 60_000,
    })).toBeNull();
  });

  test('rejects implausibly future-dated chat and purchase events', () => {
    const nowMs = Date.parse('2026-05-08T12:00:00Z');
    expect(buildNewChatAlertCandidate(
      { dealUsid: 'future-chat', chatRoomUuid: 'future-room' },
      { message: '미래 시각 문의', registeredDateTime: '2099-01-01T00:00:00Z' },
      {},
      { nowMs, maxAgeMs: 15 * 60_000 },
    )).toBeNull();

    const { alerts, updated } = buildNewDealStatusAlerts([
      { productUsid: 'future-purchase', dealStatus: 'Delivered', borrowerName: '미래 구매자', deliveredDateTime: '2099-01-01T00:00:00Z' },
    ], {}, { nowMs, firstSeenMaxAgeMs: 30 * 60_000 });
    expect(updated['future-purchase']).toBe('Delivered');
    expect(alerts).toEqual([]);
  });

  test('uses an environment-configurable conservative chat age with a 15 minute default', () => {
    const deal = { dealUsid: 'deal-1', chatRoomUuid: 'room-1' };
    const message = { message: '새 문의', registeredDateTime: '2026-05-01T12:00:00Z' };
    const nowMs = Date.parse('2026-05-01T12:14:59Z');

    expect(buildNewChatAlertCandidate(deal, message, {}, { nowMs })).not.toBeNull();
    expect(buildNewChatAlertCandidate(deal, message, {}, {
      nowMs,
      env: { POLL_CHAT_ALERT_MAX_AGE_MS: '60000' } as NodeJS.ProcessEnv,
    })).toBeNull();
  });

  test('atomically reserves a fingerprint before sending and does not send when persistence fails', async () => {
    const known: Record<string, string> = {};
    const order: string[] = [];
    const alert = { fingerprint: 'room:time:text', timestamp: '2026-05-01T12:00:00Z' } as any;
    const send = vi.fn(async () => { order.push('send'); return { sent: true as const, reason: 'sent' as const }; });

    await expect(reserveAndSendChatAlert(alert, known, (state) => {
      expect(state[alert.fingerprint]).toBe(alert.timestamp);
      order.push('persist');
      return true;
    }, send)).resolves.toBe(true);
    expect(order).toEqual(['persist', 'send']);

    const failedSend = vi.fn(async () => ({ sent: true as const, reason: 'sent' as const }));
    await expect(reserveAndSendChatAlert({ ...alert, fingerprint: 'other' }, known, () => false, failedSend)).resolves.toBe(false);
    expect(failedSend).not.toHaveBeenCalled();
  });

  test('persists purchase state before Telegram sends and sends nothing if persistence fails', async () => {
    const order: string[] = [];
    const sends = [
      vi.fn(async () => { order.push('send-1'); return { sent: true as const, reason: 'sent' as const }; }),
      vi.fn(async () => { order.push('send-2'); return { sent: true as const, reason: 'sent' as const }; }),
    ];
    await expect(persistAndSendDealAlerts({ product: 'Delivered' }, () => {
      order.push('persist');
      return true;
    }, sends)).resolves.toBe(2);
    expect(order).toEqual(['persist', 'send-1', 'send-2']);

    const blockedSend = vi.fn(async () => ({ sent: true as const, reason: 'sent' as const }));
    await expect(persistAndSendDealAlerts({ product: 'Delivered' }, () => false, [blockedSend])).rejects.toThrow(/persist/i);
    expect(blockedSend).not.toHaveBeenCalled();
  });

  test('prevents overlapping poll ticks from sending the same alert twice', async () => {
    let release: (() => void) | undefined;
    let calls = 0;
    const work = vi.fn(() => {
      calls += 1;
      if (calls === 1) return new Promise<void>((resolve) => { release = resolve; });
      return Promise.resolve();
    });
    const run = createSingleFlightRunner(work);

    const first = run();
    const overlapping = run();
    expect(work).toHaveBeenCalledTimes(1);
    await expect(overlapping).resolves.toBe(false);

    release?.();
    await expect(first).resolves.toBe(true);
    await expect(run()).resolves.toBe(true);
    expect(work).toHaveBeenCalledTimes(2);
  });

  test('writes known chat state atomically without leaving a temporary file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'known-chat-'));
    const path = join(dir, 'known.json');
    try {
      expect(saveKnownChatMessagesAtomically(path, { fingerprint: 'time' })).toBe(true);
      expect(existsSync(path)).toBe(true);
      expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ fingerprint: 'time' });
      expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(readdirSync(dir)).toEqual(['known.json']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('writes known purchase state atomically with private permissions', () => {
    const dir = mkdtempSync(join(tmpdir(), 'known-deals-'));
    const path = join(dir, 'known.json');
    try {
      expect(saveKnownDealsAtomically(path, { product: 'Delivered' })).toBe(true);
      expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ product: 'Delivered' });
      expect(statSync(path).mode & 0o777).toBe(0o600);
      expect(readdirSync(dir)).toEqual(['known.json']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('uses an exclusive filesystem lock so a second dashboard process skips the same poll', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'poll-lock-'));
    const lockPath = join(dir, 'poll.lock');
    let release: (() => void) | undefined;
    const nowMs = Date.now();
    const first = runWithExclusivePollLock(lockPath, () => new Promise<void>((resolve) => { release = resolve; }), { nowMs });
    await Promise.resolve();
    expect(existsSync(lockPath)).toBe(true);
    await expect(runWithExclusivePollLock(lockPath, async () => undefined, {
      nowMs: nowMs + 10 * 60_000,
      staleAfterMs: 1,
    })).resolves.toBe(false);
    expect(existsSync(lockPath)).toBe(true);
    release?.();
    await expect(first).resolves.toBe(true);
    expect(existsSync(lockPath)).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  test('alerts when a deal is first seen already delivered after a missed OnSale transition', () => {
    const { alerts, updated } = buildNewDealStatusAlerts([
      {
        productUsid: 'deal-new-delivered',
        dealStatus: 'Delivered',
        deliveredDateTime: '2026.05.04 21:00',
        productTypeString: '티빙',
        productName: '티빙 프리미엄',
        borrowerName: '최현준',
      },
    ], {}, { nowMs: Date.parse('2026-05-04T12:05:00Z'), firstSeenMaxAgeMs: 30 * 60_000 });

    expect(updated['deal-new-delivered']).toBe('Delivered');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toContain('새 구매 발생');
    expect(alerts[0]).toContain('티빙');
    expect(alerts[0]).toContain('최현준');
    expect(alerts[0]).toContain('deal-new-delivered');
  });

  test('baselines old first-seen purchased rows without alerting after known deal state is lost', () => {
    const { alerts, updated } = buildNewDealStatusAlerts([
      {
        productUsid: 'week-old-delivered',
        dealStatus: 'Delivered',
        deliveredDateTime: '2026.05.01 21:00',
        borrowerName: '과거 구매자',
      },
    ], {}, { nowMs: Date.parse('2026-05-08T12:00:00Z'), firstSeenMaxAgeMs: 30 * 60_000 });

    expect(updated['week-old-delivered']).toBe('Delivered');
    expect(alerts).toEqual([]);
  });

  test('alerts only a fresh OnSale transition and baselines stale or timestamp-less transitions', () => {
    const nowMs = Date.parse('2026-05-08T12:00:00Z');
    const fresh = buildNewDealStatusAlerts([
      { productUsid: 'fresh-transition', dealStatus: 'Delivered', borrowerName: '실제 신규 구매자', deliveredDateTime: '2026-05-08T20:55:00+09:00' },
    ], { 'fresh-transition': 'OnSale' }, { nowMs, firstSeenMaxAgeMs: 30 * 60_000 });
    expect(fresh.alerts).toHaveLength(1);
    expect(fresh.alerts[0]).toContain('실제 신규 구매자');

    const stale = buildNewDealStatusAlerts([
      { productUsid: 'stale-transition', dealStatus: 'Delivered', borrowerName: '과거 구매자', deliveredDateTime: '2026-05-01T12:00:00Z' },
      { productUsid: 'missing-time-transition', dealStatus: 'Delivered', borrowerName: '시각 없음' },
    ], { 'stale-transition': 'OnSale', 'missing-time-transition': 'OnSale' }, { nowMs, firstSeenMaxAgeMs: 30 * 60_000 });
    expect(stale.updated['stale-transition']).toBe('Delivered');
    expect(stale.updated['missing-time-transition']).toBe('Delivered');
    expect(stale.alerts).toEqual([]);
  });

  test('does not replay an old first-seen extension warning after state loss', () => {
    const { alerts, updated } = buildNewDealStatusAlerts([
      {
        productUsid: 'old-extension',
        dealStatus: 'ExtensionWaiting',
        deliveredDateTime: '2026.05.01 21:00',
        productKeepAcctYn: false,
        borrowerName: '과거 구매자',
      },
    ], {}, { nowMs: Date.parse('2026-05-08T12:00:00Z') });

    expect(updated['old-extension']).toBe('ExtensionWaiting');
    expect(alerts).toEqual([]);
  });

  test('does not alert for first-seen OnSale rows during baseline refresh', () => {
    const { alerts, updated } = buildNewDealStatusAlerts([
      {
        productUsid: 'deal-on-sale',
        dealStatus: 'OnSale',
        productTypeString: '웨이브',
        productName: '웨이브 프리미엄',
      },
    ], {});

    expect(updated['deal-on-sale']).toBe('OnSale');
    expect(alerts).toEqual([]);
  });
});
