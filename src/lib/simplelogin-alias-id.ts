export interface SimpleLoginAliasLookupResult {
  id?: string | number | null;
  email?: string | null;
}

export interface ResolveCreatedSimpleLoginAliasIdInput {
  createdEmail: string;
  lookup: (normalizedEmail: string) => Promise<SimpleLoginAliasLookupResult | null>;
  sleep: (milliseconds: number) => Promise<void>;
  retryDelaysMs?: readonly number[];
}

export const SIMPLELOGIN_ALIAS_ID_RETRY_DELAYS_MS = [500, 1000, 2000, 4000, 8000] as const;
const MAX_TOTAL_RETRY_DELAY_MS = 15500;

function normalizeEmail(value: string | null | undefined): string {
  return String(value || '').trim().toLowerCase();
}

function hasAliasId(value: unknown): value is string | number {
  return typeof value === 'number'
    || (typeof value === 'string' && value.trim().length > 0);
}

function boundedRetryDelays(delays: readonly number[]): number[] {
  const bounded: number[] = [];
  let total = 0;
  for (const value of delays) {
    const delay = Number(value);
    if (!Number.isFinite(delay) || delay < 0 || total + delay > MAX_TOTAL_RETRY_DELAY_MS) break;
    bounded.push(delay);
    total += delay;
  }
  return bounded;
}

/** Resolves an already-created alias without issuing another create request. */
export async function resolveCreatedSimpleLoginAliasId(
  input: ResolveCreatedSimpleLoginAliasIdInput,
): Promise<{ id: string | number; email: string }> {
  const email = normalizeEmail(input.createdEmail);
  const retryDelays = boundedRetryDelays(input.retryDelaysMs ?? SIMPLELOGIN_ALIAS_ID_RETRY_DELAYS_MS);

  for (let poll = 0; poll <= retryDelays.length; poll += 1) {
    const alias = await input.lookup(email);
    if (alias && normalizeEmail(alias.email) === email && hasAliasId(alias.id)) {
      return { id: alias.id, email };
    }
    if (poll < retryDelays.length) await input.sleep(retryDelays[poll]);
  }

  throw new Error(`SimpleLogin 별칭은 생성됐지만 alias id 확인이 아직 완료되지 않았어요: ${email}. 잠시 후 다시 시도하거나 새로고침해 주세요.`);
}
