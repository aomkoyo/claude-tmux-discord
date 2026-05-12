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
- **tmux**
- **Claude Code** CLI (`claude`) — installed and authenticated
- A **Discord bot token** with `MESSAGE_CONTENT` intent enabled

---

## Local setup (bare metal)

Use the host's own tmux — no Docker needed.

### Quick start

```bash
git clone https://github.com/aomkoyo/claude-tmux-discord.git
cd claude-tmux-discord
bash setup.sh
```

The setup script checks dependencies, creates `.env`, installs packages, and builds.

### Manual setup

```bash
corepack enable
pnpm install
cp .env.example .env   # edit — set DISCORD_TOKEN at minimum
pnpm build
pnpm start
```

### Dev mode (auto-reload)

```bash
pnpm dev
```

### Local .env

```env
DISCORD_TOKEN=your-bot-token
REGISTER_GUILD_ID=your-guild-id
DATABASE_URL=file:./dev.db
WORKSPACE_ROOT=./workspace
LOG_LEVEL=info
```

---

## Docker setup

### Using pre-built image (GHCR)

```bash
cp .env.example .env
# edit .env — set DISCORD_TOKEN, and change:
#   DATABASE_URL=file:/data/state.db
#   WORKSPACE_ROOT=/workspace

docker compose up -d
```

### Build locally

```bash
docker compose up -d --build
```

### Docker .env

```env
DISCORD_TOKEN=your-bot-token
REGISTER_GUILD_ID=your-guild-id
DATABASE_URL=file:/data/state.db
WORKSPACE_ROOT=/workspace
LOG_LEVEL=info
```

### Claude Code login (Docker)

Claude Code requires authentication before it can run. Two options:

**Option A — Share host login (recommended)**

If you already have `claude` logged in on the host, the default `docker-compose.yml` mounts `~/.claude` into the container. Claude inside Docker will use the host's existing session:

```yaml
volumes:
  - ${HOME}/.claude:/home/node/.claude   # read-write for token refresh
```

> The mount is **read-write** so Claude can refresh expired OAuth tokens. If you prefer read-only, be aware that token refresh will fail after expiry.

**Option B — Login inside the container**

Use an isolated config directory instead of the host's:

1. Edit `docker-compose.yml` — comment out the host mount, uncomment the local one:

```yaml
volumes:
  # - ${HOME}/.claude:/home/node/.claude     # comment this
  - ./claude-config:/home/node/.claude        # uncomment this
```

2. Start the container, then login:

```bash
docker compose up -d
docker compose exec bot claude login
```

3. Follow the browser-based auth flow. The session is saved in `./claude-config/` and persists across container restarts.

**Verify login works:**

```bash
docker compose exec bot claude --version
```

### Volumes

| Mount | Purpose |
|-------|---------|
| `./workspace:/workspace` | Per-channel Claude workspaces |
| `./data:/data` | SQLite database (auto-migrated on boot) |
| `~/.claude:/home/node/.claude` | Claude Code auth, config, and session data |

### Dev with Docker

```bash
docker compose -f docker-compose.dev.yml up
```

Source files are mounted, auto-reloads on change via `tsx watch`.

---

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

---

## @aomkoyo/discord-cli

Standalone CLI for sending messages to Discord. Used by Claude inside tmux sessions. Zero runtime dependencies.

### Install globally

```bash
pnpm add -g @aomkoyo/discord-cli
```

### Usage

```bash
discord-send "Hello world" -c <channelId>
discord-send "Reply here" -c <channelId> -r <messageId>
discord-send "Check this" -f ./image.png
discord-send "From URL" -f https://example.com/image.png
discord-send "Multi" -f ./a.png -f ./b.txt
discord-send "Hello" -t <bot-token> -c <channelId>

# With env vars (no flags needed)
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
3. `DISCORD_TOKEN` in `.env` file (cwd, then parent dirs)

---

## Environment variables

| Variable | Required | Local default | Docker default | Description |
|----------|----------|---------------|----------------|-------------|
| `DISCORD_TOKEN` | Yes | | | Bot token |
| `DISCORD_APP_ID` | No | auto-derived | auto-derived | Application ID |
| `REGISTER_GUILD_ID` | No | | | Guild for instant slash command registration |
| `BOT_OWNER_IDS` | No | | | Comma-separated user IDs for `/acl` |
| `DATABASE_URL` | No | `file:./dev.db` | `file:/data/state.db` | SQLite connection |
| `WORKSPACE_ROOT` | No | `./workspace` | `/workspace` | Channel workspace root |
| `TMUX_SESSION_PREFIX` | No | `claude-` | `claude-` | Tmux session name prefix |
| `CLAUDE_CMD` | No | `claude` | `claude` | Claude CLI command |
| `CLAUDE_SYSTEM_PROMPT` | No | built-in | built-in | Override system prompt (`OFF` to disable) |
| `DEFAULT_CHANNEL_ID` | No | | | Default channel for `discord-send` |
| `LOG_LEVEL` | No | `info` | `info` | Pino log level |

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
    src/send.ts       # discord-send CLI (@aomkoyo/discord-cli)
  prisma/
    schema.prisma     # Database schema
```

## License

MIT
