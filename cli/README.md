# @aomkoyo/discord-cli

[![npm](https://img.shields.io/npm/v/@aomkoyo/discord-cli)](https://www.npmjs.com/package/@aomkoyo/discord-cli)
[![GitHub](https://img.shields.io/github/license/aomkoyo/claude-tmux-discord)](https://github.com/aomkoyo/claude-tmux-discord/blob/main/LICENSE)

Zero-dependency CLI for sending messages and files to Discord channels. Uses Node.js built-in `fetch` against the Discord REST API v10 directly.

Part of [**claude-tmux-discord**](https://github.com/aomkoyo/claude-tmux-discord) — AI coding agents running in tmux use this to send replies back to Discord.

**[GitHub](https://github.com/aomkoyo/claude-tmux-discord/tree/main/cli)** | **[Issues](https://github.com/aomkoyo/claude-tmux-discord/issues)** | **[Wiki](https://github.com/aomkoyo/claude-tmux-discord/wiki/Discord-Send-CLI)**

## Install

```bash
npm install -g @aomkoyo/discord-cli
# or
pnpm add -g @aomkoyo/discord-cli
```

## Usage

```bash
# Send a text message
discord-send "Hello from the CLI!"

# Send to a specific channel
discord-send "Hello" -c 1234567890123456789

# Reply to a message
discord-send "Got it!" -r 1234567890123456789

# Attach a local file
discord-send "Here's the file" -f ./report.pdf

# Attach multiple files
discord-send "Screenshots" -f ./before.png -f ./after.png

# Attach from URL
discord-send "Check this out" -f https://example.com/image.png

# Send only files (no text)
discord-send -f ./output.zip

# Use a specific bot token
discord-send "Hello" -t "Bot_TOKEN_HERE" -c 1234567890123456789
```

## Options

```
discord-send <message> [options]

Options:
  -c, --channel <id>      Target channel ID
  -r, --reply <id>        Message ID to reply to
  -t, --token <token>     Discord bot token
  -f, --file <path|url>   Attach a file (repeat for multiple)
  -h, --help              Show help
```

## Authentication

The token is resolved in this order:

1. `-t` flag (highest priority)
2. `DISCORD_TOKEN` environment variable
3. `DISCORD_TOKEN` in `.env` file (searches cwd, then parent directories)

## Channel ID

The target channel is resolved in this order:

1. `-c` flag (highest priority)
2. `DEFAULT_CHANNEL_ID` environment variable
3. `DEFAULT_CHANNEL_ID` in `.env` file

## Environment Variables

```env
DISCORD_TOKEN=your-bot-token
DEFAULT_CHANNEL_ID=your-default-channel-id
```

Or create a `.env` file in your project root with the above variables.

## Features

- Zero runtime dependencies — uses Node.js 22+ built-in `fetch`
- Send text messages with optional file attachments
- Attach local files or remote URLs (fetched and re-uploaded)
- Reply to specific messages
- Multiple file attachments in a single message
- Automatic `.env` file discovery (cwd and parent directories)
- Suppresses @mentions by default (`allowed_mentions: { parse: [] }`)

## Use with AI Agents

This CLI is designed to be called by AI coding agents (Claude Code, Codex, Gemini, etc.) running inside tmux sessions. The agent's system prompt instructs it to use `discord-send` for all communication back to the Discord user.

```bash
# Agent sends a response
discord-send "I've fixed the bug in auth.ts. The issue was..."

# Agent sends a file it created
discord-send "Here's the generated report" -f ./output/report.pdf

# Agent replies to the user's message
discord-send "Working on it..." -r 1234567890123456789
```

## Requirements

- **Node.js** >= 22

## Contributing

Contributions are welcome! Please open an issue or PR on [GitHub](https://github.com/aomkoyo/claude-tmux-discord).

## License

MIT - see [LICENSE](https://github.com/aomkoyo/claude-tmux-discord/blob/main/LICENSE)
