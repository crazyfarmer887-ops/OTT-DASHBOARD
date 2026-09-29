import { afterEach, describe, expect, test, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
  classifyYouTubeBuyerIntent,
  isSafeYouTubeBuyerIntent,
  syncYouTubeJevReplies,
  type JevReplyJournal,
  YOUTUBE_COUNTRY_MISMATCH_REPLY,
  YOUTUBE_DELIVERED_NO_INVITATION_REPLY,
  YOUTUBE_INVITATION_WAIT_REPLY,
  YOUTUBE_MISSING_EMAIL_REPLY,
  YOUTUBE_PREMIUM_LOST_REPLY,
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
  test('revisits an ignored delivery inquiry and asks for a missing Google email once', async () => {
    let journal: JevReplyJournal | null = { version: 1, startedAt: '2026-09-25T00:00:00.000Z', records: {} };
    const current = deal('missing-email');
    const chat = [seller('Google 이메일 주소를 남겨주세요.', '2026.09.25 11:40'),
      buyer('구매했는데 답이 없나요?', '2026.09.25 11:49'),
      buyer('거래 안하시나요?', '2026.09.25 11:50')];
    const send = vi.fn(async () => true);
    const classify = vi.fn(async () => 'other' as const);
    const deps = {
      listDeals: async () => [current], listMessages: async () => chat,
      providerStatus: async () => 'Delivering', classify, send,
      alertCountryIssue: vi.fn(async () => {}),
      readJournal: () => journal,
      writeJournal: (value: JevReplyJournal) => { journal = structuredClone(value); },
      now: () => now,
      buyerEmails: undefined as undefined | (() => Promise<string[] | null>),
    };
    expect((await syncYouTubeJevReplies(deps)).ignored).toBe(1);
    deps.buyerEmails = async () => [];
    expect((await syncYouTubeJevReplies(deps)).sent).toBe(1);
    expect(send).toHaveBeenCalledExactlyOnceWith(current, YOUTUBE_MISSING_EMAIL_REPLY);
    expect((await syncYouTubeJevReplies(deps)).sent).toBe(0);
    expect(classify).toHaveBeenCalledTimes(1);
  });

  test('does not request an email after a cancellation or when an email is already known', async () => {
    for (const [text, emails] of [['취소 부탁드립니다. 거래 안 할게요', []],
      ['거래 안하시나요?', ['buyer@gmail.com']]] as const) {
      let journal: JevReplyJournal | null = { version: 1, startedAt: '2026-09-25T00:00:00.000Z', records: {} };
      const send = vi.fn(async () => true);
      await syncYouTubeJevReplies({ listDeals: async () => [deal('guard')],
        listMessages: async () => [buyer(text)], providerStatus: async () => 'Delivering',
        classify: async () => 'other', send, buyerEmails: async () => [...emails],
        alertCountryIssue: async () => {}, readJournal: () => journal,
        writeJournal: (value) => { journal = structuredClone(value); }, now: () => now });
      expect(send).not.toHaveBeenCalled();
    }
  });
  test('accepts common phrasing and blocks contradictory or destructive requests', () => {
    for (const message of ['초대 언제 오나요?', '혹시 얼마나 더 기다려야 돼요?', '초대 좀 빨리요']) {
      expect(isSafeYouTubeBuyerIntent(message, 'invitation_wait')).toBe(true);
    }
    for (const message of [
      '국가가 다르다고 떠요', '국가 달라서 가족 그룹 가입 안 된다는데요?',
      '국가/지역이 일치하지 않는다면서 초대 수락이 안돼요', '초대장이 왔는데 다른 나라라고 떠요',
      '지역 달라서 안됨', '나라가 틀리대요', '국가설정 오류나네요',
      'Your country is different라고 나와요',
      '구글 결제 프로필 국가가 달라서 초대가 안 된대요',
      '나라 달라서 초대 안 받아진다고 뜨네요ㅠ',
    ]) expect(isSafeYouTubeBuyerIntent(message, 'country_mismatch')).toBe(true);
    for (const message of [
      '초대장 안왔는데 국가가 다르다고 뜹니다', '초대 아직 안 왔는데 국가가 달라서 못 받아요',
      '초대 안 받았는데 국가가 다르다네요',
      '초대 전인데 국가가 달라도 괜찮나요?', '국가가 다르다고 뜨면 어떻게 해야 하나요?',
      '초대장 받았는데 국가 달라요. 그냥 환불해주세요',
    ]) expect(isSafeYouTubeBuyerIntent(message, 'country_mismatch')).toBe(false);
    expect(isSafeYouTubeBuyerIntent('언제오나요? 그리고 취소할게요', 'invitation_wait')).toBe(false);
    for (const message of [
      '전달 완료라고 뜨는데 초대장이 안 왔어요', '배송 완료 눌렸는데 초대 메일이 없어요',
      '계정 전달 상태인데 아직 초대 링크 못 받았습니다',
    ]) expect(isSafeYouTubeBuyerIntent(message, 'delivered_no_invitation')).toBe(true);
    for (const message of [
      '초대장은 왔는데 국가가 달라요', '초대 메일 안 왔어요. 환불해주세요',
      '초대장 안 왔다가 방금 왔어요', '가족 변경 제한이라 초대 못 받아요',
    ]) expect(isSafeYouTubeBuyerIntent(message, 'delivered_no_invitation')).toBe(false);
    for (const message of [
      '가입했는데 프리미엄이 안 떠요', '프리미엄 잘 되다가 갑자기 풀렸어요',
      '어제까지 이용했는데 프리미엄이 사라졌네요', '초대받았는데 Premium이 취소됐어요',
    ]) expect(isSafeYouTubeBuyerIntent(message, 'premium_lost')).toBe(true);
    for (const message of [
      '가족 그룹 변경이 안돼서 프리미엄이 안 떠요', '가입 전에 프리미엄 되나요?',
      '가족 가입이 안돼서 프리미엄이 안 떠요',
      '프리미엄 안돼서 환불해주세요', '프리미엄 안됐는데 지금 해결됐어요',
    ]) expect(isSafeYouTubeBuyerIntent(message, 'premium_lost')).toBe(false);
  });

  test('accepts only a high-confidence, unambiguous Jev decision', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ answers: { intent: {
      choice: 'invitation_wait', confidence: 0.98,
      probabilities: { invitation_wait: 0.98, country_mismatch: 0.01, other: 0.01 },
    } } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await classifyYouTubeBuyerIntent('초대는 언제 되나요?', 'Delivering', 'test-key')).toBe('invitation_wait');
    const [, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(options.body)).questions.intent.criteria).toHaveProperty('other');
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ answers: { intent: {
      choice: 'country_mismatch', confidence: 0.65,
      probabilities: { invitation_wait: 0.2, country_mismatch: 0.7, other: 0.1 },
    } } }), { status: 200 }));
    expect(await classifyYouTubeBuyerIntent('국가가 다르대요', 'Delivering', 'test-key')).toBe('other');
    const shortWait = () => new Response(JSON.stringify({ answers: { intent: {
      choice: 'invitation_wait', confidence: 0.83,
      probabilities: { invitation_wait: 0.89, country_mismatch: 0.01, other: 0.1 },
    } } }), { status: 200 });
    fetchMock.mockResolvedValueOnce(shortWait());
    expect(await classifyYouTubeBuyerIntent('초대장 안옵니다', 'Delivering', 'test-key')).toBe('invitation_wait');
    fetchMock.mockResolvedValueOnce(shortWait());
    expect(await classifyYouTubeBuyerIntent('아직도요?', 'Delivering', 'test-key')).toBe('other');
  });

  test('Jev separates post-delivery invitation and Premium issues by live order status', async () => {
    const fetchMock = vi.fn(async () => Response.json({ answers: { intent: {
      choice: 'delivered_no_invitation', confidence: 0.98,
      probabilities: { invitation_wait: 0.01, country_mismatch: 0, delivered_no_invitation: 0.98, premium_lost: 0, other: 0.01 },
    } } }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await classifyYouTubeBuyerIntent('계정 전달 완료인데 초대 메일을 못 받았어요', 'Delivered', 'test-key'))
      .toBe('delivered_no_invitation');
    expect(await classifyYouTubeBuyerIntent('계정 전달 완료인데 초대 메일을 못 받았어요', 'Delivering', 'test-key'))
      .toBe('other');
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.state).toContain('Order status: Delivered');
    expect(body.questions.intent.criteria).toHaveProperty('premium_lost');
    fetchMock.mockResolvedValueOnce(Response.json({ answers: { intent: {
      choice: 'premium_lost', confidence: 0.97,
      probabilities: { invitation_wait: 0, country_mismatch: 0, delivered_no_invitation: 0, premium_lost: 0.97, other: 0.03 },
    } } }));
    expect(await classifyYouTubeBuyerIntent('프리미엄 잘 되다가 풀렸어요', 'Using', 'test-key'))
      .toBe('premium_lost');
    fetchMock.mockResolvedValueOnce(Response.json({ answers: { intent: {
      choice: 'premium_lost', confidence: 0.75,
      probabilities: { invitation_wait: 0, country_mismatch: 0, delivered_no_invitation: 0.1, premium_lost: 0.8, other: 0.1 },
    } } }));
    expect(await classifyYouTubeBuyerIntent('가족 가입했는데 프리미엄이 안 떠요', 'Using', 'test-key'))
      .toBe('premium_lost');
  });

  test.each([
    { status: 'Delivered', buyerText: '배송 완료라고 뜨는데 아직 초대장이 안 왔습니다',
      intent: 'delivered_no_invitation' as const, reply: YOUTUBE_DELIVERED_NO_INVITATION_REPLY },
    { status: 'Using', buyerText: '가족 가입했는데 프리미엄이 안 떠요',
      intent: 'premium_lost' as const, reply: YOUTUBE_PREMIUM_LOST_REPLY },
  ])('replies once to $intent on a completed order', async ({ status, buyerText, intent, reply }) => {
    let journal: JevReplyJournal | null = { version: 1, startedAt: '2026-09-25T00:00:00.000Z', records: {} };
    const send = vi.fn(async () => true);
    const alertPostDeliveryIssue = vi.fn(async () => {});
    const classify = vi.fn(async () => intent);
    const current = deal(`post-${intent}`, status);
    const deps = {
      listDeals: async () => [current], listMessages: async () => [buyer(buyerText)],
      providerStatus: async () => status, classify, send, alertCountryIssue: vi.fn(async () => {}),
      alertPostDeliveryIssue,
      readJournal: () => journal,
      writeJournal: (value: JevReplyJournal) => { journal = structuredClone(value); },
      now: () => now,
    };
    expect(await syncYouTubeJevReplies(deps)).toMatchObject({ sent: 1, attempted: 1 });
    expect(classify).toHaveBeenCalledExactlyOnceWith(buyerText, status);
    expect(send).toHaveBeenCalledExactlyOnceWith(current, reply);
    expect(alertPostDeliveryIssue).toHaveBeenCalledExactlyOnceWith(current, intent);
    expect(await syncYouTubeJevReplies(deps)).toMatchObject({ sent: 0, attempted: 0 });
    expect(deps.alertCountryIssue).not.toHaveBeenCalled();
  });

  test('a renewed complaint after 24 hours alerts the seller without repeating the canned reply', async () => {
    let currentNow = now;
    let chat = [buyer('전달 완료인데 초대 메일이 안 왔어요')];
    let journal: JevReplyJournal | null = { version: 1, startedAt: '2026-09-25T00:00:00.000Z', records: {} };
    const send = vi.fn(async () => true);
    const alertPostDeliveryIssue = vi.fn(async () => {});
    const deps = {
      listDeals: async () => [deal('renewed', 'Delivered')], listMessages: async () => chat,
      providerStatus: async () => 'Delivered', classify: async () => 'delivered_no_invitation' as const,
      send, alertCountryIssue: vi.fn(async () => {}), alertPostDeliveryIssue,
      readJournal: () => journal,
      writeJournal: (value: JevReplyJournal) => { journal = structuredClone(value); },
      now: () => currentNow,
    };
    expect(await syncYouTubeJevReplies(deps)).toMatchObject({ sent: 1 });
    currentNow += 25 * 60 * 60_000;
    chat = [buyer('초대 메일 아직도 안 왔습니다', '2026.09.26 12:50'), ...chat];
    expect(await syncYouTubeJevReplies(deps)).toMatchObject({ sent: 0, ignored: 1 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(alertPostDeliveryIssue).toHaveBeenCalledTimes(2);
  });

  test('holds post-delivery reply when live status changes or the buyer says the issue is resolved', async () => {
    let chat: GraytagChatMessage[] = [buyer('전달 완료인데 초대장 안 왔어요')];
    let status = 'Canceled';
    let journal: JevReplyJournal | null = { version: 1, startedAt: '2026-09-25T00:00:00.000Z', records: {} };
    const send = vi.fn(async () => true);
    const deps = {
      listDeals: async () => [deal('post-check', 'Delivered')], listMessages: async () => chat,
      providerStatus: async () => status, classify: async () => 'delivered_no_invitation' as const,
      send, alertCountryIssue: vi.fn(async () => {}),
      readJournal: () => journal,
      writeJournal: (value: JevReplyJournal) => { journal = structuredClone(value); },
      now: () => now,
    };
    expect(await syncYouTubeJevReplies(deps)).toMatchObject({ sent: 0 });
    status = 'Delivered';
    chat = [buyer('초대장이 안 왔는데 지금 왔어요')];
    expect(await syncYouTubeJevReplies(deps)).toMatchObject({ sent: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  test('combines a split post-delivery complaint and keeps pre/post polling separate', async () => {
    let journal: JevReplyJournal | null = { version: 1, startedAt: '2026-09-25T00:00:00.000Z',
      postStartedAt: '2026-09-25T00:00:00.000Z', records: {} };
    const current = deal('split-post', 'Delivered');
    const classify = vi.fn(async () => 'delivered_no_invitation' as const);
    const send = vi.fn(async () => true);
    const deps = {
      listDeals: async () => [current],
      listMessages: async () => [buyer('초대 메일은 아직 안 왔어요', '2026.09.25 11:50'),
        buyer('전달 완료로 떠요', '2026.09.25 11:40')],
      providerStatus: async () => 'Delivered', classify, send, alertCountryIssue: vi.fn(async () => {}),
      readJournal: () => journal,
      writeJournal: (value: JevReplyJournal) => { journal = structuredClone(value); },
      now: () => now,
    };
    expect(await syncYouTubeJevReplies({ ...deps, scope: 'pre' })).toMatchObject({ sent: 0 });
    expect(classify).not.toHaveBeenCalled();
    expect(await syncYouTubeJevReplies({ ...deps, scope: 'post' })).toMatchObject({ sent: 1 });
    expect(classify).toHaveBeenCalledWith('전달 완료로 떠요\n초대 메일은 아직 안 왔어요', 'Delivered');
    expect(send).toHaveBeenCalledExactlyOnceWith(current, YOUTUBE_DELIVERED_NO_INVITATION_REPLY);
  });

  test('first post-delivery poll baselines past chats before any reply', async () => {
    let currentNow = now;
    let chat = [buyer('전달 완료인데 초대장 안 왔어요', '2026.09.25 11:50')];
    let journal: JevReplyJournal | null = { version: 1, startedAt: '2026-09-24T00:00:00.000Z', records: {} };
    const classify = vi.fn(async () => 'delivered_no_invitation' as const);
    const send = vi.fn(async () => true);
    const deps = {
      scope: 'post' as const, listDeals: async () => [deal('baseline-post', 'Delivered')],
      listMessages: async () => chat, providerStatus: async () => 'Delivered',
      classify, send, alertCountryIssue: vi.fn(async () => {}),
      readJournal: () => journal,
      writeJournal: (value: JevReplyJournal) => { journal = structuredClone(value); },
      now: () => currentNow,
    };
    expect(await syncYouTubeJevReplies(deps)).toMatchObject({ baselined: 1, sent: 0 });
    expect(classify).not.toHaveBeenCalled();
    expect(journal?.postStartedAt).toBe(new Date(currentNow).toISOString());
    expect(await syncYouTubeJevReplies(deps)).toMatchObject({ sent: 0 });
    currentNow += 10 * 60_000;
    chat = [buyer('아직도 초대장이 안 왔습니다', '2026.09.25 12:08'), ...chat];
    expect(await syncYouTubeJevReplies(deps)).toMatchObject({ sent: 0 });
    currentNow += 5 * 60_000;
    expect(await syncYouTubeJevReplies(deps)).toMatchObject({ sent: 1 });
    expect(send).toHaveBeenCalledTimes(1);
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

  test('keeps the existing single-message fingerprint after deployment', async () => {
    const room = 'room-existing';
    const message = buyer('초대 언제 되나요?', '2026.09.25 11:50');
    const fingerprint = createHash('sha256').update(`${room}\0${message.registeredDateTime}\0${message.message}`).digest('hex');
    const journal: JevReplyJournal = { version: 1, startedAt: '2026-09-25T00:00:00.000Z',
      records: { existing: { fingerprint, state: 'sent', updatedAt: '2026-09-25T02:55:00.000Z' } } };
    const classify = vi.fn(async () => 'invitation_wait' as const);
    const send = vi.fn(async () => true);
    expect(await syncYouTubeJevReplies({
      listDeals: async () => [deal('existing')], listMessages: async () => [message],
      providerStatus: async () => 'Delivering', classify, send, alertCountryIssue: async () => {},
      readJournal: () => journal, writeJournal: vi.fn(), now: () => now,
    })).toMatchObject({ sent: 0 });
    expect(classify).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
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

  test('combines buyer messages sent minutes apart before asking Jev', async () => {
    let journal: JevReplyJournal | null = { version: 1, startedAt: '2026-09-25T00:00:00.000Z', records: {} };
    const send = vi.fn(async () => true);
    const classify = vi.fn(async (text: string) => text.includes('초대장은') && text.includes('언제 오나요?')
      ? 'invitation_wait' as const : 'other' as const);
    const deps = {
      listDeals: async () => [deal('split')],
      listMessages: async () => [buyer('언제 오나요?', '2026.09.25 11:50'), buyer('초대장은', '2026.09.25 11:32')],
      providerStatus: async () => 'Delivering', classify, send, alertCountryIssue: async () => {},
      readJournal: () => journal,
      writeJournal: (value: JevReplyJournal) => { journal = structuredClone(value); },
      now: () => now,
    };
    expect(await syncYouTubeJevReplies(deps)).toMatchObject({ sent: 1 });
    expect(classify).toHaveBeenCalledWith('초대장은\n언제 오나요?', 'Delivering');
    expect(send).toHaveBeenCalledExactlyOnceWith(deal('split'), YOUTUBE_INVITATION_WAIT_REPLY);
    expect(await syncYouTubeJevReplies(deps)).toMatchObject({ sent: 0 });
  });

  test('recognizes a country error split across messages and stops at a seller reply or long pause', async () => {
    let chat: GraytagChatMessage[] = [
      buyer('다르다고 떠요', '2026.09.25 11:50'),
      buyer('초대장 누르면 국가가', '2026.09.25 11:35'),
    ];
    let journal: JevReplyJournal | null = { version: 1, startedAt: '2026-09-25T00:00:00.000Z', records: {} };
    const classify = vi.fn(async (text: string) => text.includes('국가가') && text.includes('다르다고 떠요')
      ? 'country_mismatch' as const : 'other' as const);
    const send = vi.fn(async () => true);
    const deps = {
      listDeals: async () => [deal('country-split')], listMessages: async () => chat,
      providerStatus: async () => 'Delivering', classify, send, alertCountryIssue: async () => {},
      readJournal: () => journal,
      writeJournal: (value: JevReplyJournal) => { journal = structuredClone(value); },
      now: () => now,
    };
    expect(await syncYouTubeJevReplies(deps)).toMatchObject({ sent: 1 });
    expect(classify).toHaveBeenCalledWith('초대장 누르면 국가가\n다르다고 떠요', 'Delivering');
    expect(send).toHaveBeenCalledExactlyOnceWith(deal('country-split'), YOUTUBE_COUNTRY_MISMATCH_REPLY);

    journal = { version: 1, startedAt: '2026-09-25T00:00:00.000Z', records: {} };
    classify.mockClear(); send.mockClear();
    chat = [...chat, seller('제가 확인하겠습니다', '2026.09.25 11:40')];
    expect(await syncYouTubeJevReplies(deps)).toMatchObject({ sent: 0 });
    expect(classify).toHaveBeenCalledWith('다르다고 떠요', 'Delivering');

    journal = { version: 1, startedAt: '2026-09-25T00:00:00.000Z', records: {} };
    classify.mockClear();
    chat = [buyer('다르다고 떠요', '2026.09.25 11:50'), buyer('초대장 누르면 국가가', '2026.09.25 11:19')];
    expect(await syncYouTubeJevReplies(deps)).toMatchObject({ sent: 0 });
    expect(classify).toHaveBeenCalledWith('다르다고 떠요', 'Delivering');
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
