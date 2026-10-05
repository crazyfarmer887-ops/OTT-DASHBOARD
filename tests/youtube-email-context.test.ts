import { describe, expect, test, vi } from 'vitest';
import { resolveYouTubeBuyerEmailWithContext, selectYouTubeEmailWithJev } from '../src/api/youtube-email-context';
const buyer = (message: string) => ({ message, owned: false });
const seller = (message: string) => ({ message, owned: true });

describe('contextual YouTube email selection', () => {
  test('does not wait for AI for an explicit informal submission', async () => {
    const select = vi.fn();
    expect(await resolveYouTubeBuyerEmailWithContext('room', [buyer('ID:buyer＠gmail．com입니다')], select)).toEqual(['buyer@gmail.com']);
    expect(select).not.toHaveBeenCalled();
  });

  test('uses context to confirm a previously ambiguous selection without allowing an invented address', async () => {
    const messages = [buyer('first@gmail.com 또는 second@gmail.com'), buyer('두 번째 주소로 부탁드려요')];
    const select = vi.fn(async () => 'second@gmail.com');
    expect(await resolveYouTubeBuyerEmailWithContext('room', messages, select)).toEqual(['second@gmail.com']);
    expect(select).toHaveBeenCalledWith(['first@gmail.com', 'second@gmail.com'], expect.arrayContaining([{ role: 'buyer', text: '두 번째 주소로 부탁드려요' }]));
    expect(await resolveYouTubeBuyerEmailWithContext('room', messages, async () => 'made-up@gmail.com')).toBeNull();
  });

  test('never revives an address after a seller asks for another account until the buyer writes an address again', async () => {
    const select = vi.fn(async () => 'old@gmail.com');
    expect(await resolveYouTubeBuyerEmailWithContext('room', [buyer('old@gmail.com'), seller('다른 계정으로 초대받으셔야 해요'), seller('일단 초대해드릴게요'), buyer('네 부탁드려요')], select)).toBeNull();
    expect(select).not.toHaveBeenCalled();
  });

  test('does not choose seller/system addresses and pauses after a buyer cancels', async () => {
    const select = vi.fn(async () => 'seller@gmail.com');
    expect(await resolveYouTubeBuyerEmailWithContext('room', [seller('seller@gmail.com'), { ...buyer('system@gmail.com'), informationMessage: true }], select)).toEqual([]);
    expect(await resolveYouTubeBuyerEmailWithContext('room', [buyer('old@gmail.com'), buyer('취소해주세요')], select)).toBeNull();
    expect(select).not.toHaveBeenCalled();
  });

  test('remains pending on classifier failure', async () => {
    expect(await resolveYouTubeBuyerEmailWithContext('room', [buyer('a@gmail.com 또는 b@gmail.com')], async () => { throw new Error('offline'); })).toBeNull();
  });

  test.each([
    ['email_1', 0.97, { email_0: 0.01, email_1: 0.97, none: 0.02 }, 'b@gmail.com'],
    ['email_1', 0.6, { email_0: 0.1, email_1: 0.6, none: 0.3 }, null],
    ['email_99', 1, { email_99: 1 }, null],
    ['none', 0.99, { none: 0.99 }, null],
  ])('validates Jev choice and confidence: %s', async (choice, confidence, probabilities, expected) => {
    const transport = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => Response.json({ answers: { address: { choice, confidence, probabilities } } }));
    const result = await selectYouTubeEmailWithJev(['a@gmail.com', 'b@gmail.com'], [{ role: 'buyer', text: '두번째로 해주세요' }], transport, 'fixture-key');
    expect(result).toBe(expected);
    const request = JSON.parse(String(transport.mock.calls[0]?.[1]?.body));
    expect(request.questions.address.criteria.email_1).toContain('b@gmail.com');
  });
});
