import { lstat, readdir, readFile, realpath, unlink } from 'node:fs/promises';
import { resolve, relative, join, isAbsolute } from 'node:path';
import { spawn } from 'node:child_process';
import { manifest, sha256, validPath, type Entry, type Limits } from '../../shared/src/artifacts.js';
import { AppError, ensure } from '../../shared/src/errors.js';
import { Client, randomKey, requestID, saveJSON, readJSON } from './client.js';
import { readProject } from './project.js';

export interface Project {
  origin: string; appId?: string; name: string; namespace?: string; slug?: string; output: string; build?: string; spa: boolean;
  createRequestId: string;
  pending?: {requestId: string; fingerprint: string; baseVersion: string | null};
}
interface App {id: string; url: string; namespace: string; slug: string; aliasUrl: string; activeDeployment: string | null; dataState: string}
export async function build(command: string | undefined, project: string) {
  if (!command) return;
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, {cwd: project, shell: true, stdio: ['inherit', 'inherit', 'inherit']});
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new AppError(400, 'build_failed', `Build exited with code ${code}; nothing was uploaded`)));
  });
}
export async function collect(output: string, limits: Limits): Promise<Entry[]> {
  ensure(!(await lstat(output)).isSymbolicLink(), 400, 'symlink', 'Output directory cannot be a symlink');
  const root = await realpath(output);
  const files: Entry[] = [];
  async function visit(directory: string) {
    for (const name of await readdir(directory)) {
      const path = join(directory, name);
      const rel = relative(root, path).split('\\').join('/');
      validPath(rel);
      const stat = await lstat(path);
      ensure(!stat.isSymbolicLink(), 400, 'symlink', `Symlink not allowed: ${rel}`);
      if (stat.isDirectory()) await visit(path);
      else {
        ensure(stat.isFile(), 400, 'invalid_file', `Only regular files are supported: ${rel}`);
        ensure(stat.size <= limits.fileBytes, 413, 'file_limit', `File too large: ${rel}`);
        ensure(files.length < limits.files, 413, 'file_limit', 'Too many files');
        files.push({path: rel, size: stat.size, sha256: sha256(await readFile(path))});
      }
    }
  }
  await visit(root);
  return manifest(files, limits);
}
export async function deploy(client: Client, directory: string, options: {output?: string; build?: string; name?: string; namespace?: string; slug?: string; spa?: boolean}, notify: (s: string) => void) {
  const projectPath = resolve(directory);
  const configPath = join(projectPath, 'cellapp.json');
  let project = await readProject(projectPath, client.origin);
  if (project && project.origin !== client.origin) throw new Error('Project belongs to another control origin');
  if (project?.appId && (options.namespace !== undefined || options.slug !== undefined)) {
    throw new Error('CLI slugs are set only when creating an application; change existing slugs in the owner console');
  }
  const output = options.output ?? project?.output;
  ensure(output, 400, 'output_required', 'Specify --output with the static build directory');
  const outPath = resolve(projectPath, output);
  const rel = relative(projectPath, outPath);
  ensure(!isAbsolute(rel) && !rel.startsWith('..'), 400, 'invalid_output', 'Output must be inside the project');
  const command = options.build ?? project?.build;
  await build(command, projectPath);
  const actualOutput = await realpath(outPath);
  const actualProject = await realpath(projectPath);
  const actualRelative = relative(actualProject, actualOutput);
  ensure(!isAbsolute(actualRelative) && actualRelative !== '..' && !actualRelative.startsWith('../'), 400, 'invalid_output', 'Output resolves outside the project');
  const limits = await client.request<Limits>('/limits');
  const files = await collect(outPath, limits);
  project = {...project, origin: client.origin, name: options.name ?? project?.name ?? 'My app', namespace: options.namespace ?? project?.namespace, slug: options.slug ?? project?.slug, output, build: command, spa: options.spa ?? project?.spa ?? false, createRequestId: project?.createRequestId ?? requestID()};
  const keyPath = `${client.credentialFile}.create-${project.createRequestId}`;
  let initialKey = (await readJSON<{key: string}>(keyPath))?.key;
  if (initialKey) ensure(/^[a-f0-9]{64}$/.test(initialKey), 400, 'invalid_state', 'Pending application key is invalid');
  if (!project.appId) {
    initialKey ??= randomKey();
    await saveJSON(keyPath, {key: initialKey}, true);
    await saveJSON(configPath, project);
    const body = {name: project.name, key: initialKey, requestId: project.createRequestId,
      ...(project.namespace ? {namespace: project.namespace} : {}), ...(project.slug ? {slug: project.slug} : {})};
    const create = () => client.request<App>('/apps', 'POST', body);
    let app: App;
    try { app = await create(); } catch (e) {
      if (e instanceof AppError) {
        if (e.code === 'app_data_not_ready' && typeof e.details?.appId === 'string' && /^[a-f0-9]{32}$/.test(e.details.appId)) {
          project.appId = e.details.appId;
          await saveJSON(configPath, project);
        }
        throw e;
      }
      app = await create();
    }
    project.appId = app.id;
    await saveJSON(configPath, project);
  }
  const apps = await client.request<App[]>('/apps');
  const app = apps.find(a => a.id === project!.appId);
  ensure(app, 404, 'app_not_found', 'Linked app was deleted or belongs to another owner');
  if (app.dataState !== 'ready') await client.request(`/apps/${app.id}/data/reconcile`, 'POST', {});
  const fingerprint = sha256(JSON.stringify({files, spa: project.spa}));
  if (project.pending && project.pending.fingerprint !== fingerprint) project.pending = undefined;
  project.pending ??= {requestId: requestID(), fingerprint, baseVersion: app.activeDeployment};
  await saveJSON(configPath, project);
  const base = `/apps/${app.id}/deployments`;
  const d = await client.request<{id: string}>(base, 'POST', {manifest: files, requestId: project.pending.requestId, baseVersion: project.pending.baseVersion, spa: project.spa});
  const status = await client.request<{status: string; uploaded: string[]}>(`${base}/${d.id}`);
  if (status.status !== 'published') {
    for (const [index, file] of files.entries()) {
      if (status.uploaded.includes(file.path)) continue;
      const path = join(outPath, file.path);
      ensure(!(await lstat(path)).isSymbolicLink(), 400, 'symlink', 'Artifact changed during deployment');
      const data = await readFile(path);
      ensure(sha256(data) === file.sha256, 400, 'artifact_changed', 'Artifact changed during deployment; rebuild and retry');
      await client.request(`${base}/${d.id}/files/${index}`, 'PUT', data, true);
    }
  }
  const result = await client.request<{url: string; id: string; status: string}>(`${base}/${d.id}/publish`, 'POST', {});
  delete project.pending;
  await saveJSON(configPath, project);
  if (initialKey) await unlink(keyPath);
  notify('静态应用已发布。');
  return {...result, namespace: app.namespace, slug: app.slug, aliasUrl: app.aliasUrl,
    ...(initialKey ? {accessKey: initialKey} : {keyUnchanged: true})};
}
