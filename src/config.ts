import { z } from 'zod';
import { parseAgents, defaultAgentName, type AgentDef } from './agents.js';

const csv = z
  .string()
  .optional()
  .default('')
  .transform((s) =>
    s
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0),
  );

const DEFAULT_SYSTEM_PROMPT = `IMPORTANT: You can ONLY communicate with the user by running the discord-send command. Plain text output is invisible to them. Every reply MUST use discord-send.

Usage: discord-send "<message>" [-c <channelId>] [-r <replyId>] [-f <filePath>]
  -c  Target channel (optional — DEFAULT_CHANNEL_ID is already set)
  -r  Reply to a specific message ID
  -f  Attach a file or image (repeat for multiple)
  Use quotes for multi-line messages. You may call discord-send multiple times per turn.

When the user sends images, they are saved to the .uploads/ directory. Use your Read tool to view them — you are multimodal.

You are ready to serve. Greet the user and respond immediately.`;

const schema = z.object({
  DISCORD_TOKEN: z.string().min(1, 'DISCORD_TOKEN is required'),
  DISCORD_APP_ID: z.string().optional(),
  BOT_OWNER_IDS: csv,
  WORKSPACE_ROOT: z.string().optional(),
  TMUX_SESSION_PREFIX: z.string().optional().default('claude-'),
  CLAUDE_CMD: z.string().optional().default('claude'),
  CLAUDE_SYSTEM_PROMPT: z.preprocess(
    (v) => (v === undefined || v === null || v === '' ? DEFAULT_SYSTEM_PROMPT : v),
    z.string(),
  ),
  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
    .optional()
    .default('info'),
});

export type AppConfig = {
  discordToken: string;
  discordAppId: string;
  botOwnerIds: string[];
  workspaceRoot: string | undefined;
  tmuxSessionPrefix: string;
  claudeCmd: string;
  claudeSystemPrompt: string;
  agents: Map<string, AgentDef>;
  defaultAgent: string;
  logLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
};

export function deriveAppIdFromToken(token: string): string {
  const head = token.split('.')[0];
  if (!head) {
    throw new Error('DISCORD_TOKEN is malformed (cannot extract app id)');
  }
  const normalized = head.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const decoded = Buffer.from(padded, 'base64').toString('utf8');
  if (!/^[0-9]{15,25}$/.test(decoded)) {
    throw new Error(
      `DISCORD_TOKEN does not encode a valid snowflake app id (decoded: "${decoded}"). Set DISCORD_APP_ID explicitly.`,
    );
  }
  return decoded;
}

export function loadConfig(env: NodeJS.ProcessEnv | Record<string, string | undefined>): AppConfig {
  const parsed = schema.parse(env);

  const discordAppId =
    parsed.DISCORD_APP_ID && parsed.DISCORD_APP_ID.length > 0
      ? parsed.DISCORD_APP_ID
      : deriveAppIdFromToken(parsed.DISCORD_TOKEN);

  const claudeSystemPrompt = parsed.CLAUDE_SYSTEM_PROMPT === 'OFF' ? '' : parsed.CLAUDE_SYSTEM_PROMPT;
  const agents = parseAgents(env as Record<string, string | undefined>, parsed.CLAUDE_CMD, claudeSystemPrompt);

  return {
    discordToken: parsed.DISCORD_TOKEN,
    discordAppId,
    botOwnerIds: parsed.BOT_OWNER_IDS,
    workspaceRoot: parsed.WORKSPACE_ROOT,
    tmuxSessionPrefix: parsed.TMUX_SESSION_PREFIX,
    claudeCmd: parsed.CLAUDE_CMD,
    claudeSystemPrompt,
    agents,
    defaultAgent: defaultAgentName(agents),
    logLevel: parsed.LOG_LEVEL,
  };
}
