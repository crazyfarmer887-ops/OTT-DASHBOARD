import { describe, expect, test } from 'vitest';
import {
  buildYouTubeFamilyGroupCreateBody,
  buildYouTubeFamilyGroupPatchBody,
  parseYouTubeFamilyGroupsResponse,
  validateYouTubeFamilyGroupDraft,
  isYouTubeManagementService,
  partitionYouTubeManagementServices,
} from '../src/web/lib/youtube-family-groups';

const group = {
  id: 'youtube-family-group:1',
  label: '운영 그룹',
  managerEmailMasked: 'm***r@example.com',
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
});
