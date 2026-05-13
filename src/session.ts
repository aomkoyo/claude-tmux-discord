import { createHash } from 'node:crypto';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import * as tmux from './tmux.js';
import * as db from './db.js';
import { asRoomMode, type RoomMode } from './db.js';
import { isClaudeAgent } from './agents.js';
import type { AppConfig } from './config.js';
import type { Logger } from './logger.js';

const MODE_FLAGS: Record<RoomMode, string[]> = {
  default: [],
  plan: ['--permission-mode', 'plan'],
  acceptEdits: ['--permission-mode', 'acceptEdits'],
  bypassPermissions: ['--dangerously-skip-permissions'],
};

function channelSessionId(channelId: string): string {
  const hash = createHash('sha256').update(`claude-tmux-discord:${channelId}`).digest('hex');
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    '4' + hash.slice(13, 16),
    ((parseInt(hash.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0') + hash.slice(18, 20),
    hash.slice(20, 32),
  ].join('-');
}

function shellSingleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function claudeHistoryDir(workspaceDir: string): string {
  const abs = path.resolve(workspaceDir);
  const encoded = abs.replace(/\//g, '-');
  return path.join(homedir(), '.claude', 'projects', encoded);
}

async function hasClaudeHistory(workspaceDir: string): Promise<boolean> {
  try {
    const entries = await readdir(claudeHistoryDir(workspaceDir));
    return entries.some((e) => e.endsWith('.jsonl'));
  } catch {
    return false;
  }
}

type SessionState = {
  channelId: string;
  tmuxSession: string;
  workspaceDir: string;
  busy: Promise<void>;
};

export type RoomCreate = {
  channelId: string;
  guildId: string;
  parentId: string | null;
  name: string;
  createdBy: string;
  mode?: RoomMode;
  workspacePath?: string | undefined;
  projectId?: string | undefined;
  agent?: string | undefined;
};

export class SessionManager {
  private readonly sessions = new Map<string, SessionState>();
  private readonly registeredChannels = new Set<string>();

  constructor(
    private readonly cfg: AppConfig,
    private readonly log: Logger,
  ) {}

  async loadRegistered(): Promise<void> {
    const rooms = await db.listRooms();
    this.registeredChannels.clear();
    for (const r of rooms) this.registeredChannels.add(r.channelId);
    this.log.info({ count: this.registeredChannels.size }, 'loaded registered rooms');
  }

  hasRegisteredChannel(channelId: string): boolean {
    return this.registeredChannels.has(channelId);
  }

  registeredChannelCount(): number {
    return this.registeredChannels.size;
  }

  async resumeAll(): Promise<{ resumed: number; failed: number }> {
    const ids = [...this.registeredChannels];
    let resumed = 0;
    let failed = 0;
    for (const id of ids) {
      try {
        await this.ensure(id);
        resumed += 1;
      } catch (err) {
        failed += 1;
        this.log.warn({ err, channelId: id }, 'failed to resume tmux session');
      }
    }
    this.log.info({ resumed, failed, total: ids.length }, 'tmux sessions resumed');
    return { resumed, failed };
  }

  // ─── room CRUD (DB) ─────────────────────────────────────────────

  async registerRoom(input: RoomCreate): Promise<db.Room> {
    const tmuxSession = this.cfg.tmuxSessionPrefix + input.channelId;

    let workspaceDir: string;
    if (input.workspacePath) {
      workspaceDir = path.resolve(input.workspacePath);
    } else if (input.projectId) {
      const project = await db.findProjectByCategory(input.projectId);
      if (!project) throw new Error(`Project not found: ${input.projectId}`);
      workspaceDir = project.workspaceDir;
    } else {
      workspaceDir = path.join(this.cfg.workspaceRoot, input.channelId);
    }

    await mkdir(workspaceDir, { recursive: true });
    const room = await db.createRoom({
      channelId: input.channelId,
      guildId: input.guildId,
      parentId: input.parentId,
      name: input.name,
      workspaceDir,
      tmuxSession,
      createdBy: input.createdBy,
      mode: input.mode ?? 'bypassPermissions',
      projectId: input.projectId,
      agent: input.agent ?? this.cfg.defaultAgent,
    });
    this.registeredChannels.add(input.channelId);
    return room;
  }

  async setRoomAgent(channelId: string, agent: string): Promise<db.Room | null> {
    const room = await db.setRoomAgent(channelId, agent);
    if (!room) return null;
    await tmux.killSession(room.tmuxSession);
    this.sessions.delete(channelId);
    return room;
  }

  async setRoomMode(channelId: string, mode: RoomMode): Promise<db.Room | null> {
    const room = await db.setRoomMode(channelId, mode);
    if (!room) return null;
    await tmux.killSession(room.tmuxSession);
    this.sessions.delete(channelId);
    return room;
  }

  async unregisterRoom(channelId: string, opts: { wipeWorkspace?: boolean } = {}): Promise<void> {
    const room = await db.findRoomByChannel(channelId);
    const name = room?.tmuxSession ?? this.cfg.tmuxSessionPrefix + channelId;
    await tmux.killSession(name);
    this.sessions.delete(channelId);
    this.registeredChannels.delete(channelId);

    if (opts.wipeWorkspace && room) {
      if (room.projectId) {
        this.log.warn({ channelId }, 'refusing to wipe shared project workspace');
      } else {
        try {
          await rm(room.workspaceDir, { recursive: true, force: true });
        } catch (err) {
          this.log.warn({ err, dir: room.workspaceDir }, 'failed to wipe workspace');
        }
      }
    }
    await db.deleteRoom(channelId);
  }

  async listRooms(guildId?: string): Promise<db.Room[]> {
    return db.listRooms(guildId);
  }

  async getRoom(channelId: string): Promise<db.Room | null> {
    return db.findRoomByChannel(channelId);
  }

  // ─── project CRUD ───────────────────────────────────────────────

  async createProject(input: {
    categoryId: string;
    guildId: string;
    name: string;
    workspacePath?: string | undefined;
    defaultMode?: RoomMode;
    createdBy: string;
  }): Promise<db.Project> {
    const workspaceDir = input.workspacePath
      ? path.resolve(input.workspacePath)
      : path.join(this.cfg.workspaceRoot, input.name);
    await mkdir(workspaceDir, { recursive: true });
    return db.createProject({
      categoryId: input.categoryId,
      guildId: input.guildId,
      name: input.name,
      workspaceDir,
      defaultMode: input.defaultMode,
      createdBy: input.createdBy,
    });
  }

  async deleteProject(categoryId: string, opts: { deleteRooms?: boolean } = {}): Promise<void> {
    if (opts.deleteRooms) {
      const rooms = await db.listRoomsByProject(categoryId);
      for (const room of rooms) {
        await this.unregisterRoom(room.channelId);
      }
    }
    await db.deleteProject(categoryId);
  }

  async listProjects(guildId?: string): Promise<db.Project[]> {
    return db.listProjects(guildId);
  }

  async getProject(categoryId: string): Promise<db.Project | null> {
    return db.findProjectByCategory(categoryId);
  }

  async findProjectByCategory(categoryId: string): Promise<db.Project | null> {
    return db.findProjectByCategory(categoryId);
  }

  // ─── prompt flow ───────────────────────────────────────────────

  async sendPrompt(channelId: string, text: string): Promise<void> {
    const state = await this.ensure(channelId, text);
    await state.busy;
  }

  async sendChoice(channelId: string, choice: number): Promise<void> {
    const state = await this.ensure(channelId);
    const queued = state.busy.then(() => this.runChoice(state, choice));
    state.busy = queued.catch((err) => {
      this.log.error({ err, channelId, choice }, 'choice send failed');
    });
    await queued;
  }

  async resetChannel(channelId: string): Promise<void> {
    const room = await db.findRoomByChannel(channelId);
    const name = room?.tmuxSession ?? this.cfg.tmuxSessionPrefix + channelId;
    await tmux.killSession(name);
    this.sessions.delete(channelId);
  }

  async statusChannel(channelId: string): Promise<{ exists: boolean; sessionName: string; cwd: string; room: db.Room | null }> {
    const room = await db.findRoomByChannel(channelId);
    const name = room?.tmuxSession ?? this.cfg.tmuxSessionPrefix + channelId;
    const cwd = room?.workspaceDir ?? path.join(this.cfg.workspaceRoot, channelId);
    const exists = await tmux.sessionExists(name);
    return { exists, sessionName: name, cwd, room };
  }

  // ─── internal ──────────────────────────────────────────────────

  private async ensure(channelId: string, initialMessage?: string): Promise<SessionState> {
    const cached = this.sessions.get(channelId);
    if (cached) {
      if (initialMessage && initialMessage.trim().length > 0) {
        const queued = cached.busy.then(() => this.runOne(cached, initialMessage));
        cached.busy = queued.catch((err) => {
          this.log.error({ err, channelId }, 'prompt run failed');
        });
      }
      return cached;
    }

    const room = await db.findRoomByChannel(channelId);
    const name = room?.tmuxSession ?? this.cfg.tmuxSessionPrefix + channelId;
    const cwd = room?.workspaceDir ?? path.join(this.cfg.workspaceRoot, channelId);

    await mkdir(cwd, { recursive: true });

    const mode = asRoomMode(room?.mode);
    const agentName = room?.agent ?? this.cfg.defaultAgent;
    const agentDef = this.cfg.agents.get(agentName);
    const agentCmd = agentDef?.cmd ?? this.cfg.claudeCmd;
    const agentPrompt = agentDef?.systemPrompt ?? this.cfg.claudeSystemPrompt;
    const isClaude = isClaudeAgent(agentCmd);

    const alreadyExists = await tmux.sessionExists(name);
    if (!alreadyExists) {
      const [markerSeen, historySeen] = await Promise.all([
        this.markerExists(cwd, channelId),
        isClaude ? hasClaudeHistory(cwd) : Promise.resolve(false),
      ]);
      const startedBefore = markerSeen || historySeen;

      const startFlags: string[] = [];
      if (isClaude) {
        startFlags.push(...MODE_FLAGS[mode]);
      }
      if (agentPrompt.length > 0 && agentDef?.systemPromptFlag) {
        startFlags.push(agentDef.systemPromptFlag, shellSingleQuote(agentPrompt));
      }
      if (agentDef?.sessionIdFlag) {
        startFlags.push(agentDef.sessionIdFlag, channelSessionId(channelId));
      }
      if (startedBefore && agentDef?.resumeFlag) {
        startFlags.push(agentDef.resumeFlag);
      }

      this.log.info(
        { channelId, name, cwd, mode, agent: agentName, resume: startedBefore },
        'creating tmux session and starting agent',
      );
      await tmux.createSession(name, cwd);
      await this.exportEnvToSession(name, channelId);
      await tmux.startAgent(name, agentCmd, startFlags);
      await this.waitForAgentReady(name, channelId);
      await this.writeMarker(cwd, channelId);
    } else {
      this.log.info({ channelId, name, mode, agent: agentName }, 'reattaching to existing tmux session');
      await this.waitForAgentReady(name, channelId);
    }

    const state: SessionState = {
      channelId,
      tmuxSession: name,
      workspaceDir: cwd,
      busy: Promise.resolve(),
    };
    this.sessions.set(channelId, state);

    if (initialMessage && initialMessage.trim().length > 0) {
      const queued = state.busy.then(() => this.runOne(state, initialMessage));
      state.busy = queued.catch((err) => {
        this.log.error({ err, channelId }, 'prompt run failed');
      });
    }

    return state;
  }

  private markerPath(cwd: string, channelId: string): string {
    return path.join(cwd, '.claude-tmux-discord', channelId, 'started');
  }

  private async markerExists(cwd: string, channelId: string): Promise<boolean> {
    try {
      await stat(this.markerPath(cwd, channelId));
      return true;
    } catch {
      return false;
    }
  }

  private async exportEnvToSession(sessionName: string, channelId: string): Promise<void> {
    await tmux.setEnvironment(sessionName, 'DISCORD_TOKEN', this.cfg.discordToken);
    await tmux.setEnvironment(sessionName, 'DEFAULT_CHANNEL_ID', channelId);
    const exports = `export DISCORD_TOKEN=${shellSingleQuote(this.cfg.discordToken)} DEFAULT_CHANNEL_ID=${shellSingleQuote(channelId)}`;
    await tmux.sendPromptText(sessionName, exports);
    await tmux.sendEnter(sessionName);
    await delay(500);
  }

  private async waitForAgentReady(sessionName: string, channelId: string): Promise<void> {
    const maxWaitMs = 60_000;
    const pollMs = 1000;
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      await delay(pollMs);
      let pane: string;
      try {
        pane = await tmux.capturePane(sessionName);
      } catch {
        continue;
      }
      const trimmed = pane.trimEnd();
      const lastLine = trimmed.split('\n').at(-1) ?? '';
      if (/[❯>$#%]\s*$/.test(lastLine)) {
        this.log.info({ channelId, elapsed: Date.now() - start }, 'agent ready');
        return;
      }
    }
    this.log.warn({ channelId, maxWaitMs }, 'agent did not become ready in time, proceeding anyway');
  }

  private async writeMarker(cwd: string, channelId: string): Promise<void> {
    const file = this.markerPath(cwd, channelId);
    try {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, new Date().toISOString());
    } catch (err) {
      this.log.warn({ err, file }, 'failed to write claude resume marker');
    }
  }

  private async runOne(state: SessionState, text: string): Promise<void> {
    if (text.trim().length === 0) return;
    this.log.debug({ channelId: state.channelId, len: text.length }, 'sending prompt');
    await tmux.sendPromptText(state.tmuxSession, text);
    await tmux.sendEnter(state.tmuxSession);
  }

  private async runChoice(state: SessionState, choice: number): Promise<void> {
    this.log.debug({ channelId: state.channelId, choice }, 'sending menu choice');
    await tmux.sendChoice(state.tmuxSession, choice);
  }
}
