import { describe, expect, it, vi } from 'vitest';
import { CODE_REMINDER_MODEL, CODE_REMINDER_TEXT, classifyCodeRequest, processCodeReminder,
  type CodeReminderChat, type CodeReminderJournal } from '../src/scheduler/gbuts-code-reminder';
import { GbutsChatDeliveryError } from '../src/lib/gbuts-chat-delivery';
import { syncGbutsSpotifyChatAlerts } from '../src/scheduler/gbuts-spotify-chat-alerts';

function setup() {
  let journal: CodeReminderJournal = { version: 1, records: {} };
  const chat: CodeReminderChat = { postSeq: 12, roomId: 'ROOM12',
    member: { seq: 91, userSeq: 42, productId: '801', status: 'APPLY', cancelStatus: null },
    messages: [
      { senderSeq: 7, message: '이메일 인증코드 확인 방법은 위 링크 https://example.com 에 안내되어 있습니다.', messageType: 'TEXT', createdAt: '2026-10-22 19:00:00' },
      { senderSeq: 42, message: '이메일 인증번호 보내주세요', messageType: 'TEXT', createdAt: '2026-10-22 20:00:00' },
    ] };
  const deps = { sellerSeq: 7, startAt: '2026-10-22T10:30:00Z',
    listMembers: vi.fn(async () => [chat.member]), openPrivateRoom: vi.fn(async () => chat.roomId),
    getChat: vi.fn(async () => ({ messages: chat.messages })), classify: vi.fn(async () => true),
    sendText: vi.fn(async (_room: string, _seller: number, text: string) => {
      chat.messages.push({ senderSeq: 7, message: text, messageType: 'TEXT', createdAt: '2026-10-22T11:01:00Z' });
    }),
    readJournal: () => structuredClone(journal), writeJournal: (value: CodeReminderJournal) => { journal = structuredClone(value); },
    now: () => '2026-10-22T11:01:00Z',
  };
  return { chat, deps, journal: () => journal };
}
describe('GButs code reminder', () => {
  it('classifies a fresh buyer request, persists before send, verifies echo and survives restart', async () => {
    const s = setup();
    const realSend = s.deps.sendText.getMockImplementation()!;
    s.deps.sendText.mockImplementation(async (...args) => {
      expect(Object.values(s.journal().records)[0].state).toBe('attempted'); await realSend(...args);
    });
    await processCodeReminder(s.chat, s.deps);
    expect(s.deps.sendText).toHaveBeenCalledWith('ROOM12', 7, CODE_REMINDER_TEXT);
    expect(Object.values(s.journal().records)[0].state).toBe('confirmed');
    await processCodeReminder(s.chat, s.deps);
    expect(s.deps.sendText).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(s.journal())).not.toContain(s.chat.messages[1].message);
    expect(JSON.stringify(s.journal())).not.toContain('ROOM12');
  });
  it('confirms a provider echo truncated to seconds when the send started within that second', async () => {
    const s = setup();
    s.deps.now = () => '2026-10-22T11:01:00.700Z';
    await processCodeReminder(s.chat, s.deps);
    expect(Object.values(s.journal().records)[0].state).toBe('confirmed');
  });
  it('reconciles a second-precision echo after an uncertain send without sending again', async () => {
    const s = setup();
    s.deps.now = () => '2026-10-22T11:01:00.700Z';
    s.deps.sendText.mockRejectedValueOnce(new Error('unknown outcome'));
    await processCodeReminder(s.chat, s.deps);
    s.chat.messages.push({ senderSeq: 7, message: CODE_REMINDER_TEXT,
      messageType: 'TEXT', createdAt: '2026-10-22 20:01:00' });
    await processCodeReminder(s.chat, s.deps);
    expect(Object.values(s.journal().records)[0].state).toBe('confirmed');
    expect(s.deps.sendText).toHaveBeenCalledTimes(1);
  });
  it.each(['환불해주세요', '초대해주세요', '위 안내 읽었는데 코드가 안 와요', '이미 정독했는데 링크 오류입니다'])('ignores unrelated/escalated request: %s', async text => {
    const s = setup(); s.chat.messages[1].message = text;
    await processCodeReminder(s.chat, s.deps); expect(s.deps.sendText).not.toHaveBeenCalled();
  });
  it('does not tell customers to read a nonexistent guide', async () => {
    const s = setup(); s.chat.messages.shift(); await processCodeReminder(s.chat, s.deps);
    expect(s.deps.classify).not.toHaveBeenCalled();
  });
  it.each(['2026-10-22T09:00:00Z', '2026-10-22T11:02:00Z'])('ignores historical/future requests: %s', async createdAt => {
    const s = setup(); s.chat.messages[1].createdAt = createdAt; await processCodeReminder(s.chat, s.deps);
    expect(s.deps.classify).not.toHaveBeenCalled();
  });
  it('rechecks refunds and exact room after inference', async () => {
    const s = setup(); s.deps.listMembers.mockResolvedValue([{ ...s.chat.member, cancelStatus: 'REFUNDED' }]);
    await processCodeReminder(s.chat, s.deps); expect(s.deps.sendText).not.toHaveBeenCalled();
    s.deps.listMembers.mockResolvedValue([s.chat.member]); s.deps.openPrivateRoom.mockResolvedValue('OTHER');
    await processCodeReminder(s.chat, s.deps); expect(s.deps.sendText).not.toHaveBeenCalled();
  });
  it('does not send after a human replies during inference', async () => {
    const s = setup(); s.deps.classify.mockImplementation(async () => {
      s.chat.messages.push({ senderSeq: 7, message: '제가 확인해드리겠습니다.', messageType: 'TEXT', createdAt: '2026-10-22T11:00:30Z' }); return true;
    });
    await processCodeReminder(s.chat, s.deps); expect(s.deps.sendText).not.toHaveBeenCalled();
  });
  it('never resends an uncertain send, even for another request', async () => {
    const s = setup(); s.deps.sendText.mockRejectedValue(new Error('unknown outcome'));
    await processCodeReminder(s.chat, s.deps);
    s.chat.messages.push({ ...s.chat.messages[1], createdAt: '2026-10-22T11:00:40Z' });
    await processCodeReminder(s.chat, s.deps); expect(s.deps.sendText).toHaveBeenCalledTimes(1);
    expect(Object.values(s.journal().records)[0].state).toBe('attempted');
  });
  it('retries only a confirmed pre-submission connection failure', async () => {
    const s = setup(); s.deps.sendText.mockRejectedValueOnce(new GbutsChatDeliveryError('connection', false, true));
    await processCodeReminder(s.chat, s.deps); expect(Object.keys(s.journal().records)).toHaveLength(0);
    await processCodeReminder(s.chat, s.deps); expect(s.deps.sendText).toHaveBeenCalledTimes(2);
  });
  it('backs off after a confirmed reply and deduplicates model-negative decisions', async () => {
    const s = setup(); await processCodeReminder(s.chat, s.deps);
    s.chat.messages.push({ ...s.chat.messages[1], createdAt: '2026-10-22T11:01:00Z' });
    await processCodeReminder(s.chat, s.deps); expect(s.deps.sendText).toHaveBeenCalledTimes(1);
    const other = setup(); other.deps.classify.mockResolvedValue(false);
    await processCodeReminder(other.chat, other.deps); await processCodeReminder(other.chat, other.deps);
    expect(other.deps.classify).toHaveBeenCalledTimes(1); expect(other.deps.sendText).not.toHaveBeenCalled();
  });
  it('leaves model failures pending without sending', async () => {
    const s = setup(); s.deps.classify.mockRejectedValue(new Error('rate limit'));
    await expect(processCodeReminder(s.chat, s.deps)).rejects.toThrow();
    expect(s.deps.sendText).not.toHaveBeenCalled(); expect(Object.keys(s.journal().records)).toHaveLength(0);
  });
  it('preserves seller notifications when the reminder handler fails', async () => {
    const s = setup(); const sendAlert = vi.fn(async () => ({ sent: true as const, reason: 'sent' as const }));
    const readJournal = () => ({ version: 1 as const, sent: {} });
    const result = await syncGbutsSpotifyChatAlerts({ ...s.deps, sendAlert, readJournal, writeJournal: () => {},
      processBuyerChat: async () => { throw new Error('classifier unavailable'); } }, 12);
    expect(sendAlert).toHaveBeenCalledTimes(1); expect(result.failed).toBe(1);
  });
});

describe('OpenRouter free classification', () => {
  const reply = (content: string, finish_reason = 'stop') => new Response(JSON.stringify({ choices: [{ finish_reason, message: { content } }] }));
  it('uses only the free router, sends redacted request text and accepts a confident decision', async () => {
    const transport = vi.fn(async (_url: any, init: any) => {
      const body = JSON.parse(init.body);
      expect(body.model).toBe(CODE_REMINDER_MODEL); expect(body.models).toBeUndefined();
      expect(body.messages[1].content).not.toMatch(/buyer@example\.com|MySecret123!|123456|private-token/);
      return reply('{"emailCodeRequest":true,"confidence":0.99}');
    });
    expect(await classifyCodeRequest('buyer@example.com 비밀번호: MySecret123! 이메일 코드 123456 주세요 https://example.com/private-token', transport as typeof fetch, 'test-key')).toBe(true);
  });
  it.each(['{"emailCodeRequest":true,"confidence":0.8}', '{"emailCodeRequest":false,"confidence":1}'])('does not send for uncertain/negative output', async content => {
    expect(await classifyCodeRequest('메일 코드 주세요', async () => reply(content), 'test')).toBe(false);
  });
  it.each(['not json', '{"emailCodeRequest":"true","confidence":1}', '{"emailCodeRequest":true,"confidence":2}'])('rejects malformed model output', async content => {
    await expect(classifyCodeRequest('코드 주세요', async () => reply(content), 'test')).rejects.toThrow();
  });
  it('does not fall back to a paid model on rate limits', async () => {
    const transport = vi.fn(async () => new Response('', { status: 429 }));
    await expect(classifyCodeRequest('메일 코드 주세요', transport, 'test')).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(1);
  });
});
