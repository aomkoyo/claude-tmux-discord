export type AgentDef = {
  name: string;
  cmd: string;
  systemPrompt: string;
  resumeFlag: string;
  sessionIdFlag: string;
  systemPromptFlag: string;
};

const AGENT_PREFIX = 'AGENT_';
const META_SUFFIXES = ['_PROMPT', '_RESUME', '_SESSION_ID', '_SYSPROMPT_FLAG'] as const;

function isMetaKey(key: string): boolean {
  return META_SUFFIXES.some((s) => key.endsWith(s));
}

export function parseAgents(
  env: Record<string, string | undefined>,
  fallbackCmd: string,
  defaultSystemPrompt: string,
): Map<string, AgentDef> {
  const agents = new Map<string, AgentDef>();

  const agentKeys = Object.keys(env).filter(
    (k) => k.startsWith(AGENT_PREFIX) && !isMetaKey(k) && env[k]?.trim(),
  );

  for (const key of agentKeys) {
    const val = env[key]!;
    const name = key.slice(AGENT_PREFIX.length).toLowerCase();
    const prompt = env[`${key}_PROMPT`]?.trim() ?? defaultSystemPrompt;
    const resumeFlag = env[`${key}_RESUME`]?.trim() ?? '--continue';
    const sessionIdFlag = env[`${key}_SESSION_ID`]?.trim() ?? '--session-id';
    const systemPromptFlag = env[`${key}_SYSPROMPT_FLAG`]?.trim() ?? '--append-system-prompt';
    agents.set(name, { name, cmd: val.trim(), systemPrompt: prompt, resumeFlag, sessionIdFlag, systemPromptFlag });
  }

  if (agents.size === 0) {
    agents.set('claude', {
      name: 'claude',
      cmd: fallbackCmd,
      systemPrompt: defaultSystemPrompt,
      resumeFlag: '--continue',
      sessionIdFlag: '--session-id',
      systemPromptFlag: '--append-system-prompt',
    });
  }

  return agents;
}

export function defaultAgentName(agents: Map<string, AgentDef>): string {
  if (agents.has('claude')) return 'claude';
  return agents.keys().next().value!;
}

export function isClaudeAgent(cmd: string): boolean {
  return cmd.split(/\s+/)[0] === 'claude';
}
