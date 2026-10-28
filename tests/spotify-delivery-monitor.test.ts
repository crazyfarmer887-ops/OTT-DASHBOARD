import { describe, expect, it, vi } from 'vitest';
import { assessSpotifyBuyerDelivery, collectSpotifyDeliveryScan, flushSpotifyDeliveryAlerts,
  reconcileSpotifyDeliveryIncidents, spotifyDeliveryAlertInput, unboundSpotifyCompletionIssues,
  type SpotifyBuyerDeliverySnapshot, type SpotifyDeliveryMonitorJournal, type SpotifyDeliveryScan,
  type SpotifyDeliveryIssue } from '../src/scheduler/spotify-delivery-monitor';
import { spotifyRegisteredAccountInvitedReply } from '../src/scheduler/gbuts-spotify-messages';
import type { SpotifyNotionRow } from '../src/scheduler/gbuts-spotify-sync';

const activatedAt = '2026-10-28T03:00:30Z';
const now = Date.parse('2026-10-28T04:00:00Z');
const member = { seq: 91, userSeq: 42, status: 'APPLY', cancelStatus: null, productId: 'SPOT1' };
const message = { senderSeq: 42, messageType: 'TEXT', message: '새 계정 발급 부탁합니다', createdAt: '2026-10-28T03:01:00Z' };
const row: SpotifyNotionRow = { id: 'page-1', orderKey: '15557:91', email: 'original@example.com', password: 'Original123!',
  emailHistory: [], registered: true, registeredEmail: 'issued@example.net', registeredPassword: 'Issued456!', invited: true,
  cancelled: false, updatedAt: '2026-10-28T03:02:00Z' };
function buyer(platform: 'gbuts' | 'everyview' = 'gbuts'): SpotifyBuyerDeliverySnapshot {
  return { platform, postSeq: 15557, member, sellerSeq: 7, rows: [{ ...row, orderKey: `${platform === 'everyview' ? 'everyview:' : ''}15557:91` }],
    messages: [message], activatedAt, uncertainDelivery: false };
}
const issue: SpotifyDeliveryIssue = { key: 'order:15557:91', scope: 'gbuts:post:15557', platform: 'gbuts', code: 'delivery_missing',
  orderKey: '15557:91', postSeq: 15557, memberSeq: 91, notionPageId: 'page-1' };
const scan: SpotifyDeliveryScan = { issues: [issue], checkedScopes: ['gbuts:post:15557'] };
const empty = (): SpotifyDeliveryMonitorJournal => ({ version: 1, activatedAt, incidents: {} });
function repeated(code: SpotifyDeliveryIssue['code'] = 'delivery_missing') {
  return reconcileSpotifyDeliveryIncidents(reconcileSpotifyDeliveryIncidents(empty(), { ...scan, issues: [{ ...issue, code }] }, now),
    { ...scan, issues: [{ ...issue, code }] }, now + 120_000);
}

describe('Spotify completion/read-only delivery assessment', () => {
  it.each(['gbuts', 'everyview'] as const)('detects missing %s delivery and clears it only for the actual issued saved message', platform => {
    const s = buyer(platform);
    expect(assessSpotifyBuyerDelivery(s)?.code).toBe('delivery_missing');
    s.messages = [...s.messages, { senderSeq: 7, messageType: 'TEXT', createdAt: '2026-10-28T03:03:00Z',
      message: spotifyRegisteredAccountInvitedReply('original@example.com', 'Original123!') }];
    expect(assessSpotifyBuyerDelivery(s)?.code).toBe('delivery_missing');
    s.messages = [...s.messages, { senderSeq: 7, messageType: 'TEXT', createdAt: '2026-10-28T03:04:00Z',
      message: spotifyRegisteredAccountInvitedReply('issued@example.net', 'Issued456!') }];
    expect(assessSpotifyBuyerDelivery({ ...s, uncertainDelivery: true })).toBeNull();
  });
  it('recognizes legacy manual delivery of the exact issued pair without requiring a canned template', () => {
    const s = buyer();
    s.messages = [...s.messages, { senderSeq: 7, messageType: 'TEXT', createdAt: '2026-10-28T03:03:00Z',
      message: 'issued@example.net PW : Issued456! 입니다. 계정 정보를 변경해서 이용해주세요.' }];
    expect(assessSpotifyBuyerDelivery(s)).toBeNull();
    expect(assessSpotifyBuyerDelivery({ ...s, messages: s.messages.map(m => ({ ...m, senderSeq: 42 })) })?.code).toBe('delivery_missing');
  });
  it('distinguishes a different saved issued identity from an unsent account', () => {
    expect(assessSpotifyBuyerDelivery({ ...buyer(), messages: [message, { senderSeq: 7, messageType: 'TEXT',
      createdAt: '2026-10-28T03:03:00Z', message: 'different@example.net PW : Issued456! 입니다!' }] })?.code).toBe('identity_mismatch');
  });
  it('stays quiet while partner fulfillment is incomplete or a buyer is refunded', () => {
    expect(assessSpotifyBuyerDelivery({ ...buyer(), rows: [{ ...row, invited: false }] })).toBeNull();
    expect(assessSpotifyBuyerDelivery({ ...buyer(), rows: [{ ...row, registered: false, invited: false }] })).toBeNull();
    expect(assessSpotifyBuyerDelivery({ ...buyer(), member: { ...member, cancelStatus: 'REFUNDED' } })).toBeNull();
    expect(assessSpotifyBuyerDelivery({ ...buyer(), rows: [{ ...row, cancelled: true }] })).toBeNull();
  });
  it('detects incomplete issued fields, duplicate bindings and uncertain sends without retrying them', () => {
    expect(assessSpotifyBuyerDelivery({ ...buyer(), rows: [{ ...row, registeredEmail: 'bad value' }] })?.code).toBe('invalid_issued');
    expect(assessSpotifyBuyerDelivery({ ...buyer(), rows: [row, { ...row, id: 'other' }] })?.code).toBe('notion_ambiguous');
    expect(assessSpotifyBuyerDelivery({ ...buyer(), uncertainDelivery: true })?.code).toBe('delivery_uncertain');
  });
  it('detects a new missing request but does not replay old resolved/unbound buyers', () => {
    expect(assessSpotifyBuyerDelivery({ ...buyer(), rows: [] })?.code).toBe('notion_missing');
    expect(assessSpotifyBuyerDelivery({ ...buyer(), rows: [], messages: [{ ...message, createdAt: '2026-10-01T00:00:00Z' }] })).toBeNull();
    expect(assessSpotifyBuyerDelivery({ ...buyer(), rows: [], messages: [message, { senderSeq: 7, messageType: 'TEXT',
      createdAt: '2026-10-28T03:05:00Z', message: spotifyRegisteredAccountInvitedReply('issued@example.net', 'Issued456!') }] })).toBeNull();
  });
  it('flags a completed row linked to the wrong current account and respects a later own-account choice', () => {
    const own = { ...message, createdAt: '2026-10-28T03:10:00Z', message: 'Spotify email: other@example.com\nPassword: Other123!' };
    expect(assessSpotifyBuyerDelivery({ ...buyer(), messages: [message, own] })?.code).toBe('identity_mismatch');
    expect(assessSpotifyBuyerDelivery({ ...buyer(), rows: [{ ...row, email: 'other@example.com', registered: false }],
      messages: [message, own, { senderSeq: 7, messageType: 'TEXT', message: '초대 완료했습니다. 확인해주세요!', createdAt: '2026-10-28T03:11:00Z' }] })).toBeNull();
  });
  it('notifies for newly completed unbound rows, including the activation minute, but ignores old manual rows', () => {
    const rows = [{ ...row, orderKey: '', updatedAt: '2026-10-28T03:00:00Z' },
      { ...row, id: 'old', orderKey: '', updatedAt: '2026-10-20T00:00:00Z' },
      { ...row, id: 'pending', orderKey: '', invited: false }, row];
    expect(unboundSpotifyCompletionIssues(rows, activatedAt)).toEqual([{ key: 'unbound:page-1', scope: 'notion', code: 'notion_unbound', notionPageId: 'page-1' }]);
  });
});

describe('persistent quiet-unless-actionable Telegram reporting', () => {
  it('waits two minutes and repeated observations, sends once, and remains deduplicated after restart', async () => {
    let j = reconcileSpotifyDeliveryIncidents(empty(), scan, now); const send = vi.fn(async () => ({ sent: true as const, reason: 'sent' as const }));
    const deps = { read: () => j, write: (value: SpotifyDeliveryMonitorJournal) => { j = JSON.parse(JSON.stringify(value)); }, send, nowMs: now + 30_000 };
    expect(await flushSpotifyDeliveryAlerts(deps)).toBe(0);
    j = reconcileSpotifyDeliveryIncidents(j, scan, now + 120_000);
    expect(await flushSpotifyDeliveryAlerts({ ...deps, nowMs: now + 120_000 })).toBe(1);
    j = JSON.parse(JSON.stringify(j));
    expect(await flushSpotifyDeliveryAlerts({ ...deps, nowMs: now + 360_000 })).toBe(0);
    expect(send).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(j)).not.toMatch(/issued@example|Issued456|Original123/);
  });
  it('silently resolves healthy scopes and notifies again only for a new incident', async () => {
    let j = repeated(); const sent: string[] = [];
    const send = async (input: { key: string }) => { sent.push(input.key); return { sent: true as const, reason: 'sent' as const }; };
    const deps = { read: () => j, write: (v: SpotifyDeliveryMonitorJournal) => { j = v; }, send, nowMs: now + 120_000 };
    await flushSpotifyDeliveryAlerts(deps);
    j = reconcileSpotifyDeliveryIncidents(j, { issues: [], checkedScopes: scan.checkedScopes }, now + 180_000);
    expect(Object.keys(j.incidents)).toHaveLength(0);
    j = reconcileSpotifyDeliveryIncidents(j, scan, now + 240_000);
    j = reconcileSpotifyDeliveryIncidents(j, scan, now + 360_000);
    await flushSpotifyDeliveryAlerts({ ...deps, nowMs: now + 360_000 });
    expect(sent).toHaveLength(2); expect(sent[0]).not.toBe(sent[1]);
  });
  it('retains issues when a source could not be checked and backs off failed Telegram sends', async () => {
    let j = reconcileSpotifyDeliveryIncidents(repeated(), { issues: [], checkedScopes: ['notion'] }, now + 120_000);
    expect(Object.keys(j.incidents)).toHaveLength(1);
    const send = vi.fn(async () => ({ sent: false as const, reason: 'failed' as const }));
    const deps = { read: () => j, write: (v: SpotifyDeliveryMonitorJournal) => { j = v; }, send, nowMs: now + 120_000 };
    await flushSpotifyDeliveryAlerts(deps); await flushSpotifyDeliveryAlerts({ ...deps, nowMs: now + 180_000 });
    expect(send).toHaveBeenCalledTimes(1);
    await flushSpotifyDeliveryAlerts({ ...deps, nowMs: now + 420_000 });
    expect(send).toHaveBeenCalledTimes(2);
    expect(j.incidents[issue.key].notifiedAt).toBeUndefined();
  });
  it('uses static descriptions and identifiers instead of secrets, chat text or raw error messages', () => {
    const input = spotifyDeliveryAlertInput(repeated().incidents[issue.key]);
    expect(input.provider).toBe('gbuts'); expect(input.actionUrl).toBe('https://www.notion.so/page1');
    expect(input.body).toContain('15557:91'); expect(JSON.stringify(input)).not.toMatch(/Original123|Issued456|issued@example|새 계정/);
    const everyview = spotifyDeliveryAlertInput({ ...repeated().incidents[issue.key], issue: { ...issue, platform: 'everyview' } });
    expect(everyview.title).toContain('에브리뷰'); expect(everyview.provider).toBeUndefined();
  });
});

describe('independent read-only source collection', () => {
  function source(platform: 'gbuts' | 'everyview') {
    const sendText = vi.fn();
    return { platform, posts: async () => [15557], sellerAccountSeq: async () => 7,
      listMembers: async () => [member], openPrivateRoom: async () => 'room', getChat: async () => ({ messages: [message] }),
      uncertainOrders: () => new Set<string>(), sendText };
  }
  it('detects stalled delivery independently of the sender without performing a SEND', async () => {
    const g = source('gbuts'), e = source('everyview');
    const result = await collectSpotifyDeliveryScan({ listRows: async () => [row, { ...row, id: 'everyview-page', orderKey: 'everyview:15557:91' }],
      sources: [g,e], activatedAt });
    expect(result.issues.map(i => i.platform)).toEqual(['gbuts','everyview']);
    expect(result.checkedScopes).toContain('everyview:post:15557');
    expect(g.sendText).not.toHaveBeenCalled(); expect(e.sendText).not.toHaveBeenCalled();
  });
  it('continues checking the other platform when one source fails and skips historical buyers', async () => {
    const g = { ...source('gbuts'), getChat: async () => { throw Error('Password: MUST_NOT_LEAK'); } };
    const e = { ...source('everyview'), eligibility: () => 'historical' as const };
    const result = await collectSpotifyDeliveryScan({ listRows: async () => [row], sources: [g,e], activatedAt });
    expect(result.issues).toEqual([{ key: 'gbuts:inventory:unavailable', scope: 'gbuts:inventory', code: 'source_unavailable', platform: 'gbuts', postSeq: 15557 }]);
    expect(result.checkedScopes).not.toContain('gbuts:post:15557');
    expect(result.checkedScopes).toContain('everyview:post:15557');
    expect(JSON.stringify(result)).not.toContain('MUST_NOT_LEAK');
  });
  it('collapses a provider outage into one alert instead of one per sale', async () => {
    const g = { ...source('gbuts'), posts: async () => [15557, 17124, 18184], listMembers: async () => { throw Error('offline'); } };
    const result = await collectSpotifyDeliveryScan({ listRows: async () => [], sources: [g], activatedAt });
    expect(result.issues).toHaveLength(1); expect(result.issues[0].postSeq).toBeUndefined();
  });
  it('reports an unavailable Notion source without treating old issues as resolved', async () => {
    const g = source('gbuts'); const result = await collectSpotifyDeliveryScan({ listRows: async () => { throw Error('auth secret'); }, sources: [g], activatedAt });
    expect(result.checkedScopes).toEqual([]); expect(result.issues[0].code).toBe('source_unavailable');
    expect(JSON.stringify(result)).not.toContain('auth secret');
  });
});
