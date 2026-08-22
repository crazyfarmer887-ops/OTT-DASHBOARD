import type { SellerAlertInput, SellerAlertResult } from '../alerts/telegram';
import {
  normalizeYouTubeInvitationEmail,
  normalizeYouTubeManagerEmail,
  type YouTubeFamilyGroup,
  type YouTubeInvitationJob,
} from '../lib/youtube-invitations';

export const YOUTUBE_NEW_SALE_GUIDE_CATEGORY = 'youtube_new_sale_guide';
export const YOUTUBE_EMAIL_INVITATION_ALERT_CATEGORY = 'youtube_email_invitation_alert';
export const YOUTUBE_NEW_SALE_GUIDE = '유튜브 프리미엄 초대장 이용 안내입니다.\n\n'
  + '이메일을 남겨주시면 구매 당일 안으로는 초대해드리고 있습니다.  \n\n'
  + '만약 초대 수락 오류 발생 시 아래 링크를 꼭 확인해주세요\n\n'
  + 'https://zrr.kr/xTL6y9';
export const DEFAULT_YOUTUBE_EMAIL_MODEL = 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free';

export type EnvLike = Record<string, string | undefined>;
export type SellerAlertSender = (input: SellerAlertInput) => Promise<SellerAlertResult>;

type GraytagDealLike = Record<string, unknown>;

function stringField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** YouTube matching intentionally uses only productType/productName fields. */
export function isYouTubeAutoReplyProduct(deal: GraytagDealLike): boolean {
  const productType = stringField(deal.productTypeString || deal.productType).toLowerCase();
  const productName = stringField(deal.productName).toLowerCase();
  const combined = `${productType} ${productName}`;
  const isYouTube = combined.includes('유튜브') || combined.includes('youtube');
  const isPremium = combined.includes('프리미엄') || combined.includes('premium');
  return isYouTube && isPremium;
}

function parseTrustworthyTimestamp(value: string): number {
  const dotted = /^(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})$/.exec(value);
  if (dotted) {
    const [, year, month, day, hour, minute] = dotted.map(Number);
    const utcMs = Date.UTC(year, month - 1, day, hour - 9, minute);
    const kst = new Date(utcMs + 9 * 60 * 60 * 1000);
    return kst.getUTCFullYear() === year && kst.getUTCMonth() === month - 1
      && kst.getUTCDate() === day && kst.getUTCHours() === hour && kst.getUTCMinutes() === minute
      ? utcMs : Number.NaN;
  }
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    ? Date.parse(value) : Number.NaN;
}

function trustworthyDealTimestamp(deal: GraytagDealLike): string {
  return stringField(
    deal.registeredDateTime
    || deal.createdDateTime
    || deal.dealRegisteredDateTime
    || deal.inflowDateTime,
  );
}

export function buildYouTubeNewSaleCandidate(
  deal: GraytagDealLike,
  processStartedAt: Date,
  now = new Date(),
): Record<string, unknown> | null {
  if (!isYouTubeAutoReplyProduct(deal)) return null;
  const dealStatus = stringField(deal.dealStatus);
  const dealUsid = stringField(deal.dealUsid);
  const chatRoomUuid = stringField(deal.chatRoomUuid);
  if (!dealUsid || !chatRoomUuid || !dealStatus || dealStatus === 'OnSale') return null;

  const timestamp = trustworthyDealTimestamp(deal);
  const timestampMs = parseTrustworthyTimestamp(timestamp);
  const startedMs = processStartedAt.getTime();
  const nowMs = now.getTime();
  if (!timestamp || !Number.isFinite(timestampMs) || !Number.isFinite(startedMs) || !Number.isFinite(nowMs)) return null;
  if (timestampMs < startedMs || timestampMs > nowMs + 2 * 60 * 1000) return null;

  return {
    internalCategory: YOUTUBE_NEW_SALE_GUIDE_CATEGORY,
    message: YOUTUBE_NEW_SALE_GUIDE,
    registeredDateTime: timestamp,
    chatRoomUuid,
    dealUsid,
    buyerName: stringField(deal.borrowerName),
    productType: stringField(deal.productTypeString || deal.productType),
    productName: stringField(deal.productName),
    dealStatus,
    endDateTime: deal.endDateTime ?? null,
  };
}

export function resolveYouTubeEmailModel(env: EnvLike = process.env): string {
  return stringField(env.AUTO_REPLY_YOUTUBE_EMAIL_MODEL) || DEFAULT_YOUTUBE_EMAIL_MODEL;
}

export function buildYouTubeEmailExtractionPrompt(buyerMessage: string): string {
  return [
    'Extract exactly one explicit email address written by the buyer for a YouTube Premium family invitation.',
    'Return strict JSON only, with no markdown or commentary.',
    'Schema: {"email":string|null}',
    'Use null if there is no explicit valid email, if more than one distinct email appears, or if uncertain.',
    'Never infer, repair, complete, or invent an email address.',
    `Buyer message: ${JSON.stringify(String(buyerMessage || '').slice(0, 10_000))}`,
  ].join('\n');
}

export function parseYouTubeEmailExtractionJson(output: string): { email: string | null } {
  try {
    const parsed = JSON.parse(String(output || '').trim()) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { email: null };
    if (Object.keys(parsed).length !== 1 || !Object.hasOwn(parsed, 'email')) return { email: null };
    if (parsed.email === null) return { email: null };
    return { email: normalizeYouTubeInvitationEmail(parsed.email) };
  } catch {
    return { email: null };
  }
}

export type YouTubeInvitationAlert = { title: '유튜브 프리미엄 초대'; body: string };

export function buildYouTubeInvitationAlert(
  dealUsid: string,
  buyerEmail: string,
  jobs: readonly YouTubeInvitationJob[],
  familyGroups: readonly YouTubeFamilyGroup[],
): YouTubeInvitationAlert | null {
  const exactDealUsid = stringField(dealUsid);
  const normalizedBuyerEmail = normalizeYouTubeInvitationEmail(buyerEmail);
  if (!exactDealUsid || !normalizedBuyerEmail) return null;
  const invitationJob = jobs.find((job) => job.dealUsid === exactDealUsid);
  if (!invitationJob || !invitationJob.familyGroupId) return null;
  const familyGroup = familyGroups.find((group) => group.id === invitationJob.familyGroupId);
  const managerEmail = normalizeYouTubeManagerEmail(familyGroup?.managerEmail);
  if (!familyGroup || !managerEmail) return null;
  return {
    title: '유튜브 프리미엄 초대',
    body: `초대해야 할 이메일 : ${normalizedBuyerEmail}\n초대할 수 있는 이메일 : ${managerEmail}`,
  };
}

export async function sendYouTubeInvitationAlert(input: {
  alert: YouTubeInvitationAlert;
  messageFingerprint: string;
  alreadySentAt?: string;
  sender: SellerAlertSender;
}): Promise<SellerAlertResult | { sent: false; reason: 'already-sent' }> {
  if (input.alreadySentAt) return { sent: false, reason: 'already-sent' };
  return input.sender({
    key: `youtube-invitation-email-${input.messageFingerprint}`,
    title: input.alert.title,
    body: input.alert.body,
    severity: 'warning',
    category: 'purchase',
    throttleMs: 0,
  });
}

export function shouldIncludeOffHoursNotice(env: EnvLike = process.env): boolean {
  return env.AUTO_REPLY_OFF_HOURS_NOTICE_ENABLED !== 'false';
}

export async function sendHumanReviewAlertIfEnabled(
  env: EnvLike,
  sender: SellerAlertSender,
  input: SellerAlertInput,
): Promise<SellerAlertResult> {
  if (env.AUTO_REPLY_HUMAN_ALERT_ENABLED === 'false') return { sent: false, reason: 'disabled' };
  return sender(input);
}
