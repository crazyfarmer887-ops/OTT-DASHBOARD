import { createHash } from 'node:crypto';
import { disneyEveryviewAccountKey } from './gbuts-disney-everyview';
import type { DisneySeatClaim, DisneySeatSnapshot } from './disney-cross-platform-inventory';
import type { GbutsOttStore } from './gbuts-ott';
import type { EveryviewDisneyWatchState } from '../scheduler/everyview-disney-observation';

/** Evidence must be collected independently; an HTML empty slot is not proof of an active advertisement. */
export interface EveryviewDisneyVerifiedEvidence {
  partyId: number;
  accountHash: string;
  /** Exactly the roster observation against which the evidence was verified. */
  observedAt: string;
  checkedAt: string;
  buyers: Record<string, { userSeq: number; profileNumber: number }>;
  /** Explicitly held, separately verified unsold profiles; not inferred from empty slots. */
  advertisements: Array<{ reservationId: string; profileNumber: number }>;
}

const validProfile = (n: unknown): n is number => Number.isInteger(n) && Number(n) >= 1 && Number(n) <= 6;
const safeId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(v);
const numericId = (v: string) => /^[1-9]\d*$/.test(v) && Number.isSafeInteger(Number(v));

/**
 * Derives a held-only snapshot for an already explicitly mapped party.
 * Invalid, missing, stale, disappeared or conflicting evidence fails closed.
 * Callers must hold withGbutsOttInventory and atomically write the returned
 * store; do not enable publication from this adapter alone. Independent
 * checkout systems still require dedicated, durable seat reservations.
 */
export function applyEveryviewDisneyObservation(input: {
  store: GbutsOttStore;
  accountEmail: string;
  partyId: number;
  watch: EveryviewDisneyWatchState;
  evidence?: EveryviewDisneyVerifiedEvidence;
  now: Date;
  maxAgeMs?: number;
}): { store: GbutsOttStore; complete: boolean } {
  const { store, accountEmail, partyId, watch, evidence, now } = input;
  const maxAgeMs = input.maxAgeMs ?? 120_000, current = now.getTime();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(accountEmail.trim()) || !Number.isSafeInteger(partyId) || partyId < 1
    || !Number.isFinite(current) || !Number.isFinite(maxAgeMs) || maxAgeMs <= 0) throw Error('BINDING_INVALID');
  const key = disneyEveryviewAccountKey(accountEmail), mapping = store.disneyEveryview?.[key];
  if (!mapping || !Array.isArray(mapping.partyIds) || mapping.partyIds.filter(id => id === partyId).length !== 1
    || !mapping.snapshots || typeof mapping.snapshots !== 'object') throw Error('PARTY_MAPPING_REQUIRED');
  const source = `everyview:${partyId}`, previous = mapping.snapshots[String(partyId)];
  const observed = watch?.parties?.[String(partyId)];
  const ageOkay = (value: string | undefined) => {
    const time = Date.parse(value || '');
    return Number.isFinite(time) && time <= current && current - time <= maxAgeMs;
  };
  let complete = Boolean(watch?.version === 1 && !watch.lastError && observed?.accountHash === key
    && ageOkay(observed?.observedAt) && evidence?.partyId === partyId && evidence?.accountHash === key
    && evidence?.observedAt === observed?.observedAt && ageOkay(evidence?.checkedAt)
    && Date.parse(evidence!.checkedAt) >= Date.parse(observed!.observedAt)
    && evidence?.buyers && typeof evidence.buyers === 'object' && !Array.isArray(evidence.buyers)
    && Array.isArray(evidence?.advertisements));
  const claims: DisneySeatClaim[] = [];
  const add = (claim: DisneySeatClaim) => { claims.push(claim); };
  if (observed?.members && typeof observed.members === 'object' && !Array.isArray(observed.members)) {
    for (const [memberSeq, member] of Object.entries(observed.members)) {
      if (!numericId(memberSeq) || !Number.isSafeInteger(member?.userSeq) || member.userSeq < 1) { complete = false; continue; }
      const proof = evidence?.buyers?.[memberSeq];
      const profile = proof?.userSeq === member.userSeq && validProfile(proof?.profileNumber) ? proof.profileNumber : undefined;
      if (profile === undefined || !member.currentlyVisible) complete = false;
      add({ id: `buyer_${memberSeq}`, kind: 'buyer', state: member.currentlyVisible ? 'active' : 'unknown', profileNumber: profile });
    }
  } else complete = false;
  let advertisements = 0;
  if (Array.isArray(evidence?.advertisements)) for (const ad of evidence.advertisements) {
    if (!safeId(ad?.reservationId) || !validProfile(ad?.profileNumber)) { complete = false; continue; }
    add({ id: `advertised_${ad.reservationId}`, kind: 'advertised', state: 'pending', profileNumber: ad.profileNumber });
    advertisements++;
  }
  if (evidence?.buyers && typeof evidence.buyers === 'object') {
    for (const id of Object.keys(evidence.buyers)) if (!observed?.members?.[id]) complete = false;
  }
  // A past hold cannot disappear just because a subsequent observation omits it.
  // Even when an advertisement turns into a buyer, reconciliation is required
  // before its prior hold can be explicitly released.
  const ids = new Set(claims.map(c => c.id));
  if (Array.isArray(previous?.claims)) for (const old of previous.claims) {
    if (old.state === 'released') continue;
    const next = claims.find(c => c.id === old.id);
    if (!next) { add({ ...old, state: 'unknown' }); complete = false; }
    else if (old.profileNumber !== next.profileNumber || old.kind !== next.kind) complete = false;
  }
  if (ids.size !== claims.length || new Set(claims.map(c => c.id)).size !== claims.length) complete = false;
  const numbers = claims.map(c => c.profileNumber).filter((v): v is number => v != null);
  if (numbers.length !== claims.length || new Set(numbers).size !== numbers.length || claims.length > 6) complete = false;
  const snapshot: DisneySeatSnapshot = { source, complete,
    verifiedAt: observed?.observedAt || previous?.verifiedAt || now.toISOString(),
    advertisedVacancies: advertisements, claims };
  const next = structuredClone(store);
  next.disneyEveryview![key].snapshots[String(partyId)] = snapshot;
  return { store: next, complete };
}

/** Independently checked party setting; a visual empty slot alone is insufficient. */
export interface EveryviewDedicatedSeatEvidence {
  partyId: number;
  accountHash: string;
  rosterObservedAt: string;
  checkedAt: string;
  /** Total currently occupied + open buyer places, independently observed. */
  buyerCapacity: 0 | 1;
  advertisedVacancies: 0 | 1;
}

/**
 * Model a permanently segregated Everyview seat. The seat remains held even
 * when hidden, sold, refunded or visibility is unknown. Profile assignment is
 * configured before publication; no buyer is renumbered. A hidden/expired
 * listing never frees the seat for another platform automatically.
 */
export function applyDedicatedEveryviewDisneySeat(input: {
  store: GbutsOttStore; accountEmail: string; partyId: number; profileNumber: number;
  watch: EveryviewDisneyWatchState; evidence?: EveryviewDedicatedSeatEvidence;
  now: Date; maxAgeMs?: number;
}): { store: GbutsOttStore; complete: boolean } {
  const { store, accountEmail, partyId, profileNumber, watch, evidence, now } = input;
  const current = now.getTime(), maxAge = input.maxAgeMs ?? 120_000;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(accountEmail.trim()) || !Number.isSafeInteger(partyId) || partyId < 1
    || !validProfile(profileNumber) || !Number.isFinite(current) || !Number.isFinite(maxAge) || maxAge <= 0) throw Error('BINDING_INVALID');
  const key = disneyEveryviewAccountKey(accountEmail), mapping = store.disneyEveryview?.[key];
  if (!mapping || !Array.isArray(mapping.partyIds) || mapping.partyIds.filter(id => id === partyId).length !== 1
    || !mapping.snapshots || typeof mapping.snapshots !== 'object') throw Error('PARTY_MAPPING_REQUIRED');
  const party = watch?.parties?.[String(partyId)], previous = mapping.snapshots[String(partyId)];
  const validTime = (value: string | undefined) => {
    const n = Date.parse(value || ''); return Number.isFinite(n) && n <= current && current - n <= maxAge;
  };
  const entries = party?.members && typeof party.members === 'object' && !Array.isArray(party.members) ? Object.entries(party.members) : [];
  const identitiesValid = entries.every(([id, m]) => numericId(id) && Number.isSafeInteger(m?.userSeq) && m.userSeq > 0);
  const visible = entries.filter(([, m]) => m.currentlyVisible);
  const missing = entries.filter(([, m]) => !m.currentlyVisible);
  let complete = Boolean(watch?.version === 1 && !watch.lastError && party?.accountHash === key
    && validTime(party?.observedAt) && evidence?.partyId === partyId && evidence?.accountHash === key
    && evidence?.rosterObservedAt === party?.observedAt && validTime(evidence?.checkedAt)
    && Date.parse(evidence!.checkedAt) >= Date.parse(party!.observedAt)
    && [0, 1].includes(evidence?.buyerCapacity as number) && [0, 1].includes(evidence?.advertisedVacancies as number)
    && (evidence?.buyerCapacity || 0) >= visible.length + (evidence?.advertisedVacancies || 0)
    && identitiesValid && visible.length <= 1 && missing.length === 0
    && !(visible.length && evidence?.advertisedVacancies === 1));
  const id = `dedicated_${partyId}_${profileNumber}`;
  // Any legacy or unknown hold requires reconciliation instead of replacement.
  const prior = Array.isArray(previous?.claims) ? previous.claims.filter(c => c.state !== 'released') : [];
  if (previous && (!Array.isArray(previous.claims) || previous.source !== `everyview:${partyId}`)) complete = false;
  if (prior.some(c => c.id !== id || c.profileNumber !== profileNumber)) complete = false;
  const oldBuyer = prior.find(c => c.id === id)?.buyerIdentity;
  const buyerIdentity = visible.length === 1
    ? createHash('sha256').update(`${partyId}:${visible[0][0]}:${visible[0][1].userSeq}`).digest('hex') : undefined;
  if (oldBuyer && oldBuyer !== buyerIdentity) complete = false;
  if (prior.some(c => c.id === id && c.kind === 'buyer' && !c.buyerIdentity)) complete = false;
  const kind: NonNullable<DisneySeatClaim['kind']> = visible.length === 1 ? 'buyer'
    : evidence?.advertisedVacancies === 1 && missing.length === 0 ? 'advertised' : 'reserved';
  const claim: DisneySeatClaim = { id, profileNumber, kind,
    ...(oldBuyer || buyerIdentity ? { buyerIdentity: oldBuyer || buyerIdentity } : {}),
    state: !complete ? 'unknown' : kind === 'buyer' ? 'active' : 'pending' };
  const claims: DisneySeatClaim[] = [claim];
  for (const old of prior) if (old.id !== id) claims.push({ ...old, state: 'unknown' });
  const snapshot: DisneySeatSnapshot = { source: `everyview:${partyId}`, complete,
    verifiedAt: party?.observedAt || previous?.verifiedAt || now.toISOString(),
    advertisedVacancies: kind === 'advertised' ? 1 : 0, claims };
  const next = structuredClone(store);
  next.disneyEveryview![key].snapshots[String(partyId)] = snapshot;
  return { store: next, complete };
}
