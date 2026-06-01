import { describe, expect, test } from 'vitest';
import {
  buildPartyAccessPublicPayload,
  createPartyAccessLinkRecord,
  enrichPartyAccessRecordWithKnownCredentials,
  isPartyAccessAllowed,
  normalizePartyAccessToken,
  normalizeEmailVerifyUrl,
  partyAccessTokenHash,
  resolvePartyAccessCredentials,
  buildPartyAccessDeliverySnapshotByMember,
  resolvePartyAccessDeliverySnapshotByListing,
  resolvePartyAccessDeliverySnapshotForDeal,
  buildPartyAccessDeliveryTemplate,
  buildPartyAccessProfileStatuses,
  syncPartyAccessStoreWithMembers,
  redactPartyAccessPayloadForConsent,
  isValidPartyAccessConsent,
  PARTY_ACCESS_CONSENT_PHRASES,
} from '../src/lib/party-access';
import { buildPartyAccessHtml } from '../src/lib/party-access-page-html';
import { mergePartyMaintenanceChecklistState } from '../src/lib/party-maintenance-checklist';

describe('party member account access links', () => {
  test('public preview hides credentials/profile before server-side consent is completed', () => {
    const record = createPartyAccessLinkRecord({
      token: 'consent-token',
      now: '2026-05-09T00:00:00.000Z',
      serviceType: '넷플릭스',
      accountEmail: 'nflx@example.com',
      fallbackPassword: 'secret-password',
      profileName: '사과',
      member: { kind: 'graytag', memberId: 'deal-1', memberName: '구매자', status: 'Using', endDateTime: '2026-08-07' },
    });
    const fullPayload = buildPartyAccessPublicPayload(record, {}, {}, '2026-05-10T00:00:00.000Z', { [record.tokenHash]: record });
    const preview = redactPartyAccessPayloadForConsent(fullPayload);

    expect(preview.ok).toBe(true);
    expect(preview.sensitiveRedacted).toBe(true);
    expect(preview.consentRequired).toBe(true);
    expect(preview.profileName).toBeUndefined();
    expect(preview.accountEmail).toBeUndefined();
    expect(preview.emailAccessUrl).toBeUndefined();
    expect(preview.partyProfiles).toBeUndefined();
    expect(preview.credentials).toBeUndefined();
    expect(isValidPartyAccessConsent([...PARTY_ACCESS_CONSENT_PHRASES])).toBe(true);
    expect(isValidPartyAccessConsent([PARTY_ACCESS_CONSENT_PHRASES[0]])).toBe(false);
  });

  test('prefers fill product profile assignment when an OnSale product becomes a Using deal', () => {
    const fillRecord = createPartyAccessLinkRecord({
      token: 'fill-token',
      now: '2026-05-09T00:00:00.000Z',
      serviceType: '넷플릭스',
      accountEmail: 'nflx9@example.com',
      profileName: '양말',
      member: { kind: 'graytag', memberId: 'fill:product-1', memberName: '구매자', status: 'OnSale', endDateTime: '2026-08-07' },
    });
    const staleDealRecord = createPartyAccessLinkRecord({
      token: 'deal-token',
      now: '2026-05-10T00:00:00.000Z',
      serviceType: '넷플릭스',
      accountEmail: 'nflx9@example.com',
      profileName: '딸기',
      member: { kind: 'graytag', memberId: 'deal-1', memberName: '구매자', status: 'Using', endDateTime: '2026-08-07' },
    });
    const snapshots = buildPartyAccessDeliverySnapshotByMember({
      [fillRecord.tokenHash]: fillRecord,
      [staleDealRecord.tokenHash]: staleDealRecord,
    });

    const snapshot = resolvePartyAccessDeliverySnapshotForDeal(snapshots, {
      serviceType: '넷플릭스',
      accountEmail: 'nflx9@example.com',
      dealUsid: 'deal-1',
      productUsid: 'product-1',
    });

    expect(snapshot?.profileName).toBe('양말');
  });

  test('management can map placeholder Graytag account text back to the real account via the fill access link', () => {
    const fillRecord = createPartyAccessLinkRecord({
      token: 'placeholder-fill-token',
      now: '2026-05-09T00:00:00.000Z',
      serviceType: '디즈니플러스',
      accountEmail: 'real-disney@example.com',
      fallbackPassword: 'real-password',
      profileName: '망고',
      member: { kind: 'graytag', memberId: 'fill:product-99', memberName: '구매자', status: 'OnSale', endDateTime: '2026-08-07' },
    });
    const snapshots = buildPartyAccessDeliverySnapshotByMember({ [fillRecord.tokenHash]: fillRecord });

    const snapshot = resolvePartyAccessDeliverySnapshotByListing(snapshots, {
      serviceType: '디즈니플러스',
      productUsid: 'product-99',
    });

    expect(snapshot?.accountEmail).toBe('real-disney@example.com');
    expect(snapshot?.password).toBe('real-password');
    expect(snapshot?.profileName).toBe('망고');
  });

  test('placeholder listing resolver ignores revoked links and prefers the newest active fill link', () => {
    const revoked = {
      ...createPartyAccessLinkRecord({
        token: 'old-fill-token',
        now: '2026-05-09T00:00:00.000Z',
        serviceType: '넷플릭스',
        accountEmail: 'old@example.com',
        profileName: '사과',
        member: { kind: 'graytag', memberId: 'fill:product-77', memberName: '구매자', status: 'OnSale', endDateTime: '2026-08-07' },
      }),
      revokedAt: '2026-05-10T00:00:00.000Z',
    };
    const newestActive = createPartyAccessLinkRecord({
      token: 'new-fill-token',
      now: '2026-05-11T00:00:00.000Z',
      serviceType: '넷플릭스',
      accountEmail: 'new@example.com',
      profileName: '망고',
      member: { kind: 'graytag', memberId: 'fill:product-77', memberName: '구매자', status: 'OnSale', endDateTime: '2026-08-07' },
    });
    const olderActive = createPartyAccessLinkRecord({
      token: 'middle-fill-token',
      now: '2026-05-10T12:00:00.000Z',
      serviceType: '넷플릭스',
      accountEmail: 'middle@example.com',
      profileName: '포도',
      member: { kind: 'graytag', memberId: 'fill:product-77', memberName: '구매자', status: 'OnSale', endDateTime: '2026-08-07' },
    });
    const snapshots = buildPartyAccessDeliverySnapshotByMember({
      [revoked.tokenHash]: revoked,
      [newestActive.tokenHash]: newestActive,
      [olderActive.tokenHash]: olderActive,
    });

    const snapshot = resolvePartyAccessDeliverySnapshotByListing(snapshots, {
      serviceType: '넷플릭스',
      productUsid: 'product-77',
    });

    expect(snapshot?.accountEmail).toBe('new@example.com');
    expect(snapshot?.profileName).toBe('망고');
  });

  test('creates a token-hashed link record and stores the share token for stable buyer URLs', () => {
    const token = '  AbC-123_secret  ';
    const record = createPartyAccessLinkRecord({
      token,
      now: '2026-05-03T00:00:00.000Z',
      serviceType: '디즈니플러스',
      accountEmail: 'party@example.com',
      fallbackPassword: 'old-pass',
      fallbackPin: '111222',
      member: { kind: 'graytag', memberId: 'deal-1', memberName: '남은사람', status: 'Using', endDateTime: '2026-05-20' },
    });

    expect(normalizePartyAccessToken(token)).toBe('AbC-123_secret');
    expect(record.tokenHash).toBe(partyAccessTokenHash('AbC-123_secret'));
    expect(record.shareToken).toBe('AbC-123_secret');
    expect(record.serviceType).toBe('디즈니플러스');
    expect(record.member.memberId).toBe('deal-1');
  });

  test('allows current party members and blocks ended or revoked members in real time by date/status', () => {
    const active = createPartyAccessLinkRecord({
      token: 'active-token', now: '2026-05-03T00:00:00.000Z', serviceType: '넷플릭스', accountEmail: 'n@example.com',
      member: { kind: 'graytag', memberId: 'deal-active', memberName: '활성', status: 'Using', endDateTime: '2026-05-04' },
    });
    const ended = createPartyAccessLinkRecord({
      token: 'ended-token', now: '2026-05-03T00:00:00.000Z', serviceType: '넷플릭스', accountEmail: 'n@example.com',
      member: { kind: 'graytag', memberId: 'deal-ended', memberName: '종료', status: 'Using', endDateTime: '2026-05-02' },
    });
    const cancelled = createPartyAccessLinkRecord({
      token: 'cancel-token', now: '2026-05-03T00:00:00.000Z', serviceType: '넷플릭스', accountEmail: 'n@example.com',
      member: { kind: 'manual', memberId: 'manual-1', memberName: '취소', status: 'cancelled', endDateTime: '2026-05-20' },
    });
    const nearExpiration = createPartyAccessLinkRecord({
      token: 'near-expiration-token', now: '2026-05-03T00:00:00.000Z', serviceType: '넷플릭스', accountEmail: 'n@example.com',
      member: { kind: 'graytag', memberId: 'deal-near', memberName: '임박', status: 'UsingNearExpiration', statusName: '종료임박', endDateTime: '2026-05-04' },
    });
    const withdrawn = createPartyAccessLinkRecord({
      token: 'withdrawn-token', now: '2026-05-03T00:00:00.000Z', serviceType: '넷플릭스', accountEmail: 'n@example.com',
      member: { kind: 'graytag', memberId: 'deal-withdrawn', memberName: '탈퇴', status: 'WithdrawnByBorrower', statusName: '탈퇴', endDateTime: '2026-05-20' },
    });
    const left = createPartyAccessLinkRecord({
      token: 'left-token', now: '2026-05-03T00:00:00.000Z', serviceType: '넷플릭스', accountEmail: 'n@example.com',
      member: { kind: 'graytag', memberId: 'deal-left', memberName: '나감', status: 'LeftParty', statusName: '파티 나감', endDateTime: '2026-05-20' },
    });
    const finished = createPartyAccessLinkRecord({
      token: 'finished-token', now: '2026-05-03T00:00:00.000Z', serviceType: '넷플릭스', accountEmail: 'n@example.com',
      member: { kind: 'graytag', memberId: 'deal-finished', memberName: '완료', status: 'NormalFinished', statusName: '거래완료', endDateTime: '2026-05-20' },
    });
    const revoked = { ...active, revokedAt: '2026-05-03T01:00:00.000Z' };

    expect(isPartyAccessAllowed(active, '2026-05-03T12:00:00.000Z')).toMatchObject({ allowed: true });
    expect(isPartyAccessAllowed(nearExpiration, '2026-05-03T12:00:00.000Z')).toMatchObject({ allowed: true });
    expect(isPartyAccessAllowed(ended, '2026-05-03T12:00:00.000Z')).toMatchObject({ allowed: false, reason: 'expired' });
    expect(isPartyAccessAllowed(cancelled, '2026-05-03T12:00:00.000Z')).toMatchObject({ allowed: false, reason: 'ended-status' });
    expect(isPartyAccessAllowed(withdrawn, '2026-05-03T12:00:00.000Z')).toMatchObject({ allowed: false, reason: 'ended-status' });
    expect(isPartyAccessAllowed(left, '2026-05-03T12:00:00.000Z')).toMatchObject({ allowed: false, reason: 'ended-status' });
    expect(isPartyAccessAllowed(finished, '2026-05-03T12:00:00.000Z')).toMatchObject({ allowed: false, reason: 'ended-status' });
    expect(isPartyAccessAllowed(revoked, '2026-05-03T12:00:00.000Z')).toMatchObject({ allowed: false, reason: 'revoked' });
  });

  test('returns latest checklist password and PIN over stale link fallback credentials', () => {
    const record = createPartyAccessLinkRecord({
      token: 'credential-token', now: '2026-05-03T00:00:00.000Z', serviceType: '디즈니플러스', accountEmail: 'party@example.com',
      fallbackPassword: 'old-pass', fallbackPin: '111222',
      member: { kind: 'graytag', memberId: 'deal-1', memberName: '남은사람', status: 'Using', endDateTime: '2026-05-20' },
    });
    const key = '디즈니플러스:party@example.com';
    const store = mergePartyMaintenanceChecklistState({}, key, {
      recruitAgain: true,
      passwordChanged: true,
      changedPassword: 'latest-pass',
      pinStillUnchanged: false,
      generatedPin: '654321',
      generatedPinAliasId: 123,
    }, 'tester');

    expect(resolvePartyAccessCredentials(record, store, {})).toEqual({
      id: 'party@example.com',
      password: 'latest-pass',
      pin: '654321',
      updatedAt: store[key].updatedAt,
    });
  });

  test('filters Graytag placeholder ID and PW out of public credentials', () => {
    const record = createPartyAccessLinkRecord({
      token: 'placeholder-public-token', now: '2026-05-03T00:00:00.000Z', serviceType: '디즈니플러스', accountEmail: '아래 메세지를 꼭 확인해주세요',
      fallbackPassword: '그래야 계정에 접근할 수 있습니다.', fallbackPin: '919693', profileName: '감귤',
      member: { kind: 'graytag', memberId: 'deal-placeholder', memberName: '구매자', status: 'Using', endDateTime: '2026-05-20' },
    });

    const payload = buildPartyAccessPublicPayload(record, {}, {}, '2026-05-03T12:00:00.000Z');
    expect(payload.ok).toBe(true);
    expect(payload.accountEmail).toBe('');
    expect(payload.credentials).toMatchObject({ id: '', password: '', pin: '919693' });
  });

  test('public payload never includes credentials for blocked members and logs allowed view metadata', () => {
    const record = createPartyAccessLinkRecord({
      token: 'payload-token', now: '2026-05-03T00:00:00.000Z', serviceType: '웨이브', accountEmail: 'w@example.com',
      fallbackPassword: 'pw', fallbackPin: '222333',
      member: { kind: 'graytag', memberId: 'deal-1', memberName: '남은사람', status: 'Using', endDateTime: '2026-05-20' },
    });
    const allowed = buildPartyAccessPublicPayload(record, {}, {}, '2026-05-03T12:00:00.000Z');
    expect(allowed.ok).toBe(true);
    expect(allowed.credentials).toMatchObject({ id: 'w@example.com', password: 'pw', pin: '' });
    expect(allowed.emailAccessUrl).toBe('');
    expect(allowed.audit).toMatchObject({ memberId: 'deal-1', allowed: true });

    const blocked = buildPartyAccessPublicPayload({ ...record, revokedAt: '2026-05-03T13:00:00.000Z' }, {}, {}, '2026-05-03T14:00:00.000Z');
    expect(blocked.ok).toBe(false);
    expect(blocked.credentials).toBeUndefined();
    expect(blocked.audit).toMatchObject({ memberId: 'deal-1', allowed: false, reason: 'revoked' });
  });

  test('public payload exposes profile name and email access link for buyer consent and email verification', () => {
    const record = createPartyAccessLinkRecord({
      token: 'profile-token', now: '2026-05-03T00:00:00.000Z', serviceType: '티빙', accountEmail: 'gtwavve7',
      fallbackPassword: 'pw', fallbackPin: '123456', profileName: '수달이', emailAccessUrl: 'https://email-verify.one/email/mail/42837058',
      member: { kind: 'manual', memberId: 'manual-1', memberName: '구매자', status: 'active', endDateTime: '2026-05-20' },
    });

    const payload = buildPartyAccessPublicPayload(record, {}, {}, '2026-05-03T12:00:00.000Z');
    expect(payload.ok).toBe(true);
    expect(payload.profileName).toBe('수달이');
    expect(payload.emailAccessUrl).toBe('https://email-verify.one/email/mail/42837058');
  });

  test('normalizes old email-verify.xyz links to the public email-verify.one domain', () => {
    expect(normalizeEmailVerifyUrl('http://email-verify.xyz/email/mail/123')).toBe('https://email-verify.one/email/mail/123');
    expect(normalizeEmailVerifyUrl('https://email-verify.xyz/email/mail/123')).toBe('https://email-verify.one/email/mail/123');
    expect(normalizeEmailVerifyUrl('http://email-verify.one/email/mail/123')).toBe('https://email-verify.one/email/mail/123');

    const record = createPartyAccessLinkRecord({
      token: 'legacy-email-domain-token', now: '2026-05-03T00:00:00.000Z', serviceType: '넷플릭스', accountEmail: 'n@example.com',
      fallbackPassword: 'pw', fallbackPin: '123456', emailAccessUrl: 'http://email-verify.xyz/email/mail/777',
      member: { kind: 'graytag', memberId: 'deal-1', memberName: '구매자', status: 'Using', endDateTime: '2026-05-20' },
    });
    const payload = buildPartyAccessPublicPayload(record, {}, {}, '2026-05-03T12:00:00.000Z');
    expect(record.emailAccessUrl).toBe('https://email-verify.one/email/mail/777');
    expect(payload.emailAccessUrl).toBe('https://email-verify.one/email/mail/777');
  });

  test('public payload derives email access URL from checklist or generated account when the link record missed it', () => {
    const record = createPartyAccessLinkRecord({
      token: 'derived-email-url-token', now: '2026-05-03T00:00:00.000Z', serviceType: '넷플릭스', accountEmail: 'n@example.com',
      fallbackPassword: 'pw', fallbackPin: '123456',
      member: { kind: 'graytag', memberId: 'deal-1', memberName: '구매자', status: 'Using', endDateTime: '2026-05-20' },
    });
    const key = '넷플릭스:n@example.com';
    const checklist = mergePartyMaintenanceChecklistState({}, key, { generatedPin: '654321', generatedPinAliasId: 98765 }, 'tester');

    const payload = buildPartyAccessPublicPayload(record, checklist, {}, '2026-05-03T12:00:00.000Z');
    expect(payload.emailAccessUrl).toBe('https://email-verify.one/email/mail/98765');
    expect(payload.credentials?.pin).toBe('654321');
  });

  test('웨이브 access payload suppresses email verification URL and PIN even when stored data has them', () => {
    const record = createPartyAccessLinkRecord({
      token: 'wavve-no-email-url-token', now: '2026-05-03T00:00:00.000Z', serviceType: '웨이브', accountEmail: 'wavve7@example.com',
      fallbackPassword: 'pw', fallbackPin: '777955', emailAccessUrl: 'https://email-verify.one/email/mail/42837058',
      member: { kind: 'graytag', memberId: 'deal-wavve', memberName: '구매자', status: 'Using', endDateTime: '2026-05-20' },
    });
    const key = '웨이브:wavve7@example.com';
    const checklist = mergePartyMaintenanceChecklistState({}, key, { generatedPin: '111222', generatedPinAliasId: 12345 }, 'tester');

    const payload = buildPartyAccessPublicPayload(record, checklist, {}, '2026-05-03T12:00:00.000Z');
    expect(payload.ok).toBe(true);
    expect(payload.emailAccessUrl).toBe('');
    expect(payload.credentials).toMatchObject({ id: 'wavve7@example.com', password: 'pw', pin: '' });
  });

  test('티빙 access page derives email access from the matched Wavve double-pass generated alias', () => {
    const tvingRecord = createPartyAccessLinkRecord({
      token: 'tving-email-url-token', now: '2026-05-03T00:00:00.000Z', serviceType: '티빙', accountEmail: 'gtwavve4',
      fallbackPassword: '', fallbackPin: '',
      member: { kind: 'graytag', memberId: 'deal-tving', memberName: '구매자', status: 'Using', endDateTime: '2026-05-20' },
    });
    const generatedStore = {
      'double-wavve4': {
        id: 'double-wavve4', serviceType: '티빙+웨이브', email: 'gtwavve4.fastball266@aleeas.com',
        password: 'pass4', pin: '444444', emailId: 444, memo: '', createdAt: '2026-05-01T00:00:00.000Z',
        paymentStatus: 'paid' as const, paidAt: '2026-05-01T00:01:00.000Z', source: 'account-generator' as const,
      },
    };

    const payload = buildPartyAccessPublicPayload(tvingRecord, {}, generatedStore, '2026-05-03T12:00:00.000Z');
    expect(payload.emailAccessUrl).toBe('https://email-verify.one/email/mail/444');
    expect(payload.credentials).toMatchObject({ id: 'gtwavve4', password: 'pass4', pin: '444444' });
  });

  test('웨이브 access page derives password from same-email double-pass generated account but still hides email and PIN', () => {
    const wavveRecord = createPartyAccessLinkRecord({
      token: 'wavve-double-pass-token', now: '2026-05-03T00:00:00.000Z', serviceType: '웨이브', accountEmail: 'gtwavve13.gout658@aleeas.com',
      fallbackPassword: '', fallbackPin: '',
      member: { kind: 'graytag', memberId: 'deal-wavve', memberName: '구매자', status: 'Using', endDateTime: '2026-05-20' },
    });
    const generatedStore = {
      'double-wavve13': {
        id: 'double-wavve13', serviceType: '티빙+웨이브', email: 'gtwavve13.gout658@aleeas.com',
        password: 'pass13', pin: '919693', emailId: 43949717, memo: '', createdAt: '2026-05-01T00:00:00.000Z',
        paymentStatus: 'paid' as const, paidAt: '2026-05-01T00:01:00.000Z', source: 'account-generator' as const,
      },
    };

    const payload = buildPartyAccessPublicPayload(wavveRecord, {}, generatedStore, '2026-05-03T12:00:00.000Z');
    expect(payload.emailAccessUrl).toBe('');
    expect(payload.credentials).toMatchObject({ id: 'gtwavve13.gout658@aleeas.com', password: 'pass13', pin: '' });
  });

  test('new access links inherit known email URL and PIN from older links for the same account', () => {
    const older = createPartyAccessLinkRecord({
      token: 'older-token', now: '2026-05-01T00:00:00.000Z', serviceType: '넷플릭스', accountEmail: 'n@example.com',
      fallbackPassword: 'old-pw', fallbackPin: '112233', emailAccessUrl: 'https://email-verify.one/email/mail/111',
      member: { kind: 'graytag', memberId: 'deal-old', memberName: '기존', status: 'Using', endDateTime: '2026-05-20' },
    });
    const blank = createPartyAccessLinkRecord({
      token: 'blank-token', now: '2026-05-05T00:00:00.000Z', serviceType: '넷플릭스', accountEmail: 'n@example.com',
      fallbackPassword: '', fallbackPin: '', emailAccessUrl: '',
      member: { kind: 'graytag', memberId: 'deal-new', memberName: '신규', status: 'Using', endDateTime: '2026-05-20' },
    });

    const enriched = enrichPartyAccessRecordWithKnownCredentials(blank, { [older.tokenHash]: older }, {}, {});
    expect(enriched.fallbackPassword).toBe('old-pw');
    expect(enriched.fallbackPin).toBe('112233');
    expect(enriched.emailAccessUrl).toBe('https://email-verify.one/email/mail/111');
  });

  test('syncs cancellation state from account management into access links and keeps delivery credentials as history', () => {
    const record = createPartyAccessLinkRecord({
      token: 'cancelled-sync-token',
      now: '2026-05-03T00:00:00.000Z',
      serviceType: '웨이브',
      accountEmail: 'wavve@example.com',
      fallbackPassword: 'delivered-pass',
      fallbackPin: '123456',
      member: { kind: 'graytag', memberId: 'deal-cancelled', memberName: '취소회원', status: 'Using', statusName: '이용중', endDateTime: '2026-05-30' },
    });

    const { store, changed } = syncPartyAccessStoreWithMembers({
      store: { [record.tokenHash]: record },
      members: [{ kind: 'graytag', memberId: 'deal-cancelled', status: 'CancelByNoShow', statusName: '거래취소', endDateTime: '2026-05-30' }],
      now: '2026-05-06T00:00:00.000Z',
    });
    const synced = store[record.tokenHash];

    expect(changed).toBe(true);
    expect(synced.member.status).toBe('CancelByNoShow');
    expect(synced.revokedAt).toBe('2026-05-06T00:00:00.000Z');
    expect(buildPartyAccessPublicPayload(synced, {}, {}, '2026-05-06T00:01:00.000Z')).toMatchObject({ ok: false });
    expect(buildPartyAccessDeliverySnapshotByMember(store).get('웨이브:wavve@example.com:graytag:deal-cancelled')).toMatchObject({
      password: 'delivered-pass',
      pin: '123456',
      revokedAt: '2026-05-06T00:00:00.000Z',
    });
  });

  test('uses the newest delivery history snapshot for the same party member', () => {
    const older = createPartyAccessLinkRecord({
      token: 'history-old', now: '2026-05-01T00:00:00.000Z', serviceType: '티빙', accountEmail: 'gtwavve7',
      fallbackPassword: 'old-pass', fallbackPin: '111111', member: { kind: 'graytag', memberId: 'deal-1', memberName: '회원', status: 'Using' },
    });
    const newer = createPartyAccessLinkRecord({
      token: 'history-new', now: '2026-05-02T00:00:00.000Z', serviceType: '티빙', accountEmail: 'gtwavve7',
      fallbackPassword: 'new-pass', fallbackPin: '222222', member: { kind: 'graytag', memberId: 'deal-1', memberName: '회원', status: 'Using' },
    });

    const snapshots = buildPartyAccessDeliverySnapshotByMember({ [older.tokenHash]: older, [newer.tokenHash]: newer });
    expect(snapshots.get('티빙:gtwavve7:graytag:deal-1')).toMatchObject({ password: 'new-pass', pin: '222222' });
  });

  test('public payload lists current same-account party profiles and excludes withdrawn/left/expired/cancelled members', () => {
    const mine = createPartyAccessLinkRecord({
      token: 'mine', now: '2026-05-01T00:00:00.000Z', serviceType: '넷플릭스', accountEmail: 'n@example.com', profileName: '사과',
      member: { kind: 'graytag', memberId: 'deal-mine', memberName: '나', status: 'Using', statusName: '이용중', endDateTime: '2026-06-01' },
    });
    const other = createPartyAccessLinkRecord({
      token: 'other', now: '2026-05-01T01:00:00.000Z', serviceType: '넷플릭스', accountEmail: 'n@example.com', profileName: '망고',
      member: { kind: 'graytag', memberId: 'deal-other', memberName: '옆자리', status: 'UsingNearExpiration', statusName: '종료임박', endDateTime: '2026-05-25' },
    });
    const checking = createPartyAccessLinkRecord({
      token: 'checking', now: '2026-05-01T01:30:00.000Z', serviceType: '넷플릭스', accountEmail: 'n@example.com', profileName: '자두',
      member: { kind: 'graytag', memberId: 'deal-checking', memberName: '확인중', status: 'DeliveredAndCheckPrepaid', statusName: '계정확인중', endDateTime: '2026-05-28' },
    });
    const expiredByDate = createPartyAccessLinkRecord({
      token: 'expired-date-profile', now: '2026-05-01T02:00:00.000Z', serviceType: '넷플릭스', accountEmail: 'n@example.com', profileName: '삭제대상',
      member: { kind: 'graytag', memberId: 'deal-expired-date', memberName: '기간만료', status: 'Using', statusName: '이용중', endDateTime: '2026-04-30' },
    });
    const withdrawn = createPartyAccessLinkRecord({
      token: 'withdrawn-profile', now: '2026-05-01T03:00:00.000Z', serviceType: '넷플릭스', accountEmail: 'n@example.com', profileName: '돌고래',
      member: { kind: 'graytag', memberId: 'deal-withdrawn', memberName: '탈퇴', status: 'WithdrawnByBorrower', statusName: '탈퇴', endDateTime: '2026-06-01' },
    });
    const left = createPartyAccessLinkRecord({
      token: 'left-profile', now: '2026-05-01T04:00:00.000Z', serviceType: '넷플릭스', accountEmail: 'n@example.com', profileName: '참새랑',
      member: { kind: 'graytag', memberId: 'deal-left', memberName: '나감', status: 'LeftParty', statusName: '파티 나감', endDateTime: '2026-06-01' },
    });
    const cancelled = createPartyAccessLinkRecord({
      token: 'cancelled-profile', now: '2026-05-01T05:00:00.000Z', serviceType: '넷플릭스', accountEmail: 'n@example.com', profileName: '취소자리',
      member: { kind: 'graytag', memberId: 'deal-cancelled-profile', memberName: '취소', status: 'CancelByNoShow', statusName: '거래취소', endDateTime: '2026-06-01' },
    });
    const normallyFinished = createPartyAccessLinkRecord({
      token: 'normally-finished-profile', now: '2026-05-01T06:00:00.000Z', serviceType: '넷플릭스', accountEmail: 'n@example.com', profileName: '완료자리',
      member: { kind: 'graytag', memberId: 'deal-finished-profile', memberName: '완료', status: 'NormalFinished', statusName: '거래완료', endDateTime: '2026-06-01' },
    });
    const onSale = createPartyAccessLinkRecord({
      token: 'on-sale-profile', now: '2026-05-01T07:00:00.000Z', serviceType: '넷플릭스', accountEmail: 'n@example.com', profileName: '판매중자리',
      member: { kind: 'graytag', memberId: 'fill:product-profile', memberName: '판매중', status: 'OnSale', statusName: '판매중', endDateTime: '2026-06-01' },
    });
    const otherAccount = createPartyAccessLinkRecord({
      token: 'other-account', now: '2026-05-01T08:00:00.000Z', serviceType: '넷플릭스', accountEmail: 'other@example.com', profileName: '다른계정',
      member: { kind: 'graytag', memberId: 'deal-other-account', memberName: '다른계정', status: 'Using', statusName: '이용중', endDateTime: '2026-06-01' },
    });
    const store = {
      [mine.tokenHash]: mine,
      [other.tokenHash]: other,
      [checking.tokenHash]: checking,
      [expiredByDate.tokenHash]: expiredByDate,
      [withdrawn.tokenHash]: withdrawn,
      [left.tokenHash]: left,
      [cancelled.tokenHash]: cancelled,
      [normallyFinished.tokenHash]: normallyFinished,
      [onSale.tokenHash]: onSale,
      [otherAccount.tokenHash]: otherAccount,
    };

    const profileAssignments = [
      {
        id: 'n@example.com:포도',
        productUsids: ['product-profile'],
        serviceType: '넷플릭스',
        accountEmail: 'n@example.com',
        emailAliasId: null,
        emailAlias: '',
        profileNickname: '포도',
        status: 'active' as const,
        warningCount: 0,
        createdAt: '2026-05-01T00:00:00.000Z',
        updatedAt: '2026-05-01T00:00:00.000Z',
      },
      {
        id: 'n@example.com:끝난자리',
        productUsids: ['ended-product'],
        serviceType: '넷플릭스',
        accountEmail: 'n@example.com',
        emailAliasId: null,
        emailAlias: '',
        profileNickname: '끝난자리',
        status: 'ended' as const,
        warningCount: 0,
        createdAt: '2026-05-01T00:00:00.000Z',
        updatedAt: '2026-05-01T00:00:00.000Z',
      },
    ];
    const statuses = buildPartyAccessProfileStatuses(mine, store, '2026-05-03T00:00:00.000Z', profileAssignments);
    expect(statuses.map((item) => item.profileName)).toEqual(['사과', '망고', '자두']);
    expect(statuses[0]).toMatchObject({ profileName: '사과', isCurrentMember: true });
    expect(statuses.find((item) => item.profileName === '포도')).toBeUndefined();

    const payload = buildPartyAccessPublicPayload(mine, {}, {}, '2026-05-03T00:00:00.000Z', store, profileAssignments);
    expect(payload.partyProfiles?.map((item) => item.profileName)).toEqual(['사과', '망고', '자두']);
  });

  test('builds the copyable manual delivery template around the party access URL', () => {
    const template = buildPartyAccessDeliveryTemplate('https://example.com/dashboard/access/token-1');
    expect(template).toContain('✅ 계정 업데이트 주소 : https://example.com/dashboard/access/token-1 ✅');
    expect(template).toContain('필수 동의 3가지 입력');
    expect(template).toContain('동의를 완료한 뒤 나오는 최신 계정 정보 확인');
    expect(template).toContain('추가회원 자리 기능은 절대 수정하지 마세요');
    expect(template).toContain('꼭 정해진 프로필 이름으로 만들어주세요');
    expect(template).toContain('로그인이 안될 때마다 직접 묻지 마시고 먼저 저 링크에서 업데이트 된 정보 확인');
  });

  test('serves a lightweight public access shell with updated profile and email verification copy', () => {
    const html = buildPartyAccessHtml('tok<en>&1');
    expect(html).toContain('window.__PARTY_ACCESS_TOKEN__="tok\\u003cen\\u003e\\u00261"');
    expect(html).toContain('고소장 실제사례 이미지');
    expect(html).toContain('/dashboard/access-notice-assets/complaint-case.jpg');
    expect(html).toContain('프로필 수정 화면 예시');
    expect(html).toContain('/dashboard/access-notice-assets/disney-profiles.jpg');
    expect(html).toContain('복사/붙여넣기 없이 직접 입력');
    expect(html).toContain('계정 정보 수정 금지');
    expect(html).toContain('계정 정보를 절대 변경하지 않겠습니다.');
    expect(html).toContain('로그인 안 될 때 이 페이지를 먼저 확인하겠습니다.');
    expect(html).toContain('배정된 1개 프로필만 사용하겠습니다.');
    expect(html).toContain('배정된 프로필 1개만 쓰고, 현황에 없는 프로필만 삭제하세요.');
    expect(html).not.toContain('구매자님 배정 프로필은');
    expect(html).not.toContain("el('div','assigned-name',profileName)");
    expect(html).not.toContain('card.appendChild(assigned)');
    expect(html).not.toContain('renderNoticeImage(profileName, payload.partyProfiles)');
    expect(html).not.toContain('const renderNoticeImage');
    expect(html).toContain('이메일 접근 PIN번호');
    expect(html).toContain('이메일 인증/핀번호 확인 링크');
    expect(html).toContain('이메일 인증 열기');
    expect(html).toContain('현재 파티원 프로필 현황');
    expect(html).toContain('프로필이 꽉 찼다면 위 현황에 없는 프로필을 삭제한 뒤');
    expect(html).not.toContain('status-chip');
    expect(html).not.toContain("profile.statusName || profile.status || '이용중'");
    expect(html).not.toContain('/dashboard/assets/');
  });
});
