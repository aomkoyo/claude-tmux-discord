# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run

```bash
pnpm build        # prisma generate + tsc + copy generated client to dist/
pnpm start        # prisma migrate deploy + node dist/index.js
pnpm dev          # prisma generate + migrate deploy + tsx watch (auto-reload)
pnpm typecheck    # tsc --noEmit

# CLI package (cli/)
cd cli && pnpm build   # tsc only, zero runtime deps
```

The build has a manual step: `src/generated/` (Prisma client output) is excluded from tsconfig but must be copied to `dist/generated/` — the `copy:generated` script handles this. If you see "Cannot find module './generated/prisma'" at runtime, you forgot this step.

## Architecture

Discord bot that gives each channel its own tmux session running Claude Code. **There is no output capture or polling** — Claude sends replies to Discord directly by running `discord-send` (the CLI in `cli/`).

```
User types messages → buffer (in-memory) → /enter → tmux send-keys → Claude Code
Claude Code → runs discord-send → Discord REST API → message appears in channel
```

### Key design decisions

- **No tmux pane scraping.** The system prompt tells the agent to use `discord-send` for all replies. The only `capturePane()` call is in `waitForAgentReady()` — polling for the prompt to confirm the agent has booted.
- **Serial promise chain per channel.** `SessionState.busy` is a `.then()` chain that serializes all prompts/choices for a given channel. Never send concurrent input to the same tmux session.
- **Buffer-then-enter.** Messages accumulate in `MessageBuffer` until `/enter` flushes them as one prompt. This enables multi-message composition with attachments.
- **`ensure()` is the session lifecycle entry point.** It creates tmux sessions lazily, exports `DISCORD_TOKEN` + `DEFAULT_CHANNEL_ID` into the shell environment, starts Claude with `--append-system-prompt`, waits for the `❯` prompt, then queues the initial message if provided.

### Session environment injection

`exportEnvToSession()` uses both `tmux set-environment` (for future child processes) AND shell `export` keystrokes (for the current shell) with a 500ms delay. Both are needed because Claude's workspace cwd differs from the project root, so `discord-send` can't find `.env`.

### Resume detection

Two signals trigger `--continue`: the `.claude-tmux-discord/<channelId>/started` marker file (written by the bot, per-channel to avoid collisions in shared workspaces) OR `~/.claude/projects/<encoded-path>/*.jsonl` (Claude's own history). Either one → `--continue`.

### Projects

A **Project** maps 1:1 with a Discord category and defines a shared workspace directory. All rooms inside a project category share the same workspace — each channel gets its own tmux session + Claude instance, but they all see the same files.

- `/project create name:<name> [dir:<path>]` — creates Discord category + Project DB record
- Channels created inside a project category are auto-registered via the `channelCreate` event
- `/new` inside a project category auto-uses the project's workspace dir (unless `path` is explicitly set)
- Workspace resolution priority: explicit `path` > project lookup > per-channel default
- `/delete wipe:True` is blocked for project rooms to protect the shared workspace

### Multi-agent support

Rooms can run different AI CLI agents (Claude, Codex, Gemini, Copilot, etc.). Agents are defined via `AGENT_<NAME>=<command>` env vars. If none are set, defaults to `claude` from `CLAUDE_CMD`.

- `/new name:foo agent:codex` — creates room with a specific agent
- `/agent gemini` — switches agent (resets tmux session)
- Per-agent system prompt via `AGENT_<NAME>_PROMPT=...` (falls back to `CLAUDE_SYSTEM_PROMPT`)
- Claude-specific flags (`--append-system-prompt`, `--continue`, `--permission-mode`) are only applied when the agent command starts with `claude`
- Non-Claude agents receive the system prompt as the first message instead
- Ready detection uses universal regex `/[❯>$#%]\s*$/` for all agents

## Monorepo structure

pnpm workspace with two packages: root (the bot) and `cli/` (@aomkoyo/discord-cli).

- `cli/` has zero runtime dependencies — uses Node.js `fetch` against Discord REST API directly
- Root depends on `cli/` via `workspace:*` — gives `discord-send` binary on PATH
- The CLI resolves credentials in order: `-t` flag → `DISCORD_TOKEN` env → `.env` file

## Adding slash commands

1. Add `SlashCommandBuilder` to the `commandDefinitions` array in `commands.ts`
2. Add a case to the switch in `bindCommandHandlers` — these are not auto-connected
3. Slash commands are registered via REST before `client.login()`, not through discord.js gateway

## Prisma / Database

SQLite via Prisma. Schema in `prisma/schema.prisma`. Models: Project, Room, AclEntry, Setting.

- `src/generated/` is gitignored — run `pnpm prisma generate` after cloning
- Migrations auto-apply on `pnpm start` via `prisma migrate deploy`
- `db.ts` exports all query functions — no raw Prisma calls elsewhere

## Auth model

- Registered rooms (created via `/new`) auto-allow all messages — no ACL check needed
- ACL (`/acl add/remove/list`) gates non-registered channels by user ID, role ID, or channel ID
- Bot owners are auto-detected from Discord application info + `BOT_OWNER_IDS` env (60s cache)
- `authorize()` in `auth.ts` is synchronous — uses in-memory Sets, no DB hit

## Docker

Multi-stage build. Runtime stage copies `node_modules` from builder (avoids npm/pnpm workspace protocol conflicts). Claude Code is installed globally via `npm install -g @anthropic-ai/claude-code`. GitHub Actions publishes to `ghcr.io/aomkoyo/claude-tmux-discord`.

## Gotchas

- `bypassPermissions` is the default mode for new rooms (`--dangerously-skip-permissions`)
- `waitForClaudeReady()` polls for `❯` on the last non-empty line of the pane — if Claude is mid-response it may timeout (60s) and proceed anyway
- `send-keys -l` (literal mode) prevents shell injection from user messages, but system prompt and export commands use `shellSingleQuote()` escaping
- `SessionState` map is in-memory only — bot restart loses it, sessions re-ensure lazily on next message
- TypeScript v6 with `exactOptionalPropertyTypes` — passing `undefined` to optional properties requires explicit `| undefined` in the type
