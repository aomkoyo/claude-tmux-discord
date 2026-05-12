import { PrismaClient, type Room, type AclEntry, type Setting } from './generated/prisma/index.js';

export const ACL_ENTRY_TYPES = ['user', 'role', 'channel'] as const;
export type AclEntryType = (typeof ACL_ENTRY_TYPES)[number];

export function isAclEntryType(s: string | undefined | null): s is AclEntryType {
  return typeof s === 'string' && (ACL_ENTRY_TYPES as readonly string[]).includes(s);
}

export const ROOM_MODES = ['default', 'plan', 'acceptEdits', 'bypassPermissions'] as const;
export type RoomMode = (typeof ROOM_MODES)[number];

export function isRoomMode(s: string | undefined | null): s is RoomMode {
  return typeof s === 'string' && (ROOM_MODES as readonly string[]).includes(s);
}

export function asRoomMode(s: string | undefined | null): RoomMode {
  return isRoomMode(s) ? s : 'bypassPermissions';
}

let _prisma: PrismaClient | undefined;

export function getPrisma(): PrismaClient {
  if (!_prisma) {
    _prisma = new PrismaClient({
      log: [{ emit: 'event', level: 'warn' }, { emit: 'event', level: 'error' }],
    });
  }
  return _prisma;
}

export async function disconnect(): Promise<void> {
  if (_prisma) {
    await _prisma.$disconnect();
    _prisma = undefined;
  }
}

export type { Room };

export type CreateRoomInput = {
  channelId: string;
  guildId: string;
  parentId: string | null;
  name: string;
  workspaceDir: string;
  tmuxSession: string;
  createdBy: string;
  mode?: RoomMode;
};

export async function createRoom(input: CreateRoomInput): Promise<Room> {
  return getPrisma().room.create({
    data: {
      channelId: input.channelId,
      guildId: input.guildId,
      parentId: input.parentId,
      name: input.name,
      workspaceDir: input.workspaceDir,
      tmuxSession: input.tmuxSession,
      createdBy: input.createdBy,
      mode: input.mode ?? 'bypassPermissions',
    },
  });
}

export async function setRoomMode(channelId: string, mode: RoomMode): Promise<Room | null> {
  return getPrisma()
    .room.update({ where: { channelId }, data: { mode } })
    .catch(() => null);
}

export async function findRoomByChannel(channelId: string): Promise<Room | null> {
  return getPrisma().room.findUnique({ where: { channelId } });
}

export async function listRooms(guildId?: string): Promise<Room[]> {
  return getPrisma().room.findMany({
    where: { archived: false, ...(guildId ? { guildId } : {}) },
    orderBy: { createdAt: 'asc' },
  });
}

export async function deleteRoom(channelId: string): Promise<void> {
  await getPrisma().room.delete({ where: { channelId } }).catch(() => undefined);
}

export async function archiveRoom(channelId: string): Promise<void> {
  await getPrisma()
    .room.update({ where: { channelId }, data: { archived: true } })
    .catch(() => undefined);
}

export async function renameRoom(channelId: string, name: string): Promise<Room | null> {
  return getPrisma()
    .room.update({ where: { channelId }, data: { name } })
    .catch(() => null);
}

// ─── ACL ─────────────────────────────────────────────────────────────

export type { AclEntry, Setting };

export async function listAclEntries(): Promise<AclEntry[]> {
  return getPrisma().aclEntry.findMany({ orderBy: [{ type: 'asc' }, { addedAt: 'asc' }] });
}

export async function addAclEntry(
  type: AclEntryType,
  value: string,
  addedBy: string,
): Promise<AclEntry | null> {
  return getPrisma()
    .aclEntry.create({ data: { type, value, addedBy } })
    .catch(() => null);
}

export async function removeAclEntry(type: AclEntryType, value: string): Promise<boolean> {
  const result = await getPrisma()
    .aclEntry.deleteMany({ where: { type, value } });
  return result.count > 0;
}

export async function getSetting(key: string): Promise<string | null> {
  const row = await getPrisma().setting.findUnique({ where: { key } });
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await getPrisma().setting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}
