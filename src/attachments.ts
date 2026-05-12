import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Message, Attachment } from 'discord.js';
import type { Logger } from './logger.js';

/** Workspace-relative subfolder where downloads land. */
const UPLOADS_DIR = '.uploads';

/** Hard cap so a malicious or huge attachment can't fill the disk. */
const MAX_BYTES = 25 * 1024 * 1024; // 25 MiB

const SAFE_NAME_RE = /[^a-zA-Z0-9._-]+/g;

export type SavedAttachment = {
  /** Absolute path on disk (inside the room workspace). */
  absolutePath: string;
  /** Path relative to the workspace root (suitable for prompt references). */
  workspaceRelative: string;
  /** Original filename from Discord. */
  originalName: string;
  /** MIME content-type from Discord, if any. */
  contentType: string | null;
  /** True when contentType starts with `image/`. */
  isImage: boolean;
  /** Bytes written. */
  size: number;
};

/**
 * Download every attachment on a Discord message into the room's `.uploads/`
 * folder and return metadata. Skips attachments larger than MAX_BYTES.
 */
export async function downloadAttachments(
  message: Message,
  workspaceDir: string,
  log: Logger,
): Promise<SavedAttachment[]> {
  if (message.attachments.size === 0) return [];

  const dir = path.join(workspaceDir, UPLOADS_DIR);
  await mkdir(dir, { recursive: true });

  const saved: SavedAttachment[] = [];
  for (const att of message.attachments.values()) {
    try {
      const result = await downloadOne(att, dir, log);
      if (result) saved.push(result);
    } catch (err) {
      log.warn({ err, name: att.name, url: att.url }, 'attachment download failed');
    }
  }
  return saved;
}

async function downloadOne(
  att: Attachment,
  dir: string,
  log: Logger,
): Promise<SavedAttachment | null> {
  if (att.size > MAX_BYTES) {
    log.warn({ name: att.name, size: att.size }, 'attachment too large; skipping');
    return null;
  }

  const safeName = att.name.replace(SAFE_NAME_RE, '_').slice(0, 80) || 'file';
  const stamp = Date.now().toString(36);
  const filename = `${stamp}-${safeName}`;
  const absolutePath = path.join(dir, filename);

  const res = await fetch(att.url);
  if (!res.ok) {
    log.warn({ status: res.status, name: att.name }, 'attachment fetch failed');
    return null;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(absolutePath, buf);

  const contentType = att.contentType ?? null;
  return {
    absolutePath,
    workspaceRelative: path.posix.join(UPLOADS_DIR, filename),
    originalName: att.name,
    contentType,
    isImage: !!contentType && contentType.startsWith('image/'),
    size: buf.length,
  };
}

/**
 * Build the prompt fragment that references downloaded attachments. Designed to
 * be appended to the user's text so Claude knows the files exist locally.
 */
export function describeAttachments(items: readonly SavedAttachment[]): string {
  if (items.length === 0) return '';
  const lines = items.map((it) => {
    const kind = it.isImage ? 'image' : 'file';
    return `[Attached ${kind}: ${it.workspaceRelative} (${it.originalName}, ${it.size} bytes)]`;
  });
  return lines.join('\n');
}
