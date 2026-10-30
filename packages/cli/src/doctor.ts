import {access, readFile, realpath, stat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {homedir} from 'node:os';
import {dirname, isAbsolute, join, relative, resolve} from 'node:path';
import {Client, readJSON} from './client.js';
import {CONTROL_API} from './paths.js';
import {diagnoseLocalAgents, locateExecutable, type AgentDiagnostic} from './agent-doctor.js';
import {selectedAgent} from './agent-selection.js';

export type CheckStatus = 'pass' | 'action' | 'unknown';
export interface DoctorCheck {id: string; status: CheckStatus; detail: string; next?: string}
export interface DoctorReport {platform: string; nodeVersion: string; origin: string; selectedAgent?: string; agents: AgentDiagnostic[]; checks: DoctorCheck[]}

function nodeSupported(version: string): boolean {
  const [major, minor] = version.split('.').map(Number);
  return (major ?? 0) > 22 || major === 22 && (minor ?? 0) >= 12;
}

async function projectChecks(path: string): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  let directory: string;
  try {
    directory = resolve(path);
    if (!(await stat(directory)).isDirectory()) throw new Error('not a directory');
    await access(directory, constants.R_OK);
    checks.push({id: 'project', status: 'pass', detail: 'Project directory is readable'});
  } catch {
    return [{id: 'project', status: 'action', detail: 'Project directory is missing or unreadable', next: 'Choose an existing readable directory with --project'}];
  }
  try {
    const raw = await readFile(join(directory, 'package.json'), 'utf8');
    const manifest = JSON.parse(raw) as {scripts?: Record<string, unknown>};
    checks.push(typeof manifest.scripts?.build === 'string'
      ? {id: 'build', status: 'pass', detail: 'package.json has a build script'}
      : {id: 'build', status: 'unknown', detail: 'No build script found; plain HTML may not need one', next: 'Confirm the static output directory before deploying'});
  } catch {
    checks.push({id: 'build', status: 'unknown', detail: 'No readable package.json build script', next: 'Confirm how this project produces static files'});
  }
  try {
    const linked = await readJSON<{appId?: unknown; output?: unknown}>(join(directory, 'cellapp.json'));
    checks.push(linked && typeof linked.appId === 'string'
      ? {id: 'association', status: 'pass', detail: 'Project is associated with a Cellapp application'}
      : {id: 'association', status: 'unknown', detail: 'No Cellapp application association yet', next: 'Deploy or link the project when ready'});
    const candidates = [typeof linked?.output === 'string' ? linked.output : '', 'dist', 'build', '.'];
    const projectRoot = await realpath(directory);
    let staticOutput = false;
    for (const candidate of candidates) {
      if (!candidate || isAbsolute(candidate)) continue;
      const output = resolve(directory, candidate);
      const lexical = relative(directory, output);
      if (lexical === '..' || lexical.startsWith('../') || lexical.startsWith('..\\')) continue;
      try {
        const actual = await realpath(output);
        const scoped = relative(projectRoot, actual);
        if (scoped === '..' || scoped.startsWith('../') || scoped.startsWith('..\\')) continue;
        if ((await stat(join(actual, 'index.html'))).isFile()) { staticOutput = true; break; }
      } catch { /* A build may not have run yet. */ }
    }
    checks.push(staticOutput
      ? {id: 'static-output', status: 'pass', detail: 'Found an index.html in a likely static output directory'}
      : {id: 'static-output', status: 'unknown', detail: 'No static index.html found yet', next: 'Build locally and identify the output directory before deploying'});
  } catch {
    checks.push({id: 'association', status: 'unknown', detail: 'Cannot read Cellapp project association', next: 'Check cellapp.json manually'});
  }
  return checks;
}

export async function diagnoseCellapp(options: {origin: string; configDirectory?: string; project?: string; platform?: NodeJS.Platform; path?: string; home?: string; fetchImpl?: typeof fetch}): Promise<DoctorReport> {
  const client = new Client(options.origin, options.configDirectory);
  const checks: DoctorCheck[] = [];
  checks.push(nodeSupported(process.versions.node)
    ? {id: 'node', status: 'pass', detail: `Node.js ${process.versions.node}`}
    : {id: 'node', status: 'action', detail: `Node.js ${process.versions.node} is too old`, next: 'Install Node.js 22.12 or later'});
  const platform = options.platform ?? process.platform;
  const path = options.path ?? process.env.PATH ?? '';
  const home = options.home ?? homedir();
  const npm = await locateExecutable('npm', platform, path, home);
  checks.push(npm ? {id: 'npm', status: 'pass', detail: 'npm is available'} : {id: 'npm', status: 'action', detail: 'npm was not found', next: 'Install npm with Node.js'});
  const configDirectory = options.configDirectory ?? join(home, '.config', 'cellapp');
  try {
    await access(configDirectory, constants.R_OK | constants.W_OK);
    checks.push({id: 'config', status: 'pass', detail: 'Cellapp configuration directory is readable and writable'});
  } catch {
    try {
      await access(dirname(configDirectory), constants.W_OK);
      checks.push({id: 'config', status: 'unknown', detail: 'Cellapp configuration directory will be created on first login'});
    } catch {
      checks.push({id: 'config', status: 'action', detail: 'Cellapp configuration directory cannot be written', next: 'Check local directory permissions'});
    }
  }
  let preferred: string | undefined;
  try { preferred = await selectedAgent(options.configDirectory); }
  catch { checks.push({id: 'selection', status: 'unknown', detail: 'Cannot read local Agent selection', next: 'Check agent-selection.json manually'}); }
  const agents = (await diagnoseLocalAgents({platform, path, home})).agents;
  if (preferred) {
    const chosen = agents.find(agent => agent.id === preferred);
    checks.push(chosen?.installed
      ? {id: 'selection', status: 'pass', detail: `${chosen.name} is the selected local Agent`}
      : {id: 'selection', status: 'action', detail: `Selected Agent ${preferred} is no longer installed`, next: 'Run cellapp set agent <name> with an installed Agent'});
  } else if (!checks.some(check => check.id === 'selection')) {
    checks.push({id: 'selection', status: 'unknown', detail: 'No local Agent selected', next: 'Run cellapp set agent codex, or continue manually'});
  }
  for (const agent of agents) {
    checks.push(agent.installed
      ? {id: `agent:${agent.id}`, status: agent.loginState === 'signed-out' ? 'action' : agent.loginState === 'unknown' ? 'unknown' : 'pass', detail: `${agent.name} ${agent.version ?? 'version unknown'}; login ${agent.loginState}`, next: agent.loginState === 'signed-in' ? undefined : `Check locally with ${agent.loginCommand}`}
      : {id: `agent:${agent.id}`, status: 'unknown', detail: `${agent.name} is not installed`, next: agent.installGuide});
  }
  if (options.project !== undefined) checks.push(...await projectChecks(options.project));
  let token: string | undefined;
  try {
    const saved = await readJSON<{token?: unknown}>(client.credentialFile);
    if (typeof saved?.token === 'string') token = saved.token;
  } catch { checks.push({id: 'login', status: 'unknown', detail: 'Cannot read Cellapp login state', next: 'Check the local Cellapp configuration'}); }
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(options.origin + `${CONTROL_API}/app-api/versions`, {redirect: 'error', signal: AbortSignal.timeout(5000)});
    checks.push(response.ok || response.status === 401 || response.status === 403
      ? {id: 'service', status: 'pass', detail: 'Cellapp control service is reachable'}
      : {id: 'service', status: 'unknown', detail: `Cellapp control service returned ${response.status}`, next: 'Check the selected origin'});
    if (token) {
      const auth = await fetchImpl(options.origin + `${CONTROL_API}/apps`, {headers: {Authorization: `Bearer ${token}`}, redirect: 'error', signal: AbortSignal.timeout(5000)});
      checks.push(auth.ok ? {id: 'login', status: 'pass', detail: 'Cellapp login is valid'} : auth.status === 401 ? {id: 'login', status: 'action', detail: 'Cellapp login has expired', next: 'Run cellapp login'} : {id: 'login', status: 'unknown', detail: `Cellapp login check returned ${auth.status}`});
    }
  } catch {
    checks.push({id: 'service', status: 'unknown', detail: 'Cellapp control service could not be reached', next: 'Check network, HTTPS certificate, and --origin'});
  }
  if (!token && !checks.some(check => check.id === 'login')) checks.push({id: 'login', status: 'action', detail: 'No Cellapp login found', next: 'Run cellapp login'});
  else if (token && !checks.some(check => check.id === 'login')) checks.push({id: 'login', status: 'unknown', detail: 'Cellapp login could not be verified while offline', next: 'Retry when online'});
  return {platform, nodeVersion: process.version, origin: options.origin, selectedAgent: preferred, agents, checks};
}

export function formatDoctorReport(report: DoctorReport): string {
  return [`Cellapp doctor · ${report.platform} · Node ${report.nodeVersion} · ${report.origin}`,
    ...report.checks.map(check => `${check.status.toUpperCase().padEnd(7)} ${check.id}: ${check.detail}${check.next ? `\n        Next: ${check.next}` : ''}`)].join('\n') + '\n';
}
