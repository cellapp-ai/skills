import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkForUpdates, isNewerVersion } from '../packages/cli/src/update.js';
import { CLI_VERSION } from '../packages/cli/src/version.js';

const execFileAsync = promisify(execFile);

test('package versions match the CLI version', async () => {
  for (const path of ['package.json', 'packages/cli/package.json', 'packages/shared/package.json']) {
    const value = JSON.parse(await readFile(join(process.cwd(), path), 'utf8')) as {version: string};
    assert.equal(value.version, CLI_VERSION, path);
  }
  const lock = JSON.parse(await readFile(join(process.cwd(), 'package-lock.json'), 'utf8')) as {
    version: string; packages: Record<string, {version?: string}>;
  };
  assert.equal(lock.version, CLI_VERSION);
  for (const path of ['', 'packages/cli', 'packages/shared']) assert.equal(lock.packages[path]?.version, CLI_VERSION, path);
});

test('stable versions compare numerically', () => {
  assert.equal(isNewerVersion('0.2.10', '0.2.1'), true);
  assert.equal(isNewerVersion('1.0.0', '0.2.1'), true);
  for (const latest of ['0.2.1', '0.2.0', '0.3.0-beta.1', 'invalid', {}, '999999999999999999.0.0']) {
    assert.equal(isNewerVersion(latest, CLI_VERSION), false);
  }
});

test('first invocation each local day checks npm once without credentials', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cellapp-update-'));
  const notices: string[] = [];
  const requests: Array<{url: string; init: RequestInit}> = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    requests.push({url, init});
    return Response.json({version: '0.3.3'});
  }) as typeof fetch;
  try {
    const day = new Date(2026, 9, 14, 10);
    await checkForUpdates(root, notice => notices.push(notice), day, fetcher);
    await checkForUpdates(root, notice => notices.push(notice), day, fetcher);
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.url, 'https://registry.npmjs.org/@cellapp%2Fcli/latest');
    assert.deepEqual(requests[0]?.init.headers, {Accept: 'application/json'});
    assert.equal(requests[0]?.init.redirect, 'error');
    assert.equal(notices.length, 1);
    assert.match(notices[0]!, /npm install -g @cellapp\/cli@latest/);
    assert.equal((await stat(join(root, 'update-check.json'))).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(await readFile(join(root, 'update-check.json'), 'utf8')), {date: '2026-10-14'});
    await checkForUpdates(root, notice => notices.push(notice), new Date(2026, 9, 15, 1), fetcher);
    assert.equal(requests.length, 2);
  } finally { await rm(root, {recursive: true, force: true}); }
});

test('equal, malformed and failed lookups do not interrupt CLI use', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cellapp-update-'));
  const notices: string[] = [];
  try {
    await checkForUpdates(root, notice => notices.push(notice), new Date(2026, 9, 14), (async () => Response.json({version: CLI_VERSION})) as typeof fetch);
    await checkForUpdates(root, notice => notices.push(notice), new Date(2026, 9, 15), (async () => Response.json({version: 'bad'})) as typeof fetch);
    await checkForUpdates(root, notice => notices.push(notice), new Date(2026, 9, 16), (async () => { throw new Error('offline'); }) as typeof fetch);
    assert.equal(notices.length, 0);
    await checkForUpdates(root, notice => notices.push(notice), new Date(), (async () => Response.json({version: CLI_VERSION})) as typeof fetch);
    const {stdout, stderr} = await execFileAsync(process.execPath, [
      '--import', 'tsx', 'packages/cli/src/main.ts', '--help', '--config-dir', root,
    ], {cwd: process.cwd()});
    assert.match(stdout, /^cellapp <login\|logout\|deploy/);
    assert.equal(stderr, '');
  } finally { await rm(root, {recursive: true, force: true}); }
});
