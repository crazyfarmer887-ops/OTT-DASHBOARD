import { describe, expect, test } from 'vitest';
import {
  buildYouTubeFamilyGroupCreateBody,
  buildYouTubeFamilyGroupPatchBody,
  parseYouTubeFamilyGroupsResponse,
  parseYouTubeInvitationsResponse,
  parseYouTubeProductRegistrationsResponse,
  getYouTubeRegistrationDisplayLabel,
  summarizeYouTubeFamilyGroup,
  validateYouTubeFamilyGroupDraft,
  isYouTubeManagementService,
  partitionYouTubeManagementServices,
} from '../src/web/lib/youtube-family-groups';

const group = {
  id: 'youtube-family-group:1',
  label: '운영 그룹',
  managerEmailMasked: 'm***r@example.com',
  listingCode: 'manger',
  subscriptionEndDate: '2027-08-11',
  sellableSeats: 5,
  availableSeats: 3,
  enabled: true,
  createdAt: '2026-08-11T00:00:00.000Z',
  updatedAt: '2026-08-11T00:00:00.000Z',
};

describe('YouTube family-group management UI helpers', () => {
  test('allowlists safe list DTO fields and rejects malformed responses', () => {
    expect(parseYouTubeFamilyGroupsResponse({
      ok: true,
      enabled: true,
      familyGroups: [{ ...group, managerEmail: 'raw@example.com', unexpected: 'secret' }],
    })).toEqual({ enabled: true, familyGroups: [group] });
    expect(parseYouTubeFamilyGroupsResponse({ ok: true, enabled: true, familyGroups: [{ ...group, availableSeats: -1 }] })).toBeNull();
    expect(parseYouTubeFamilyGroupsResponse({ ok: true, enabled: true, familyGroups: [{ ...group, managerEmailMasked: 'raw@example.com' }] })).toBeNull();
    expect(parseYouTubeFamilyGroupsResponse({ ok: true, enabled: true, familyGroups: [{ ...group, label: 'unsafe\nlabel' }] })).toBeNull();
    expect(parseYouTubeFamilyGroupsResponse({ ok: true, enabled: true, familyGroups: [{ ...group, updatedAt: 'not-a-date' }] })).toBeNull();
    expect(parseYouTubeFamilyGroupsResponse({ ok: true, enabled: 'yes', familyGroups: [] })).toBeNull();
  });

  test('validates label, email, real date, seats range, and occupied-seat floor', () => {
    const valid = { label: ' 새 그룹 ', managerEmail: 'manager@example.com', subscriptionEndDate: '2027-08-11', sellableSeats: '5' };
    expect(validateYouTubeFamilyGroupDraft(valid)).toBeNull();
    expect(validateYouTubeFamilyGroupDraft({ ...valid, label: ' ' })).toContain('이름');
    expect(validateYouTubeFamilyGroupDraft({ ...valid, managerEmail: 'not-an-email' })).toContain('이메일');
    expect(validateYouTubeFamilyGroupDraft({ ...valid, subscriptionEndDate: '2027-02-30' })).toContain('날짜');
    expect(validateYouTubeFamilyGroupDraft({ ...valid, sellableSeats: '21' })).toContain('1~20');
    expect(validateYouTubeFamilyGroupDraft({ ...valid, sellableSeats: '1' }, { occupiedSeats: 2 })).toContain('사용 중인 2석');
    expect(validateYouTubeFamilyGroupDraft({ ...valid, managerEmail: '' }, { allowBlankEmail: true, occupiedSeats: 2 })).toBeNull();
  });

  test('builds exact create fields and only changed patch fields while blank edit email is omitted', () => {
    expect(buildYouTubeFamilyGroupCreateBody({
      label: ' 새 그룹 ', managerEmail: ' Manager@Example.com ', subscriptionEndDate: '', sellableSeats: '5',
    })).toEqual({ label: '새 그룹', managerEmail: 'Manager@Example.com', subscriptionEndDate: null, sellableSeats: 5 });

    expect(buildYouTubeFamilyGroupPatchBody(group, {
      label: '운영 그룹', managerEmail: '', subscriptionEndDate: '2027-08-11', sellableSeats: '5',
    })).toEqual({});
    expect(buildYouTubeFamilyGroupPatchBody(group, {
      label: '변경 그룹', managerEmail: 'new@example.com', subscriptionEndDate: '', sellableSeats: '6',
    })).toEqual({ label: '변경 그룹', managerEmail: 'new@example.com', subscriptionEndDate: null, sellableSeats: 6 });
  });

  test('separates legacy YouTube transactions from credential accounts without guessing mappings', () => {
    expect(isYouTubeManagementService('유튜브')).toBe(true);
    expect(isYouTubeManagementService(' YouTube Premium ')).toBe(true);
    expect(isYouTubeManagementService('넷플릭스')).toBe(false);
    const services = [{ serviceType: '넷플릭스' }, { serviceType: '유튜브 프리미엄' }];
    expect(partitionYouTubeManagementServices(services)).toEqual({
      credentialServices: [services[0]],
      unmappedYouTubeServices: [services[1]],
    });
  });

  test('parses privacy-safe invitation rows and rejects raw or malformed email data', () => {
    const invitation = {
      id: 'invitation-safe', familyGroupId: group.id, buyerName: '구매자',
      productDisplayId: 'product-123456789abc',
      buyerEmailMasked: 'b***r@example.com', endDateTime: '2027-08-01T00:00:00.000Z',
      status: 'email_confirmed', updatedAt: '2026-08-11T00:00:00.000Z',
    };
    expect(parseYouTubeInvitationsResponse({ ok: true, enabled: true, invitations: [
      { ...invitation, dealDisplayId: 'deal-safe', history: [], buyerGoogleEmail: 'raw@example.com' },
    ] })).toEqual({ enabled: true, invitations: [invitation] });
    expect(parseYouTubeInvitationsResponse({ ok: true, enabled: true, invitations: [
      { ...invitation, buyerEmailMasked: 'raw@example.com' },
    ] })).toBeNull();
    expect(parseYouTubeInvitationsResponse({ ok: true, enabled: true, invitations: [
      { ...invitation, status: 'unknown' },
    ] })).toBeNull();
    expect(parseYouTubeInvitationsResponse({ ok: true, enabled: true, invitations: [
      { ...invitation, endDateTime: 'not-a-date' },
    ] })).toBeNull();
    expect(parseYouTubeInvitationsResponse({ ok: true, enabled: true, invitations: [
      { ...invitation, updatedAt: '2026-08-11' },
    ] })).toBeNull();
  });

  test('allowlists validated raw productUsid for admin links and rejects malformed values', () => {
    const registration = {
      registrationDisplayId: 'registration-123456789abc',
      productDisplayId: 'product-123456789abc',
      productUsid: 'raw-product_123',
      familyGroupId: group.id,
      status: 'registered' as const,
      createdAt: '2026-08-11T00:00:00.000Z',
      updatedAt: '2026-08-11T00:00:01.000Z',
    };
    expect(parseYouTubeProductRegistrationsResponse({ ok: true, enabled: true, registrations: [{
      ...registration,
      idempotencyKey: 'raw-request-key', actor: 'raw-actor', unexpected: 'secret',
    }] })).toEqual({ enabled: true, registrations: [registration] });
    expect(parseYouTubeProductRegistrationsResponse({ ok: true, enabled: true, registrations: [{ ...registration, productUsid: 'bad/value' }] })).toBeNull();
    expect(parseYouTubeProductRegistrationsResponse({ ok: true, enabled: true, registrations: [{ ...registration, productUsid: 'a'.repeat(201) }] })).toBeNull();
    expect(parseYouTubeProductRegistrationsResponse({ ok: true, enabled: true, registrations: [{ ...registration, status: 'unknown' }] })).toBeNull();
    expect(parseYouTubeProductRegistrationsResponse({ ok: true, enabled: true, registrations: [{ ...registration, registrationDisplayId: 'unsafe' }] })).toBeNull();
    expect(parseYouTubeProductRegistrationsResponse({ ok: true, enabled: true, registrations: [{ ...registration, productDisplayId: null, productUsid: null, status: 'submitting' }] })).not.toBeNull();
    expect(parseYouTubeProductRegistrationsResponse({ ok: true, enabled: true, registrations: [{ ...registration, createdAt: 'not-a-date' }] })).toBeNull();
  });

  test('summarizes registrations newest-first and links invitations only within the exact family group', () => {
    const invitations = [
      { id:'active', productDisplayId:'product-aaaaaaaaaaaa', familyGroupId:group.id, buyerName:'활성', buyerEmailMasked:'a***e@example.com', endDateTime:'2027-08-01T00:00:00.000Z', status:'active' as const, updatedAt:'2026-08-12T00:00:00.000Z' },
      { id:'accepted', productDisplayId:'product-accepted000', familyGroupId:group.id, buyerName:'수락', buyerEmailMasked:'o***k@example.com', endDateTime:null, status:'delivered_waiting_inspection' as const, updatedAt:'2026-08-11T00:00:00.000Z' },
      { id:'pending', productDisplayId:'product-pending0000', familyGroupId:group.id, buyerName:'대기', buyerEmailMasked:null, endDateTime:null, status:'waiting_for_buyer_email' as const, updatedAt:'2026-08-10T00:00:00.000Z' },
      { id:'failed', productDisplayId:'product-failed00000', familyGroupId:group.id, buyerName:'실패', buyerEmailMasked:'f***d@example.com', endDateTime:null, status:'failed' as const, updatedAt:'2026-08-09T00:00:00.000Z' },
      { id:'other', productDisplayId:'product-aaaaaaaaaaaa', familyGroupId:'other-group', buyerName:'다른 그룹', buyerEmailMasked:null, endDateTime:null, status:'active' as const, updatedAt:'2026-08-13T00:00:00.000Z' },
    ];
    const registrations = [
      { registrationDisplayId:'registration-aaaaaaaaaaaa', productDisplayId:'product-aaaaaaaaaaaa', familyGroupId:group.id, status:'registered' as const, createdAt:'2026-08-09T00:00:00.000Z', updatedAt:'2026-08-09T00:00:01.000Z' },
      { registrationDisplayId:'registration-bbbbbbbbbbbb', productDisplayId:null, familyGroupId:group.id, status:'submitting' as const, createdAt:'2026-08-12T00:00:00.000Z', updatedAt:'2026-08-12T00:00:01.000Z' },
      { registrationDisplayId:'registration-cccccccccccc', productDisplayId:null, familyGroupId:group.id, status:'uncertain' as const, createdAt:'2026-08-11T00:00:00.000Z', updatedAt:'2026-08-11T00:00:01.000Z' },
      { registrationDisplayId:'registration-dddddddddddd', productDisplayId:'product-dddddddddddd', familyGroupId:group.id, status:'failed' as const, createdAt:'2026-08-10T00:00:00.000Z', updatedAt:'2026-08-10T00:00:01.000Z' },
      { registrationDisplayId:'registration-eeeeeeeeeeee', productDisplayId:'product-aaaaaaaaaaaa', familyGroupId:'other-group', status:'registered' as const, createdAt:'2026-08-13T00:00:00.000Z', updatedAt:'2026-08-13T00:00:01.000Z' },
    ];
    expect(summarizeYouTubeFamilyGroup(group, invitations, registrations)).toMatchObject({
      activeCount: 1, pendingCount: 1, acceptedCount: 1, failedCount: 1,
      occupiedSeats: 2, availableSeats: 3,
      members: [invitations[0], invitations[1], invitations[2], invitations[3]],
      registeredRegistrationCount: 1, pendingRegistrationCount: 1,
      uncertainRegistrationCount: 1, failedRegistrationCount: 1,
      registrations: [
        { ...registrations[1], invitation: null },
        { ...registrations[2], invitation: null },
        { ...registrations[3], invitation: null },
        { ...registrations[0], invitation: invitations[0] },
      ],
    });
  });

  test('counts only registered attempts as sales listings and keeps all attempts as registration records', () => {
    const registrations = (['registered', 'submitting', 'uncertain', 'failed'] as const).map((status, index) => ({
      registrationDisplayId: `registration-${String(index + 1).repeat(12)}`,
      productDisplayId: status === 'registered' ? 'product-111111111111' : null,
      familyGroupId: group.id,
      status,
      createdAt: `2026-08-1${index}T00:00:00.000Z`,
      updatedAt: `2026-08-1${index}T00:00:01.000Z`,
    }));

    const summary = summarizeYouTubeFamilyGroup(group, [], registrations);
    expect(summary.registeredRegistrationCount).toBe(1);
    expect(summary.registrations).toHaveLength(4);
  });

  test('labels unlinked registration attempts by lifecycle state', () => {
    expect(getYouTubeRegistrationDisplayLabel('registered')).toBe('구매 대기');
    expect(getYouTubeRegistrationDisplayLabel('submitting')).toBe('등록 처리 중');
    expect(getYouTubeRegistrationDisplayLabel('uncertain')).toBe('등록 결과 확인 필요');
    expect(getYouTubeRegistrationDisplayLabel('failed')).toBe('등록 실패');
  });

  test('keeps an all-registered five-listing target as five sales and five purchase waits', () => {
    const registrations = Array.from({ length: 5 }, (_, index) => ({
      registrationDisplayId: `registration-${String(index + 1).repeat(12)}`,
      productDisplayId: `product-${String(index + 1).repeat(12)}`,
      familyGroupId: group.id,
      status: 'registered' as const,
      createdAt: `2026-08-1${index}T00:00:00.000Z`,
      updatedAt: `2026-08-1${index}T00:00:01.000Z`,
    }));
    const summary = summarizeYouTubeFamilyGroup(group, [], registrations);

    expect(summary.registeredRegistrationCount).toBe(5);
    expect(summary.registrations.map(registration => getYouTubeRegistrationDisplayLabel(registration.status)))
      .toEqual(Array(5).fill('구매 대기'));
  });
});
