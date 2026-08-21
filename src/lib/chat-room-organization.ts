import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface ChatRoomCategory {
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

export interface ChatRoomOrganizationStore {
  version: 1;
  categories: ChatRoomCategory[];
  rooms: Record<string, ChatRoomOrganizationEntry>;
}

const DEFAULT_PATH = '/home/ubuntu/.hermes/hermes-agent/graytag-aio-manager-0606/data/chat-room-organization.json';

export function chatRoomOrganizationPath(): string {
  return process.env.CHAT_ROOM_ORGANIZATION_PATH || DEFAULT_PATH;
}

function emptyStore(): ChatRoomOrganizationStore {
  return { version: 1, categories: [], rooms: {} };
}

export function normalizeChatRoomCategoryName(value: unknown): string {
  return String(value ?? '').normalize('NFKC').trim().replace(/\s+/gu, ' ');
}

export function validateChatRoomCategoryName(value: unknown): string {
  const name = normalizeChatRoomCategoryName(value);
  if (!name) throw new Error('카테고리 이름을 입력하세요.');
  if (name.length > 40) throw new Error('카테고리 이름은 40자 이하여야 합니다.');
  if (!/^[\p{L}\p{N} ._()\-]+$/u.test(name) || /\.\./.test(name)) {
    throw new Error('카테고리 이름이 올바르지 않습니다.');
  }
  return name;
}

export function validateChatRoomId(value: unknown): string {
  const roomId = String(value ?? '').trim();
  if (!roomId || roomId.length > 160 || !/^[A-Za-z0-9:_-]+$/.test(roomId)) {
    throw new Error('채팅방 식별자가 올바르지 않습니다.');
  }
  return roomId;
}

function normalizeStore(value: unknown): ChatRoomOrganizationStore {
  if (!value || typeof value !== 'object') return emptyStore();
  const raw = value as Partial<ChatRoomOrganizationStore>;
  const categories = Array.isArray(raw.categories)
    ? raw.categories.filter((category): category is ChatRoomCategory => Boolean(
      category && typeof category.id === 'string' && typeof category.name === 'string'
      && typeof category.createdAt === 'string' && typeof category.updatedAt === 'string',
    ))
    : [];
  const validCategoryIds = new Set(categories.map((category) => category.id));
  const rooms: Record<string, ChatRoomOrganizationEntry> = {};
  if (raw.rooms && typeof raw.rooms === 'object') {
    for (const [roomId, entry] of Object.entries(raw.rooms)) {
      if (!entry || typeof entry !== 'object' || typeof entry.updatedAt !== 'string') continue;
      rooms[roomId] = {
        ...(typeof entry.categoryId === 'string' && validCategoryIds.has(entry.categoryId) ? { categoryId: entry.categoryId } : {}),
        unresolved: entry.unresolved === true,
        updatedAt: entry.updatedAt,
      };
    }
  }
  return { version: 1, categories, rooms };
}

export function loadChatRoomOrganization(): ChatRoomOrganizationStore {
  try {
    const path = chatRoomOrganizationPath();
    if (!existsSync(path)) return emptyStore();
    return normalizeStore(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return emptyStore();
  }
}

export function saveChatRoomOrganization(store: ChatRoomOrganizationStore): ChatRoomOrganizationStore {
  const normalized = normalizeStore(store);
  const path = chatRoomOrganizationPath();
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporaryPath, 'wx', 0o600);
    writeFileSync(descriptor, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporaryPath, path);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporaryPath, { force: true });
  }
  return normalized;
}

export function createChatRoomCategory(name: unknown, now = new Date().toISOString()): ChatRoomCategory {
  const store = loadChatRoomOrganization();
  const normalizedName = validateChatRoomCategoryName(name);
  if (store.categories.some((category) => normalizeChatRoomCategoryName(category.name).toLocaleLowerCase('ko-KR') === normalizedName.toLocaleLowerCase('ko-KR'))) {
    throw new Error('이미 존재하는 카테고리 이름입니다.');
  }
  const category: ChatRoomCategory = {
    id: randomUUID(),
    name: normalizedName,
    createdAt: now,
    updatedAt: now,
  };
  saveChatRoomOrganization({ ...store, categories: [...store.categories, category] });
  return category;
}

export function renameChatRoomCategory(categoryId: string, name: unknown, now = new Date().toISOString()): ChatRoomCategory {
  const store = loadChatRoomOrganization();
  const category = store.categories.find((item) => item.id === categoryId);
  if (!category) throw new Error('카테고리를 찾을 수 없습니다.');
  const normalizedName = validateChatRoomCategoryName(name);
  if (store.categories.some((item) => item.id !== categoryId && normalizeChatRoomCategoryName(item.name).toLocaleLowerCase('ko-KR') === normalizedName.toLocaleLowerCase('ko-KR'))) {
    throw new Error('이미 존재하는 카테고리 이름입니다.');
  }
  const updated = { ...category, name: normalizedName, updatedAt: now };
  saveChatRoomOrganization({
    ...store,
    categories: store.categories.map((item) => item.id === categoryId ? updated : item),
  });
  return updated;
}

export function deleteChatRoomCategory(categoryId: string, now = new Date().toISOString()): ChatRoomOrganizationStore {
  const store = loadChatRoomOrganization();
  if (!store.categories.some((category) => category.id === categoryId)) throw new Error('카테고리를 찾을 수 없습니다.');
  const rooms = Object.fromEntries(Object.entries(store.rooms).flatMap(([roomId, entry]) => {
    if (entry.categoryId !== categoryId) return [[roomId, entry]];
    if (!entry.unresolved) return [];
    return [[roomId, { unresolved: true, updatedAt: now } satisfies ChatRoomOrganizationEntry]];
  }));
  return saveChatRoomOrganization({
    ...store,
    categories: store.categories.filter((category) => category.id !== categoryId),
    rooms,
  });
}

export function updateChatRoomOrganizationEntry(
  roomIdValue: unknown,
  patch: { categoryId?: unknown; unresolved?: unknown },
  now = new Date().toISOString(),
): ChatRoomOrganizationEntry | null {
  const roomId = validateChatRoomId(roomIdValue);
  const store = loadChatRoomOrganization();
  const current = store.rooms[roomId] ?? { unresolved: false, updatedAt: now };
  let categoryId = current.categoryId;
  if (Object.prototype.hasOwnProperty.call(patch, 'categoryId')) {
    if (patch.categoryId === null || patch.categoryId === '') categoryId = undefined;
    else if (typeof patch.categoryId === 'string' && store.categories.some((category) => category.id === patch.categoryId)) categoryId = patch.categoryId;
    else throw new Error('카테고리를 찾을 수 없습니다.');
  }
  const unresolved = Object.prototype.hasOwnProperty.call(patch, 'unresolved')
    ? patch.unresolved === true
    : current.unresolved;
  const rooms = { ...store.rooms };
  if (!categoryId && !unresolved) {
    delete rooms[roomId];
    saveChatRoomOrganization({ ...store, rooms });
    return null;
  }
  const updated: ChatRoomOrganizationEntry = {
    ...(categoryId ? { categoryId } : {}),
    unresolved,
    updatedAt: now,
  };
  rooms[roomId] = updated;
  saveChatRoomOrganization({ ...store, rooms });
  return updated;
}
