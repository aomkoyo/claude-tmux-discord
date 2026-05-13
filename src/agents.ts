export type AgentDef = {
  name: string;
  cmd: string;
  systemPrompt: string;
};

const AGENT_PREFIX = 'AGENT_';
const PROMPT_SUFFIX = '_PROMPT';

export function parseAgents(
  env: Record<string, string | undefined>,
  fallbackCmd: string,
  defaultSystemPrompt: string,
): Map<string, AgentDef> {
  const agents = new Map<string, AgentDef>();

  const agentKeys = Object.keys(env).filter(
    (k) => k.startsWith(AGENT_PREFIX) && !k.endsWith(PROMPT_SUFFIX) && env[k]?.trim(),
  );

  for (const key of agentKeys) {
    const val = env[key]!;
    const name = key.slice(AGENT_PREFIX.length).toLowerCase();
    const promptKey = `${key}${PROMPT_SUFFIX}`;
    const prompt = env[promptKey]?.trim() ?? defaultSystemPrompt;
    agents.set(name, { name, cmd: val.trim(), systemPrompt: prompt });
  }

  if (agents.size === 0) {
    agents.set('claude', { name: 'claude', cmd: fallbackCmd, systemPrompt: defaultSystemPrompt });
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
