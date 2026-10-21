#!/usr/bin/env node
import { CONTROL_API, controlApp } from './paths.js';
import { parseArgs } from 'node:util';
import { resolve, join } from 'node:path';
import { Client, randomKey, requestID, readJSON, saveJSON } from './client.js';
import { deploy, type Project } from './deploy.js';
import { AppError } from '../../shared/src/errors.js';
import { readProject } from './project.js';
import { selectOrigin } from './origin.js';
import { runData } from './data.js';
import { checkForUpdates } from './update.js';

const {values, positionals} = parseArgs({allowPositionals: true, options: {
  origin: {type: 'string'}, project: {type: 'string', default: '.'}, output: {type: 'string'},
  build: {type: 'string'}, name: {type: 'string'}, namespace: {type: 'string'}, slug: {type: 'string'}, spa: {type: 'boolean'}, help: {type: 'boolean'},
  'config-dir': {type: 'string'},
  manifest: {type: 'string'}, 'allow-destructive': {type: 'boolean'},
  pages: {type: 'string'}, read: {type: 'string'}, write: {type: 'string'},
}});
const [command, appId, dataAppId] = positionals;
const notify = (s: string) => process.stderr.write(s + '\n');
try {
  await checkForUpdates(values['config-dir'], notify);
  if (values.help || !command) {
    process.stdout.write('cellapp <login|logout|deploy|apps|link|reset-key|delete|data|anonymous> [app-id] [--origin https://cellapp.ai]\nDeploy: --project . --output dist [--build "npm run build"] [--namespace user-slug] [--slug app-slug] [--spa]\nLink: link <app-id> --project . --output dist\nData: data <plan|apply|status|verify|reconcile> [app-id] --project . [--manifest cellapp.data.json] [--allow-destructive]\nAnonymous: anonymous <get|set> <app-id> [--pages true|false --read true|false --write true|false]\nDefault origin: https://cellapp.ai\n');
  } else {
    const projectPath = resolve(values.project);
    const newProject = await readJSON<Project>(join(projectPath, 'cellapp.json'));
    const legacyProject = await readJSON<Project>(join(projectPath, 'ohmyapp.json'));
    const origin = selectOrigin(values.origin, newProject, legacyProject, process.env);
    const project = await readProject(projectPath, origin);
    if (project && project.origin !== origin && (command === 'deploy' || command === 'link' || command === 'data')) {
      throw new Error('Project belongs to another control origin; check --origin and CELLAPP_ORIGIN');
    }
    const client = new Client(origin, values['config-dir']);
    await client.load();
    if (command === 'login') { await client.login(notify); process.stdout.write('{"authorized":true}\n'); }
    else if (command === 'logout') { await client.logout(); process.stdout.write('{"loggedOut":true}\n'); }
    else {
      if (!client.token) await client.login(notify);
      let result: unknown;
      if (command === 'deploy') result = await deploy(client, projectPath, values, notify);
      else if (command === 'apps') result = await client.request(`${CONTROL_API}/apps`);
      else if (command === 'data') result = await runData(client, appId, projectPath, project, dataAppId, values.manifest, values['allow-destructive']);
      else if (command === 'anonymous') {
        if (!dataAppId || !/^[a-f0-9]{32}$/.test(dataAppId)) throw new Error('A valid app ID is required');
        const path = `${controlApp(dataAppId)}/anonymous`;
        if (appId === 'get') result = await client.request(path);
        else if (appId === 'set') {
          const flag = (value: string | undefined, name: string): boolean => {
            if (value !== 'true' && value !== 'false') throw new Error(`--${name} must be true or false`);
            return value === 'true';
          };
          result = await client.request(path, 'PUT', {pages: flag(values.pages, 'pages'), read: flag(values.read, 'read'), write: flag(values.write, 'write')});
        } else throw new Error('Use anonymous get or set');
      }
      else {
        if (!appId || !/^[a-f0-9]{32}$/.test(appId)) throw new Error('A valid app ID is required');
        if (command === 'reset-key') { const key = randomKey(); await client.request(`${controlApp(appId)}/key`, 'POST', {key}); result = {accessKey: key}; }
        else if (command === 'delete') result = await client.request(controlApp(appId), 'DELETE');
        else if (command === 'link') {
          if (project && project.origin !== client.origin) throw new Error('Project belongs to another control origin');
          const apps = await client.request<{id: string; name: string; namespace: string; slug: string}[]>(`${CONTROL_API}/apps`);
          const app = apps.find(a => a.id === appId);
          if (!app) throw new Error('Application not owned by this credential');
          if (project?.appId && project.appId !== appId) throw new Error('Project is already linked to another application');
          const output = values.output ?? project?.output;
          if (!output) throw new Error('Specify --output to link a new project');
          const linked: Project = {...project, origin: client.origin, appId, name: project?.name ?? app.name, namespace: app.namespace, slug: app.slug, output, spa: project?.spa ?? false, createRequestId: project?.createRequestId ?? requestID()};
          delete linked.pending;
          await saveJSON(join(projectPath, 'cellapp.json'), linked); result = {linked: appId};
        } else throw new Error('Unknown command; use --help');
      }
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    }
  }
} catch (e) {
  process.stderr.write(JSON.stringify(e instanceof AppError ? {error: e.code, message: e.message, details: e.details} : {error: 'cli_error', message: (e as Error).message}) + '\n');
  process.exitCode = 1;
}
