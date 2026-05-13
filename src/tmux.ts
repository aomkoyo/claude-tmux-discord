import { execa, ExecaError } from 'execa';
import stripAnsi from 'strip-ansi';

export class TmuxError extends Error {
  public override readonly cause: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'TmuxError';
    this.cause = cause;
  }
}

async function tmux(args: string[], opts: { allowFailure?: boolean } = {}): Promise<{ stdout: string; exitCode: number }> {
  try {
    const result = await execa('tmux', args, { reject: !opts.allowFailure, timeout: 15_000 });
    return { stdout: result.stdout, exitCode: result.exitCode ?? 0 };
  } catch (err) {
    if (err instanceof ExecaError) {
      throw new TmuxError(`tmux ${args[0]} failed: ${err.shortMessage ?? err.message}`, err);
    }
    throw err;
  }
}

export async function sessionExists(name: string): Promise<boolean> {
  const result = await tmux(['has-session', '-t', name], { allowFailure: true });
  return result.exitCode === 0;
}

export async function createSession(name: string, cwd: string, width = 200, height = 50): Promise<void> {
  await tmux([
    'new-session',
    '-d',
    '-s', name,
    '-c', cwd,
    '-x', String(width),
    '-y', String(height),
  ]);
}

export async function startAgent(
  name: string,
  claudeCmd: string,
  extraArgs: string[] = [],
): Promise<void> {
  // Compose a single shell-safe command line; extraArgs are static flags from
  // a fixed allow-list so no user input ever reaches this string.
  const fullCmd = [claudeCmd, ...extraArgs].join(' ');
  await tmux(['send-keys', '-t', name, fullCmd, 'Enter']);
}

/**
 * Send a single character (typically a digit) followed by Enter.
 * Used to answer Claude menu prompts.
 */
export async function sendChoice(name: string, choice: number | string): Promise<void> {
  await tmux(['send-keys', '-t', name, String(choice), 'Enter']);
}

export async function sendPromptText(name: string, text: string): Promise<void> {
  if (text.length === 0) return;
  await tmux(['send-keys', '-t', name, '-l', text]);
}

export async function sendEnter(name: string): Promise<void> {
  await tmux(['send-keys', '-t', name, 'Enter']);
}

export async function sendCtrlC(name: string): Promise<void> {
  await tmux(['send-keys', '-t', name, 'C-c']);
}

export async function capturePane(name: string, scrollback = 2000): Promise<string> {
  const result = await tmux(['capture-pane', '-t', name, '-p', '-J', '-S', `-${scrollback}`]);
  return stripAnsi(result.stdout);
}

export async function setEnvironment(name: string, key: string, value: string): Promise<void> {
  await tmux(['set-environment', '-t', name, key, value]);
}

export async function killSession(name: string): Promise<void> {
  await tmux(['kill-session', '-t', name], { allowFailure: true });
}

export async function listSessions(): Promise<string[]> {
  const result = await tmux(['list-sessions', '-F', '#{session_name}'], { allowFailure: true });
  if (result.exitCode !== 0) return [];
  return result.stdout.split('\n').filter((s) => s.length > 0);
}
