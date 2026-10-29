/** One observed claim on a Disney account. Uncertain claims continue to occupy a place. */
export interface DisneySeatClaim {
  id: string;
  state: 'active' | 'pending' | 'unknown' | 'released';
  /** Reserved advertisement capacity is a real hold until that listing is closed. */
  kind?: 'buyer' | 'advertised' | 'reserved';
  /** Optional opaque identity used to prevent a buyer being silently replaced. */
  buyerIdentity?: string;
  /** A missing number is reserved, but cannot safely be assigned a specific profile. */
  profileNumber?: number | null;
}

export interface DisneySeatSnapshot {
  /** Stable, independently observed source, e.g. gbuts, everyview, graytag or manual. */
  source: string;
  complete: boolean;
  verifiedAt: string;
  /** Required for Everyview mappings: verified currently advertised, unsold places. */
  advertisedVacancies?: number;
  claims: readonly DisneySeatClaim[];
}

export type DisneyInventoryError = 'INVALID_CONFIGURATION' | 'MISSING_SOURCE' | 'INCOMPLETE_SOURCE'
  | 'STALE_SOURCE' | 'DUPLICATE_SOURCE' | 'INVALID_CLAIM' | 'DUPLICATE_CLAIM'
  | 'PROFILE_CONFLICT' | 'CAPACITY_EXCEEDED';

export interface DisneyInventoryResult {
  ok: boolean;
  errors: DisneyInventoryError[];
  capacity: number;
  /** Existing numbers are reported unchanged. */
  occupiedProfiles: number[];
  unnumberedClaims: number;
  occupied: number;
  /** Only publish this many places when all required sources are current and consistent. */
  available: number;
  /** Empty when any claim lacks a profile: its actual number could be any of the remaining ones. */
  assignableProfiles: number[];
}

/**
 * Evaluate one explicitly mapped account, without mutating orders or reservations.
 * Sources must supply actual paid/reserved claims, not unsold listing capacities.
 * Callers must independently serialize publication and reconcile concurrent purchases.
 */
export function evaluateDisneyInventory(input: {
  capacity: number;
  requiredSources: readonly string[];
  snapshots: readonly DisneySeatSnapshot[];
  now: Date;
  maxAgeMs: number;
}): DisneyInventoryResult {
  const errors = new Set<DisneyInventoryError>();
  const { capacity, requiredSources, snapshots, now, maxAgeMs } = input;
  const nowMs = now.getTime();
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 6 || !Number.isFinite(nowMs)
    || !Number.isFinite(maxAgeMs) || maxAgeMs <= 0 || requiredSources.length === 0
    || requiredSources.some(s => typeof s !== 'string' || !s.trim())
    || new Set(requiredSources).size !== requiredSources.length) errors.add('INVALID_CONFIGURATION');
  const bySource = new Map<string, DisneySeatSnapshot>();
  for (const snapshot of snapshots) {
    if (!snapshot.source?.trim() || bySource.has(snapshot.source)) { errors.add('DUPLICATE_SOURCE'); continue; }
    bySource.set(snapshot.source, snapshot);
    if (!snapshot.complete) errors.add('INCOMPLETE_SOURCE');
    const verified = Date.parse(snapshot.verifiedAt);
    if (!Number.isFinite(verified) || verified > nowMs || nowMs - verified > maxAgeMs) errors.add('STALE_SOURCE');
  }
  for (const source of requiredSources) if (!bySource.has(source)) errors.add('MISSING_SOURCE');

  const numbers = new Set<number>();
  let unnumberedClaims = 0;
  for (const snapshot of bySource.values()) {
    if (!Array.isArray(snapshot.claims)) { errors.add('INVALID_CLAIM'); continue; }
    const ids = new Set<string>();
    for (const claim of snapshot.claims) {
      if (!claim || typeof claim.id !== 'string' || !claim.id.trim()
        || !['active', 'pending', 'unknown', 'released'].includes(claim.state)
        || (claim.kind !== undefined && !['buyer', 'advertised', 'reserved'].includes(claim.kind))) { errors.add('INVALID_CLAIM'); continue; }
      if (ids.has(claim.id)) { errors.add('DUPLICATE_CLAIM'); continue; }
      ids.add(claim.id);
      if (claim.state === 'released') continue;
      if (claim.profileNumber == null) { unnumberedClaims++; continue; }
      if (!Number.isInteger(claim.profileNumber) || claim.profileNumber < 1 || claim.profileNumber > capacity) {
        errors.add('INVALID_CLAIM'); continue;
      }
      if (numbers.has(claim.profileNumber)) errors.add('PROFILE_CONFLICT');
      numbers.add(claim.profileNumber);
    }
  }
  const occupiedProfiles = [...numbers].sort((a, b) => a - b);
  const occupied = occupiedProfiles.length + unnumberedClaims;
  if (occupied > capacity) errors.add('CAPACITY_EXCEEDED');
  const ok = errors.size === 0;
  return { ok, errors: [...errors], capacity, occupiedProfiles, unnumberedClaims, occupied,
    available: ok && unnumberedClaims === 0 ? capacity - occupied : 0,
    assignableProfiles: ok && unnumberedClaims === 0
      ? Array.from({ length: capacity }, (_, i) => i + 1).filter(n => !numbers.has(n)) : [] };
}
