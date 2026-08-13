import type {
  YouTubeFamilyGroup,
  YouTubeInvitationJob,
  YouTubeInvitationStatus,
} from './youtube-invitations';
import type { YouTubeProductRegistrationRecord } from './youtube-product-registrations';

const CAPACITY_CONSUMING_STATUSES = new Set<YouTubeInvitationStatus>([
  'waiting_for_group_assignment',
  'waiting_for_buyer_email',
  'email_candidate_found',
  'email_confirmed',
  'invite_sent',
  'delivery_completion_pending',
  'delivered_waiting_inspection',
  'active',
]);

function normalize(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase();
}

export class YouTubeCapacityInvariantError extends Error {
  constructor() {
    super('YouTube capacity invariant violated');
    this.name = 'YouTubeCapacityInvariantError';
  }
}

export function occupiedYouTubeFamilyGroupSeats(
  familyGroupId: string,
  invitationJobs: readonly YouTubeInvitationJob[],
  registrations: readonly YouTubeProductRegistrationRecord[],
): number {
  const target = normalize(familyGroupId);
  const occupiedProducts = new Set<string>();
  const fallbackDeals = new Set<string>();
  let anonymousReservations = 0;
  for (const job of invitationJobs) {
    if (normalize(job.familyGroupId) !== target || !CAPACITY_CONSUMING_STATUSES.has(job.status)) continue;
    const productUsid = normalize(job.productUsid);
    if (productUsid) occupiedProducts.add(productUsid);
    else {
      const dealUsid = normalize(job.dealUsid);
      if (dealUsid) fallbackDeals.add(dealUsid);
      else anonymousReservations += 1;
    }
  }
  for (const registration of registrations) {
    if (normalize(registration.familyGroupId) !== target || registration.status === 'failed') continue;
    const productUsid = registration.status === 'registered' ? normalize(registration.productUsid) : '';
    if (productUsid) occupiedProducts.add(productUsid);
    else anonymousReservations += 1;
  }
  return occupiedProducts.size + fallbackDeals.size + anonymousReservations;
}

/**
 * Validates one coherent snapshot. Callers must hold the shared capacity lock
 * while obtaining all three snapshots and until their store write commits.
 */
export function assertYouTubeCapacityInvariant(
  familyGroups: readonly YouTubeFamilyGroup[],
  invitationJobs: readonly YouTubeInvitationJob[],
  registrations: readonly YouTubeProductRegistrationRecord[],
): void {
  const groups = new Map(familyGroups.map((group) => [normalize(group.id), group]));
  const occupiedProducts = new Map<string, Set<string>>();
  const fallbackReservations = new Map<string, number>();

  const requireGroup = (rawGroupId: string): string => {
    const groupId = normalize(rawGroupId);
    if (!groupId || !groups.has(groupId)) throw new YouTubeCapacityInvariantError();
    return groupId;
  };
  const productsFor = (groupId: string): Set<string> => {
    let products = occupiedProducts.get(groupId);
    if (!products) {
      products = new Set<string>();
      occupiedProducts.set(groupId, products);
    }
    return products;
  };
  const reserveFallback = (groupId: string): void => {
    fallbackReservations.set(groupId, (fallbackReservations.get(groupId) ?? 0) + 1);
  };

  for (const job of invitationJobs) {
    if (!CAPACITY_CONSUMING_STATUSES.has(job.status)) continue;
    const rawGroupId = normalize(job.familyGroupId);
    // Unassigned waiting jobs do not consume a particular group's capacity.
    if (!rawGroupId && job.status === 'waiting_for_group_assignment') continue;
    const groupId = requireGroup(job.familyGroupId);
    const productUsid = normalize(job.productUsid);
    if (productUsid) productsFor(groupId).add(productUsid);
    else reserveFallback(groupId);
  }

  for (const registration of registrations) {
    if (registration.status === 'failed') continue;
    const groupId = requireGroup(registration.familyGroupId);
    if (registration.status === 'registered') {
      const productUsid = normalize(registration.productUsid);
      if (!productUsid) throw new YouTubeCapacityInvariantError();
      productsFor(groupId).add(productUsid);
    } else {
      // submitting and uncertain outcomes each reserve one seat because no
      // trustworthy product identity exists for cross-feed deduplication.
      reserveFallback(groupId);
    }
  }

  for (const [groupId, group] of groups) {
    const occupied = (occupiedProducts.get(groupId)?.size ?? 0)
      + (fallbackReservations.get(groupId) ?? 0);
    if (occupied > group.sellableSeats) throw new YouTubeCapacityInvariantError();
  }
}
