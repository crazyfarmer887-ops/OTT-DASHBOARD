import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolveDoublePassBundleNo } from '../lib/tving-wavve-bundle';

export interface EmailAliasCandidate {
  id: number | string;
  email: string;
  enabled?: boolean;
}

export interface EmailAliasFillResult {
  ok: boolean;
  found: boolean;
  pinConfigured: boolean;
  pinRecoverable: boolean;
  email: string;
  serviceType: string;
  emailId: number | string | null;
  pin: string | null;
  memo: string;
  missing: Array<'email' | 'pin'>;
  message?: string;
}

type PinRecord = { pin?: string; hash?: string; updatedAt?: string };

const DEFAULT_PIN_STORE_PATH = '/home/ubuntu/.hermes/hermes-agent/graytag-email-verify-dashboard-5588/data/alias-pins.json';

function pinStorePath() {
  return process.env.EMAIL_ALIAS_PIN_STORE_PATH || DEFAULT_PIN_STORE_PATH;
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function forcedDoublePassAliasEmail(accountEmail: string, serviceType: string): string | null {
  const local = normalizeEmail(accountEmail).split('@')[0] || '';
  const service = String(serviceType || '').trim();
  if (service === '티빙' && local === 'gtwavve444') return 'wavve4444.prozac789@aleeas.com';
  if (service === '티빙' && local === 'gtwavve4444') return 'wavve4.hyperlink631@aleeas.com';
  return null;
}

function serviceKeywords(serviceType: string): string[] {
  const normalized = serviceType.toLowerCase();
  const pairs: Array<[RegExp, string[]]> = [
    [/디즈니|disney/, ['disney']],
    [/넷플릭스|netflix/, ['netflix']],
    // TVING seats are backed by the Wavve+TVING bundle aliases in this dashboard.
    [/티빙|티방|tving|gtwavve|gtwalve/, ['tving', 'wavve']],
    [/웨이브|wavve/, ['wavve']],
    [/왓챠|watcha/, ['watcha']],
    [/라프텔|laftel/, ['laftel']],
    [/쿠팡|coupang/, ['coupang']],
    [/유튜브|youtube|google/, ['youtube', 'google']],
    [/애플|apple/, ['apple']],
    [/프라임|prime|amazon/, ['prime', 'amazon']],
  ];
  for (const [re, keys] of pairs) if (re.test(normalized)) return keys;
  return normalized ? [normalized] : [];
}

export function loadAliasPinStore(): Record<string, PinRecord> {
  const path = pinStorePath();
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Record<string, PinRecord>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveAliasPinStore(store: Record<string, PinRecord>) {
  const path = pinStorePath();
  const dir = path.replace(/\/[^\/]+$/, '');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(store, null, 2), 'utf8');
}

function normalizeSixDigitPin(pin: string) {
  const candidate = pin.trim();
  return /^\d{6}$/.test(candidate) ? candidate : null;
}

function compatibleServiceType(requested: string, stored: string | null | undefined) {
  const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, '');
  const requestedService = normalize(requested);
  const storedService = normalize(String(stored || ''));
  if (!requestedService || !storedService) return false;
  if (requestedService === storedService) return true;
  const doublePassServices = new Set(['티빙', '티방', '웨이브', '티빙+웨이브', 'tving', 'wavve']);
  return doublePassServices.has(requestedService) && doublePassServices.has(storedService);
}

export function generateSixDigitPin(random = Math.random): string {
  return String(Math.floor(random() * 1_000_000)).padStart(6, '0');
}

export function verifyEmailAliasPinUpdate(emailId: number | string, expectedPin: string): { ok: boolean; emailId: number | string; pin: string | null; updatedAt?: string; message?: string } {
  const pin = normalizeSixDigitPin(expectedPin);
  if (!pin) return { ok: false, emailId, pin: null, message: 'PIN은 6자리 숫자여야 해요.' };
  const record = loadAliasPinStore()[String(emailId)];
  const currentPin = record?.pin?.trim() || null;
  return {
    ok: currentPin === pin,
    emailId,
    pin: currentPin,
    updatedAt: record?.updatedAt,
    ...(currentPin === pin ? {} : { message: '저장된 PIN이 요청한 PIN과 일치하지 않아요.' }),
  };
}

export async function updateEmailAliasPin(input: {
  accountEmail: string;
  serviceType: string;
  aliases: EmailAliasCandidate[];
  pin: string;
}, now = new Date().toISOString()): Promise<EmailAliasFillResult> {
  const accountEmail = input.accountEmail.trim();
  const serviceType = input.serviceType.trim();
  const pin = normalizeSixDigitPin(input.pin);
  if (!pin) {
    return { ok: false, found: false, pinConfigured: false, pinRecoverable: false, email: accountEmail, serviceType, emailId: null, pin: null, memo: '', missing: ['pin'], message: 'PIN은 6자리 숫자여야 해요.' };
  }
  const pinStore = loadAliasPinStore();
  const alias = chooseAlias(accountEmail, serviceType, input.aliases, pinStore);
  if (!alias) {
    return { ok: false, found: false, pinConfigured: false, pinRecoverable: false, email: accountEmail, serviceType, emailId: null, pin: null, memo: '', missing: ['email'], message: '이 계정과 연결된 이메일 대시보드 alias를 찾지 못했어요.' };
  }
  const key = String(alias.id);
  const nextStore = { ...pinStore, [key]: { ...(pinStore[key] || {}), pin, updatedAt: now } };
  saveAliasPinStore(nextStore);
  return { ok: true, found: true, pinConfigured: true, pinRecoverable: true, email: alias.email, serviceType, emailId: alias.id, pin, memo: makeEmailVerifyMemo(alias.id, pin), missing: [] };
}

export function makeEmailVerifyMemo(emailId: string | number, pin: string): string {
  return `✅ 아래 내용 꼭 읽어주세요! 로그인 관련 내용입니다!! ✅
로그인 시도 간 필요한 이메일 코드는 아래 사이트에서 언제든지 셀프인증 가능합니다!
https://email-verify.one/email/mail/${emailId}
사이트에서 필요한 핀번호는 : ${pin}입니다!

프로필을 만드실 때, 본명에서 가운데 글자를 별(*)로 가려주세요!
만약, 특수기호 사용이 불가할 경우 본명으로 설정 부탁드립니다! 예)홍길동 또는 홍*동
만약, 접속 시 기본 프로필 1개만 있거나 자리가 꽉 찼는데 기본 프로필이 있다면 그걸 먼저 수정하고 사용하시면 되겠습니다!

즐거운 시청되세요!`;
}

function chooseAlias(accountEmail: string, serviceType: string, aliases: EmailAliasCandidate[], pinStore: Record<string, PinRecord>) {
  const targetEmail = normalizeEmail(accountEmail);
  const enabledAliases = aliases.filter(a => a && a.id !== undefined && a.email && a.enabled !== false);
  const direct = enabledAliases.find(a => normalizeEmail(a.email) === targetEmail);
  if (direct) return direct;

  const forcedAliasEmail = forcedDoublePassAliasEmail(accountEmail, serviceType);
  if (forcedAliasEmail) {
    const forced = enabledAliases.find(a => normalizeEmail(a.email) === forcedAliasEmail);
    if (forced) return forced;
    return { id: forcedAliasEmail, email: forcedAliasEmail, enabled: true };
  }

  const withPin = enabledAliases.filter(a => pinStore[String(a.id)]?.pin);

  // For concrete SimpleLogin-style email addresses, fail closed when the exact alias
  // is absent. A broad service fallback can otherwise map gtdny9.claim... to an
  // unrelated Disney alias that merely has a PIN configured.
  if (targetEmail.includes('@')) return null;

  const doublePassNo = resolveDoublePassBundleNo({ serviceType, email: accountEmail, loginId: accountEmail, accountId: accountEmail });
  if (doublePassNo) {
    const sameNumberMatches = withPin.filter(a => {
      const local = normalizeEmail(a.email).split('@')[0] || '';
      return new RegExp(`(?:gtwavve|wavve|tving)${doublePassNo}(?:\\D|$)`, 'i').test(local);
    });
    if (sameNumberMatches.length) return sameNumberMatches.sort((a, b) => Number(b.id) - Number(a.id))[0];

    // Double-pass accounts are bundle-number sensitive. Falling through to the
    // broad service keyword fallback can map e.g. TVING gtwavve8 to an unrelated
    // newer Wavve alias such as gtwavve13 just because both contain "wavve".
    // If the exact bundle alias is not present in the fetched/pinned aliases,
    // fail closed instead of exposing another account's inbox.
    return null;
  }

  const keys = serviceKeywords(serviceType);
  const serviceMatches = withPin.filter(a => keys.some(key => normalizeEmail(a.email).includes(key)));
  if (serviceMatches.length) {
    return serviceMatches.sort((a, b) => Number(b.id) - Number(a.id))[0];
  }

  const emailLocalPrefix = targetEmail.split('@')[0]?.replace(/\d+.*$/, '') || '';
  if (emailLocalPrefix) {
    const prefixMatches = withPin.filter(a => normalizeEmail(a.email).startsWith(emailLocalPrefix));
    if (prefixMatches.length) return prefixMatches.sort((a, b) => Number(b.id) - Number(a.id))[0];
  }

  return null;
}

export async function resolveEmailAliasFill(input: {
  accountEmail: string;
  serviceType: string;
  aliases: EmailAliasCandidate[];
  fallbackPin?: string | null;
  fallbackEmailId?: number | string | null;
  fallbackServiceType?: string | null;
}): Promise<EmailAliasFillResult> {
  const accountEmail = input.accountEmail.trim();
  const serviceType = input.serviceType.trim();
  const pinStore = loadAliasPinStore();
  const alias = chooseAlias(accountEmail, serviceType, input.aliases, pinStore);
  const exactAlias = alias
    && normalizeEmail(alias.email) === normalizeEmail(accountEmail)
    && String(alias.id) === String(input.fallbackEmailId ?? '')
    && compatibleServiceType(serviceType, input.fallbackServiceType);
  const generatedPin = exactAlias ? normalizeSixDigitPin(String(input.fallbackPin || '')) : null;
  const pinRecord = alias ? pinStore[String(alias.id)] : undefined;
  const pin = pinRecord?.pin?.trim() || generatedPin || null;
  const pinRecoverable = Boolean(alias && pin);
  const pinConfigured = Boolean(alias && (pinRecoverable || pinRecord?.hash?.trim()));
  const missing: Array<'email' | 'pin'> = [];
  if (!alias) missing.push('email');
  if (!alias || !pinConfigured) missing.push('pin');

  const ok = pinRecoverable;
  return {
    ok,
    found: ok,
    pinConfigured,
    pinRecoverable,
    email: alias?.email || accountEmail,
    serviceType,
    emailId: alias?.id ?? null,
    pin,
    memo: ok ? makeEmailVerifyMemo(alias!.id, pin!) : '',
    missing,
    ...(ok ? {} : { message: missing.includes('email')
      ? '이 계정과 연결된 이메일 대시보드 alias를 찾지 못했어요.'
      : pinConfigured
        ? 'PIN은 설정되어 있지만 기존 번호 원문은 확인할 수 없어요.'
        : '이 계정 alias의 PIN 번호가 설정되어 있지 않아요.' }),
  };
}
