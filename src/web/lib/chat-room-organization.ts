export interface ChatRoomOrganizationCategory {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatRoomOrganizationEntry {
  categoryId?: string;
  unresolved: boolean;
  updatedAt: string;
}

export interface ChatRoomOrganization {
  version: 1;
  categories: ChatRoomOrganizationCategory[];
  rooms: Record<string, ChatRoomOrganizationEntry>;
}

export type ChatRoomOrganizationView = 'all' | 'unresolved' | 'unassigned' | `category:${string}`;

type IdentifiedChatRoom = { chatRoomUuid: string };

export function emptyChatRoomOrganization(): ChatRoomOrganization {
  return { version: 1, categories: [], rooms: {} };
}

export function buildChatRoomOrganizationCounts<T extends IdentifiedChatRoom>(
  rooms: T[],
  organization: ChatRoomOrganization,
): { total: number; unresolved: number; unassigned: number; byCategory: Record<string, number> } {
  const validCategoryIds = new Set(organization.categories.map((category) => category.id));
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

export function filterRoomsByOrganizationView<T extends IdentifiedChatRoom>(
  rooms: T[],
  organization: ChatRoomOrganization,
  view: ChatRoomOrganizationView,
): T[] {
  if (view === 'all') return rooms;
  const validCategoryIds = new Set(organization.categories.map((category) => category.id));
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
