import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '../packages/cli/src/client.js';
import { deploy } from '../packages/cli/src/deploy.js';
import { runData } from '../packages/cli/src/data.js';
import { AppError } from '../packages/shared/src/errors.js';

interface Operation { method: string; path: string; successStatus: number; responseRequired?: string[]; responseType?: string; errors?: string[] }
const contract = JSON.parse(await readFile(new URL('../contracts/http-v3.json', import.meta.url), 'utf8')) as {operations: Operation[]};

test('v3 retains all 17 v2 operations with canonical paths and unchanged results', async () => {
  const previous = JSON.parse(await readFile(new URL('../contracts/http-v2.json', import.meta.url), 'utf8')) as {operations: Operation[]};
  assert.equal(contract.operations.length, 20);
  assert.equal(previous.operations.length, 17);
  for (const old of previous.operations) {
    const path = old.path === '/device-authorizations' ? '/auth/device'
      : old.path === '/device-authorizations/poll' ? '/auth/device/poll'
      : old.path === '/credentials/current' ? '/auth/credentials/current'
      : `/api/control/v1${old.path}`;
    const current = contract.operations.find(item => item.path === path && item.method === old.method);
    assert.ok(current, `missing compatible operation ${old.method} ${path}`);
    assert.equal(current.path, path);
    assert.equal(current.method, old.method);
    assert.equal(current.successStatus, old.successStatus);
    assert.deepEqual(current.responseRequired, old.responseRequired);
    assert.deepEqual(current.errors, old.errors);
  }
});

function operationFor(method: string, path: string) {
  return contract.operations.find(item => item.method === method && new RegExp(`^${item.path.replace(/\{[^}]+\}/g, '[^/]+')}$`).test(path));
}

test('public HTTP contract covers CLI login, deployment, management and retry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cellapp-contract-'));
  const fetchBefore = globalThis.fetch;
  const appId = 'a'.repeat(32);
  let app: {id: string; name: string; namespace: string; slug: string; aliasUrl: string; url: string; activeDeployment: string | null; suspended: boolean; visibility: string; dataState: string} | undefined;
  let deployment: {id: string; status: string; uploaded: string[]; manifest: {path: string}[]; baseVersion: string | null; spa: boolean; createdAt: string} | undefined;
  let deploymentNumber = 0;
  let provisioningFailed = false;
  let createdKey = '';
  const deploymentsByRequest = new Map<string, typeof deployment>();
  const seen = new Set<string>();
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const path = url.pathname;
    const operation = operationFor(method, path);
    assert.ok(operation, `missing public contract: ${method} ${path}`);
    seen.add(`${method} ${operation.path}`);
    const body = init?.body && method !== 'PUT' ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    let data: unknown;
    if (path === '/auth/device') data = {deviceSecret: 'secret', userCode: 'CODE', verificationUri: 'https://control.example/device', interval: 0, expiresIn: 10};
    else if (path === '/auth/device/poll') data = {token: 'credential', credentialId: 'c'.repeat(32), expiresIn: 100};
    else if (path === '/auth/credentials/current') data = {revoked: true};
    else if (path === '/api/control/v1/limits') data = {files: 10, fileBytes: 1000, deploymentBytes: 1000, monthlyVisitors: 1000};
    else if (path === '/api/control/v1/app-api/versions') data = {stable: '1.1', latest: '1.1', versions: [{version: '1.1', date: '261022', status: 'supported'}]};
    else if (path === '/api/control/v1/apps' && method === 'GET') data = app ? [app] : [];
    else if (path === '/api/control/v1/apps' && method === 'POST') {
      assert.equal(body.namespace, 'demo');
      assert.equal(body.slug, 'test');
      app = {id: appId, name: String(body.name), namespace: 'demo', slug: 'test', aliasUrl: 'https://control.example/a/demo/test', url: 'https://test-demo.apps.example', activeDeployment: null, suspended: false, visibility: 'restricted', dataState: 'ready'};
      createdKey = String(body.key);
      if (!provisioningFailed) {
        provisioningFailed = true;
        app.dataState = 'error';
        return new Response(JSON.stringify({error: 'app_data_not_ready', message: 'retry', details: {appId}}), {status: 503, headers: {'Content-Type': 'application/json'}});
      }
      data = app;
    } else if (path === `/api/control/v1/apps/${appId}/anonymous`) data = {pages: true, read: false, write: true, operatorWritesEnabled: false, effectiveWrite: false};
    else if (path === `/api/control/v1/apps/${appId}/data`) data = {state: 'ready', errorCode: null, version: 1, digest: 'f'.repeat(64)};
    else if (path === `/api/control/v1/apps/${appId}/data/reconcile`) { app!.dataState = 'ready'; data = {ready: true}; }
    else if (path === `/api/control/v1/apps/${appId}/data/verify`) data = {ready: true, version: 1, digest: 'f'.repeat(64)};
    else if (path === `/api/control/v1/apps/${appId}/data/plan` || path === `/api/control/v1/apps/${appId}/data/apply`) data = {version: 1, digest: 'f'.repeat(64), operations: ['create table notes'], requiresDestructive: false, alreadyApplied: false};
    else if (path === `/api/control/v1/apps/${appId}/key`) data = {reset: true};
    else if (path === `/api/control/v1/apps/${appId}`) { app = undefined; data = {deleted: true}; }
    else if (path === `/api/control/v1/apps/${appId}/deployments` && method === 'POST') {
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
    await assert.rejects(deploy(client, project, {output: 'dist', namespace: 'demo', slug: 'test'}, () => {}), error => error instanceof AppError && error.code === 'app_data_not_ready');
    const saved = JSON.parse(await readFile(join(project, 'cellapp.json'), 'utf8')) as {appId: string; createRequestId: string; apiVersion?: string};
    assert.equal(saved.appId, appId);
    assert.equal(saved.apiVersion, undefined);
    assert.ok(!(await readFile(join(project, 'cellapp.json'), 'utf8')).includes(createdKey));
    const keyPath = `${client.credentialFile}.create-${saved.createRequestId}`;
    assert.equal((await stat(keyPath)).mode & 0o777, 0o600);
    const first = await deploy(client, project, {}, () => {});
    assert.equal(first.status, 'published');
    assert.equal(first.apiVersion, '1.1');
    assert.equal(first.apiDate, '261022');
    assert.match(await readFile(join(project, 'dist', 'index.html'), 'utf8'), /cellapp-api-version" content="1\.1"/);
    assert.equal(first.aliasUrl, 'https://control.example/a/demo/test');
    assert.ok('accessKey' in first);
    assert.equal(first.accessKey, createdKey);
    await assert.rejects(stat(keyPath), {code: 'ENOENT'});
    assert.equal((await client.request<unknown[]>('/api/control/v1/apps')).length, 1);
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
    await assert.rejects(deploy(client, project, {apiVersion: '2.0'}, () => {}), error => error instanceof AppError && error.code === 'unsupported_api_version');
    await writeFile(join(project, 'dist', 'index.html'), '<h1>Explicit version</h1>');
    const fixed = await deploy(client, project, {apiVersion: '261022'}, () => {});
    assert.equal(fixed.apiVersion, '1.1');
    assert.equal(fixed.apiDate, '261022');
    assert.equal((JSON.parse(await readFile(join(project, 'cellapp.json'), 'utf8')) as {apiVersion: string}).apiVersion, '261022');
    assert.match(await readFile(join(project, 'dist', 'index.html'), 'utf8'), /cellapp-api-version" content="1\.1"/);
    await assert.rejects(deploy(client, project, {slug: 'changed'}, () => {}), /only when creating/);
    assert.equal(deploymentNumber, 3);
    await writeFile(join(project, 'cellapp.data.json'), JSON.stringify({version: 1, tables: [{name: 'notes', columns: [{name: 'id', type: 'uuid'}, {name: 'body', type: 'text'}], primaryKey: ['id'], policies: {select: 'all-admitted-users', insert: 'all-admitted-users'}}]}));
    const association = {appId, origin: client.origin, name: 'Test', output: 'dist', spa: false, createRequestId: 'b'.repeat(32)};
    assert.ok((await runData(client, 'plan', project, association)));
    assert.ok((await runData(client, 'apply', project, association)));
    assert.ok((await runData(client, 'status', project, association)));
    assert.ok((await runData(client, 'verify', project, association)));
    assert.deepEqual(await client.request(`/api/control/v1/apps/${appId}/key`, 'POST', {key: 'f'.repeat(64)}), {reset: true});
    assert.ok(await client.request(`/api/control/v1/apps/${appId}/anonymous`));
    assert.ok(await client.request(`/api/control/v1/apps/${appId}/anonymous`, 'PUT', {pages: true, read: false, write: true}));
    assert.deepEqual(await client.request(`/api/control/v1/apps/${appId}`, 'DELETE'), {deleted: true});
    await client.logout();
    assert.equal(client.token, undefined);
    assert.equal(seen.size, contract.operations.length);
    globalThis.fetch = async () => new Response(JSON.stringify({error: 'authorization_required', message: 'Run login', details: null}), {status: 401, headers: {'Content-Type': 'application/json'}});
    await assert.rejects(client.request('/api/control/v1/apps'), error => error instanceof AppError && error.status === 401 && error.code === 'authorization_required');
    const persisted = JSON.parse(await readFile(join(project, 'cellapp.json'), 'utf8'));
    assert.equal(persisted.appId, appId);
    assert.equal(persisted.pending, undefined);
  } finally {
    globalThis.fetch = fetchBefore;
    await rm(root, {recursive: true, force: true});
  }
});
