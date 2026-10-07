import { describe, expect, test, vi } from 'vitest';
import { resolveYouTubeBuyerEmailWithContext } from '../src/api/youtube-email-context';
const buyer = (message: string) => ({ message, owned: false });
const seller = (message: string) => ({ message, owned: true });

describe('contextual YouTube email selection', () => {
  test('interprets even an explicit informal submission through the selected provider', async () => {
    const select = vi.fn(async () => 'buyer@gmail.com');
    expect(await resolveYouTubeBuyerEmailWithContext('room', [buyer('ID:buyer＠gmail．com입니다')], select)).toEqual(['buyer@gmail.com']);
    expect(select).toHaveBeenCalled();
  });

  test('imports a plain address without depending on an AI abstention', async () => {
    const select = vi.fn(async () => null);
    expect(await resolveYouTubeBuyerEmailWithContext('room', [buyer('buyer&#64;gmail.com')], select)).toEqual(['buyer@gmail.com']);
    expect(select).not.toHaveBeenCalled();
  });
  test('does not use the plain-address path after withdrawal or ambiguous context', async () => {
    const select = vi.fn(async () => null);
    expect(await resolveYouTubeBuyerEmailWithContext('room', [buyer('buyer@gmail.com'), buyer('잘못 보냈어요')], select)).toBeNull();
    expect(select).toHaveBeenCalled();
    expect(await resolveYouTubeBuyerEmailWithContext('room', [buyer('buyer@gmail.com'), seller('다른 계정으로 초대받으셔야 해요')], select)).toBeNull();
  });
  test('uses context to confirm a previously ambiguous selection without allowing an invented address', async () => {
    const messages = [buyer('first@gmail.com 또는 second@gmail.com'), buyer('두 번째 주소로 부탁드려요')];
    const select = vi.fn(async () => 'second@gmail.com');
    expect(await resolveYouTubeBuyerEmailWithContext('room', messages, select)).toEqual(['second@gmail.com']);
    expect(select).toHaveBeenCalledWith(['first@gmail.com', 'second@gmail.com'], expect.arrayContaining([{ role: 'buyer', text: '두 번째 주소로 부탁드려요' }]));
    expect(await resolveYouTubeBuyerEmailWithContext('room', messages, async () => 'made-up@gmail.com')).toBeNull();
  });

  test('asks about negation context instead of discarding an unrelated address', async () => {
    const select = vi.fn(async () => 'buyer@gmail.com');
    expect(await resolveYouTubeBuyerEmailWithContext('room', [buyer('buyer@gmail.com으로 초대해주세요. 새 계정은 아니에요')], select)).toEqual(['buyer@gmail.com']);
    expect(select).toHaveBeenCalled();
    expect(await resolveYouTubeBuyerEmailWithContext('room', [buyer('buyer@gmail.com은 아닙니다. 잘못 보냈어요')], async () => null)).toBeNull();
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

  test('coalesces repeated context checks but reclassifies a changed buyer message', async () => {
    const transport = vi.fn(async () => Response.json({ choices: [{message:{content: JSON.stringify({email:'VALUE_1',password:null,confidence:0.99})}}] }));
    vi.stubEnv('OPENROUTER_API_KEY', 'fixture-key');
    vi.stubGlobal('fetch', transport);
    try {
      const messages = [buyer('cache-first@gmail.com 또는 cache-second@gmail.com'), buyer('두 번째 부탁드려요')];
      expect(await Promise.all([resolveYouTubeBuyerEmailWithContext('cache-room', messages),
        resolveYouTubeBuyerEmailWithContext('cache-room', messages)])).toEqual([['cache-second@gmail.com'], ['cache-second@gmail.com']]);
      expect(transport).toHaveBeenCalledTimes(1);
      await resolveYouTubeBuyerEmailWithContext('cache-room', [...messages, buyer('방금 보낸 내용대로 부탁드립니다')]);
      expect(transport).toHaveBeenCalledTimes(2);
    } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
  });

});
