import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createBot } from './bot.js';
import { registerCommands } from './commands.js';
import { AclState } from './acl.js';
import { disconnect as dbDisconnect, getPrisma } from './db.js';

async function main(): Promise<void> {
  const cfg = loadConfig(process.env);
  const log = createLogger(cfg.logLevel);

  log.info(
    {
      botOwners: cfg.botOwnerIds.length,
      workspaceRoot: cfg.workspaceRoot,
      registerGuildId: process.env['REGISTER_GUILD_ID'] ?? null,
    },
    'starting claude-tmux-discord',
  );

  await getPrisma().$connect();
  log.info('database connected');

  const acl = new AclState(log);
  await acl.load();

  if (acl.isEmpty() && cfg.botOwnerIds.length === 0) {
    log.warn(
      'allowlist is empty AND no BOT_OWNER_IDS configured — only the Discord application owner can use /acl to onboard users.',
    );
  }

  // Register slash commands BEFORE login: REST is independent of gateway state.
  try {
    await registerCommands(cfg, log, process.env['REGISTER_GUILD_ID']);
  } catch (err) {
    log.error({ err }, 'failed to register slash commands (continuing)');
  }

  const { client } = await createBot(cfg, acl, log);

  const shutdown = async (signal: string) => {
    log.info({ signal }, 'shutting down');
    try {
      await client.destroy();
    } catch (err) {
      log.error({ err }, 'error during client.destroy()');
    }
    try {
      await dbDisconnect();
    } catch (err) {
      log.error({ err }, 'error during db disconnect');
    }
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  process.on('unhandledRejection', (reason) => {
    log.error({ reason }, 'unhandled rejection');
  });

  await client.login(cfg.discordToken);
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
