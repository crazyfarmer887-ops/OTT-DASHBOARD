import { describe, expect, test, vi } from 'vitest';
import {
  YOUTUBE_NEW_SALE_GUIDE,
  YOUTUBE_NEW_SALE_GUIDE_CATEGORY,
  buildYouTubeEmailExtractionPrompt,
  buildYouTubeInvitationAlert,
  buildYouTubeNewSaleCandidate,
  isYouTubeAutoReplyProduct,
  parseYouTubeEmailExtractionJson,
  resolveYouTubeEmailModel,
  sendHumanReviewAlertIfEnabled,
  sendYouTubeInvitationAlert,
  shouldIncludeOffHoursNotice,
} from '../src/api/youtube-auto-reply';

describe('YouTube auto reply rules', () => {
  test('builds the exact sale guide only for a fresh trustworthy YouTube deal', () => {
    const startedAt = new Date('2026-08-22T00:00:00.000Z');
    const deal = {
      dealUsid: 'deal-new',
      chatRoomUuid: 'room-new',
      productTypeString: '유튜브',
      productName: 'YouTube Premium 가족 초대',
      dealStatus: 'Delivering',
      registeredDateTime: '2026-08-22T00:00:01.000Z',
    };

    expect(isYouTubeAutoReplyProduct(deal)).toBe(true);
    expect(buildYouTubeNewSaleCandidate(deal, startedAt)).toMatchObject({
      internalCategory: YOUTUBE_NEW_SALE_GUIDE_CATEGORY,
      message: YOUTUBE_NEW_SALE_GUIDE,
      dealUsid: 'deal-new',
    });
    expect(YOUTUBE_NEW_SALE_GUIDE).toBe(
      '유튜브 프리미엄 초대장 이용 안내입니다.\n\n' +
      '이메일을 남겨주시면 구매 당일 안으로는 초대해드리고 있습니다.  \n\n' +
      '만약 초대 수락 오류 발생 시 아래 링크를 꼭 확인해주세요\n\n' +
      'https://zrr.kr/xTL6y9',
    );
  });

  test('fails closed for historical, missing-time, on-sale, and non-YouTube deals', () => {
    const startedAt = new Date('2026-08-22T00:00:00.000Z');
    const base = {
      dealUsid: 'deal-1', chatRoomUuid: 'room-1', productTypeString: '유튜브',
      productName: '유튜브 프리미엄', dealStatus: 'Delivering',
    };
    expect(buildYouTubeNewSaleCandidate({ ...base, registeredDateTime: '2026-08-21T23:59:59.999Z' }, startedAt)).toBeNull();
    expect(buildYouTubeNewSaleCandidate(base, startedAt)).toBeNull();
    expect(buildYouTubeNewSaleCandidate({ ...base, dealStatus: 'OnSale', registeredDateTime: '2026-08-22T00:00:01Z' }, startedAt)).toBeNull();
    expect(buildYouTubeNewSaleCandidate({ ...base, productTypeString: 'Subscription', productName: '넷플릭스', registeredDateTime: '2026-08-22T00:00:01Z' }, startedAt)).toBeNull();
    expect(isYouTubeAutoReplyProduct({ productTypeString: '유튜브', productName: '유튜브 뮤직' })).toBe(false);
    expect(isYouTubeAutoReplyProduct({ productCategory: 'youtube', productTypeString: 'Subscription', productName: 'Premium' })).toBe(false);
  });

  test('accepts a fresh provider-local KST timestamp without treating it as host-local time', () => {
    const candidate = buildYouTubeNewSaleCandidate({
      dealUsid: 'deal-kst', chatRoomUuid: 'room-kst', productTypeString: '유튜브',
      productName: '유튜브 프리미엄', dealStatus: 'Delivering', registeredDateTime: '2026.08.22 09:00',
    }, new Date('2026-08-21T23:59:00Z'), new Date('2026-08-22T00:01:00Z'));
    expect(candidate).not.toBeNull();
  });

  test('uses the dedicated latest free Nano Omni model without changing general model env', () => {
    expect(resolveYouTubeEmailModel({})).toBe('nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free');
    expect(resolveYouTubeEmailModel({ AUTO_REPLY_YOUTUBE_EMAIL_MODEL: 'custom/model:free' })).toBe('custom/model:free');
    expect(resolveYouTubeEmailModel({ AUTO_REPLY_HERMES_MODEL: 'general/model' })).toBe('nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free');
  });

  test('prompts for one explicit email and validates strict model JSON', () => {
    const prompt = buildYouTubeEmailExtractionPrompt('제 초대 메일은 Buyer.Name+family@Example.COM 입니다');
    expect(prompt).toContain('{"email":string|null}');
    expect(prompt).toContain('Buyer.Name+family@Example.COM');
    expect(parseYouTubeEmailExtractionJson('{"email":"Buyer.Name+family@Example.COM"}')).toEqual({ email: 'buyer.name+family@example.com' });
    expect(parseYouTubeEmailExtractionJson('{"email":null}')).toEqual({ email: null });
    expect(parseYouTubeEmailExtractionJson('{"email":"not-an-email"}')).toEqual({ email: null });
    expect(parseYouTubeEmailExtractionJson('{"email":"first@example.com","other":"second@example.com"}')).toEqual({ email: null });
    expect(parseYouTubeEmailExtractionJson('email: buyer@example.com')).toEqual({ email: null });
  });

  test('resolves invitation alert through exact deal and family group only', () => {
    const jobs = [{ dealUsid: 'deal-exact', familyGroupId: 'group-exact' }] as any;
    const groups = [{ id: 'group-exact', managerEmail: 'Manager@Example.com' }] as any;
    expect(buildYouTubeInvitationAlert('deal-exact', 'Buyer@Example.com', jobs, groups)).toEqual({
      title: '유튜브 프리미엄 초대',
      body: '초대해야 할 이메일 : buyer@example.com\n초대할 수 있는 이메일 : manager@example.com',
    });
    expect(buildYouTubeInvitationAlert('deal-missing', 'buyer@example.com', jobs, groups)).toBeNull();
    expect(buildYouTubeInvitationAlert('deal-exact', 'buyer@example.com', jobs, [{ id: 'other', managerEmail: 'wrong@example.com' }] as any)).toBeNull();
  });

  test('dedupes invitation alert by message fingerprint through the durable job marker', async () => {
    const sender = vi.fn(async () => ({ sent: true as const, reason: 'sent' as const }));
    const first = await sendYouTubeInvitationAlert({
      alert: { title: '유튜브 프리미엄 초대', body: '초대해야 할 이메일 : buyer@example.com\n초대할 수 있는 이메일 : manager@example.com' },
      messageFingerprint: 'message-fingerprint',
      alreadySentAt: undefined,
      sender,
    });
    const second = await sendYouTubeInvitationAlert({
      alert: { title: '유튜브 프리미엄 초대', body: '초대해야 할 이메일 : buyer@example.com\n초대할 수 있는 이메일 : manager@example.com' },
      messageFingerprint: 'message-fingerprint',
      alreadySentAt: '2026-08-22T00:00:00Z',
      sender,
    });
    expect(first.sent).toBe(true);
    expect(second).toEqual({ sent: false, reason: 'already-sent' });
    expect(sender).toHaveBeenCalledTimes(1);
  });

  test('feature flags default on and false skips human sender or off-hours copy', async () => {
    const sender = vi.fn(async () => ({ sent: true as const, reason: 'sent' as const }));
    expect(shouldIncludeOffHoursNotice({})).toBe(true);
    expect(shouldIncludeOffHoursNotice({ AUTO_REPLY_OFF_HOURS_NOTICE_ENABLED: 'false' })).toBe(false);
    expect(await sendHumanReviewAlertIfEnabled({ AUTO_REPLY_HUMAN_ALERT_ENABLED: 'false' }, sender, {} as any)).toEqual({ sent: false, reason: 'disabled' });
    expect(sender).not.toHaveBeenCalled();
    await sendHumanReviewAlertIfEnabled({}, sender, {} as any);
    expect(sender).toHaveBeenCalledTimes(1);
  });
});
