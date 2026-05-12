import type { Message } from 'discord.js';
import type { AclState } from './acl.js';

export type AuthResult = { allowed: true } | { allowed: false; reason: string };

/**
 * Lightweight interface for the room registry used by auth — accepts anything
 * with a sync `hasRegisteredChannel(id)` check (e.g. SessionManager).
 */
export type RoomRegistry = {
  hasRegisteredChannel(channelId: string): boolean;
};

export function authorize(
  message: Message,
  acl: AclState,
  rooms: RoomRegistry,
): AuthResult {
  if (message.author.bot) {
    return { allowed: false, reason: 'bot author' };
  }

  // DMs are not supported.
  if (message.guild === null) {
    return { allowed: false, reason: 'dms disabled' };
  }

  // Channels created via /new are implicitly trusted (managed by /delete).
  if (rooms.hasRegisteredChannel(message.channelId)) return { allowed: true };

  if (acl.hasChannel(message.channelId)) return { allowed: true };
  if (acl.hasUser(message.author.id)) return { allowed: true };

  if (message.member) {
    const memberRoles = message.member.roles.cache;
    if (acl.hasAnyRole(memberRoles.keys())) return { allowed: true };
  }

  return { allowed: false, reason: 'no matching allowlist (guild)' };
}
