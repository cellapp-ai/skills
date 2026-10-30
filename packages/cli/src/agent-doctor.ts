import {execFile} from 'node:child_process';
import {access, realpath, stat} from 'node:fs/promises';
import {homedir} from 'node:os';
import {isAbsolute, join, win32} from 'node:path';
import {constants} from 'node:fs';
type LoginState = 'signed-in' | 'signed-out' | 'unknown';
interface AgentDefinition {
  id: string;
  name: string;
  executable: string;
  authArgs: string[];
  loginCommand: string;
  installGuide: string;
}
export interface AgentDiagnostic {
  id: string;
  name: string;
  installed: boolean;
  version?: string;
  loginState: LoginState;
  loginCommand: string;
  installGuide: string;
}
export interface LocalAgentDiagnostic {
  platform: string;
  nodeVersion: string;
  agents: AgentDiagnostic[];
}

const agents: AgentDefinition[] = [
  {id: 'codex', name: 'Codex', executable: 'codex', authArgs: ['login', 'status'], loginCommand: 'codex login', installGuide: 'https://developers.openai.com/codex/cli'},
  {id: 'claude', name: 'Claude Code', executable: 'claude', authArgs: ['auth', 'status', '--json'], loginCommand: 'claude auth login', installGuide: 'https://code.claude.com/docs/en/setup'},
  {id: 'cursor', name: 'Cursor', executable: 'cursor-agent', authArgs: ['status'], loginCommand: 'cursor-agent login', installGuide: 'https://docs.cursor.com/en/cli/installation'},
];

export async function locateExecutable(name: string, platform: string, pathValue: string, home: string): Promise<string | undefined> {
  const separator = platform === 'win32' ? ';' : ':';
  const pathAPI = platform === 'win32' ? win32 : {isAbsolute, join};
  const directories = [...pathValue.split(separator), pathAPI.join(home, '.local', 'bin')];
  const names = platform === 'win32' ? [`${name}.exe`, `${name}.cmd`] : [name];
  for (const directory of directories) {
    if (!directory || !pathAPI.isAbsolute(directory)) continue;
    for (const filename of names) {
      try {
        const canonical = await realpath(pathAPI.join(directory, filename));
        if (!(await stat(canonical)).isFile()) continue;
        await access(canonical, platform === 'win32' ? constants.F_OK : constants.X_OK);
        return canonical;
      } catch (error) {
        if (['ENOENT', 'EACCES', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) continue;
        throw error;
      }
    }
  }
  return undefined;
}

function probe(file: string, args: string[]): Promise<{code: number | null; output: string}> {
  return new Promise(resolve => {
    execFile(file, args, {cwd: homedir(), timeout: 5000, maxBuffer: 4096, windowsHide: true}, (error, stdout) => {
      resolve({code: error ? typeof error.code === 'number' ? error.code : null : 0, output: stdout.slice(0, 4096)});
    });
  });
}

function loginState(name: string, result: {code: number | null; output: string}): LoginState {
  if (name === 'Codex') return result.code === 0 ? 'signed-in' : 'unknown';
  if (name === 'Claude Code') {
    try {
      const value = JSON.parse(result.output) as Record<string, unknown>;
      if (value.loggedIn === true) return 'signed-in';
      if (value.loggedIn === false) return 'signed-out';
    } catch { /* Older versions may not support JSON status. */ }
    return 'unknown';
  }
  if (result.code !== 0) return 'unknown';
  const output = result.output.toLowerCase();
  if (/\b(not authenticated|not logged in)\b/.test(output)) return 'signed-out';
  if (/\b(authenticated|logged in)\b/.test(output)) return 'signed-in';
  return 'unknown';
}

export async function diagnoseLocalAgents(options: {platform?: NodeJS.Platform; path?: string; home?: string} = {}): Promise<LocalAgentDiagnostic> {
  const platform = options.platform ?? process.platform;
  const pathValue = options.path ?? process.env.PATH ?? '';
  const home = options.home ?? homedir();
  const found: AgentDiagnostic[] = [];
  for (const agent of agents) {
    const executable = await locateExecutable(agent.executable, platform, pathValue, home);
    const diagnostic: AgentDiagnostic = {id: agent.id, name: agent.name, installed: executable !== undefined, loginState: 'unknown', loginCommand: agent.loginCommand, installGuide: agent.installGuide};
    if (executable) {
      if (platform !== 'win32' || executable.toLowerCase().endsWith('.exe')) {
        const version = await probe(executable, ['--version']);
        const match = version.code === 0 ? version.output.match(/\b\d+\.\d+(?:\.\d+)?(?:[-+][\w.]+)?\b/) : null;
        if (match) diagnostic.version = match[0];
        diagnostic.loginState = loginState(agent.name, await probe(executable, agent.authArgs));
      }
    }
    found.push(diagnostic);
  }
  return {platform, nodeVersion: process.version, agents: found};
}

export function supportedAgentIds(): string[] { return agents.map(agent => agent.id); }
export function supportedAgentExecutable(id: string): string | undefined { return agents.find(agent => agent.id === id)?.executable; }
