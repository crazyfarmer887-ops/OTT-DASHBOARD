import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  classifyYouTubeBuyerIntent,
  isSafeYouTubeBuyerIntent,
  syncYouTubeJevReplies,
  type JevReplyJournal,
  YOUTUBE_COUNTRY_MISMATCH_REPLY,
  YOUTUBE_INVITATION_WAIT_REPLY,
} from '../src/scheduler/youtube-jev-replies';
import type { NotionDeliveryDeal } from '../src/scheduler/notion-invitation-sync';
import type { GraytagChatMessage } from '../src/api/chat-message-summary';

const now = Date.parse('2026-09-25T12:00:00+09:00');
const deal = (id: string, status = 'Delivering'): NotionDeliveryDeal => ({
  dealUsid: id, chatRoomUuid: `room-${id}`, dealStatus: status, productTypeString: '유튜브', productName: '광고X',
});
const buyer = (message: string, time = '2026.09.25 11:50'): GraytagChatMessage => ({ message, registeredDateTime: time, owned: false });
const seller = (message: string, time = '2026.09.25 11:55'): GraytagChatMessage => ({ message, registeredDateTime: time, owned: true });

afterEach(() => vi.unstubAllGlobals());

describe('Jev intent and dedicated-account replies', () => {
  test('accepts common phrasing and blocks contradictory or destructive requests', () => {
    for (const message of ['초대 언제 오나요?', '혹시 얼마나 더 기다려야 돼요?', '초대 좀 빨리요']) {
      expect(isSafeYouTubeBuyerIntent(message, 'invitation_wait')).toBe(true);
    }
    for (const message of [
      '국가가 다르다고 떠요', '국가 달라서 가족 그룹 가입 안 된다는데요?',
      '국가/지역이 일치하지 않는다면서 초대 수락이 안돼요', '초대장이 왔는데 다른 나라라고 떠요',
      '지역 달라서 안됨', '나라가 틀리대요', '국가설정 오류나네요',
      'Your country is different라고 나와요',
    ]) expect(isSafeYouTubeBuyerIntent(message, 'country_mismatch')).toBe(true);
    for (const message of [
      '초대장 안왔는데 국가가 다르다고 뜹니다', '초대 아직 안 왔는데 국가가 달라서 못 받아요',
      '초대 전인데 국가가 달라도 괜찮나요?', '국가가 다르다고 뜨면 어떻게 해야 하나요?',
      '초대장 받았는데 국가 달라요. 그냥 환불해주세요',
    ]) expect(isSafeYouTubeBuyerIntent(message, 'country_mismatch')).toBe(false);
    expect(isSafeYouTubeBuyerIntent('언제오나요? 그리고 취소할게요', 'invitation_wait')).toBe(false);
  });

  test('accepts only a high-confidence, unambiguous Jev decision', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ answers: { intent: {
      choice: 'invitation_wait', confidence: 0.98,
      probabilities: { invitation_wait: 0.98, country_mismatch: 0.01, other: 0.01 },
    } } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await classifyYouTubeBuyerIntent('초대는 언제 되나요?', 'test-key')).toBe('invitation_wait');
    const [, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(options.body)).questions.intent.criteria).toHaveProperty('other');
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ answers: { intent: {
      choice: 'country_mismatch', confidence: 0.65,
      probabilities: { invitation_wait: 0.2, country_mismatch: 0.7, other: 0.1 },
    } } }), { status: 200 }));
    expect(await classifyYouTubeBuyerIntent('국가가 다르대요', 'test-key')).toBe('other');
    const shortWait = () => new Response(JSON.stringify({ answers: { intent: {
      choice: 'invitation_wait', confidence: 0.83,
      probabilities: { invitation_wait: 0.89, country_mismatch: 0.01, other: 0.1 },
    } } }), { status: 200 });
    fetchMock.mockResolvedValueOnce(shortWait());
    expect(await classifyYouTubeBuyerIntent('초대장 안옵니다', 'test-key')).toBe('invitation_wait');
    fetchMock.mockResolvedValueOnce(shortWait());
    expect(await classifyYouTubeBuyerIntent('아직도요?', 'test-key')).toBe('other');
  });

  test('baselines existing messages, sends one wait reply for a new buyer question, and deduplicates it', async () => {
    const current = [deal('one')];
    let chat: GraytagChatMessage[] = [buyer('기존 이메일입니다', '2026.09.25 11:40')];
    let currentNow = Date.parse('2026-09-25T11:45:00+09:00');
    let journal: JevReplyJournal | null = null;
    const send = vi.fn(async () => true);
    const classify = vi.fn(async () => 'invitation_wait' as const);
    const deps = {
      listDeals: async () => current,
      listMessages: async () => chat,
      providerStatus: async () => 'Delivering',
      classify, send, alertCountryIssue: async () => {},
      readJournal: () => journal,
      writeJournal: (value: JevReplyJournal) => { journal = structuredClone(value); },
      now: () => currentNow,
    };
    expect(await syncYouTubeJevReplies(deps)).toMatchObject({ baselined: 1, sent: 0 });
    currentNow = now;
    chat = [buyer('초대 언제 되나요?', '2026.09.25 11:55'), ...chat];
    expect(await syncYouTubeJevReplies(deps)).toMatchObject({ sent: 1, attempted: 1 });
    expect(send).toHaveBeenCalledExactlyOnceWith(current[0], YOUTUBE_INVITATION_WAIT_REPLY);
    expect(await syncYouTubeJevReplies(deps)).toMatchObject({ sent: 0, attempted: 0 });
    expect(classify).toHaveBeenCalledTimes(1);
  });

  test('country mismatch receives cautious instructions and alerts the seller', async () => {
    let journal: JevReplyJournal | null = { version: 1, startedAt: '2026-09-25T00:00:00.000Z', records: {} };
    const send = vi.fn(async () => true);
    const alertCountryIssue = vi.fn(async () => {});
    const deps = {
      listDeals: async () => [deal('two')],
      listMessages: async () => [buyer('초대장 받았는데 국가가 다르다고 가입이 안돼요')],
      providerStatus: async () => 'Delivering',
      classify: async () => 'country_mismatch' as const,
      send, alertCountryIssue,
      readJournal: () => journal,
      writeJournal: (value: JevReplyJournal) => { journal = structuredClone(value); },
      now: () => now,
    };
    expect(await syncYouTubeJevReplies(deps)).toMatchObject({ sent: 1 });
    expect(send).toHaveBeenCalledExactlyOnceWith(deal('two'), YOUTUBE_COUNTRY_MISMATCH_REPLY);
    expect(alertCountryIssue).toHaveBeenCalledOnce();
    expect(YOUTUBE_COUNTRY_MISMATCH_REPLY).toContain('https://support.google.com/paymentscenter/answer/7688666?hl=ko');
    expect(YOUTUBE_COUNTRY_MISMATCH_REPLY).toContain('모든 프로필을 삭제하지는 마세요');
  });

  test('does not send after a human reply, delivery, or uncertain transport outcome', async () => {
    let chat: GraytagChatMessage[] = [seller('제가 확인할게요'), buyer('언제 초대되나요?')];
    let status = 'Delivering';
    let journal: JevReplyJournal | null = { version: 1, startedAt: '2026-09-25T00:00:00.000Z', records: {} };
    const send = vi.fn(async () => { throw new Error('socket closed'); });
    const deps = {
      listDeals: async () => [deal('three')], listMessages: async () => chat,
      providerStatus: async () => status,
      classify: async () => 'invitation_wait' as const,
      send, alertCountryIssue: async () => {},
      readJournal: () => journal,
      writeJournal: (value: JevReplyJournal) => { journal = structuredClone(value); },
      now: () => now,
    };
    expect(await syncYouTubeJevReplies(deps)).toMatchObject({ sent: 0 });
    chat = [buyer('초대는 언제 되나요?')];
    status = 'Delivered';
    expect(await syncYouTubeJevReplies(deps)).toMatchObject({ sent: 0 });
    status = 'Delivering';
    expect(await syncYouTubeJevReplies(deps)).toMatchObject({ attempted: 1, sent: 0 });
    expect(await syncYouTubeJevReplies(deps)).toMatchObject({ attempted: 0 });
    expect(send).toHaveBeenCalledTimes(1);
  });
});
