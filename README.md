# claude-tmux-discord

Discord bot that remote-controls **Claude Code** running inside **tmux sessions**.
Each Discord channel gets its own isolated tmux + workspace. Claude replies to Discord
via [`@aomkoyo/discord-cli`](https://www.npmjs.com/package/@aomkoyo/discord-cli) (`discord-send`).

## How it works

```
Discord channel  -->  /enter  -->  tmux session (Claude Code)
                                        |
                                   discord-send  -->  Discord channel
```

1. User types messages in a Discord channel (buffered)
2. User runs `/enter` to flush the buffer as a single Claude prompt
3. Claude processes the prompt inside a tmux session
4. Claude sends replies back to Discord using `discord-send` CLI

## Requirements

- **Node.js** >= 22
- **pnpm** (via corepack)
- **tmux** installed on the host
- **Claude Code** CLI (`claude`) installed and authenticated
- A **Discord bot token** with `MESSAGE_CONTENT` intent enabled

## Quick start

### 1. Clone and install

```bash
git clone https://github.com/aomkoyo/claude-tmux-discord.git
cd claude-tmux-discord
corepack enable
pnpm install
```

### 2. Configure

```bash
cp .env.example .env
```

Edit `.env`:

```env
# Required
DISCORD_TOKEN=your-bot-token-here

# Recommended: instant slash command registration during dev
REGISTER_GUILD_ID=your-guild-id

# Database
DATABASE_URL=file:./dev.db

# Workspace (where Claude sessions live)
WORKSPACE_ROOT=./workspace

# Optional: default channel for discord-send
DEFAULT_CHANNEL_ID=

# Logging
LOG_LEVEL=info
```

### 3. Build and run

```bash
pnpm build
pnpm start
```

### 4. Dev mode (auto-reload)

```bash
pnpm dev
```

## Docker

```bash
cp .env.example .env
# edit .env with your values

docker compose up -d
```

The compose file mounts:
- `./workspace` for per-channel workspaces
- `./data` for the SQLite database
- `~/.claude` for Claude Code auth (read-only)

## Discord commands

### Room management

| Command | Description |
|---------|-------------|
| `/new <name> [mode]` | Create a new Claude room (channel + tmux + workspace) |
| `/delete --force` | Delete this room and its tmux session |
| `/rooms` | List all registered rooms in this guild |
| `/rename <name>` | Rename this room |
| `/mode <mode>` | Change permission mode (restarts Claude) |
| `/status` | Show tmux session info for this channel |

### Messaging

| Command | Description |
|---------|-------------|
| _(type messages)_ | Messages are buffered automatically |
| `/enter` | Flush buffer and send to Claude as a single prompt |
| `/cancel` | Discard buffered messages |
| `/buffer` | Show what is currently buffered |
| `/reset` | Kill tmux session (next `/enter` starts fresh) |

### Access control

| Command | Description |
|---------|-------------|
| `/acl add type:<user\|role\|channel> value:<id>` | Add to allowlist |
| `/acl remove type:<...> value:<...>` | Remove from allowlist |
| `/acl list` | Show current allowlist |
| `/help` | Show available commands |

### Permission modes

| Mode | Description |
|------|-------------|
| `default` | Normal Claude permissions |
| `plan` | Plan mode only |
| `acceptEdits` | Auto-accept file edits |
| `bypassPermissions` | Skip all permission prompts (default for new rooms) |

## @aomkoyo/discord-cli

Standalone CLI for sending messages to Discord. Used by Claude inside tmux sessions.

### Install globally

```bash
pnpm add -g @aomkoyo/discord-cli
```

### Usage

```bash
# Send a message
discord-send "Hello world" -c <channelId>

# Reply to a message
discord-send "Reply here" -c <channelId> -r <messageId>

# Attach a local file
discord-send "Check this out" -f ./image.png

# Attach from URL
discord-send "From the web" -f https://example.com/image.png

# Multiple files
discord-send "Multiple" -f ./a.png -f ./b.txt

# Override token
discord-send "Hello" -t <bot-token> -c <channelId>

# Use env vars (no flags needed)
export DISCORD_TOKEN=your-token
export DEFAULT_CHANNEL_ID=your-channel
discord-send "Simple"
```

### Options

```
-c, --channel <id>     Target channel ID (or DEFAULT_CHANNEL_ID env)
-r, --reply <id>       Message ID to reply to
-t, --token <token>    Bot token (or DISCORD_TOKEN env)
-f, --file <path|url>  Attach file or URL (repeat for multiple)
-h, --help             Show help
```

### Token resolution order

1. `-t` flag
2. `DISCORD_TOKEN` environment variable
3. `DISCORD_TOKEN` in `.env` file (cwd or parent dirs)

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DISCORD_TOKEN` | Yes | | Bot token |
| `DISCORD_APP_ID` | No | auto-derived | Application ID |
| `REGISTER_GUILD_ID` | No | | Guild for instant slash command registration |
| `BOT_OWNER_IDS` | No | | Comma-separated user IDs for `/acl` access |
| `DATABASE_URL` | No | `file:/data/state.db` | Prisma SQLite connection |
| `WORKSPACE_ROOT` | No | `/workspace` | Root directory for channel workspaces |
| `TMUX_SESSION_PREFIX` | No | `claude-` | Prefix for tmux session names |
| `CLAUDE_CMD` | No | `claude` | Claude CLI command |
| `CLAUDE_SYSTEM_PROMPT` | No | built-in | Override system prompt (`OFF` to disable) |
| `DEFAULT_CHANNEL_ID` | No | | Default channel for `discord-send` |
| `LOG_LEVEL` | No | `info` | Pino log level |

## Project structure

```
claude-tmux-discord/
  src/
    index.ts          # Entry point
    bot.ts            # Discord client setup
    config.ts         # Env validation (zod)
    session.ts        # Tmux session management
    commands.ts       # Slash command handlers
    tmux.ts           # Tmux shell wrapper
    acl.ts            # Access control list
    auth.ts           # Message authorization
    buffer.ts         # Per-channel message buffer
    attachments.ts    # File download from Discord
    db.ts             # Prisma database layer
    owner.ts          # Bot owner resolution
    logger.ts         # Pino logger
  cli/
    src/send.ts       # discord-send CLI (published as @aomkoyo/discord-cli)
  prisma/
    schema.prisma     # Database schema
```

## License

MIT
