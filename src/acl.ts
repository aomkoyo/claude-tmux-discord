import * as db from './db.js';
import type { AclEntryType } from './db.js';
import type { Logger } from './logger.js';

export type AclSnapshot = {
  users: string[];
  roles: string[];
  channels: string[];
};

/**
 * In-memory mirror of the bot's allowlist. The DB is the source of truth;
 * this class caches reads and writes through to Prisma so per-message auth
 * stays a synchronous Set lookup.
 */
export class AclState {
  private readonly users = new Set<string>();
  private readonly roles = new Set<string>();
  private readonly channels = new Set<string>();

  constructor(private readonly log: Logger) {}

  async load(): Promise<void> {
    this.users.clear();
    this.roles.clear();
    this.channels.clear();
    const entries = await db.listAclEntries();
    for (const e of entries) {
      const set = this.setFor(e.type as AclEntryType);
      if (set) set.add(e.value);
    }
    this.log.info(
      {
        users: this.users.size,
        roles: this.roles.size,
        channels: this.channels.size,
      },
      'acl loaded',
    );
  }

  hasUser(id: string): boolean {
    return this.users.has(id);
  }

  hasChannel(id: string): boolean {
    return this.channels.has(id);
  }

  hasAnyRole(ids: Iterable<string>): boolean {
    for (const id of ids) if (this.roles.has(id)) return true;
    return false;
  }

  isEmpty(): boolean {
    return this.users.size === 0 && this.roles.size === 0 && this.channels.size === 0;
  }

  snapshot(): AclSnapshot {
    return {
      users: [...this.users].sort(),
      roles: [...this.roles].sort(),
      channels: [...this.channels].sort(),
    };
  }

  async add(type: AclEntryType, value: string, by: string): Promise<boolean> {
    const set = this.setFor(type);
    if (!set || set.has(value)) return false;
    const created = await db.addAclEntry(type, value, by);
    if (!created) return false;
    set.add(value);
    return true;
  }

  async remove(type: AclEntryType, value: string): Promise<boolean> {
    const set = this.setFor(type);
    if (!set || !set.has(value)) return false;
    const removed = await db.removeAclEntry(type, value);
    if (removed) set.delete(value);
    return removed;
  }

  private setFor(type: AclEntryType): Set<string> | null {
    if (type === 'user') return this.users;
    if (type === 'role') return this.roles;
    if (type === 'channel') return this.channels;
    return null;
  }
}
