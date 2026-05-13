import {
  ChannelType,
  InteractionContextType,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type CategoryChannel,
  type Guild,
  type Client,
} from 'discord.js';
import * as db from './db.js';
import {
  ACL_ENTRY_TYPES,
  ROOM_MODES,
  asRoomMode,
  isAclEntryType,
  type AclEntryType,
  type RoomMode,
} from './db.js';
import type { AclState } from './acl.js';
import { isBotOwner } from './owner.js';
import type { SessionManager } from './session.js';
import type { MessageBuffer } from './buffer.js';
import type { AppConfig } from './config.js';
import type { Logger } from './logger.js';

const NAME_RE = /^[a-z0-9][a-z0-9-_]{1,30}$/;

const MODE_DESCRIPTIONS: Record<RoomMode, string> = {
  default: 'Normal Claude Code (asks before edits/commands)',
  plan: 'Plan mode — Claude proposes a plan, no edits until you exit plan',
  acceptEdits: 'Auto-accept file edits (still asks for shell commands)',
  bypassPermissions: '⚠️ DANGEROUS: skip ALL permission prompts (= --dangerously-skip-permissions)',
};

const MODE_CHOICES = ROOM_MODES.map((m) => ({ name: `${m} — ${MODE_DESCRIPTIONS[m]}`.slice(0, 100), value: m }));

const ACL_TYPE_CHOICES = ACL_ENTRY_TYPES.map((t) => ({ name: t, value: t }));

const SNOWFLAKE_RE = /^\d{17,20}$/;
const MENTION_RE = /^<[@#&!]+(\d+)>$/;

function extractSnowflake(raw: string): string | null {
  const trimmed = raw.trim();
  const m = trimmed.match(MENTION_RE);
  const candidate = m?.[1] ?? trimmed;
  return SNOWFLAKE_RE.test(candidate) ? candidate : null;
}

export const commandDefinitions = [
  new SlashCommandBuilder()
    .setName('new')
    .setDescription('Create a new Claude room (Discord channel + tmux session + workspace)')
    .addStringOption((o) =>
      o
        .setName('name')
        .setDescription('Room name (lowercase, digits, dash, underscore; 2-31 chars)')
        .setRequired(true)
        .setMinLength(2)
        .setMaxLength(31),
    )
    .addStringOption((o) =>
      o
        .setName('mode')
        .setDescription('Permission mode for Claude in this room')
        .setRequired(false)
        .addChoices(...MODE_CHOICES),
    )
    .addStringOption((o) =>
      o
        .setName('path')
        .setDescription('Custom workspace path (absolute path, e.g. /home/user/my-project)')
        .setRequired(false),
    )
    .addStringOption((o) =>
      o
        .setName('agent')
        .setDescription('Agent to use (e.g. claude, codex, gemini — defined via AGENT_* env vars)')
        .setRequired(false),
    )
    .addChannelOption((o) =>
      o
        .setName('category')
        .setDescription('Target category to create the channel in')
        .setRequired(false)
        .addChannelTypes(ChannelType.GuildCategory),
    )
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  new SlashCommandBuilder()
    .setName('mode')
    .setDescription('Change the permission mode of this room (restarts Claude)')
    .addStringOption((o) =>
      o
        .setName('mode')
        .setDescription('New mode')
        .setRequired(true)
        .addChoices(...MODE_CHOICES),
    )
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  new SlashCommandBuilder()
    .setName('delete')
    .setDescription('Delete this Claude room (channel + tmux session + DB row)')
    .addBooleanOption((o) =>
      o
        .setName('force')
        .setDescription('Required: confirm destructive action')
        .setRequired(true),
    )
    .addBooleanOption((o) =>
      o.setName('wipe').setDescription('Also delete the workspace directory').setRequired(false),
    )
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  new SlashCommandBuilder()
    .setName('rooms')
    .setDescription('List all registered Claude rooms in this guild')
    .setContexts(InteractionContextType.Guild),

  new SlashCommandBuilder()
    .setName('rename')
    .setDescription('Rename this Claude room')
    .addStringOption((o) =>
      o
        .setName('name')
        .setDescription('New name')
        .setRequired(true)
        .setMinLength(2)
        .setMaxLength(31),
    )
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Show this channel\'s tmux session info')
    .setContexts(InteractionContextType.Guild),

  new SlashCommandBuilder()
    .setName('reset')
    .setDescription('Kill the tmux session for this channel (next message starts fresh Claude)')
    .setContexts(InteractionContextType.Guild),

  new SlashCommandBuilder()
    .setName('enter')
    .setDescription('Send the buffered messages in this channel as a single Claude prompt')
    .setContexts(InteractionContextType.Guild),

  new SlashCommandBuilder()
    .setName('cancel')
    .setDescription('Discard the buffered messages in this channel')
    .setContexts(InteractionContextType.Guild),

  new SlashCommandBuilder()
    .setName('buffer')
    .setDescription('Show what is currently buffered in this channel')
    .setContexts(InteractionContextType.Guild),

  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show available commands')
    .setContexts(InteractionContextType.Guild),

  new SlashCommandBuilder()
    .setName('agent')
    .setDescription('Change the agent for this room (resets the tmux session)')
    .addStringOption((o) =>
      o
        .setName('name')
        .setDescription('Agent name (e.g. claude, codex, gemini — defined via AGENT_* env vars)')
        .setRequired(true),
    )
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  new SlashCommandBuilder()
    .setName('acl')
    .setDescription('Manage the bot allowlist (bot owner only)')
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Add a user / role / channel to the allowlist')
        .addStringOption((o) =>
          o
            .setName('type')
            .setDescription('Entry type')
            .setRequired(true)
            .addChoices(...ACL_TYPE_CHOICES),
        )
        .addStringOption((o) =>
          o
            .setName('value')
            .setDescription('Discord ID or mention (<@id>, <#id>, <@&id>)')
            .setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('Remove a user / role / channel from the allowlist')
        .addStringOption((o) =>
          o
            .setName('type')
            .setDescription('Entry type')
            .setRequired(true)
            .addChoices(...ACL_TYPE_CHOICES),
        )
        .addStringOption((o) =>
          o
            .setName('value')
            .setDescription('Discord ID or mention')
            .setRequired(true),
        ),
    )
    .addSubcommand((s) =>
      s.setName('list').setDescription('Show the current allowlist'),
    ),

  new SlashCommandBuilder()
    .setName('project')
    .setDescription('Manage Claude projects (shared workspace across channels in a category)')
    .addSubcommand((s) =>
      s
        .setName('create')
        .setDescription('Create a new project (Discord category + shared workspace)')
        .addStringOption((o) =>
          o
            .setName('name')
            .setDescription('Project name (lowercase, digits, dash, underscore; 2-31 chars)')
            .setRequired(true)
            .setMinLength(2)
            .setMaxLength(31),
        )
        .addStringOption((o) =>
          o
            .setName('dir')
            .setDescription('Custom workspace path (absolute, e.g. /home/user/my-project)')
            .setRequired(false),
        )
        .addStringOption((o) =>
          o
            .setName('mode')
            .setDescription('Default permission mode for rooms in this project')
            .setRequired(false)
            .addChoices(...MODE_CHOICES),
        ),
    )
    .addSubcommand((s) =>
      s.setName('list').setDescription('List all projects in this guild'),
    )
    .addSubcommand((s) =>
      s
        .setName('delete')
        .setDescription('Delete this project (run from a channel inside the project category)')
        .addBooleanOption((o) =>
          o.setName('force').setDescription('Required: confirm destructive action').setRequired(true),
        )
        .addBooleanOption((o) =>
          o.setName('delete_rooms').setDescription('Also unregister all rooms in this project').setRequired(false),
        ),
    )
    .addSubcommand((s) =>
      s.setName('info').setDescription('Show project info for this channel\'s category'),
    )
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
].map((b) => b.toJSON());

/**
 * Register slash commands. If GUILD_ID is set, register to that guild only (instant).
 * Otherwise register globally (may take up to 1 hour to propagate).
 */
export async function registerCommands(
  cfg: AppConfig,
  log: Logger,
  guildId?: string,
): Promise<void> {
  const rest = new REST({ version: '10' }).setToken(cfg.discordToken);
  if (guildId) {
    await rest.put(Routes.applicationGuildCommands(cfg.discordAppId, guildId), {
      body: commandDefinitions,
    });
    log.info({ guildId, count: commandDefinitions.length }, 'registered guild slash commands');
  } else {
    await rest.put(Routes.applicationCommands(cfg.discordAppId), { body: commandDefinitions });
    log.info({ count: commandDefinitions.length }, 'registered global slash commands');
  }
}

export type CommandDeps = {
  sessionMgr: SessionManager;
  acl: AclState;
  cfg: AppConfig;
  log: Logger;
  buffer: MessageBuffer;
};

/**
 * Wire interaction handlers into the client.
 */
export function bindCommandHandlers(client: Client, deps: CommandDeps): void {
  const { sessionMgr, acl, cfg, log, buffer } = deps;

  client.on('interactionCreate', async (interaction) => {
    // ─── slash commands ─────────────────────────────────────────
    if (interaction.isChatInputCommand()) {
      try {
        switch (interaction.commandName) {
          case 'new':
            await handleNew(interaction, sessionMgr, cfg, log);
            break;
          case 'delete':
            await handleDelete(interaction, sessionMgr, log);
            break;
          case 'rooms':
            await handleRooms(interaction, sessionMgr);
            break;
          case 'rename':
            await handleRename(interaction, sessionMgr);
            break;
          case 'mode':
            await handleMode(interaction, sessionMgr, log);
            break;
          case 'status':
            await handleStatus(interaction, sessionMgr, cfg);
            break;
          case 'reset':
            await handleReset(interaction, sessionMgr);
            break;
          case 'acl':
            await handleAcl(interaction, acl, sessionMgr, client, cfg.botOwnerIds, log);
            break;
          case 'enter':
            await handleEnter(interaction, sessionMgr, buffer, log);
            break;
          case 'cancel':
            await handleCancel(interaction, buffer);
            break;
          case 'buffer':
            await handleBuffer(interaction, buffer);
            break;
          case 'help':
            await handleHelp(interaction, cfg);
            break;
          case 'project':
            await handleProject(interaction, sessionMgr, log);
            break;
          case 'agent':
            await handleAgent(interaction, sessionMgr, cfg, log);
            break;
          default:
            await replyEphemeral(
              interaction,
              `❓ Unknown command: \`${interaction.commandName}\``,
            );
        }
      } catch (err) {
        log.error({ err, command: interaction.commandName }, 'command handler error');
        const msg = err instanceof Error ? err.message : String(err);
        try {
          if (interaction.deferred || interaction.replied) {
            await interaction.followUp({ content: `⚠️ ${msg}`, ephemeral: true });
          } else {
            await interaction.reply({ content: `⚠️ ${msg}`, ephemeral: true });
          }
        } catch {
          // best-effort
        }
      }
      return;
    }

    // ─── menu buttons ───────────────────────────────────────────
    if (interaction.isButton() && interaction.customId.startsWith('menu:')) {
      try {
        await handleMenuButton(interaction, sessionMgr, log);
      } catch (err) {
        log.error({ err, customId: interaction.customId }, 'menu button error');
        try {
          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
              content: `⚠️ ${err instanceof Error ? err.message : String(err)}`,
              ephemeral: true,
            });
          }
        } catch {
          // best-effort
        }
      }
      return;
    }
  });
}

// ─── /acl handlers ───────────────────────────────────────────────────

async function handleAcl(
  interaction: ChatInputCommandInteraction,
  acl: AclState,
  sessionMgr: SessionManager,
  client: Client,
  ownerIds: string[],
  log: Logger,
): Promise<void> {
  if (!(await isBotOwner(interaction.user.id, client, ownerIds, log))) {
    await replyEphemeral(
      interaction,
      '🚫 Only the bot owner can manage the allowlist.',
    );
    return;
  }

  const sub = interaction.options.getSubcommand();
  switch (sub) {
    case 'add':
      await aclAdd(interaction, acl, log);
      return;
    case 'remove':
      await aclRemove(interaction, acl, log);
      return;
    case 'list':
      await aclList(interaction, acl, sessionMgr);
      return;
    default:
      await replyEphemeral(interaction, `❓ Unknown subcommand: \`${sub}\``);
  }
}

async function aclAdd(
  interaction: ChatInputCommandInteraction,
  acl: AclState,
  log: Logger,
): Promise<void> {
  const typeRaw = interaction.options.getString('type', true);
  const valueRaw = interaction.options.getString('value', true);
  if (!isAclEntryType(typeRaw)) {
    await replyEphemeral(interaction, '❌ Invalid type.');
    return;
  }
  const type: AclEntryType = typeRaw;
  const value = extractSnowflake(valueRaw);
  if (!value) {
    await replyEphemeral(interaction, '❌ Value must be a Discord snowflake ID or mention.');
    return;
  }
  const added = await acl.add(type, value, interaction.user.id);
  if (!added) {
    await replyEphemeral(interaction, `ℹ️ \`${type}\` \`${value}\` is already on the allowlist.`);
    return;
  }
  log.info({ type, value, by: interaction.user.id }, 'acl entry added');
  await interaction.reply({
    content: `✅ Added ${formatAclTarget(type, value)} to the allowlist.`,
    ephemeral: true,
  });
}

async function aclRemove(
  interaction: ChatInputCommandInteraction,
  acl: AclState,
  log: Logger,
): Promise<void> {
  const typeRaw = interaction.options.getString('type', true);
  const valueRaw = interaction.options.getString('value', true);
  if (!isAclEntryType(typeRaw)) {
    await replyEphemeral(interaction, '❌ Invalid type.');
    return;
  }
  const type: AclEntryType = typeRaw;
  const value = extractSnowflake(valueRaw);
  if (!value) {
    await replyEphemeral(interaction, '❌ Value must be a Discord snowflake ID or mention.');
    return;
  }
  const removed = await acl.remove(type, value);
  if (!removed) {
    await replyEphemeral(interaction, `ℹ️ \`${type}\` \`${value}\` is not on the allowlist.`);
    return;
  }
  log.info({ type, value, by: interaction.user.id }, 'acl entry removed');
  await interaction.reply({
    content: `🗑️ Removed ${formatAclTarget(type, value)} from the allowlist.`,
    ephemeral: true,
  });
}

async function aclList(
  interaction: ChatInputCommandInteraction,
  acl: AclState,
  sessionMgr: SessionManager,
): Promise<void> {
  const snap = acl.snapshot();
  const registeredCount = sessionMgr.registeredChannelCount();
  const sections: string[] = [];
  sections.push(
    `**Registered rooms** (auto-allowed via \`/new\`): ${registeredCount}`,
  );
  sections.push(formatList('Users', snap.users.map((id) => `<@${id}> \`${id}\``)));
  sections.push(formatList('Roles', snap.roles.map((id) => `<@&${id}> \`${id}\``)));
  sections.push(formatList('Channels', snap.channels.map((id) => `<#${id}> \`${id}\``)));
  await interaction.reply({
    content: sections.join('\n\n'),
    ephemeral: true,
    allowedMentions: { parse: [] },
  });
}

function formatAclTarget(type: AclEntryType, value: string): string {
  if (type === 'user') return `<@${value}> \`${value}\``;
  if (type === 'role') return `<@&${value}> \`${value}\``;
  return `<#${value}> \`${value}\``;
}

function formatList(title: string, items: string[]): string {
  if (items.length === 0) return `**${title}:** _(empty)_`;
  return `**${title}** (${items.length})\n${items.map((i) => `• ${i}`).join('\n')}`;
}

// ─── handlers ────────────────────────────────────────────────────────

async function handleNew(
  interaction: ChatInputCommandInteraction,
  sessionMgr: SessionManager,
  cfg: AppConfig,
  log: Logger,
): Promise<void> {
  if (!interaction.guild) {
    await replyEphemeral(interaction, '❌ `/new` only works in a guild.');
    return;
  }
  const guild: Guild = interaction.guild;

  const rawName = interaction.options.getString('name', true);
  if (!NAME_RE.test(rawName)) {
    await replyEphemeral(
      interaction,
      '❌ Name must match `[a-z0-9][a-z0-9-_]{1,30}` (lowercase, digits, dash, underscore).',
    );
    return;
  }

  const mode = asRoomMode(interaction.options.getString('mode'));
  const customPath = interaction.options.getString('path') ?? undefined;
  const agentRaw = interaction.options.getString('agent')?.toLowerCase();
  const agent = agentRaw ?? cfg.defaultAgent;
  if (!cfg.agents.has(agent)) {
    const available = [...cfg.agents.keys()].join(', ');
    await replyEphemeral(interaction, `❌ Unknown agent \`${agent}\`. Available: ${available}`);
    return;
  }

  const me = guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
    await replyEphemeral(interaction, '❌ Bot missing `Manage Channels` permission.');
    return;
  }

  await interaction.deferReply();

  const categoryOption = interaction.options.getChannel('category');
  let parent: CategoryChannel | null = null;
  if (categoryOption && categoryOption.type === ChannelType.GuildCategory) {
    parent = categoryOption as CategoryChannel;
  } else {
    const source = interaction.channel;
    if (source && 'parent' in source && source.parent && source.parent.type === ChannelType.GuildCategory) {
      parent = source.parent;
    }
  }

  let projectId: string | undefined;
  let effectiveMode = mode;
  if (parent && !customPath) {
    const project = await sessionMgr.findProjectByCategory(parent.id);
    if (project) {
      projectId = project.categoryId;
      if (mode === 'bypassPermissions' && project.defaultMode !== 'bypassPermissions') {
        effectiveMode = asRoomMode(project.defaultMode);
      }
    }
  }

  const created = await guild.channels.create({
    name: `claude-${rawName}`,
    type: ChannelType.GuildText,
    parent: parent?.id ?? null,
    topic: `Claude Code session — created by <@${interaction.user.id}>`,
    reason: `claude-tmux-discord: /new by ${interaction.user.tag}`,
  });

  const room = await sessionMgr.registerRoom({
    channelId: created.id,
    guildId: guild.id,
    parentId: parent?.id ?? null,
    name: rawName,
    createdBy: interaction.user.id,
    mode: effectiveMode,
    workspacePath: customPath,
    projectId,
    agent,
  });

  const agentDef = cfg.agents.get(agent);
  log.info({ channelId: created.id, name: rawName, mode: effectiveMode, agent, by: interaction.user.id }, 'room created');
  await interaction.editReply(
    `✅ Created <#${created.id}> · agent \`${agent}\` (\`${agentDef?.cmd ?? agent}\`) · mode \`${effectiveMode}\` · workspace \`${room.workspaceDir}\``,
  );
}

async function handleMode(
  interaction: ChatInputCommandInteraction,
  sessionMgr: SessionManager,
  log: Logger,
): Promise<void> {
  const room = await sessionMgr.getRoom(interaction.channelId);
  if (!room) {
    await replyEphemeral(
      interaction,
      '❌ This channel is not a registered Claude room. Use `/new` to create one.',
    );
    return;
  }

  const newMode = asRoomMode(interaction.options.getString('mode', true));
  if (newMode === room.mode) {
    await replyEphemeral(interaction, `ℹ️ Already in \`${newMode}\` mode.`);
    return;
  }

  await interaction.deferReply();
  const updated = await sessionMgr.setRoomMode(interaction.channelId, newMode);
  if (!updated) {
    await interaction.editReply(`⚠️ Failed to update mode.`);
    return;
  }
  log.info({ channelId: interaction.channelId, from: room.mode, to: newMode }, 'mode changed');

  let warn = '';
  if (newMode === 'bypassPermissions') {
    warn = '\n\n⚠️ **bypass mode** — Claude will run shell commands and edit files without asking. Use only if you trust the prompt source.';
  }
  await interaction.editReply(
    `🔧 Mode changed: \`${room.mode}\` → \`${newMode}\`. tmux session killed; next message will start a fresh Claude with the new flags.${warn}`,
  );
}

async function handleDelete(
  interaction: ChatInputCommandInteraction,
  sessionMgr: SessionManager,
  log: Logger,
): Promise<void> {
  if (!interaction.guild) {
    await replyEphemeral(interaction, '❌ `/delete` only works in a guild.');
    return;
  }

  const force = interaction.options.getBoolean('force', true);
  const wipe = interaction.options.getBoolean('wipe') ?? false;

  if (!force) {
    await replyEphemeral(interaction, '⚠️ You must pass `force: True` to confirm deletion.');
    return;
  }

  const room = await sessionMgr.getRoom(interaction.channelId);
  if (!room) {
    await replyEphemeral(
      interaction,
      '❌ This channel is not a registered Claude room. Use `/new` to create one.',
    );
    return;
  }

  const me = interaction.guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
    await replyEphemeral(interaction, '❌ Bot missing `Manage Channels` permission.');
    return;
  }

  // Acknowledge before destructive ops; the channel itself goes away last.
  await interaction.reply({
    content: `🗑️ Deleting room \`${room.name}\`${wipe ? ' (wiping workspace)' : ''}…`,
  });

  await sessionMgr.unregisterRoom(interaction.channelId, { wipeWorkspace: wipe });
  log.info(
    { channelId: interaction.channelId, by: interaction.user.id, wipe },
    'room deleted',
  );

  if (interaction.channel && 'delete' in interaction.channel && typeof interaction.channel.delete === 'function') {
    await (interaction.channel as { delete(reason?: string): Promise<unknown> }).delete(
      `claude-tmux-discord: /delete by ${interaction.user.tag}`,
    );
  }
}

async function handleRooms(
  interaction: ChatInputCommandInteraction,
  sessionMgr: SessionManager,
): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  const rooms = await sessionMgr.listRooms(interaction.guild?.id);
  if (rooms.length === 0) {
    await interaction.editReply('🪹 No rooms registered. Use `/new` to create one.');
    return;
  }
  const lines = rooms.map(
    (r) => `• <#${r.channelId}> — \`${r.name}\` · tmux \`${r.tmuxSession}\` · by <@${r.createdBy}>`,
  );
  await interaction.editReply(['**Registered rooms**', ...lines].join('\n'));
}

async function handleRename(
  interaction: ChatInputCommandInteraction,
  sessionMgr: SessionManager,
): Promise<void> {
  const room = await sessionMgr.getRoom(interaction.channelId);
  if (!room) {
    await replyEphemeral(interaction, '❌ This channel is not a registered Claude room.');
    return;
  }
  const newName = interaction.options.getString('name', true);
  if (!NAME_RE.test(newName)) {
    await replyEphemeral(
      interaction,
      '❌ Name must match `[a-z0-9][a-z0-9-_]{1,30}`.',
    );
    return;
  }

  await interaction.deferReply();
  if (interaction.channel && 'setName' in interaction.channel && typeof interaction.channel.setName === 'function') {
    await (interaction.channel as { setName(name: string): Promise<unknown> }).setName(`claude-${newName}`);
  }
  await db.renameRoom(interaction.channelId, newName);
  await interaction.editReply(`✅ Renamed to \`${newName}\``);
}

async function handleStatus(
  interaction: ChatInputCommandInteraction,
  sessionMgr: SessionManager,
  cfg: AppConfig,
): Promise<void> {
  const status = await sessionMgr.statusChannel(interaction.channelId);
  const lines = [
    `**Session:** \`${status.sessionName}\``,
    `**Workspace:** \`${status.cwd}\``,
    `**State:** ${status.exists ? '✅ active' : '⚪ not started'}`,
    status.room
      ? `**Agent:** \`${status.room.agent}\` (\`${cfg.agents.get(status.room.agent)?.cmd ?? status.room.agent}\`)`
      : `**Agent:** \`${cfg.defaultAgent}\` (default)`,
    status.room
      ? `**Mode:** \`${status.room.mode}\``
      : '**Mode:** \`default\` (no DB record)',
    status.room
      ? `**Registered:** \`${status.room.name}\` · created <t:${Math.floor(status.room.createdAt.getTime() / 1000)}:R> by <@${status.room.createdBy}>`
      : '**Registered:** ❌ not in DB (ad-hoc per-channel session)',
  ];
  await interaction.reply({ content: lines.join('\n'), ephemeral: true });
}

async function handleReset(
  interaction: ChatInputCommandInteraction,
  sessionMgr: SessionManager,
): Promise<void> {
  await interaction.deferReply();
  await sessionMgr.resetChannel(interaction.channelId);
  await interaction.editReply('🔁 Session reset. The next message will start a fresh Claude.');
}

async function handleEnter(
  interaction: ChatInputCommandInteraction,
  sessionMgr: SessionManager,
  buffer: MessageBuffer,
  log: Logger,
): Promise<void> {
  if (!sessionMgr.hasRegisteredChannel(interaction.channelId)) {
    await replyEphemeral(
      interaction,
      '❌ This channel is not a registered Claude room. Use `/new` to create one.',
    );
    return;
  }

  const flushed = buffer.flush(interaction.channelId);
  if (!flushed) {
    await replyEphemeral(interaction, 'ℹ️ Buffer is empty — type a message first, then `/enter`.');
    return;
  }

  await interaction.reply({
    content: `📤 Sent **${flushed.attachments.length} attachment(s)** + ${flushed.text.length} chars to Claude.`,
    ephemeral: true,
  });

  try {
    await sessionMgr.sendPrompt(interaction.channelId, flushed.text);
  } catch (err) {
    log.error({ err, channelId: interaction.channelId }, 'sendPrompt failed');
    try {
      await interaction.followUp({
        content: `⚠️ ${err instanceof Error ? err.message : String(err)}`,
        ephemeral: true,
      });
    } catch {
      // best-effort
    }
  }
}

async function handleCancel(
  interaction: ChatInputCommandInteraction,
  buffer: MessageBuffer,
): Promise<void> {
  const dropped = buffer.cancel(interaction.channelId);
  await replyEphemeral(
    interaction,
    dropped > 0 ? `🗑️ Discarded ${dropped} buffered message(s).` : 'ℹ️ Buffer was already empty.',
  );
}

async function handleBuffer(
  interaction: ChatInputCommandInteraction,
  buffer: MessageBuffer,
): Promise<void> {
  const snap = buffer.snapshot(interaction.channelId);
  if (snap.count === 0) {
    await replyEphemeral(interaction, '🪹 Buffer is empty. Type something, then `/enter` to send.');
    return;
  }
  const lines: string[] = [
    `**Buffered:** ${snap.count} message(s) · ${snap.totalChars} chars · ${snap.attachmentCount} attachment(s)`,
    '',
  ];
  let preview = '';
  for (const e of snap.entries) {
    const text = e.text.length > 0 ? e.text : '_(no text)_';
    const att = e.attachments.length > 0 ? ` 📎×${e.attachments.length}` : '';
    const segment = `• ${e.authorTag}${att}: ${text}`;
    if (preview.length + segment.length + 1 > 1500) {
      preview += '\n…';
      break;
    }
    preview += (preview.length > 0 ? '\n' : '') + segment;
  }
  lines.push(preview);
  lines.push('', 'Run `/enter` to send, `/cancel` to discard.');
  await replyEphemeral(interaction, lines.join('\n'));
}

async function handleHelp(interaction: ChatInputCommandInteraction, cfg: AppConfig): Promise<void> {
  await interaction.reply({
    ephemeral: true,
    content: [
      '**Room management**',
      '`/new name:<name> [mode:<mode>] [agent:<name>]` — สร้าง Discord channel ใหม่ + workspace + tmux session',
      '`/delete force:True [wipe:True]` — ลบห้องนี้ (channel + tmux + DB; `wipe` ลบ workspace ด้วย)',
      '`/rooms` — list ห้องที่ลงทะเบียนทั้งหมด',
      '`/rename name:<new>` — เปลี่ยนชื่อห้องนี้',
      '`/mode mode:<mode>` — เปลี่ยน permission mode ของห้องนี้ (restart Claude อัตโนมัติ)',
      '',
      '**Send flow (buffered!)**',
      'พิมพ์ข้อความหรือแนบรูปในห้อง = เก็บใน buffer ไม่ได้ส่งให้ Claude ทันที',
      '`/enter` — รวม buffer ทั้งหมด → ส่งให้ Claude เป็น prompt เดียว',
      '`/cancel` — ทิ้ง buffer',
      '`/buffer` — ดู buffer ปัจจุบัน',
      '',
      '**Session control**',
      '`/status` — ข้อมูล session ของห้องนี้',
      '`/reset` — kill tmux ของห้องนี้',
      '`/agent name:<name>` — เปลี่ยน agent (reset session อัตโนมัติ)',
      '`/help` — แสดงข้อความนี้',
      '',
      '**Agents** (กำหนดผ่าน `AGENT_*` env vars)',
      ...[...cfg.agents.entries()].map(([k, v]) => `\`${k}\` → \`${v.cmd}\``),
      '',
      '**Modes**',
      '`default` — Claude ถาม permission ก่อนทำทุกอย่าง',
      '`plan` — Plan mode (วางแผนก่อน, แก้ไฟล์ไม่ได้)',
      '`acceptEdits` — auto-accept file edits (แต่ shell ยังถาม)',
      '`bypassPermissions` — ⚠️ ข้าม permission ทั้งหมด (`--dangerously-skip-permissions`)',
      '',
      '**Projects (shared workspace)**',
      '`/project create name:<name> [dir:<path>] [mode:<mode>]` — สร้าง category + shared workspace',
      '`/project list` — list projects ทั้งหมด',
      '`/project delete force:True [delete_rooms:True]` — ลบ project',
      '`/project info` — ดูข้อมูล project ของ category นี้',
      'Channel ที่สร้างใน project category จะ auto-register เป็น Claude room',
      '',
      '**Allowlist (bot owner only)**',
      '`/acl add type:<user|role|channel> value:<id|mention>` — เพิ่มเข้า allowlist',
      '`/acl remove type:<...> value:<...>` — ลบออกจาก allowlist',
      '`/acl list` — ดู allowlist ปัจจุบัน',
      '',
      'รูป/ไฟล์ที่นายท่านแนบจะถูก save ไว้ใน `<workspace>/.uploads/` แล้ว Claude อ่านได้ผ่าน path',
      'เมื่อ Claude ตอบกลับด้วย `[function-reply] <ข้อความ>` บอตจะส่งเป็นข้อความปกติให้',
      'เมื่อ Claude ขึ้น menu (เลือก 1/2/3) บอตจะแสดง embed + buttons ให้กดเลือกได้ทันที',
    ].join('\n'),
  });
}

// ─── /agent handler ─────────────────────────────────────────────────

async function handleAgent(
  interaction: ChatInputCommandInteraction,
  sessionMgr: SessionManager,
  cfg: AppConfig,
  log: Logger,
): Promise<void> {
  const room = await sessionMgr.getRoom(interaction.channelId);
  if (!room) {
    await replyEphemeral(interaction, '❌ This channel is not a registered Claude room.');
    return;
  }

  const newAgent = interaction.options.getString('name', true).toLowerCase();
  if (!cfg.agents.has(newAgent)) {
    const available = [...cfg.agents.keys()].join(', ');
    await replyEphemeral(interaction, `❌ Unknown agent \`${newAgent}\`. Available: ${available}`);
    return;
  }

  if (newAgent === room.agent) {
    await replyEphemeral(interaction, `ℹ️ Already using agent \`${newAgent}\`.`);
    return;
  }

  const agentDef = cfg.agents.get(newAgent)!;
  await interaction.deferReply();
  await sessionMgr.setRoomAgent(interaction.channelId, newAgent);
  log.info({ channelId: interaction.channelId, from: room.agent, to: newAgent }, 'agent changed');
  await interaction.editReply(
    `⚠️ Agent changed: \`${room.agent}\` → \`${newAgent}\` (\`${agentDef.cmd}\`)\nSession ถูก reset — ข้อความถัดไปจะเริ่ม agent ใหม่ค่ะ`,
  );
}

// ─── /project handlers ──────────────────────────────────────────────

async function handleProject(
  interaction: ChatInputCommandInteraction,
  sessionMgr: SessionManager,
  log: Logger,
): Promise<void> {
  const sub = interaction.options.getSubcommand();
  switch (sub) {
    case 'create':
      await handleProjectCreate(interaction, sessionMgr, log);
      return;
    case 'list':
      await handleProjectList(interaction, sessionMgr);
      return;
    case 'delete':
      await handleProjectDelete(interaction, sessionMgr, log);
      return;
    case 'info':
      await handleProjectInfo(interaction, sessionMgr);
      return;
    default:
      await replyEphemeral(interaction, `❓ Unknown subcommand: \`${sub}\``);
  }
}

async function handleProjectCreate(
  interaction: ChatInputCommandInteraction,
  sessionMgr: SessionManager,
  log: Logger,
): Promise<void> {
  if (!interaction.guild) {
    await replyEphemeral(interaction, '❌ Only works in a guild.');
    return;
  }
  const rawName = interaction.options.getString('name', true);
  if (!NAME_RE.test(rawName)) {
    await replyEphemeral(interaction, '❌ Name must match `[a-z0-9][a-z0-9-_]{1,30}`.');
    return;
  }
  const customDir = interaction.options.getString('dir') ?? undefined;
  const mode = asRoomMode(interaction.options.getString('mode'));
  const me = interaction.guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
    await replyEphemeral(interaction, '❌ Bot missing `Manage Channels` permission.');
    return;
  }

  await interaction.deferReply();

  const category = await interaction.guild.channels.create({
    name: rawName,
    type: ChannelType.GuildCategory,
    reason: `claude-tmux-discord: /project create by ${interaction.user.tag}`,
  });

  const project = await sessionMgr.createProject({
    categoryId: category.id,
    guildId: interaction.guild.id,
    name: rawName,
    workspacePath: customDir,
    defaultMode: mode,
    createdBy: interaction.user.id,
  });

  log.info({ categoryId: category.id, name: rawName, dir: project.workspaceDir, by: interaction.user.id }, 'project created');
  await interaction.editReply(
    `✅ Created project **${rawName}** · category <#${category.id}> · workspace \`${project.workspaceDir}\`\nสร้าง channel ใน category นี้ → auto-register เป็น Claude room เจ้าค่ะ ✿`,
  );
}

async function handleProjectList(
  interaction: ChatInputCommandInteraction,
  sessionMgr: SessionManager,
): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  const projects = await sessionMgr.listProjects(interaction.guild?.id);
  if (projects.length === 0) {
    await interaction.editReply('🪹 No projects. Use `/project create` to make one.');
    return;
  }
  const lines = projects.map(
    (p) => `• **${p.name}** · <#${p.categoryId}> · \`${p.workspaceDir}\` · by <@${p.createdBy}>`,
  );
  await interaction.editReply(['**Projects**', ...lines].join('\n'));
}

async function handleProjectDelete(
  interaction: ChatInputCommandInteraction,
  sessionMgr: SessionManager,
  log: Logger,
): Promise<void> {
  if (!interaction.guild) {
    await replyEphemeral(interaction, '❌ Only works in a guild.');
    return;
  }
  const force = interaction.options.getBoolean('force', true);
  if (!force) {
    await replyEphemeral(interaction, '⚠️ You must pass `force: True` to confirm deletion.');
    return;
  }
  const deleteRooms = interaction.options.getBoolean('delete_rooms') ?? false;

  const source = interaction.channel;
  let categoryId: string | null = null;
  if (source && 'parentId' in source && source.parentId) {
    categoryId = source.parentId;
  }
  if (!categoryId) {
    await replyEphemeral(interaction, '❌ Run this from a channel inside a project category.');
    return;
  }
  const project = await sessionMgr.getProject(categoryId);
  if (!project) {
    await replyEphemeral(interaction, '❌ This category is not a registered project.');
    return;
  }

  await interaction.deferReply();
  await sessionMgr.deleteProject(categoryId, { deleteRooms });
  log.info({ categoryId, name: project.name, deleteRooms, by: interaction.user.id }, 'project deleted');
  await interaction.editReply(
    `🗑️ Deleted project **${project.name}**${deleteRooms ? ' and all its rooms' : ''}.`,
  );
}

async function handleProjectInfo(
  interaction: ChatInputCommandInteraction,
  sessionMgr: SessionManager,
): Promise<void> {
  const source = interaction.channel;
  let categoryId: string | null = null;
  if (source && 'parentId' in source && source.parentId) {
    categoryId = source.parentId;
  }
  if (!categoryId) {
    await replyEphemeral(interaction, 'ℹ️ This channel is not in a category.');
    return;
  }
  const project = await sessionMgr.getProject(categoryId);
  if (!project) {
    await replyEphemeral(interaction, 'ℹ️ This category is not a registered project.');
    return;
  }
  const lines = [
    `**Project:** ${project.name}`,
    `**Category:** <#${project.categoryId}>`,
    `**Workspace:** \`${project.workspaceDir}\``,
    `**Default mode:** \`${project.defaultMode}\``,
    `**Created:** <t:${Math.floor(project.createdAt.getTime() / 1000)}:R> by <@${project.createdBy}>`,
  ];
  await interaction.reply({ content: lines.join('\n'), ephemeral: true });
}

// ─── menu button handler ─────────────────────────────────────────────

async function handleMenuButton(
  interaction: ButtonInteraction,
  sessionMgr: SessionManager,
  log: Logger,
): Promise<void> {
  const parts = interaction.customId.split(':');
  if (parts.length !== 3 || parts[0] !== 'menu') {
    await interaction.reply({ content: '⚠️ Malformed menu button.', ephemeral: true });
    return;
  }
  const targetChannelId = parts[1]!;
  const choice = parseInt(parts[2]!, 10);
  if (!Number.isInteger(choice) || choice < 1 || choice > 25) {
    await interaction.reply({ content: '⚠️ Invalid choice number.', ephemeral: true });
    return;
  }

  if (interaction.channelId !== targetChannelId) {
    await interaction.reply({
      content: '⚠️ This button belongs to a different channel.',
      ephemeral: true,
    });
    return;
  }

  // Disable the buttons immediately so the same choice can't fire twice
  try {
    await interaction.update({
      components: [],
      embeds: interaction.message.embeds.map((e) => ({
        ...e.toJSON(),
        footer: { text: `✓ Chose ${choice} (by ${interaction.user.tag})` },
      })),
    });
  } catch (err) {
    log.warn({ err }, 'failed to update menu message — proceeding anyway');
  }

  log.debug({ channelId: targetChannelId, choice, by: interaction.user.id }, 'menu button clicked');
  await sessionMgr.sendChoice(targetChannelId, choice);
}

// ─── helpers ─────────────────────────────────────────────────────────

async function replyEphemeral(
  interaction: ChatInputCommandInteraction,
  content: string,
): Promise<void> {
  await interaction.reply({ content, ephemeral: true });
}

