import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, symlink, rm, stat, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build, collect, deploy } from '../packages/cli/src/deploy.js';
import { Client, saveJSON } from '../packages/cli/src/client.js';
import { readProject } from '../packages/cli/src/project.js';
import { DEFAULT_ORIGIN, RETIRED_ORIGIN } from '../packages/cli/src/origin.js';

test('collector uploads only output and rejects secrets and symlinks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cellapp-cli-'));
  try {
    const output = join(root, 'dist'); await mkdir(output);
    await writeFile(join(root, '.env'), 'SECRET=outside-output');
    await writeFile(join(output, 'index.html'), '<h1>Hello</h1>');
    const limits = {files: 10, fileBytes: 1000, deploymentBytes: 1000};
    assert.deepEqual((await collect(output, limits)).map(f => f.path), ['index.html']);
    await symlink(join(root, '.env'), join(output, 'secret.txt'));
    await assert.rejects(collect(output, limits), /Symlink/);
    await rm(join(output, 'secret.txt'));
    await writeFile(join(output, '.env'), 'SECRET=bad');
    await assert.rejects(collect(output, limits), /sensitive/);
    await assert.rejects(build('exit 3', root), /Build exited/);
  } finally { await rm(root, {recursive: true, force: true}); }
});
test('credential files are private and origins cannot redirect bearer tokens', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cellapp-auth-'));
  try {
    const a = new Client('https://control.example', root);
    const b = new Client('https://other.example', root);
    assert.notEqual(a.credentialFile, b.credentialFile);
    await saveJSON(a.credentialFile, {token: 'secret'}, true);
    assert.equal((await stat(a.credentialFile)).mode & 0o777, 0o600);
    await a.load(); assert.equal(a.token, 'secret');
    assert.equal(JSON.parse(await readFile(a.credentialFile, 'utf8')).token, 'secret');
    assert.throws(() => new Client('http://insecure.example'), /HTTPS/);
    assert.throws(() => new Client('https://control.example/path'), /HTTPS/);
  } finally { await rm(root, {recursive: true, force: true}); }
});

test('expired owner credentials fail closed and can be revoked locally', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cellapp-expired-'));
  const originalFetch = globalThis.fetch;
  try {
    const client = new Client(DEFAULT_ORIGIN, root);
    await saveJSON(client.credentialFile, {token: 'expired-token', origin: DEFAULT_ORIGIN}, true);
    await client.load();
    globalThis.fetch = async () => Response.json({error: 'authorization_required', message: 'Credential expired'}, {status: 401});
    await assert.rejects(client.request('/api/control/v1/apps'), /Credential expired/);
    await client.logout();
    await assert.rejects(readFile(client.credentialFile), {code: 'ENOENT'});
  } finally { globalThis.fetch = originalFetch; await rm(root, {recursive: true, force: true}); }
});

test('local build succeeds, while backend-only output is rejected', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cellapp-build-'));
  try {
    await mkdir(join(root, 'dist'));
    await writeFile(join(root, 'build.cjs'), 'require("fs").writeFileSync("dist/index.html", "<h1>Built</h1>")');
    await build('node build.cjs', root);
    assert.equal((await collect(join(root, 'dist'), {files: 2, fileBytes: 1000, deploymentBytes: 1000})).length, 1);
    await rm(join(root, 'dist', 'index.html'));
    await writeFile(join(root, 'dist', 'server.js'), 'listen()');
    await assert.rejects(collect(join(root, 'dist'), {files: 2, fileBytes: 1000, deploymentBytes: 1000}), /static index.html/);
  } finally { await rm(root, {recursive: true, force: true}); }
});

test('legacy project association migrates without destroying the old file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cellapp-project-'));
  try {
    const old = {origin: 'https://control.example', appId: 'a'.repeat(32), name: 'Existing', output: 'dist', spa: false, createRequestId: 'b'.repeat(32), pending: {requestId: 'c'.repeat(32), fingerprint: 'e'.repeat(64), baseVersion: null}};
    await saveJSON(join(root, 'ohmyapp.json'), old);
    assert.deepEqual(await readProject(root), old);
    assert.deepEqual(JSON.parse(await readFile(join(root, 'cellapp.json'), 'utf8')), old);
    const {pending: _pending, ...updated} = old;
    await saveJSON(join(root, 'cellapp.json'), updated);
    assert.deepEqual(await readProject(root), updated);
    await saveJSON(join(root, 'cellapp.json'), {...updated, appId: 'd'.repeat(32)});
    await assert.rejects(readProject(root), /conflicts/);
    assert.deepEqual(JSON.parse(await readFile(join(root, 'ohmyapp.json'), 'utf8')), old);
  } finally { await rm(root, {recursive: true, force: true}); }
});

test('official project migration preserves pending identity and isolates old credentials', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cellapp-official-origin-'));
  try {
    const association = {origin: RETIRED_ORIGIN, appId: 'a'.repeat(32), name: 'Existing', output: 'dist', spa: false,
      createRequestId: 'b'.repeat(32), pending: {requestId: 'c'.repeat(32), fingerprint: 'e'.repeat(64), baseVersion: null}};
    await saveJSON(join(root, 'cellapp.json'), association);
    await writeFile(join(root, 'cellapp.json.interrupted.tmp'), '{"origin":"broken"');
    const oldClient = new Client(RETIRED_ORIGIN, root);
    const newClient = new Client(DEFAULT_ORIGIN, root);
    await saveJSON(oldClient.credentialFile, {token: 'old-token'}, true);
    await newClient.load();
    assert.equal(newClient.token, undefined);
    assert.notEqual(newClient.credentialFile, oldClient.credentialFile);
    const migrated = await readProject(root);
    assert.deepEqual(migrated, {...association, origin: DEFAULT_ORIGIN});
    assert.deepEqual(await readProject(root), migrated);
    assert.equal((await readFile(join(root, 'cellapp.json.interrupted.tmp'), 'utf8')).includes('broken'), true);
    assert.equal(JSON.parse(await readFile(oldClient.credentialFile, 'utf8')).token, 'old-token');
  } finally { await rm(root, {recursive: true, force: true}); }
});

test('official migration detects association conflicts before writing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cellapp-official-conflict-'));
  try {
    const current = {origin: RETIRED_ORIGIN, appId: 'a'.repeat(32), name: 'One', output: 'dist', spa: false, createRequestId: 'b'.repeat(32)};
    const legacy = {...current, appId: 'd'.repeat(32)};
    await saveJSON(join(root, 'cellapp.json'), current);
    await saveJSON(join(root, 'ohmyapp.json'), legacy);
    await assert.rejects(readProject(root), /conflicts/);
    assert.deepEqual(JSON.parse(await readFile(join(root, 'cellapp.json'), 'utf8')), current);
    await rm(join(root, 'ohmyapp.json'));
    assert.deepEqual(await readProject(root, 'https://custom.example'), current);
    assert.deepEqual(JSON.parse(await readFile(join(root, 'cellapp.json'), 'utf8')), current);
  } finally { await rm(root, {recursive: true, force: true}); }
});

test('new-origin credential is shared across projects but cannot replace an app owned by another account', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cellapp-owner-scope-'));
  try {
    const first = new Client(DEFAULT_ORIGIN, root);
    await saveJSON(first.credentialFile, {token: 'new-owner-token', origin: DEFAULT_ORIGIN}, true);
    const second = new Client(DEFAULT_ORIGIN, root);
    await second.load();
    assert.equal(second.token, 'new-owner-token');
    const project = join(root, 'project');
    const otherProject = join(root, 'other-project');
    await mkdir(otherProject);
    await saveJSON(join(otherProject, 'cellapp.json'), {origin: DEFAULT_ORIGIN, appId: 'd'.repeat(32), name: 'Other', output: 'dist', spa: false, createRequestId: 'e'.repeat(32)});
    const otherProjectClient = new Client(DEFAULT_ORIGIN, root);
    await otherProjectClient.load();
    assert.equal((await readProject(otherProject))?.appId, 'd'.repeat(32));
    assert.equal(otherProjectClient.token, second.token);
    await mkdir(join(project, 'dist'), {recursive: true});
    await writeFile(join(project, 'dist', 'index.html'), '<h1>Existing</h1>');
    const association = {origin: RETIRED_ORIGIN, appId: 'a'.repeat(32), name: 'Existing', output: 'dist', spa: false, createRequestId: 'b'.repeat(32)};
    await saveJSON(join(project, 'cellapp.json'), association);
    let created = false;
    second.request = async (path: string, method = 'GET') => {
      if (path === '/api/control/v1/limits') return {files: 10, fileBytes: 1000, deploymentBytes: 1000} as never;
      if (path === '/api/control/v1/apps' && method === 'GET') return [] as never;
      if (path === '/api/control/v1/apps' && method === 'POST') created = true;
      throw new Error('unexpected request');
    };
    await assert.rejects(deploy(second, project, {}, () => {}), /deleted or belongs to another owner/);
    assert.equal(created, false);
    assert.equal(JSON.parse(await readFile(join(project, 'cellapp.json'), 'utf8')).appId, association.appId);
  } finally { await rm(root, {recursive: true, force: true}); }
});

test('legacy credential migrates with private permissions and remains recoverable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cellapp-credential-'));
  try {
    const current = join(root, 'current');
    const legacy = join(root, 'legacy');
    const client = new Client('https://control.example', current, legacy);
    const legacyFile = client.legacyCredentialFile!;
    await saveJSON(legacyFile, {token: 'existing-token', origin: client.origin}, true);
    await client.load();
    assert.equal(client.token, 'existing-token');
    assert.equal((await stat(client.credentialFile)).mode & 0o777, 0o600);
    assert.equal(JSON.parse(await readFile(legacyFile, 'utf8')).token, 'existing-token');
    const conflicting = new Client('https://control.example', current, legacy);
    await saveJSON(conflicting.credentialFile, {token: 'different-token'}, true);
    await conflicting.load();
    assert.equal(conflicting.token, 'different-token');
    conflicting.request = async () => ({revoked: true}) as never;
    await conflicting.logout();
    await assert.rejects(readFile(legacyFile));
    await assert.rejects(readFile(conflicting.credentialFile));
  } finally { await rm(root, {recursive: true, force: true}); }
});
