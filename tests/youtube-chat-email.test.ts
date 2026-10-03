import { describe, expect, test } from 'vitest';
import { resolveYouTubeBuyerEmailFromChat } from '../src/api/youtube-chat-email';
import type { GraytagChatMessage } from '../src/api/chat-message-summary';

const buyer = (message: string, time = ''): GraytagChatMessage => ({ message, owned: false, messageType: 'Normal', registeredDateTime: time });
const seller = (message: string, time = ''): GraytagChatMessage => ({ message, owned: true, messageType: 'Normal', registeredDateTime: time });

describe('YouTube buyer email from chat', () => {
  test('decodes the HTML encoded at-sign in the real GrayTag transcript, then holds after an alternate-account request', () => {
    const messages = [
      { ...buyer('최광일님이 결제하셨습니다.', '2026.09.23 22:43'), messageType: 'Information' },
      seller('구매 감사합니다. Google 이메일 주소를 남겨주세요.', '2026.09.23 22:44'),
      buyer('khungs.nine1&#64;gmail.com 입니다', '2026.09.23 22:45'),
      buyer('기존에 다른 그룹으로 프리미엄 이용 중이었는데 지장 없을까요?', '2026.09.23 22:45'),
      seller('그러면 다른 계정으로 초대받으셔야 해요', '2026.09.23 22:47'),
      buyer('두번 바뀌지 않은거 같아요', '2026.09.23 22:49'),
      seller('일단 초대해드릴게요', '2026.09.23 22:50'),
    ];
    expect(resolveYouTubeBuyerEmailFromChat('room-1', messages.slice(0, 4))).toEqual(['khungs.nine1@gmail.com']);
    expect(resolveYouTubeBuyerEmailFromChat('room-1', messages)).toBeNull();
    expect(resolveYouTubeBuyerEmailFromChat('room-1', [...messages, buyer('새 주소는 second@gmail.com 입니다', '2026.09.23 22:51')]))
      .toEqual(['second@gmail.com']);
  });

  test('ignores seller and system addresses; blocks conflicting buyer addresses until clarified', () => {
    expect(resolveYouTubeBuyerEmailFromChat('room-1', [seller('support@gmail.com'),
      { ...buyer('buyer@gmail.com'), messageType: 'Information' }])).toEqual([]);
    expect(resolveYouTubeBuyerEmailFromChat('room-1', [buyer('first@gmail.com'), buyer('second@gmail.com')])).toBeNull();
    expect(resolveYouTubeBuyerEmailFromChat('room-1', [buyer('first@gmail.com'),
      buyer('정정합니다. second@gmail.com 으로 해주세요')])).toEqual(['second@gmail.com']);
    expect(resolveYouTubeBuyerEmailFromChat('room-1', [buyer('first@gmail.com 또는 second@gmail.com')])).toBeNull();
  });

  test('sorts timestamped messages before resolving seller corrections', () => {
    const messages = [buyer('new@gmail.com', '2026.09.23 22:51'),
      seller('다른 계정으로 초대받으셔야 해요', '2026.09.23 22:47'),
      buyer('old@gmail.com', '2026.09.23 22:45')];
    expect(resolveYouTubeBuyerEmailFromChat('room-1', messages)).toEqual(['new@gmail.com']);
  });

  test('waits a full five minutes before publishing an email from a minute-precision chat timestamp', () => {
    const messages = [buyer('buyer&#64;gmail.com', '2026.09.23 22:45')];
    const at = (time: string) => Date.parse(time);
    expect(resolveYouTubeBuyerEmailFromChat('room-1', messages, false, 5 * 60_000,
      at('2026-09-23T13:50:59Z'))).toBeNull();
    expect(resolveYouTubeBuyerEmailFromChat('room-1', messages, false, 5 * 60_000,
      at('2026-09-23T13:51:00Z'))).toEqual(['buyer@gmail.com']);
  });
});
