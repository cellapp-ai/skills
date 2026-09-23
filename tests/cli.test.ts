import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, symlink, rm, stat, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build, collect } from '../packages/cli/src/deploy.js';
import { Client, saveJSON } from '../packages/cli/src/client.js';
import { readProject } from '../packages/cli/src/project.js';

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
