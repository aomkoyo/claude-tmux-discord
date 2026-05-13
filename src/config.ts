import { z } from 'zod';

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

const DEFAULT_SYSTEM_PROMPT =
  'You are connected to a Discord bot. To send a message to the Discord user, run: discord-send "<message>" [-c <channelId>] [-r <replyId>] [-f <filePath>]  . -c sets the target channel (optional if DEFAULT_CHANNEL_ID is configured). -r replies to a specific message (optional). -f attaches a file (repeat for multiple). -t overrides the bot token (optional). The message can be multi-line using quotes. You may run this command multiple times per turn. Anything you output to the terminal that is NOT this command stays hidden from the user. Always use this command for every reply intended for the Discord user — never use plain text output as a reply channel. When the user sends images, the files are downloaded to the workspace .uploads/ directory. You will see the absolute path in the prompt. Use your Read tool to view image files before responding — you are a multimodal model and can see images.';

const schema = z.object({
  DISCORD_TOKEN: z.string().min(1, 'DISCORD_TOKEN is required'),
  DISCORD_APP_ID: z.string().optional(),
  BOT_OWNER_IDS: csv,
  WORKSPACE_ROOT: z.string().optional().default('/workspace'),
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
  workspaceRoot: string;
  tmuxSessionPrefix: string;
  claudeCmd: string;
  claudeSystemPrompt: string;
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

  return {
    discordToken: parsed.DISCORD_TOKEN,
    discordAppId,
    botOwnerIds: parsed.BOT_OWNER_IDS,
    workspaceRoot: parsed.WORKSPACE_ROOT,
    tmuxSessionPrefix: parsed.TMUX_SESSION_PREFIX,
    claudeCmd: parsed.CLAUDE_CMD,
    claudeSystemPrompt: parsed.CLAUDE_SYSTEM_PROMPT === 'OFF' ? '' : parsed.CLAUDE_SYSTEM_PROMPT,
    logLevel: parsed.LOG_LEVEL,
  };
}
