import type { SavedAttachment } from './attachments.js';
import { describeAttachments } from './attachments.js';

export type BufferEntry = {
  text: string;
  attachments: SavedAttachment[];
  authorTag: string;
  receivedAt: number;
};

export type BufferSnapshot = {
  count: number;
  totalChars: number;
  attachmentCount: number;
  entries: BufferEntry[];
};

/**
 * Per-channel queue of pending user messages. Messages typed in a Claude room
 * are accumulated here and flushed into a single Claude prompt when the user
 * runs `/enter`. This lets the user compose multi-line / multi-message prompts
 * (and attach images across messages) without firing each line at Claude.
 */
export class MessageBuffer {
  private readonly buffers = new Map<string, BufferEntry[]>();

  append(channelId: string, entry: BufferEntry): number {
    const list = this.buffers.get(channelId) ?? [];
    list.push(entry);
    this.buffers.set(channelId, list);
    return list.length;
  }

  size(channelId: string): number {
    return this.buffers.get(channelId)?.length ?? 0;
  }

  snapshot(channelId: string): BufferSnapshot {
    const entries = this.buffers.get(channelId) ?? [];
    const totalChars = entries.reduce((n, e) => n + e.text.length, 0);
    const attachmentCount = entries.reduce((n, e) => n + e.attachments.length, 0);
    return { count: entries.length, totalChars, attachmentCount, entries };
  }

  /** Pop everything for a channel. Returns null if buffer is empty. */
  flush(channelId: string): { text: string; attachments: SavedAttachment[] } | null {
    const list = this.buffers.get(channelId);
    if (!list || list.length === 0) return null;
    this.buffers.delete(channelId);

    const textParts: string[] = [];
    const attachments: SavedAttachment[] = [];
    for (const entry of list) {
      if (entry.text.length > 0) textParts.push(entry.text);
      attachments.push(...entry.attachments);
    }

    const userText = textParts.join('\n');
    const attachmentBlock = describeAttachments(attachments);
    const composed = [userText, attachmentBlock].filter((s) => s.length > 0).join('\n\n');
    return { text: composed, attachments };
  }

  cancel(channelId: string): number {
    const n = this.buffers.get(channelId)?.length ?? 0;
    this.buffers.delete(channelId);
    return n;
  }
}
