import { closeSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
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
  return { version: 1, categories: [], rooms: emptyRooms() };
}

const RESERVED_ROOM_IDS = new Set(['__proto__', 'prototype', 'constructor']);

function emptyRooms(): Record<string, ChatRoomOrganizationEntry> {
  return Object.create(null) as Record<string, ChatRoomOrganizationEntry>;
}

function reconstructRooms(entries: Iterable<readonly [string, ChatRoomOrganizationEntry]>): Record<string, ChatRoomOrganizationEntry> {
  const rooms = emptyRooms();
  for (const [roomId, entry] of entries) rooms[roomId] = entry;
  return rooms;
}

function isValidRoomId(roomId: string): boolean {
  return Boolean(roomId) && roomId.length <= 160 && /^[A-Za-z0-9:_-]+$/.test(roomId) && !RESERVED_ROOM_IDS.has(roomId);
}

export class ChatRoomOrganizationValidationError extends Error {}
export class ChatRoomOrganizationStoreError extends Error {}

function invalidInput(message: string): never {
  throw new ChatRoomOrganizationValidationError(message);
}

function invalidStore(message: string): never {
  throw new ChatRoomOrganizationStoreError(message);
}

export function normalizeChatRoomCategoryName(value: unknown): string {
  return String(value ?? '').normalize('NFKC').trim().replace(/\s+/gu, ' ');
}

export function validateChatRoomCategoryName(value: unknown): string {
  const name = normalizeChatRoomCategoryName(value);
  if (!name) invalidInput('카테고리 이름을 입력하세요.');
  if (name.length > 40) invalidInput('카테고리 이름은 40자 이하여야 합니다.');
  if (!/^[\p{L}\p{N} ._()\-]+$/u.test(name) || /\.\./.test(name)) {
    invalidInput('카테고리 이름이 올바르지 않습니다.');
  }
  return name;
}

export function validateChatRoomId(value: unknown): string {
  const roomId = String(value ?? '').trim();
  if (!isValidRoomId(roomId)) {
    invalidInput('채팅방 식별자가 올바르지 않습니다.');
  }
  return roomId;
}

function normalizeStore(value: unknown): ChatRoomOrganizationStore {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidStore('채팅방 폴더 저장소 루트가 올바르지 않습니다.');
  const raw = value as Partial<ChatRoomOrganizationStore>;
  if (raw.version !== 1) invalidStore('채팅방 폴더 저장소 버전이 올바르지 않습니다.');
  if (!Array.isArray(raw.categories)) invalidStore('채팅방 폴더 저장소 카테고리가 올바르지 않습니다.');
  if (!raw.rooms || typeof raw.rooms !== 'object' || Array.isArray(raw.rooms)) invalidStore('채팅방 폴더 저장소 채팅방이 올바르지 않습니다.');
  const categories = raw.categories.map((category) => {
    if (!category || typeof category !== 'object'
      || typeof category.id !== 'string' || !category.id
      || typeof category.name !== 'string'
      || typeof category.createdAt !== 'string' || typeof category.updatedAt !== 'string') {
      invalidStore('채팅방 폴더 저장소 카테고리 항목이 올바르지 않습니다.');
    }
    return { id: category.id, name: category.name, createdAt: category.createdAt, updatedAt: category.updatedAt };
  });
  const validCategoryIds = new Set(categories.map((category) => category.id));
  const rooms = emptyRooms();
  for (const [roomId, entry] of Object.entries(raw.rooms)) {
    if (!isValidRoomId(roomId) || !entry || typeof entry !== 'object' || Array.isArray(entry)
      || typeof entry.unresolved !== 'boolean' || typeof entry.updatedAt !== 'string'
      || (entry.categoryId !== undefined && (typeof entry.categoryId !== 'string' || !validCategoryIds.has(entry.categoryId)))) {
      invalidStore(`채팅방 폴더 저장소 채팅방 항목(${roomId})이 올바르지 않습니다.`);
    }
    rooms[roomId] = {
      ...(entry.categoryId !== undefined ? { categoryId: entry.categoryId } : {}),
      unresolved: entry.unresolved,
      updatedAt: entry.updatedAt,
    };
  }
  return { version: 1, categories, rooms };
}

export function loadChatRoomOrganization(): ChatRoomOrganizationStore {
  try {
    return normalizeStore(JSON.parse(readFileSync(chatRoomOrganizationPath(), 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return emptyStore();
    throw error;
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
    invalidInput('이미 존재하는 카테고리 이름입니다.');
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
  if (!category) invalidInput('카테고리를 찾을 수 없습니다.');
  const normalizedName = validateChatRoomCategoryName(name);
  if (store.categories.some((item) => item.id !== categoryId && normalizeChatRoomCategoryName(item.name).toLocaleLowerCase('ko-KR') === normalizedName.toLocaleLowerCase('ko-KR'))) {
    invalidInput('이미 존재하는 카테고리 이름입니다.');
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
  if (!store.categories.some((category) => category.id === categoryId)) invalidInput('카테고리를 찾을 수 없습니다.');
  const rooms = reconstructRooms(Object.entries(store.rooms).flatMap(([roomId, entry]) => {
    if (entry.categoryId !== categoryId) return [[roomId, entry] as const];
    if (!entry.unresolved) return [];
    return [[roomId, { unresolved: true, updatedAt: now } satisfies ChatRoomOrganizationEntry] as const];
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
    else invalidInput('카테고리를 찾을 수 없습니다.');
  }
  const unresolved = Object.prototype.hasOwnProperty.call(patch, 'unresolved')
    ? patch.unresolved === true
    : current.unresolved;
  const rooms = reconstructRooms(Object.entries(store.rooms));
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
