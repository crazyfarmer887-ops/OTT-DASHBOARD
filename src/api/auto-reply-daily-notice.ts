import type { AutoReplyJobStore } from './auto-reply-jobs';

export const DAILY_ACCOUNT_ACCESS_NOTICE_CATEGORY = 'daily_account_access_notice';
export const OFF_HOURS_NOTICE_CATEGORY = 'off_hours_notice';
export const CLOSING_ACKNOWLEDGEMENT_CATEGORY = 'closing_acknowledgement';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const ACTIVE_NOTICE_STATUSES = new Set(['queued', 'drafted', 'sent', 'blocked']);

export function kstDayKey(now: Date | string = new Date()): string {
  const date = typeof now === 'string' ? new Date(now) : now;
  return new Date(date.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

export function kstHour(now: Date | string = new Date()): number {
  const date = typeof now === 'string' ? new Date(now) : now;
  return new Date(date.getTime() + KST_OFFSET_MS).getUTCHours();
}

export function isKoreanBusinessHours(now: Date | string = new Date()): boolean {
  const hour = kstHour(now);
  return hour >= 14 && hour < 21;
}

function hasRoomNoticeForDay(store: AutoReplyJobStore, chatRoomUuid: string, category: string, now: Date | string): boolean {
  const day = kstDayKey(now);
  return Object.values(store.jobs || {}).some((job) => (
    job.chatRoomUuid === chatRoomUuid &&
    String(job.category || '').split(',').map((part) => part.trim()).includes(category) &&
    ACTIVE_NOTICE_STATUSES.has(String(job.status || '')) &&
    kstDayKey(job.createdAt || job.updatedAt || '') === day
  ));
}

export function shouldSendDailyAccountAccessNotice(store: AutoReplyJobStore, chatRoomUuid: string, now: Date | string = new Date()): boolean {
  if (!chatRoomUuid) return false;
  return !hasRoomNoticeForDay(store, chatRoomUuid, DAILY_ACCOUNT_ACCESS_NOTICE_CATEGORY, now);
}

export function shouldSendOffHoursNotice(store: AutoReplyJobStore, chatRoomUuid: string, now: Date | string = new Date()): boolean {
  if (!chatRoomUuid || isKoreanBusinessHours(now)) return false;
  return !hasRoomNoticeForDay(store, chatRoomUuid, OFF_HOURS_NOTICE_CATEGORY, now);
}

export function buildDailyAccountAccessNoticeReply(accessUrl: string): string {
  const url = String(accessUrl || '').trim() || '{각자 할당된 계정 확인 링크}';
  return [
    '우선 아래 계정 업데이트 주소에서 최신 ID/PW/PIN과 배정 프로필을 확인해주세요.',
    url,
    '프로필이 꽉 찼다면 링크 안의 파티원 프로필 현황에 없는 프로필을 삭제 후, 배정된 이름으로 새로 만들어주세요.',
    '그래도 안 되면 다시 문의 남겨주세요.',
  ].join('\n');
}

export function buildOffHoursNoticeReply(): string {
  return '문의 가능 시간은 14:00 ~ 21:00입니다. 확인하는 대로 답변드리겠습니다.';
}

export function buildClosingAcknowledgementReply(): string {
  return '네~ 즐거운 사용 되세요!';
}

export function combineNoticeReplies(parts: string[]): string {
  return parts.map((part) => String(part || '').trim()).filter(Boolean).join('\n\n');
}

export function isSimpleAcknowledgement(message: string): boolean {
  const normalized = String(message || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, '')
    .replace(/[!~.。！？?ㅠㅜㅋㅎ♡♥️]/g, '')
    .trim();
  if (!normalized) return false;
  if (normalized.length > 20) return false;
  return /^(네|넵|넹|예|옙|ㅇㅋ|오케이|알겠습니다|확인|확인했습니다|감사합니다|감사|고맙습니다|고마워요|네감사합니다|넵감사합니다|해결했습니다|해결됐습니다|해결됬습니다|해결됐어요|해결됬어요|해결했어요|됐습니다|됬습니다|됐어요|됬어요|됩니다|완료했습니다|완료됐습니다|완료됬습니다|완료됐어요|완료됬어요|잘됩니다|이제됩니다|등록했습니다|잘등록했습니다|등록했습니다감사합니다|잘등록했습니다감사합니다|네잘등록했습니다감사합니다|아네잘등록했습니다감사합니다)$/.test(normalized);
}

export function shouldSendClosingAcknowledgement(store: AutoReplyJobStore, chatRoomUuid: string, now: Date | string = new Date()): boolean {
  if (!chatRoomUuid) return false;
  return !hasRoomNoticeForDay(store, chatRoomUuid, CLOSING_ACKNOWLEDGEMENT_CATEGORY, now);
}

export function hasDailyAccountAccessNoticeToday(store: AutoReplyJobStore, chatRoomUuid: string, now: Date | string = new Date()): boolean {
  return hasRoomNoticeForDay(store, chatRoomUuid, DAILY_ACCOUNT_ACCESS_NOTICE_CATEGORY, now);
}
