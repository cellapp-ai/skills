import {homedir} from 'node:os';
import {join} from 'node:path';
import {readJSON, saveJSON} from './client.js';
import {locateExecutable, supportedAgentExecutable, supportedAgentIds} from './agent-doctor.js';

export function agentSelectionFile(configDirectory?: string): string {
  return join(configDirectory ?? join(homedir(), '.config', 'cellapp'), 'agent-selection.json');
}

export async function selectedAgent(configDirectory?: string): Promise<string | undefined> {
  const value = await readJSON<{agent?: unknown}>(agentSelectionFile(configDirectory));
  return typeof value?.agent === 'string' && supportedAgentIds().includes(value.agent) ? value.agent : undefined;
}

export async function setSelectedAgent(id: string, configDirectory?: string, options: {platform?: NodeJS.Platform; path?: string; home?: string} = {}): Promise<{agent: string}> {
  const executable = supportedAgentExecutable(id);
  if (!executable) throw new Error(`Unsupported agent; choose ${supportedAgentIds().join(', ')}`);
  const platform = options.platform ?? process.platform;
  const path = options.path ?? process.env.PATH ?? '';
  const home = options.home ?? homedir();
  if (!(await locateExecutable(executable, platform, path, home))) throw new Error(`${id} CLI is not installed in a supported location`);
  await saveJSON(agentSelectionFile(configDirectory), {agent: id}, true);
  return {agent: id};
}
