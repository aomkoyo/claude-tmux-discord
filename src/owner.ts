import { Team, User, type Client } from 'discord.js';
import type { Logger } from './logger.js';

const CACHE_TTL_MS = 60_000;

type OwnerCache = {
  ids: Set<string>;
  expiresAt: number;
};

let cache: OwnerCache | null = null;

/**
 * Returns true if the given Discord user ID is a bot owner. A user is an
 * owner if their ID appears in:
 *   1. The `manualOwnerIds` allowlist (env var fallback), OR
 *   2. The Discord application's owner (`User.id`), OR
 *   3. Any team member's user ID, when the application is team-owned.
 *
 * Application info is fetched from Discord and cached for 60 s.
 */
export async function isBotOwner(
  userId: string,
  client: Client,
  manualOwnerIds: readonly string[],
  log: Logger,
): Promise<boolean> {
  if (manualOwnerIds.includes(userId)) return true;

  const ids = await getOwnerIds(client, log);
  return ids.has(userId);
}

export function clearOwnerCache(): void {
  cache = null;
}

async function getOwnerIds(client: Client, log: Logger): Promise<Set<string>> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.ids;

  const ids = new Set<string>();
  try {
    const app = await client.application?.fetch();
    const owner = app?.owner;
    if (owner instanceof User) {
      ids.add(owner.id);
    } else if (owner instanceof Team) {
      if (owner.ownerId) ids.add(owner.ownerId);
      for (const member of owner.members.values()) {
        ids.add(member.user.id);
      }
    }
  } catch (err) {
    log.warn({ err }, 'failed to fetch application owner; falling back to manual list only');
  }

  cache = { ids, expiresAt: now + CACHE_TTL_MS };
  return ids;
}
