import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '../packages/cli/src/client.js';
import { deploy } from '../packages/cli/src/deploy.js';
import { AppError } from '../packages/shared/src/errors.js';

interface Operation { method: string; path: string; successStatus: number; responseRequired?: string[]; responseType?: string }
const contract = JSON.parse(await readFile(new URL('../contracts/http-v1.json', import.meta.url), 'utf8')) as {operations: Operation[]};

function operationFor(method: string, path: string) {
  return contract.operations.find(item => item.method === method && new RegExp(`^${item.path.replace(/\{[^}]+\}/g, '[^/]+')}$`).test(path));
}

test('public HTTP contract covers CLI login, deployment, management and retry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cellapp-contract-'));
  const fetchBefore = globalThis.fetch;
  const appId = 'a'.repeat(32);
  let app: {id: string; name: string; url: string; activeDeployment: string | null; suspended: boolean} | undefined;
  let deployment: {id: string; status: string; uploaded: string[]; manifest: {path: string}[]; baseVersion: string | null; spa: boolean; createdAt: string} | undefined;
  let deploymentNumber = 0;
  const deploymentsByRequest = new Map<string, typeof deployment>();
  const seen = new Set<string>();
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const path = url.pathname;
    const operation = operationFor(method, path);
    assert.ok(operation, `missing public contract: ${method} ${path}`);
    seen.add(`${method} ${operation.path}`);
    const isFileUpload = method === 'PUT' && /\/files\/\d+$/.test(path);
    const body = init?.body && !isFileUpload ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    let data: unknown;
    if (path === '/device-authorizations') data = {deviceSecret: 'secret', userCode: 'CODE', verificationUri: 'https://control.example/device', interval: 0, expiresIn: 10};
    else if (path === '/device-authorizations/poll') data = {token: 'credential', credentialId: 'c'.repeat(32), expiresIn: 100};
    else if (path === '/credentials/current') data = {revoked: true};
    else if (path === '/limits') data = {files: 10, fileBytes: 1000, deploymentBytes: 1000};
    else if (path === '/apps' && method === 'GET') data = app ? [app] : [];
    else if (path === '/apps' && method === 'POST') {
      app = {id: appId, name: String(body.name), url: `https://${appId}.apps.example`, activeDeployment: null, suspended: false};
      data = app;
    }     else if (path === `/apps/${appId}/key`) data = {reset: true};
    else if (path === `/apps/${appId}/data` && method === 'PUT') data = {provider: 'supabase', url: String(body.url), anonKey: String(body.anonKey), dataset: 'shared'};
    else if (path === `/apps/${appId}/data` && method === 'DELETE') data = {cleared: true};
    else if (path === `/apps/${appId}/data`) data = {provider: 'supabase', url: 'https://demo.supabase.co', anonKey: 'anon', dataset: 'shared'};
    else if (path === `/apps/${appId}`) { app = undefined; data = {deleted: true}; }
    else if (path === `/apps/${appId}/deployments` && method === 'POST') {
      const requestId = String(body.requestId);
      deployment = deploymentsByRequest.get(requestId);
      if (!deployment) {
        deployment = {id: String(++deploymentNumber).padStart(32, 'd'), status: 'uploading', uploaded: [], manifest: body.manifest as {path: string}[], baseVersion: body.baseVersion as string | null, spa: Boolean(body.spa), createdAt: new Date().toISOString()};
        deploymentsByRequest.set(requestId, deployment);
      }
      data = {id: deployment.id};
    } else if (path.endsWith('/publish')) {
      assert.ok(deployment && app);
      assert.equal(deployment.uploaded.length, deployment.manifest.length);
      deployment.status = 'published';
      app.activeDeployment = deployment.id;
      data = {id: deployment.id, url: app.url, status: 'published'};
    } else if (method === 'PUT') {
      assert.ok(deployment);
      const index = Number(path.split('/').at(-1));
      deployment.uploaded.push(deployment.manifest[index]!.path);
      data = {uploaded: true};
    } else data = deployment;
    assert.ok(data !== undefined);
    if (operation.responseType === 'array') assert.ok(Array.isArray(data));
    for (const key of operation.responseRequired ?? []) assert.ok(Object.hasOwn(data as object, key), `${method} ${path} missing ${key}`);
    return new Response(JSON.stringify(data), {status: operation.successStatus, headers: {'Content-Type': 'application/json'}});
  };
  try {
    const client = new Client('https://control.example', join(root, 'credentials'));
    await client.login(() => {});
    assert.equal(client.token, 'credential');
    const project = join(root, 'project');
    await mkdir(join(project, 'dist'), {recursive: true});
    await writeFile(join(project, 'dist', 'index.html'), '<h1>First</h1>');
    const first = await deploy(client, project, {output: 'dist'}, () => {});
    assert.equal(first.status, 'published');
    assert.ok('shareKey' in first);
    assert.equal((await client.request<unknown[]>('/apps')).length, 1);
    await writeFile(join(project, 'dist', 'index.html'), '<h1>Updated</h1>');
    const original = client.request.bind(client);
    let interrupted = false;
    client.request = async function<T>(path: string, method?: string, body?: unknown, binary?: boolean): Promise<T> {
      const value = await original<T>(path, method, body, binary);
      if (!interrupted && path.endsWith('/publish')) { interrupted = true; throw new Error('response lost'); }
      return value;
    };
    await assert.rejects(deploy(client, project, {}, () => {}), /response lost/);
    client.request = original;
    const retry = await deploy(client, project, {}, () => {});
    assert.equal(retry.status, 'published');
    assert.equal(retry.url, first.url);
    assert.equal(deploymentNumber, 2);
    assert.deepEqual(await client.request(`/apps/${appId}/data`, 'PUT', {provider: 'supabase', url: 'https://demo.supabase.co', anonKey: 'anon'}), {provider: 'supabase', url: 'https://demo.supabase.co', anonKey: 'anon', dataset: 'shared'});
    assert.equal((await client.request<{dataset: string}>(`/apps/${appId}/data`)).dataset, 'shared');
    assert.deepEqual(await client.request(`/apps/${appId}/data`, 'DELETE'), {cleared: true});
    assert.deepEqual(await client.request(`/apps/${appId}/key`, 'POST', {key: 'f'.repeat(64)}), {reset: true});
    assert.deepEqual(await client.request(`/apps/${appId}`, 'DELETE'), {deleted: true});
    await client.logout();
    assert.equal(client.token, undefined);
    assert.equal(seen.size, contract.operations.length);
    globalThis.fetch = async () => new Response(JSON.stringify({error: 'authorization_required', message: 'Run login', details: null}), {status: 401, headers: {'Content-Type': 'application/json'}});
    await assert.rejects(client.request('/apps'), error => error instanceof AppError && error.status === 401 && error.code === 'authorization_required');
    const persisted = JSON.parse(await readFile(join(project, 'cellapp.json'), 'utf8'));
    assert.equal(persisted.appId, appId);
    assert.equal(persisted.pending, undefined);
  } finally {
    globalThis.fetch = fetchBefore;
    await rm(root, {recursive: true, force: true});
  }
});
