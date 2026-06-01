export type ProfileNicknameCategory = 'common-word';

export interface ProfileNicknameDictionaryItem {
  name: string;
  category: ProfileNicknameCategory;
}

// 파티원 프로필명은 사람이름이 아니라, 실제로 친숙하게 쓰는 일상 단어로만 만든다.
export const PROFILE_NICKNAME_DICTIONARY: ProfileNicknameDictionaryItem[] = [
  { name: '사과', category: 'common-word' },
  { name: '망고', category: 'common-word' },
  { name: '바나나', category: 'common-word' },
  { name: '포도', category: 'common-word' },
  { name: '딸기', category: 'common-word' },
  { name: '복숭아', category: 'common-word' },
  { name: '오렌지', category: 'common-word' },
  { name: '수박', category: 'common-word' },
  { name: '멜론', category: 'common-word' },
  { name: '자두', category: 'common-word' },
  { name: '체리', category: 'common-word' },
  { name: '레몬', category: 'common-word' },
  { name: '라임', category: 'common-word' },
  { name: '감귤', category: 'common-word' },
  { name: '유자차', category: 'common-word' },
  { name: '커피', category: 'common-word' },
  { name: '우유', category: 'common-word' },
  { name: '쿠키', category: 'common-word' },
  { name: '식빵', category: 'common-word' },
  { name: '도넛', category: 'common-word' },
  { name: '숟가락', category: 'common-word' },
  { name: '젓가락', category: 'common-word' },
  { name: '물컵', category: 'common-word' },
  { name: '종이컵', category: 'common-word' },
  { name: '물병', category: 'common-word' },
  { name: '연필', category: 'common-word' },
  { name: '공책', category: 'common-word' },
  { name: '책상', category: 'common-word' },
  { name: '의자', category: 'common-word' },
  { name: '가방', category: 'common-word' },
  { name: '시계', category: 'common-word' },
  { name: '우산', category: 'common-word' },
  { name: '모자', category: 'common-word' },
  { name: '양말', category: 'common-word' },
  { name: '수건', category: 'common-word' },
  { name: '베개', category: 'common-word' },
  { name: '담요', category: 'common-word' },
  { name: '리모컨', category: 'common-word' },
  { name: '충전기', category: 'common-word' },
  { name: '이어폰', category: 'common-word' },
  { name: '키보드', category: 'common-word' },
  { name: '마우스', category: 'common-word' },
  { name: '노트북', category: 'common-word' },
  { name: '휴대폰', category: 'common-word' },
  { name: '달력', category: 'common-word' },
  { name: '냉장고', category: 'common-word' },
  { name: '선풍기', category: 'common-word' },
  { name: '세탁기', category: 'common-word' },
  { name: '손전등', category: 'common-word' },
  { name: '필통', category: 'common-word' },
];

export interface ProfileAssignment {
  id: string;
  productUsids: string[];
  serviceType: string;
  accountEmail: string;
  emailAliasId: number | string | null;
  emailAlias: string;
  profileNickname: string;
  status: 'active' | 'ended';
  warningCount: number;
  createdAt: string;
  updatedAt: string;
}

export function stableRandomFromSeed(seed: string): () => number {
  let state = Array.from(seed || 'graytag').reduce((acc, ch) => ((acc * 31) + ch.charCodeAt(0)) >>> 0, 2166136261);
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export function generateProfileNickname(random = Math.random): string {
  const index = Math.min(PROFILE_NICKNAME_DICTIONARY.length - 1, Math.floor(random() * PROFILE_NICKNAME_DICTIONARY.length));
  return PROFILE_NICKNAME_DICTIONARY[index]?.name || PROFILE_NICKNAME_DICTIONARY[0].name;
}

export function generateUniqueProfileNicknames(count: number, preferredFirst = '', random = Math.random, excludedNames: string[] = []): string[] {
  const max = Math.max(0, Math.min(count, PROFILE_NICKNAME_DICTIONARY.length));
  const picked: string[] = [];
  const seen = new Set<string>(excludedNames.map(normalizeProfileNickname).filter(Boolean));
  const first = isValidProfileNickname(preferredFirst) ? normalizeProfileNickname(preferredFirst) : '';
  if (first && !seen.has(first)) {
    picked.push(first);
    seen.add(first);
  }
  const start = Math.min(PROFILE_NICKNAME_DICTIONARY.length - 1, Math.floor(random() * PROFILE_NICKNAME_DICTIONARY.length));
  for (let offset = 0; picked.length < max && offset < PROFILE_NICKNAME_DICTIONARY.length; offset++) {
    const candidate = PROFILE_NICKNAME_DICTIONARY[(start + offset) % PROFILE_NICKNAME_DICTIONARY.length].name;
    if (seen.has(candidate)) continue;
    picked.push(candidate);
    seen.add(candidate);
  }
  return picked;
}

export function normalizeProfileNickname(value: string): string {
  return value.replace(/[^가-힣]/g, '').slice(0, 4);
}

export function isValidProfileNickname(value: string): boolean {
  const length = Array.from(normalizeProfileNickname(value)).length;
  return length >= 2 && length <= 4;
}

export function profileNicknameForPartyMember(input: {
  serviceType: string;
  accountEmail: string;
  partyRefs: string[];
  kind: 'graytag' | 'manual';
  memberId: string;
}): string {
  const refs = input.partyRefs.map((ref) => String(ref || '').trim()).filter(Boolean);
  const memberRef = `${input.kind}:${input.memberId}`;
  const completeRefs = refs.includes(memberRef) ? refs : [...refs, memberRef];
  const nicknames = generateUniqueProfileNicknames(
    completeRefs.length,
    '',
    stableRandomFromSeed(`${input.serviceType}:${input.accountEmail}:party-profiles`),
  );
  const index = completeRefs.indexOf(memberRef);
  return nicknames[index] || generateProfileNickname(stableRandomFromSeed(`${input.serviceType}:${input.accountEmail}:${memberRef}`));
}

export function buildProfileWarningMemo(profileNickname: string, baseMemo: string): string {
  const nickname = isValidProfileNickname(profileNickname) ? normalizeProfileNickname(profileNickname) : generateProfileNickname(() => 0);
  const warning = `⚠️ 1인 1프로필 원칙 안내 ⚠️\n\n배정된 프로필 이름 : ${nickname}\n\n프로필을 만드실 때 해당 이름으로 꼭 만드신 뒤 사용하셔야 합니다. 그리고 반드시 위 프로필만 사용해주세요.\n\n다른 프로필을 사용하거나 새 프로필을 추가하면 다른 이용자와 충돌이 생겨 이용이 제한될 수 있습니다.\n\n⚠️ 1인 1프로필 원칙 안내 ⚠️\n\n배정된 프로필 이름 : ${nickname}\n\n프로필을 만드실 때 해당 이름으로 꼭 만드신 뒤 사용하셔야 합니다. 그리고 반드시 위 프로필만 사용해주세요.\n\n다른 프로필을 사용하거나 새 프로필을 추가하면 다른 이용자와 충돌이 생겨 이용이 제한될 수 있습니다.\n\n⚠️ 1인 1프로필 원칙 안내 ⚠️\n\n배정된 프로필 이름 : ${nickname}\n\n프로필을 만드실 때 해당 이름으로 꼭 만드신 뒤 사용하셔야 합니다. 그리고 반드시 위 프로필만 사용해주세요.\n\n다른 프로필을 사용하거나 새 프로필을 추가하면 다른 이용자와 충돌이 생겨 이용이 제한될 수 있습니다.`;
  let stripped = baseMemo.replace(/^⚠️ 1인 1프로필 원칙 안내[\s\S]*?(?=아래 내용 꼭 읽어주세요!|로그인 시도 간|https:\/\/email-verify\.xyz|✅ 아래 내용 꼭 읽어주세요|$)/, '').trimStart();
  stripped = stripped
    .replace(/^프로필을 만드실 때,? 본명에서 가운데 글자를 별\(\*\)로 가려주세요!?.*\n?/gm, '')
    .replace(/^만약, 특수기호 사용이 불가할 경우 본명으로 설정 부탁드립니다!?.*\n?/gm, '')
    .replace(/^만약, 접속 시 기본 프로필.*\n?/gm, '')
    .trimStart();
  return `${warning}\n\n${stripped}`.trim();
}

export function buildProfileAssignment(input: {
  productUsids: string[];
  serviceType: string;
  accountEmail: string;
  emailAliasId?: number | string | null;
  emailAlias?: string;
  profileNickname: string;
  now?: string;
}): ProfileAssignment {
  const now = input.now || new Date().toISOString();
  const nickname = isValidProfileNickname(input.profileNickname) ? normalizeProfileNickname(input.profileNickname) : generateProfileNickname(() => 0);
  return {
    id: `${input.emailAliasId ?? input.accountEmail}:${nickname}`,
    productUsids: input.productUsids.filter(Boolean),
    serviceType: input.serviceType.trim(),
    accountEmail: input.accountEmail.trim(),
    emailAliasId: input.emailAliasId ?? null,
    emailAlias: input.emailAlias?.trim() || '',
    profileNickname: nickname,
    status: 'active',
    warningCount: 0,
    createdAt: now,
    updatedAt: now,
  };
}
