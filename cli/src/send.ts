#!/usr/bin/env node
import { readFileSync, statSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const DISCORD_API = 'https://discord.com/api/v10';

function isUrl(s: string): boolean {
  return /^https?:\/\//i.test(s);
}

function findEnvFile(): string {
  const candidates = [
    resolve(process.cwd(), '.env'),
    resolve(__dirname, '..', '..', '.env'),
    resolve(__dirname, '..', '.env'),
  ];
  for (const p of candidates) {
    try {
      statSync(p);
      return p;
    } catch {
      // continue
    }
  }
  return candidates[0]!;
}

function loadEnv(): Record<string, string> {
  const envPath = findEnvFile();
  let content: string;
  try {
    content = readFileSync(envPath, 'utf8');
  } catch {
    return {};
  }
  const env: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return env;
}

type ParsedArgs = {
  message: string;
  channelId: string | undefined;
  replyId: string | undefined;
  token: string | undefined;
  files: string[];
};

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  let channelId: string | undefined;
  let replyId: string | undefined;
  let token: string | undefined;
  const files: string[] = [];
  const messageParts: string[] = [];

  let i = 0;
  while (i < args.length) {
    const arg = args[i]!;
    if ((arg === '-c' || arg === '--channel') && i + 1 < args.length) {
      channelId = args[i + 1]!;
      i += 2;
    } else if ((arg === '-r' || arg === '--reply') && i + 1 < args.length) {
      replyId = args[i + 1]!;
      i += 2;
    } else if ((arg === '-t' || arg === '--token') && i + 1 < args.length) {
      token = args[i + 1]!;
      i += 2;
    } else if ((arg === '-f' || arg === '--file') && i + 1 < args.length) {
      files.push(args[i + 1]!);
      i += 2;
    } else if (arg === '-h' || arg === '--help') {
      console.log(`Usage: discord-send <message> [-c <channelId>] [-r <replyId>] [-f <file|url>]...

Options:
  -c, --channel <id>   Target channel ID (or set DEFAULT_CHANNEL_ID in .env)
  -r, --reply <id>     Message ID to reply to
  -t, --token <token>  Discord bot token (or set DISCORD_TOKEN in .env)
  -f, --file <path|url> Attach a local file or URL (repeat for multiple)
  -h, --help           Show this help`);
      process.exit(0);
    } else {
      messageParts.push(arg);
      i += 1;
    }
  }

  const message = messageParts.join(' ');
  if (message.length === 0 && files.length === 0) {
    console.error('Error: provide a message or at least one file (-f)');
    console.error('Run with --help for usage');
    process.exit(1);
  }

  return { message, channelId, replyId, token, files };
}

type ResolvedFile = { data: Buffer; filename: string };

async function resolveFile(fileArg: string): Promise<ResolvedFile> {
  if (isUrl(fileArg)) {
    const res = await fetch(fileArg);
    if (!res.ok) throw new Error(`Failed to download ${fileArg}: ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const urlPath = new URL(fileArg).pathname;
    const filename = basename(urlPath) || 'download';
    return { data: buf, filename };
  }
  const abs = resolve(fileArg);
  try {
    statSync(abs);
  } catch {
    throw new Error(`File not found: ${abs}`);
  }
  return { data: readFileSync(abs), filename: basename(abs) };
}

async function sendMessage(
  token: string,
  channelId: string,
  message: string,
  replyId: string | undefined,
  resolvedFiles: ResolvedFile[],
): Promise<void> {
  const url = `${DISCORD_API}/channels/${channelId}/messages`;

  const jsonPayload: Record<string, unknown> = {
    allowed_mentions: { parse: [] },
  };
  if (message.length > 0) jsonPayload['content'] = message;
  if (replyId) {
    jsonPayload['message_reference'] = { message_id: replyId };
  }

  let res: Response;

  if (resolvedFiles.length > 0) {
    const form = new FormData();
    form.append('payload_json', JSON.stringify(jsonPayload));
    for (let idx = 0; idx < resolvedFiles.length; idx++) {
      const file = resolvedFiles[idx]!;
      const blob = new Blob([file.data]);
      form.append(`files[${idx}]`, blob, file.filename);
    }
    res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bot ${token}` },
      body: form,
    });
  } else {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bot ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(jsonPayload),
    });
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Discord API error ${res.status}: ${body}`);
  }
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv);
  const env = loadEnv();
  const token = parsed.token ?? process.env['DISCORD_TOKEN'] ?? env['DISCORD_TOKEN'];
  const { message, channelId, replyId, files } = parsed;

  if (!token) {
    console.error('Error: DISCORD_TOKEN not found (checked process.env and .env file)');
    process.exit(1);
  }

  const resolvedChannelId = channelId ?? process.env['DEFAULT_CHANNEL_ID'] ?? env['DEFAULT_CHANNEL_ID'];
  if (!resolvedChannelId) {
    console.error('Error: no channel ID. Use -c <channelId> or set DEFAULT_CHANNEL_ID in .env');
    process.exit(1);
  }

  const resolvedFiles: ResolvedFile[] = [];
  for (const f of files) {
    try {
      resolvedFiles.push(await resolveFile(f));
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }

  await sendMessage(token, resolvedChannelId, message, replyId, resolvedFiles);
  console.log('OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
