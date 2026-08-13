#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  assertYouTubeCapacityInvariant,
  occupiedYouTubeFamilyGroupSeats,
} from '../src/lib/youtube-capacity-invariant';
import type {
  YouTubeFamilyGroup,
  YouTubeFamilyGroupsStoreData,
  YouTubeInvitationJob,
  YouTubeInvitationJobsStoreData,
} from '../src/lib/youtube-invitations';
import type {
  YouTubeProductRegistrationRecord,
  YouTubeProductRegistrationsData,
} from '../src/lib/youtube-product-registrations';

const DEFAULT_PATHS = {
  familyGroups: 'data/youtube-family-groups.json',
  invitations: 'data/youtube-invitations.json',
  registrations: 'data/youtube-product-registrations.json',
} as const;

const INVITATION_STATUSES = [
  'waiting_for_group_assignment', 'waiting_for_buyer_email', 'email_candidate_found', 'email_confirmed',
  'invite_sent', 'delivery_completion_pending', 'delivered_waiting_inspection', 'active', 'failed', 'ended',
] as const;
const REGISTRATION_STATUSES = ['submitting', 'registered', 'uncertain', 'failed'] as const;

export interface YouTubeInviteAuditReport {
  schemaVersion: 1;
  readOnly: true;
  featureFlags: {
    salesEnabled: boolean;
    autoMessageEnabled: boolean;
    providerAutomationEnabled: boolean;
  };
  stores: {
    familyGroups: 'ok' | 'missing' | 'invalid';
    invitations: 'ok' | 'missing' | 'invalid';
    registrations: 'ok' | 'missing' | 'invalid';
  };
  counts: {
    familyGroups: number;
    enabledFamilyGroups: number;
    sellableSeats: number;
    occupiedSeats: number;
    availableSeats: number;
    registrations: number;
    registrationsByStatus: Record<(typeof REGISTRATION_STATUSES)[number], number>;
    invitations: number;
    invitationsByStatus: Record<(typeof INVITATION_STATUSES)[number], number>;
  };
  invariants: {
    ok: boolean;
    storeErrors: number;
    duplicateFamilyGroupIds: number;
    duplicateRegistrationKeys: number;
    duplicateRegisteredProducts: number;
    duplicateInvitationDeals: number;
  };
  missingMappings: {
    registrationsWithoutFamilyGroup: number;
    invitationsWithoutFamilyGroup: number;
    invitationsWithoutRegisteredProduct: number;
  };
  overcapacity: {
    groupCount: number;
    excessSeats: number;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readJsonStore(path: string): { state: 'ok'; value: unknown } | { state: 'missing' | 'invalid' } {
  try {
    return { state: 'ok', value: JSON.parse(readFileSync(path, 'utf8')) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { state: 'missing' };
    return { state: 'invalid' };
  }
}

function familyGroupsFrom(value: unknown): YouTubeFamilyGroup[] | null {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.familyGroups)) return null;
  return value.familyGroups.every((group) => isRecord(group)
    && typeof group.id === 'string' && typeof group.sellableSeats === 'number' && typeof group.enabled === 'boolean')
    ? (value as unknown as YouTubeFamilyGroupsStoreData).familyGroups : null;
}

function invitationsFrom(value: unknown): YouTubeInvitationJob[] | null {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.jobs)) return null;
  return value.jobs.every((job) => isRecord(job)
    && typeof job.id === 'string' && typeof job.dealUsid === 'string' && typeof job.productUsid === 'string'
    && typeof job.familyGroupId === 'string' && typeof job.status === 'string')
    ? (value as unknown as YouTubeInvitationJobsStoreData).jobs : null;
}

function registrationsFrom(value: unknown): YouTubeProductRegistrationRecord[] | null {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.records)) return null;
  return value.records.every((row) => isRecord(row)
    && typeof row.idempotencyKey === 'string' && typeof row.familyGroupId === 'string'
    && typeof row.status === 'string' && (typeof row.productUsid === 'string' || row.productUsid === null))
    ? (value as unknown as YouTubeProductRegistrationsData).records : null;
}

function duplicateCount(values: readonly string[]): number {
  return values.length - new Set(values).size;
}

function normalize(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase();
}

function statusCounts<const T extends readonly string[]>(statuses: T, values: readonly string[]): Record<T[number], number> {
  return Object.fromEntries(statuses.map((status) => [status, values.filter((value) => value === status).length])) as Record<T[number], number>;
}

/**
 * Reads local JSON stores only. It performs no network requests, lock creation,
 * directory creation, chmod, store initialization, or writes of any kind.
 */
export function auditYouTubeInviteFlow(env: NodeJS.ProcessEnv = process.env): YouTubeInviteAuditReport {
  const raw = {
    familyGroups: readJsonStore(env.YOUTUBE_FAMILY_GROUPS_PATH || DEFAULT_PATHS.familyGroups),
    invitations: readJsonStore(env.YOUTUBE_INVITATIONS_PATH || DEFAULT_PATHS.invitations),
    registrations: readJsonStore(env.YOUTUBE_PRODUCT_REGISTRATIONS_PATH || DEFAULT_PATHS.registrations),
  };
  const groups = raw.familyGroups.state === 'ok' ? familyGroupsFrom(raw.familyGroups.value) : null;
  const invitations = raw.invitations.state === 'ok' ? invitationsFrom(raw.invitations.value) : null;
  const registrations = raw.registrations.state === 'ok' ? registrationsFrom(raw.registrations.value) : null;
  const storeStates = {
    familyGroups: raw.familyGroups.state === 'ok' && groups === null ? 'invalid' as const : raw.familyGroups.state,
    invitations: raw.invitations.state === 'ok' && invitations === null ? 'invalid' as const : raw.invitations.state,
    registrations: raw.registrations.state === 'ok' && registrations === null ? 'invalid' as const : raw.registrations.state,
  };
  const safeGroups = groups ?? [];
  const safeInvitations = invitations ?? [];
  const safeRegistrations = registrations ?? [];
  const groupIds = new Set(safeGroups.map((group) => normalize(group.id)));
  const registeredProducts = new Set(safeRegistrations
    .filter((row) => row.status === 'registered' && row.productUsid)
    .map((row) => normalize(row.productUsid)));

  let overcapacityGroupCount = 0;
  let excessSeats = 0;
  let occupiedSeats = 0;
  for (const group of safeGroups) {
    const occupied = occupiedYouTubeFamilyGroupSeats(group.id, safeInvitations, safeRegistrations);
    occupiedSeats += occupied;
    if (occupied > group.sellableSeats) {
      overcapacityGroupCount += 1;
      excessSeats += occupied - group.sellableSeats;
    }
  }

  const storeErrors = Object.values(storeStates).filter((state) => state !== 'ok').length;
  let capacityInvariantOk = storeErrors === 0;
  if (capacityInvariantOk) {
    try { assertYouTubeCapacityInvariant(safeGroups, safeInvitations, safeRegistrations); }
    catch { capacityInvariantOk = false; }
  }
  const duplicateFamilyGroupIds = duplicateCount(safeGroups.map((group) => normalize(group.id)));
  const duplicateRegistrationKeys = duplicateCount(safeRegistrations.map((row) => row.idempotencyKey));
  const duplicateRegisteredProducts = duplicateCount(safeRegistrations
    .filter((row) => row.status === 'registered' && row.productUsid)
    .map((row) => normalize(row.productUsid)));
  const duplicateInvitationDeals = duplicateCount(safeInvitations.map((job) => normalize(job.dealUsid)));
  const sellableSeats = safeGroups.reduce((total, group) => total + (Number.isSafeInteger(group.sellableSeats) ? group.sellableSeats : 0), 0);

  return {
    schemaVersion: 1,
    readOnly: true,
    featureFlags: {
      salesEnabled: env.YOUTUBE_INVITE_SALES_ENABLED === 'true',
      autoMessageEnabled: env.YOUTUBE_INVITE_AUTO_MESSAGE_ENABLED === 'true',
      providerAutomationEnabled: env.YOUTUBE_INVITE_PROVIDER_AUTOMATION_ENABLED === 'true',
    },
    stores: storeStates,
    counts: {
      familyGroups: safeGroups.length,
      enabledFamilyGroups: safeGroups.filter((group) => group.enabled).length,
      sellableSeats,
      occupiedSeats,
      availableSeats: Math.max(0, sellableSeats - occupiedSeats),
      registrations: safeRegistrations.length,
      registrationsByStatus: statusCounts(REGISTRATION_STATUSES, safeRegistrations.map((row) => row.status)),
      invitations: safeInvitations.length,
      invitationsByStatus: statusCounts(INVITATION_STATUSES, safeInvitations.map((job) => job.status)),
    },
    invariants: {
      ok: capacityInvariantOk && duplicateFamilyGroupIds === 0 && duplicateRegistrationKeys === 0
        && duplicateRegisteredProducts === 0 && duplicateInvitationDeals === 0,
      storeErrors,
      duplicateFamilyGroupIds,
      duplicateRegistrationKeys,
      duplicateRegisteredProducts,
      duplicateInvitationDeals,
    },
    missingMappings: {
      registrationsWithoutFamilyGroup: safeRegistrations.filter((row) => row.status !== 'failed' && !groupIds.has(normalize(row.familyGroupId))).length,
      invitationsWithoutFamilyGroup: safeInvitations.filter((job) => job.status !== 'failed' && job.status !== 'ended'
        && (!normalize(job.familyGroupId) || !groupIds.has(normalize(job.familyGroupId)))).length,
      invitationsWithoutRegisteredProduct: safeInvitations.filter((job) => job.status !== 'failed' && job.status !== 'ended'
        && !registeredProducts.has(normalize(job.productUsid))).length,
    },
    overcapacity: { groupCount: overcapacityGroupCount, excessSeats },
  };
}

export const YOUTUBE_INVITE_AUDIT_HELP = `Usage: node --import tsx scripts/audit-youtube-invite-flow.ts [--help]\n\nReads YouTube invite feature flags and local store paths, then prints one stable JSON report.\nThis command is read-only: it never initializes stores or sends external requests. Raw emails, buyer names, deal IDs, chat UUIDs, and product/group IDs are never printed.\n\nEnvironment paths:\n  YOUTUBE_FAMILY_GROUPS_PATH\n  YOUTUBE_INVITATIONS_PATH\n  YOUTUBE_PRODUCT_REGISTRATIONS_PATH`;

function isMainModule(): boolean {
  const entry = process.argv[1];
  return Boolean(entry) && import.meta.url === pathToFileURL(resolve(entry)).href;
}

if (isMainModule()) {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(YOUTUBE_INVITE_AUDIT_HELP);
  } else if (args.length > 0) {
    console.error('Unknown argument. Use --help.');
    process.exitCode = 2;
  } else {
    console.log(JSON.stringify(auditYouTubeInviteFlow(process.env)));
  }
}
