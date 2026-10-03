import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  classifyFamilySwitchIssue,
  findFamilySwitchEvent,
  syncYouTubeFamilySwitches,
  YOUTUBE_FAMILY_SWITCH_EMAIL_REQUEST,
  YOUTUBE_FAMILY_SWITCH_REINVITE_REPLY,
  type FamilySwitchJournal,
} from '../src/scheduler/youtube-family-switch';
import type { GraytagChatMessage } from '../src/api/chat-message-summary';
import type { NotionDeliveryDeal, NotionInvitationRow } from '../src/scheduler/notion-invitation-sync';

const NOW = Date.parse('2026-09-26T09:00:00+09:00');
const deal: NotionDeliveryDeal = { dealUsid: 'deal-1', chatRoomUuid: 'room-1', dealStatus: 'Delivered',
  productTypeString: '유튜브', productName: '광고X' };
const row: NotionInvitationRow = { id: 'notion-1', email: 'old@example.com', invited: true, dealUsid: 'deal-1' };
const buyer = (text: string, time: string): GraytagChatMessage => ({ message: text, registeredDateTime: time, owned: false });
const seller = (text: string, time: string): GraytagChatMessage => ({ message: text, registeredDateTime: time, owned: true });
const conversation: GraytagChatMessage[] = [
  buyer('old@example.com', '2026.09.26 07:00'),
  buyer('12개월 가족그룹 변경에 걸려있네요', '2026.09.26 07:29'),
  buyer('new&#64;example.com', '2026.09.26 07:30'),
  buyer('여기로 다시 초대 좀 부탁드립니다', '2026.09.26 07:30'),
];

afterEach(() => vi.unstubAllGlobals());

describe('post-delivery family switch', () => {
  test('Jev recognizes family-group switching limits but not a 12-month subscription expiry', async () => {
    const fetchMock = vi.fn(async () => Response.json({ answers: { intent: { choice: 'family_switch_limit',
      confidence: 0.98, probabilities: { family_switch_limit: 0.99, resolved: 0, other: 0.01 } } } }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await classifyFamilySwitchIssue('가족 변경이 안된다고 하네요', 'test-key')).toBe('family_switch_limit');
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.questions.intent.criteria).toHaveProperty('family_switch_limit');
    fetchMock.mockResolvedValueOnce(Response.json({ answers: { intent: { choice: 'other',
      confidence: 0.99, probabilities: { family_switch_limit: 0, resolved: 0.01, other: 0.99 } } } }));
    expect(await classifyFamilySwitchIssue('12개월 결제 기간이 만료됐나요?', 'test-key')).toBe('other');
  });

  test('finds the new buyer email after a family restriction and ignores a later successful join', () => {
    expect(findFamilySwitchEvent('room-1', conversation, row.email, NOW)).toMatchObject({
      issueText: '12개월 가족그룹 변경에 걸려있네요', newEmail: 'new@example.com',
      resolved: false, sellerReplied: false,
    });
    expect(findFamilySwitchEvent('room-1', [
      buyer('죄송합니다 전에 가입했던 판매자가 중지시키는 바람에 12개월 가족그룹 변경에 걸려있네요', '2026.09.26 07:29'),
      buyer('miran9081@gmail.com', '2026.09.26 07:30'),
      buyer('여기로 다시 초대 좀 부탁드립니다', '2026.09.26 07:30'),
    ], row.email, NOW)).toMatchObject({ newEmail: 'miran9081@gmail.com', resolved: false });
    expect(findFamilySwitchEvent('room-1', [
      buyer('가족', '2026.09.26 07:10'),
      buyer('변경이 안 된다고 하네요', '2026.09.26 07:25'),
      buyer('new@example.com', '2026.09.26 07:30'),
    ], row.email, NOW)).toMatchObject({
      issueText: '가족\n변경이 안 된다고 하네요', newEmail: 'new@example.com', resolved: false,
    });
    expect(findFamilySwitchEvent('room-1', [
      buyer('가족', '2026.09.26 07:10'),
      seller('제가 확인할게요', '2026.09.26 07:20'),
      buyer('변경이 안 된다고 하네요', '2026.09.26 07:25'),
    ], row.email, NOW)).toBeNull();
    expect(findFamilySwitchEvent('room-1', [
      buyer('가족', '2026.09.26 07:10'),
      buyer('변경이 안 된다고 하네요', '2026.09.26 07:45'),
    ], row.email, NOW)).toBeNull();
    const resolved = [
      buyer('가족 변경이 안된다고 하네요', '2026.09.26 08:21'),
      buyer('song15237575&#64;gmail.com', '2026.09.26 08:32'),
      seller('새 이메일로 재초대 보내드리겠습니다', '2026.09.26 08:34'),
      buyer('지금 가입했어요', '2026.09.26 08:35'),
      buyer('쓰고있습니다!', '2026.09.26 08:35'),
    ];
    expect(findFamilySwitchEvent('room-1', resolved, row.email, NOW)?.resolved).toBe(true);
    expect(findFamilySwitchEvent('room-1', [...conversation, seller('새 주소로 초대장을 보냈습니다', '2026.09.26 07:33')], row.email, NOW)?.resolved).toBe(true);
    expect(findFamilySwitchEvent('room-1', [
      buyer('가족 변경이 안된다고 하네요', '2026.09.26 07:29'),
      seller('기존 주소로 초대장을 보냈습니다', '2026.09.26 07:30'),
      buyer('new@example.com', '2026.09.26 07:35'),
    ], row.email, NOW)).toMatchObject({ resolved: false, newEmail: 'new@example.com' });
  });

  test('updates the exact invited Notion row, unchecks it, and replies without touching delivery', async () => {
    let current: NotionInvitationRow = { ...row };
    let journal: FamilySwitchJournal = { version: 1, records: {} };
    const updateRowEmail = vi.fn(async (_row: NotionInvitationRow, email: string) => {
      current = { ...row, email, emailHistory: [row.email], invited: false, cancelled: false };
      return current;
    });
    const send = vi.fn(async () => true);
    const deps = {
      listDeals: async () => [deal], listRows: async () => [current], getRow: async () => current,
      updateRowEmail, listMessages: async () => conversation,
      classify: async () => 'family_switch_limit' as const, send,
      readJournal: () => journal, writeJournal: (next: FamilySwitchJournal) => { journal = structuredClone(next); },
      now: () => NOW,
    };
    expect(await syncYouTubeFamilySwitches(deps)).toEqual({ updated: 1, asked: 0, replied: 1, skipped: 0 });
    expect(updateRowEmail).toHaveBeenCalledExactlyOnceWith(row, 'new@example.com');
    expect(send).toHaveBeenCalledExactlyOnceWith(deal, YOUTUBE_FAMILY_SWITCH_REINVITE_REPLY);
    expect(current).toMatchObject({ email: 'new@example.com', emailHistory: ['old@example.com'], invited: false });
    expect(await syncYouTubeFamilySwitches(deps)).toEqual({ updated: 0, asked: 0, replied: 0, skipped: 0 });
  });

  test('uses a manually struck pending email when a delivered buyer later supplies the replacement', async () => {
    const pending: NotionInvitationRow = { ...row, email: '', invited: false,
      emailHistory: ['old@example.com'], cancelled: true, cancelWaitlist: false };
    let current = pending;
    let journal: FamilySwitchJournal = { version: 1, records: {} };
    const updateRowEmail = vi.fn(async (_row: NotionInvitationRow, email: string) => {
      current = { ...pending, email, invited: false, cancelled: false, newInviteMarked: true };
      return current;
    });
    const send = vi.fn(async () => true);
    const deps = {
      listDeals: async () => [deal], listRows: async () => [current], getRow: async () => current,
      updateRowEmail, listMessages: async () => conversation,
      classify: async () => 'family_switch_limit' as const, send,
      readJournal: () => journal, writeJournal: (next: FamilySwitchJournal) => { journal = structuredClone(next); },
      now: () => NOW,
    };
    expect(await syncYouTubeFamilySwitches(deps)).toMatchObject({ updated: 1, replied: 1 });
    expect(updateRowEmail).toHaveBeenCalledExactlyOnceWith(pending, 'new@example.com');
    expect(send).toHaveBeenCalledExactlyOnceWith(deal, YOUTUBE_FAMILY_SWITCH_REINVITE_REPLY);
  });

  test('requests an alternate address once when the buyer reports the restriction without one', async () => {
    let journal: FamilySwitchJournal = { version: 1, records: {} };
    const send = vi.fn(async () => true);
    const deps = {
      listDeals: async () => [deal], listRows: async () => [row], getRow: async () => row,
      updateRowEmail: vi.fn(), listMessages: async () => conversation.slice(0, 2),
      classify: async () => 'family_switch_limit' as const, send,
      readJournal: () => journal, writeJournal: (next: FamilySwitchJournal) => { journal = structuredClone(next); },
      now: () => NOW,
    };
    expect(await syncYouTubeFamilySwitches(deps)).toMatchObject({ asked: 1, updated: 0 });
    expect(send).toHaveBeenCalledExactlyOnceWith(deal, YOUTUBE_FAMILY_SWITCH_EMAIL_REQUEST);
    expect(await syncYouTubeFamilySwitches(deps)).toMatchObject({ asked: 0 });
    expect(deps.updateRowEmail).not.toHaveBeenCalled();
  });

  test('does not ask twice when the buyer adds more detail to the same family issue', async () => {
    let journal: FamilySwitchJournal = { version: 1, records: {} };
    let messages = [buyer('가족 변경이 안 된다고 해요', '2026.09.26 07:20')];
    const send = vi.fn(async () => true);
    const deps = {
      listDeals: async () => [deal], listRows: async () => [row], getRow: async () => row,
      updateRowEmail: vi.fn(), listMessages: async () => messages,
      classify: async () => 'family_switch_limit' as const, send,
      readJournal: () => journal, writeJournal: (next: FamilySwitchJournal) => { journal = structuredClone(next); },
      now: () => NOW,
    };
    expect(await syncYouTubeFamilySwitches(deps)).toMatchObject({ asked: 1 });
    messages = [...messages, buyer('12개월 제한이라네요', '2026.09.26 07:35')];
    expect(await syncYouTubeFamilySwitches(deps)).toMatchObject({ asked: 0 });
    expect(send).toHaveBeenCalledTimes(1);
  });

  test('does not reply twice after a seller response and does nothing when the buyer already joined', async () => {
    let journal: FamilySwitchJournal = { version: 1, records: {} };
    const send = vi.fn(async () => true);
    const updateRowEmail = vi.fn(async () => ({ ...row, invited: false, email: 'new@example.com', emailHistory: [row.email] }));
    let messages = [...conversation, seller('새로 초대해 드릴게요', '2026.09.26 07:32')];
    const deps = {
      listDeals: async () => [{ ...deal, dealStatus: 'Using' }], listRows: async () => [row], getRow: async () => row,
      updateRowEmail, listMessages: async () => messages,
      classify: async () => 'family_switch_limit' as const, send,
      readJournal: () => journal, writeJournal: (next: FamilySwitchJournal) => { journal = structuredClone(next); },
      now: () => NOW,
    };
    expect(await syncYouTubeFamilySwitches(deps)).toMatchObject({ updated: 1, replied: 0 });
    expect(send).not.toHaveBeenCalled();
    messages = [...conversation, buyer('지금 가입했어요. 쓰고 있습니다!', '2026.09.26 07:35')];
    journal = { version: 1, records: {} };
    updateRowEmail.mockClear();
    expect(await syncYouTubeFamilySwitches(deps)).toMatchObject({ updated: 0, replied: 0, asked: 0 });
    expect(updateRowEmail).not.toHaveBeenCalled();
  });

  test('ignores wrong orders, ambiguous replacement emails, and an active delivery', async () => {
    const updateRowEmail = vi.fn();
    const send = vi.fn();
    const deps = {
      listDeals: async () => [{ ...deal, dealStatus: 'Delivering' }], listRows: async () => [row], getRow: async () => row,
      updateRowEmail, listMessages: async () => conversation,
      classify: async () => 'family_switch_limit' as const, send,
      readJournal: () => ({ version: 1 as const, records: {} }), writeJournal: vi.fn(), now: () => NOW,
    };
    expect(await syncYouTubeFamilySwitches(deps)).toMatchObject({ updated: 0 });
    deps.listDeals = async () => [deal];
    deps.listMessages = async () => [...conversation, buyer('another@example.com', '2026.09.26 07:31')];
    expect(await syncYouTubeFamilySwitches(deps)).toMatchObject({ updated: 0, replied: 0 });
    expect(updateRowEmail).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});
