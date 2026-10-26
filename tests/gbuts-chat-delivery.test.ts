import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { buildGbutsNetflixDeliveryText, buildGbutsNetflixLegacyDeliveryText } from '../src/lib/gbuts-ott-templates';
import { sendGbutsText, sendGbutsSingleText } from '../src/scheduler/gbuts-spotify-messages';
import { GbutsChatDeliveryError, gbutsChatContainsText, splitGbutsChatText } from '../src/lib/gbuts-chat-delivery';

beforeEach(() => {
  vi.stubEnv('GBUTS_SESSION_PATH', '/nonexistent/gbuts-chat-test-session.json');
  vi.stubEnv('GBUTS_API_TOKEN', 'test-chat-token');
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });
const guide = buildGbutsNetflixLegacyDeliveryText('https://email-verify.one/dashboard/access/test-buyer', 1);
function broker({ echo = true, failConnect = false, frameBudget = false } = {}) {
  const accepted: string[] = [];
  class Socket {
    onopen?: () => void; onmessage?: (event: { data: string }) => void; onerror?: () => void; onclose?: () => void;
    constructor() { queueMicrotask(() => failConnect ? this.onerror?.() : this.onopen?.()); }
    send(frame: string) {
      if (frame.startsWith('CONNECT\n')) {
        const authenticated = frame.includes('\napi_key:Bearer test-chat-token\n');
        queueMicrotask(() => this.onmessage?.({ data: authenticated
          ? 'CONNECTED\nversion:1.2\n\n\0' : 'ERROR\nmessage:authentication required\n\n\0' }));
      }
      if (!frame.startsWith('SEND\n')) return;
      const payload = JSON.parse(frame.split('\n\n')[1].replace(/\0$/, ''));
      // Reproduces the observed silent rejection of long multibyte messages.
      if (frameBudget ? Buffer.byteLength(frame) > 1000 : Buffer.byteLength(payload.payload) > 500) return;
      accepted.push(payload.payload);
      if (echo) queueMicrotask(() => this.onmessage?.({ data: `MESSAGE\ndestination:/sub/chat/room/${payload.roomId}\n\n${JSON.stringify({ id: accepted.length, accountSeq: payload.accountSeq, type: 'TEXT', payload: payload.payload })}\0` }));
    }
    close() {}
  }
  vi.stubGlobal('WebSocket', Socket);
  return accepted;
}
test('authenticates the chat connection before sending the Spotify buyer guide', async () => {
  const accepted = broker();
  const { SPOTIFY_BUYER_GUIDE } = await import('../src/scheduler/gbuts-spotify-messages');
  await sendGbutsText('test-room', 99, SPOTIFY_BUYER_GUIDE);
  expect(accepted).toEqual(splitGbutsChatText(SPOTIFY_BUYER_GUIDE));
});

test('does not open an anonymous socket when the seller session is missing', async () => {
  vi.stubEnv('GBUTS_API_TOKEN', '');
  const Socket = vi.fn(); vi.stubGlobal('WebSocket', Socket);
  await expect(sendGbutsText('test-room', 99, '구매 감사합니다')).rejects.toMatchObject({ submitted: false, retryable: true });
  expect(Socket).not.toHaveBeenCalled();
});
test('delivers the full Korean guide through a broker that silently rejects oversized text', async () => {
  const accepted = broker();
  await sendGbutsText('test-room', 99, guide);
  expect(accepted).toEqual(splitGbutsChatText(guide));
  expect(accepted.length).toBeGreaterThan(1);
  expect(accepted.every(text => text.length <= 500 && Buffer.byteLength(text) <= 500)).toBe(true);
  expect(gbutsChatContainsText(accepted.map(message => ({ senderSeq: 99, messageType: 'TEXT', message })), 99, guide)).toBe(true);
});
test('connection success without a saved message is not delivery success', async () => {
  vi.useFakeTimers(); broker({ echo: false });
  const outcome = sendGbutsText('test-room', 99, guide);
  const assertion = expect(outcome).rejects.toMatchObject({ submitted: true });
  await vi.advanceTimersByTimeAsync(12_000); await assertion;
});
test('a failure before any SEND is distinguishable and can be retried safely', async () => {
  broker({ failConnect: true });
  await expect(sendGbutsText('test-room', 99, guide)).rejects.toMatchObject({ submitted: false });
  expect(new GbutsChatDeliveryError('failure', false).submitted).toBe(false);
});
test('history requires every approved part from the seller, including the private URL', () => {
  const chunks = splitGbutsChatText(guide);
  const messages = chunks.map(message => ({ senderSeq: 99, messageType: 'TEXT', message }));
  expect(gbutsChatContainsText(messages.slice(1), 99, guide)).toBe(false);
  expect(gbutsChatContainsText(messages.map(x => ({ ...x, senderSeq: 10 })), 99, guide)).toBe(false);
  expect(gbutsChatContainsText([{ senderSeq: 99, messageType: 'TEXT', message: guide }], 99, guide)).toBe(true);
});
test('splits a long paragraph without corrupting emoji, words or the account URL', () => {
  const text = `${'안녕하세요 😊 '.repeat(100)}https://example.com/private-token`;
  const chunks = splitGbutsChatText(text);
  expect(chunks.every(x => Buffer.byteLength(x) <= 500 && !/[\uD800-\uDBFF]$/.test(x))).toBe(true);
  expect(chunks.join(' ').replace(/\s+/g, ' ').trim()).toBe(text.replace(/\s+/g, ' ').trim());
  expect(chunks.at(-1)).toContain('https://example.com/private-token');
});

test('sends Netflix profile and password-only rules without an access link or forwarding promise', async () => {
  const url = 'https://email-verify.one/dashboard/access/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
  const text = buildGbutsNetflixDeliveryText(url, 5);
  const accepted = broker();
  await sendGbutsText('xxxxxxxxxxxx', 123456, text);
  expect(accepted).toHaveLength(3);
  expect(accepted[0]).toContain('5번');
  expect(accepted[1]).toContain('비밀번호로 로그인');
  expect(accepted[2]).toContain('[이용수칙]');
  expect(accepted[2]).toContain('이름·PIN 변경');
  expect(accepted.join(' ')).not.toContain(url);
  expect(accepted.join(' ')).not.toContain('접근 링크');
  expect(accepted[1]).toContain('이메일 인증·로그인 코드는 제공하지 않습니다.');
  expect(accepted.every(part => Buffer.byteLength(part) <= 500)).toBe(true);
  expect(accepted.every(part => !part.includes('\u2028'))).toBe(true);
  expect(gbutsChatContainsText(accepted.map(message => ({ senderSeq: 123456, messageType: 'TEXT', message })), 123456, text)).toBe(true);
  expect(gbutsChatContainsText(accepted.slice(0, 2).map(message => ({ senderSeq: 123456, messageType: 'TEXT', message })), 123456, text)).toBe(false);
});
test('single-message delivery rejects an oversized guide before opening a socket', async () => {
  const accepted = broker({ frameBudget: true });
  await expect(sendGbutsSingleText('test-room', 99, guide)).rejects.toMatchObject({ submitted: false });
  expect(accepted).toEqual([]);
});

test('a permanent size failure is explicit and cannot be mistaken for a retryable connection failure', async () => {
  const accepted = broker({ frameBudget: true });
  const text = buildGbutsNetflixDeliveryText('https://email-verify.one/dashboard/access/' + 'x'.repeat(500), 1);
  await expect(sendGbutsSingleText('x'.repeat(36), 123456, text)).rejects.toMatchObject({ submitted: false, retryable: false });
  expect(accepted).toEqual([]);
});
