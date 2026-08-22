export interface ChatRoomOrganizationCategory {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatRoomOrganizationEntry {
  categoryId?: string;
  pinned?: boolean;
  unresolved: boolean;
  updatedAt: string;
}

export interface ChatRoomOrganization {
  version: 1;
  categories: ChatRoomOrganizationCategory[];
  rooms: Record<string, ChatRoomOrganizationEntry>;
}

export type ChatRoomOrganizationView = 'all' | 'pinned' | 'unresolved' | 'unassigned' | `category:${string}` | `service:${string}`;

type IdentifiedChatRoom = { chatRoomUuid: string; productType?: string };

export interface ChatRoomServiceFolder {
  service: string;
  count: number;
}

export type ChatRoomOrganizationGenerationRef = { current: number };

const SERVICE_VIEW_PREFIX = 'service:';

export function captureChatRoomOrganizationRead(generation: ChatRoomOrganizationGenerationRef): number {
  return generation.current;
}

export function invalidateChatRoomOrganizationReads(generation: ChatRoomOrganizationGenerationRef): void {
  generation.current += 1;
}

export function isChatRoomOrganizationReadCurrent(generation: ChatRoomOrganizationGenerationRef, snapshot: number): boolean {
  return generation.current === snapshot;
}

export function emptyChatRoomOrganization(): ChatRoomOrganization {
  return { version: 1, categories: [], rooms: {} };
}

function validCategoryIdsOf(organization: ChatRoomOrganization): Set<string> {
  return new Set(organization.categories.map((category) => category.id));
}

export function buildChatRoomOrganizationCounts<T extends IdentifiedChatRoom>(
  rooms: T[],
  organization: ChatRoomOrganization,
): { total: number; unresolved: number; unassigned: number; byCategory: Record<string, number> } {
  const validCategoryIds = validCategoryIdsOf(organization);
  const byCategory = Object.fromEntries(organization.categories.map((category) => [category.id, 0]));
  let unresolved = 0;
  let unassigned = 0;
  for (const room of rooms) {
    const entry = organization.rooms[room.chatRoomUuid];
    if (entry?.unresolved) unresolved += 1;
    if (entry?.categoryId && validCategoryIds.has(entry.categoryId)) byCategory[entry.categoryId] += 1;
    else unassigned += 1;
  }
  return { total: rooms.length, unresolved, unassigned, byCategory };
}

export function countPinnedRooms<T extends IdentifiedChatRoom>(rooms: T[], organization: ChatRoomOrganization): number {
  return rooms.reduce((count, room) => (organization.rooms[room.chatRoomUuid]?.pinned === true ? count + 1 : count), 0);
}

export function filterRoomsByPinned<T extends IdentifiedChatRoom>(rooms: T[], organization: ChatRoomOrganization): T[] {
  return rooms.filter((room) => organization.rooms[room.chatRoomUuid]?.pinned === true);
}

export function buildChatRoomServiceFolders<T extends IdentifiedChatRoom>(rooms: T[] = []): ChatRoomServiceFolder[] {
  const counts = new Map<string, number>();
  for (const room of rooms) {
    const service = room.productType?.trim();
    if (!service) continue;
    counts.set(service, (counts.get(service) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([service, count]) => ({ service, count }))
    .sort((a, b) => b.count - a.count || a.service.localeCompare(b.service, 'ko'));
}

export function filterRoomsByServiceView<T extends IdentifiedChatRoom>(rooms: T[], view: `service:${string}`): T[] {
  const service = view.slice(SERVICE_VIEW_PREFIX.length);
  return rooms.filter((room) => room.productType?.trim() === service);
}

export function isServiceChatRoomOrganizationView(view: ChatRoomOrganizationView): view is `service:${string}` {
  return view.startsWith(SERVICE_VIEW_PREFIX);
}

export function filterRoomsByOrganizationView<T extends IdentifiedChatRoom>(
  rooms: T[],
  organization: ChatRoomOrganization,
  view: ChatRoomOrganizationView,
): T[] {
  if (view === 'all') return rooms;
  if (view === 'pinned') return filterRoomsByPinned(rooms, organization);
  if (isServiceChatRoomOrganizationView(view)) return filterRoomsByServiceView(rooms, view);
  const validCategoryIds = validCategoryIdsOf(organization);
  if (view === 'unresolved') return rooms.filter((room) => organization.rooms[room.chatRoomUuid]?.unresolved === true);
  if (view === 'unassigned') {
    return rooms.filter((room) => {
      const categoryId = organization.rooms[room.chatRoomUuid]?.categoryId;
      return !categoryId || !validCategoryIds.has(categoryId);
    });
  }
  const categoryId = view.slice('category:'.length);
  if (!validCategoryIds.has(categoryId)) return [];
  return rooms.filter((room) => organization.rooms[room.chatRoomUuid]?.categoryId === categoryId);
}
