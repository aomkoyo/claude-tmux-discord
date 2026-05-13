import {
  ChannelType,
  Client,
  GatewayIntentBits,
  Events,
  type Message,
} from 'discord.js';
import { authorize } from './auth.js';
import { SessionManager } from './session.js';
import { bindCommandHandlers } from './commands.js';
import { MessageBuffer } from './buffer.js';
import { downloadAttachments } from './attachments.js';
import type { AclState } from './acl.js';
import type { AppConfig } from './config.js';
import type { Logger } from './logger.js';

export type Bot = {
  client: Client;
  sessionMgr: SessionManager;
  buffer: MessageBuffer;
};

export async function createBot(cfg: AppConfig, acl: AclState, log: Logger): Promise<Bot> {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  const sessionMgr = new SessionManager(cfg, log);
  await sessionMgr.loadRegistered();

  const buffer = new MessageBuffer();

  client.once(Events.ClientReady, (c) => {
    log.info({ user: c.user.tag, id: c.user.id }, 'bot ready');
    void sessionMgr
      .resumeAll()
      .catch((err) => log.error({ err }, 'resumeAll failed'));
  });

  client.on(Events.Error, (err) => log.error({ err }, 'discord client error'));
  client.on(Events.Warn, (msg) => log.warn({ msg }, 'discord client warn'));

  client.rest.on('rateLimited', (info) => {
    log.warn(
      {
        method: info.method,
        url: info.url,
        timeToReset: info.timeToReset,
        limit: info.limit,
        global: info.global,
      },
      'discord rate-limited (auto-retried)',
    );
  });

  bindCommandHandlers(client, { sessionMgr, acl, cfg, log, buffer });

  client.on(Events.MessageCreate, async (message: Message) => {
    const auth = authorize(message, acl, sessionMgr);
    if (!auth.allowed) {
      log.debug({ user: message.author.id, reason: auth.reason }, 'rejected message');
      return;
    }

    const text = message.content;
    if (text.trim().length === 0 && message.attachments.size === 0) return;

    if (!message.channel.isSendable()) {
      log.warn({ channelId: message.channelId }, 'channel not sendable');
      return;
    }

    let attachments: Awaited<ReturnType<typeof downloadAttachments>> = [];
    try {
      const status = await sessionMgr.statusChannel(message.channelId);
      attachments = await downloadAttachments(message, status.cwd, log);
    } catch (err) {
      log.warn({ err, channelId: message.channelId }, 'attachment download failed');
    }

    const queueLen = buffer.append(message.channelId, {
      text,
      attachments,
      authorTag: message.author.tag,
      receivedAt: Date.now(),
    });

    try {
      await message.react(attachments.length > 0 ? '📎' : '📥');
    } catch (err) {
      log.debug({ err }, 'failed to react');
    }
    log.debug(
      { channelId: message.channelId, queueLen, attachments: attachments.length },
      'message buffered',
    );
  });

  client.on(Events.ChannelCreate, async (channel) => {
    if (channel.type !== ChannelType.GuildText) return;
    if (!channel.parentId || !channel.guild) return;
    if (sessionMgr.hasRegisteredChannel(channel.id)) return;

    const project = await sessionMgr.findProjectByCategory(channel.parentId);
    if (!project) return;

    const name = channel.name
      .replace(/^claude-/, '')
      .replace(/[^a-z0-9_-]/g, '-')
      .slice(0, 31) || channel.id;

    try {
      const room = await sessionMgr.registerRoom({
        channelId: channel.id,
        guildId: channel.guild.id,
        parentId: channel.parentId,
        name,
        createdBy: 'auto',
        mode: (project.defaultMode as 'default' | 'plan' | 'acceptEdits' | 'bypassPermissions') ?? 'bypassPermissions',
        projectId: project.categoryId,
      });
      log.info(
        { channelId: channel.id, project: project.name, name },
        'auto-registered channel in project category',
      );
      if (channel.isSendable()) {
        await channel.send(
          `🤖 Auto-registered as Claude room in project **${project.name}** · workspace \`${room.workspaceDir}\`\nType a message then \`/enter\` to send to Claude.`,
        );
      }
    } catch (err) {
      log.error({ err, channelId: channel.id, parentId: channel.parentId }, 'auto-register failed');
    }
  });

  return { client, sessionMgr, buffer };
}
