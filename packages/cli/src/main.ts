#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { resolve, join } from 'node:path';
import { Client, randomKey, readJSON, saveJSON } from './client.js';
import { deploy, type Project } from './deploy.js';
import { AppError } from '../../shared/src/errors.js';
import { readProject } from './project.js';
import { selectOrigin } from './origin.js';

const {values, positionals} = parseArgs({allowPositionals: true, options: {
  origin: {type: 'string'}, project: {type: 'string', default: '.'}, output: {type: 'string'},
  build: {type: 'string'}, name: {type: 'string'}, spa: {type: 'boolean'}, help: {type: 'boolean'},
  'config-dir': {type: 'string'},
}});
const [command, appId] = positionals;
const notify = (s: string) => process.stderr.write(s + '\n');
try {
  if (values.help || !command) {
    process.stdout.write('cellapp <login|logout|deploy|apps|link|reset-key|delete> [app-id] --origin https://control.example\nDeploy: --project . --output dist [--build "npm run build"] [--spa]\n');
  } else {
    const projectPath = resolve(values.project);
    const newProject = await readJSON<Project>(join(projectPath, 'cellapp.json'));
    const legacyProject = await readJSON<Project>(join(projectPath, 'ohmyapp.json'));
    const origin = selectOrigin(values.origin, newProject, legacyProject, process.env);
    if (!origin) throw new Error('Specify --origin or CELLAPP_ORIGIN');
    const project = await readProject(projectPath);
    const client = new Client(origin, values['config-dir']);
    await client.load();
    if (command === 'login') { await client.login(notify); process.stdout.write('{"authorized":true}\n'); }
    else if (command === 'logout') { await client.logout(); process.stdout.write('{"loggedOut":true}\n'); }
    else {
      if (!client.token) await client.login(notify);
      let result: unknown;
      if (command === 'deploy') result = await deploy(client, projectPath, values, notify);
      else if (command === 'apps') result = await client.request('/apps');
      else {
        if (!appId || !/^[a-f0-9]{32}$/.test(appId)) throw new Error('A valid app ID is required');
        if (command === 'reset-key') { const key = randomKey(); await client.request(`/apps/${appId}/key`, 'POST', {key}); result = {shareKey: key}; }
        else if (command === 'delete') result = await client.request(`/apps/${appId}`, 'DELETE');
        else if (command === 'link') {
          const apps = await client.request<{id: string}[]>('/apps');
          if (!apps.some(a => a.id === appId)) throw new Error('Application not owned by this credential');
          if (!project) throw new Error('Create project metadata with a deployment before linking');
          project.appId = appId; delete project.pending; await saveJSON(join(projectPath, 'cellapp.json'), project); result = {linked: appId};
        } else throw new Error('Unknown command; use --help');
      }
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    }
  }
} catch (e) {
  process.stderr.write(JSON.stringify(e instanceof AppError ? {error: e.code, message: e.message, details: e.details} : {error: 'cli_error', message: (e as Error).message}) + '\n');
  process.exitCode = 1;
}
