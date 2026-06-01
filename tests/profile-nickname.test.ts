import { describe, expect, test } from 'vitest';
import {
  buildProfileAssignment,
  buildProfileWarningMemo,
  generateProfileNickname,
  generateUniqueProfileNicknames,
  normalizeProfileNickname,
  isValidProfileNickname,
  profileNicknameForPartyMember,
  stableRandomFromSeed,
  PROFILE_NICKNAME_DICTIONARY,
} from '../src/lib/profile-nickname';

describe('profile nickname assignment', () => {
  test('dictionary contains only familiar 2-4 character everyday Korean words', () => {
    expect(PROFILE_NICKNAME_DICTIONARY.length).toBeGreaterThanOrEqual(40);
    const requiredCommonWords = ['사과', '망고', '숟가락', '젓가락'];
    const bannedNameStyle = ['민준이', '서준이', '지우님', '하랑이'];
    const bannedAwkwardNames = ['치타별', '라마야', '고래별', '참새랑', '레몬톡', '라임톡', '체리봉'];
    const bannedNegativeWords = ['휴지통', '쓰레기통', '쓰레기', '먼지', '곰팡이', '벌레'];
    const names = PROFILE_NICKNAME_DICTIONARY.map((item) => item.name);
    for (const name of requiredCommonWords) expect(names).toContain(name);
    for (const name of [...bannedNameStyle, ...bannedAwkwardNames, ...bannedNegativeWords]) expect(names).not.toContain(name);
    for (const item of PROFILE_NICKNAME_DICTIONARY) {
      expect(item.category).toBe('common-word');
      expect(Array.from(item.name).length).toBeGreaterThanOrEqual(2);
      expect(Array.from(item.name).length).toBeLessThanOrEqual(4);
      expect(item.name).toMatch(/^[가-힣]+$/);
    }
  });

  test('generates a stable random nickname from the dictionary', () => {
    const nickname = generateProfileNickname(() => 0);
    expect(nickname).toBe(PROFILE_NICKNAME_DICTIONARY[0].name);
    expect(Array.from(nickname).length).toBeGreaterThanOrEqual(2);
    expect(Array.from(nickname).length).toBeLessThanOrEqual(4);
  });

  test('generates distinct profile names for multiple fill registrations', () => {
    const names = generateUniqueProfileNicknames(4, '사과', () => 0);

    expect(names).toHaveLength(4);
    expect(names[0]).toBe('사과');
    expect(new Set(names).size).toBe(4);
    for (const name of names) expect(isValidProfileNickname(name)).toBe(true);
  });

  test('avoids profile names that already exist on the account, including cancelled deals', () => {
    const names = generateUniqueProfileNicknames(3, '사과', () => 0, ['사과', '망고', '바나나']);
    const normalizedExisting = new Set(['사과', '망고', '바나나'].map(normalizeProfileNickname));

    expect(names).toHaveLength(3);
    expect(new Set(names).size).toBe(3);
    for (const name of names) {
      expect(normalizedExisting.has(name)).toBe(false);
      expect(isValidProfileNickname(name)).toBe(true);
    }
  });

  test('generates the same stable profile nickname for a party member as account management', () => {
    const partyRefs = ['graytag:deal-a', 'graytag:deal-b', 'manual:manual-1'];
    const fromAutoReply = profileNicknameForPartyMember({
      serviceType: '디즈니플러스',
      accountEmail: 'disney@example.com',
      partyRefs,
      kind: 'graytag',
      memberId: 'deal-b',
    });
    const sameAgain = profileNicknameForPartyMember({
      serviceType: '디즈니플러스',
      accountEmail: 'disney@example.com',
      partyRefs,
      kind: 'graytag',
      memberId: 'deal-b',
    });
    const fallback = profileNicknameForPartyMember({
      serviceType: '디즈니플러스',
      accountEmail: 'disney@example.com',
      partyRefs,
      kind: 'graytag',
      memberId: 'missing-deal',
    });

    expect(fromAutoReply).toBe(sameAgain);
    expect(fromAutoReply).toBe(generateUniqueProfileNicknames(3, '', stableRandomFromSeed('디즈니플러스:disney@example.com:party-profiles'))[1]);
    expect(isValidProfileNickname(fromAutoReply)).toBe(true);
    expect(isValidProfileNickname(fallback)).toBe(true);
    expect(fallback).not.toBe('missing-deal');
  });

  test('validates manual nicknames as Korean 2-4 character everyday words', () => {
    expect(isValidProfileNickname('사과')).toBe(true);
    expect(isValidProfileNickname('망고')).toBe(true);
    expect(isValidProfileNickname('숟가락')).toBe(true);
    expect(isValidProfileNickname('파인애플')).toBe(true);
    expect(isValidProfileNickname('a')).toBe(false);
    expect(isValidProfileNickname('abc')).toBe(false);
  });

  test('puts the updated one-profile warning three times at the very top of account delivery memo', () => {
    const memo = buildProfileWarningMemo('사과', '프로필을 만드실 때, 본명에서 가운데 글자를 별(*)로 가려주세요!\n기존 안내문입니다.');
    expect(memo.startsWith('⚠️ 1인 1프로필 원칙 안내 ⚠️')).toBe(true);
    expect(memo.match(/⚠️ 1인 1프로필 원칙 안내 ⚠️/g)).toHaveLength(3);
    expect(memo.match(/배정된 프로필 이름 : 사과/g)).toHaveLength(3);
    expect(memo.match(/프로필을 만드실 때 해당 이름으로 꼭 만드신 뒤 사용하셔야 합니다\. 그리고 반드시 위 프로필만 사용해주세요\./g)).toHaveLength(3);
    expect(memo.match(/다른 프로필을 사용하거나 새 프로필을 추가하면 다른 이용자와 충돌이 생겨 이용이 제한될 수 있습니다\./g)).toHaveLength(3);
    expect(memo).not.toContain('배정 프로필:');
    expect(memo).not.toContain('프로필명이 없거나 접속이 안 되면');
    expect(memo).not.toContain('본명에서 가운데 글자');
    expect(memo).toContain('기존 안내문입니다.');
  });

  test('builds a tracking assignment without storing password or PIN', () => {
    const assignment = buildProfileAssignment({
      productUsids: ['p1', 'p2'],
      serviceType: '디즈니플러스',
      accountEmail: 'ott@example.com',
      emailAliasId: 123,
      emailAlias: 'alias@example.com',
      profileNickname: '숟가락',
      now: '2026-04-28T00:00:00.000Z',
    });

    expect(assignment).toMatchObject({
      id: '123:숟가락',
      productUsids: ['p1', 'p2'],
      serviceType: '디즈니플러스',
      accountEmail: 'ott@example.com',
      emailAliasId: 123,
      emailAlias: 'alias@example.com',
      profileNickname: '숟가락',
      status: 'active',
      warningCount: 0,
      createdAt: '2026-04-28T00:00:00.000Z',
      updatedAt: '2026-04-28T00:00:00.000Z',
    });
    expect(JSON.stringify(assignment)).not.toMatch(/password|pin|passwd/i);
  });
});
