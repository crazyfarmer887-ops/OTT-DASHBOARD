import { describe, expect, it, vi } from 'vitest';
import { syncGbutsChatAlerts } from '../src/scheduler/gbuts-chat-alerts';
import type { GbutsSpotifyChatAlertJournal } from '../src/scheduler/gbuts-spotify-chat-alerts';

function setup() {
  let journal: GbutsSpotifyChatAlertJournal = { version: 1, sent: {} };
  const sendAlert = vi.fn(async () => ({ sent: true as const, reason: 'sent' as const }));
  const deps = {
    listPosts: async () => [
      { seq: 1, category1: { seq: 5, name: '{"ko":"넷플릭스"}' }, memberCount: 1 },
      { seq: 2, category1: { seq: 530, name: '{"ko":"MSOffice"}' }, memberCount: 1 },
      { seq: 15557, category1: { seq: 20, name: 'Spotify' }, memberCount: 1 },
    ],
    listMembers: vi.fn(async (postSeq: number) => [{ seq: postSeq, userSeq: 42, productId: '801', nickname: '구매자', status: 'APPLY', cancelStatus: null }]),
    openPrivateRoom: async (postSeq: number) => `ROOM${postSeq}`,
    getChat: async () => ({ messages: [
      { senderSeq: 42, message: '초대 언제 되나요?', messageType: 'TEXT', createdAt: '2026-10-12T10:00:00Z' },
      { senderSeq: 42, message: '새 이메일 buyer@example.com입니다', messageType: 'TEXT', createdAt: '2026-10-13T10:00:00Z' },
    ] }), sendAlert, readJournal: () => journal,
    writeJournal: (value: GbutsSpotifyChatAlertJournal) => { journal = structuredClone(value); },
    startAt: '2026-10-13T00:00:00Z', spotifyStartAt: '2026-10-04T00:00:00Z',
    now: () => '2026-10-13T10:01:00Z', accountLabel: '판매 계정',
  };
  return { deps, sendAlert, read: () => journal };
}
describe('GButs all-product chat alerts', () => {
  it('scans every product including completed sales, preserves the Spotify baseline and deduplicates after restart', async () => {
    const { deps, sendAlert, read } = setup();
    expect(await syncGbutsChatAlerts(deps)).toEqual({ posts: 3, sent: 3, messages: 4, failed: 0, errors: 0 });
    expect(sendAlert.mock.calls[0][0]).toEqual(expect.objectContaining({ title: 'GButs 넷플릭스 구매자 채팅', category: 'inquiry' }));
    expect(sendAlert.mock.calls[0][0].body).toContain('판매 계정: 판매 계정');
    expect(sendAlert.mock.calls[0][0].body).toContain('구매자: 구매자');
    expect(sendAlert.mock.calls[0][0].body).not.toContain('초대 언제 되나요?');
    expect(sendAlert.mock.calls[2][0].body).toContain('초대 언제 되나요?');
    expect(read().lastScan?.posts).toBe(3);
    expect(await syncGbutsChatAlerts(deps)).toEqual({ posts: 3, sent: 0, messages: 0, failed: 0, errors: 0 });
  });
  it('continues scanning other products when one fails, and records the failure for inspection', async () => {
    const { deps, sendAlert, read } = setup();
    deps.listMembers.mockRejectedValueOnce(new Error('provider outage'));
    expect(await syncGbutsChatAlerts(deps)).toEqual({ posts: 2, sent: 2, messages: 3, failed: 0, errors: 1 });
    expect(sendAlert).toHaveBeenCalledTimes(2);
    expect(read().lastScan?.errors).toBe(1);
  });
  it('does not accept incomplete buyer lists', async () => {
    const { deps, sendAlert } = setup();
    deps.listMembers.mockResolvedValue([]);
    expect((await syncGbutsChatAlerts(deps)).errors).toBe(3);
    expect(sendAlert).not.toHaveBeenCalled();
  });
});
