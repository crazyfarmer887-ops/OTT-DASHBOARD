/**
 * 파티별 추가공유 ON/OFF 순수 로직
 * localStorage에 의존하지 않는 순수 함수들
 */

export type ExtraShareMap = Record<string, boolean>;

export const EXTRA_SHARE_STORAGE_KEY = 'graytag_extra_share_v2';

/** "email__serviceType" 형태의 키 생성 */
export function makeExtraShareKey(email: string, serviceType: string): string {
  return `${email}__${serviceType}`;
}

/** 추가공유 ON/OFF 조회 (기본값: true) */
export function getExtraShareOn(map: ExtraShareMap, email: string, serviceType: string): boolean {
  const key = makeExtraShareKey(email, serviceType);
  return key in map ? map[key] : true;
}

/** 토글 — 불변(immutable), 원본 map 변경 없음 */
export function toggleExtraShare(map: ExtraShareMap, email: string, serviceType: string): ExtraShareMap {
  const key = makeExtraShareKey(email, serviceType);
  const current = getExtraShareOn(map, email, serviceType);
  return { ...map, [key]: !current };
}

/**
 * 추가공유 수익 계산
 * ON이면 (income - cost) * months, OFF이면 0
 */
export function applyExtraShare(
  map: ExtraShareMap,
  email: string,
  serviceType: string,
  extraIncome: Record<string, number>,
  extraCost: Record<string, number>,
  months: number,
): number {
  if (!getExtraShareOn(map, email, serviceType)) return 0;
  const income = extraIncome[serviceType] || 0;
  const cost = extraCost[serviceType] || 0;
  return (income - cost) * months;
}

/** localStorage 저장/로드 헬퍼 (브라우저 전용) */
export function loadExtraShareFromStorage(): ExtraShareMap {
  try {
    return JSON.parse(localStorage.getItem(EXTRA_SHARE_STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

export function saveExtraShareToStorage(map: ExtraShareMap): void {
  localStorage.setItem(EXTRA_SHARE_STORAGE_KEY, JSON.stringify(map));
}
