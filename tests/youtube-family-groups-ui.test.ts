import { describe, expect, test } from 'vitest';
import {
  buildYouTubeFamilyGroupCreateBody,
  buildYouTubeFamilyGroupPatchBody,
  parseYouTubeFamilyGroupsResponse,
  parseYouTubeInvitationsResponse,
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

  test('summarizes active, pending, accepted, failed, vacancy, and email confirmation per family group', () => {
    const invitations = [
      { id:'active', familyGroupId:group.id, buyerName:'활성', buyerEmailMasked:'a***e@example.com', endDateTime:'2027-08-01T00:00:00.000Z', status:'active' as const, updatedAt:'2026-08-12T00:00:00.000Z' },
      { id:'accepted', familyGroupId:group.id, buyerName:'수락', buyerEmailMasked:'o***k@example.com', endDateTime:null, status:'delivered_waiting_inspection' as const, updatedAt:'2026-08-11T00:00:00.000Z' },
      { id:'pending', familyGroupId:group.id, buyerName:'대기', buyerEmailMasked:null, endDateTime:null, status:'waiting_for_buyer_email' as const, updatedAt:'2026-08-10T00:00:00.000Z' },
      { id:'failed', familyGroupId:group.id, buyerName:'실패', buyerEmailMasked:'f***d@example.com', endDateTime:null, status:'failed' as const, updatedAt:'2026-08-09T00:00:00.000Z' },
      { id:'other', familyGroupId:'other-group', buyerName:'다른 그룹', buyerEmailMasked:null, endDateTime:null, status:'active' as const, updatedAt:'2026-08-13T00:00:00.000Z' },
    ];
    expect(summarizeYouTubeFamilyGroup(group, invitations)).toMatchObject({
      activeCount: 1, pendingCount: 1, acceptedCount: 1, failedCount: 1,
      occupiedSeats: 2, availableSeats: 3,
      members: [invitations[0], invitations[1], invitations[2], invitations[3]],
    });
  });
});
