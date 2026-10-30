import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {diagnoseCellapp} from '../packages/cli/src/doctor.js';
import {agentSelectionFile, selectedAgent, setSelectedAgent} from '../packages/cli/src/agent-selection.js';

test('doctor keeps local results when offline and only inspects an explicit project', {skip: process.platform === 'win32'}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'cellapp-setup-'));
  const project = join(root, 'project');
  try {
    await mkdir(project);
    await writeFile(join(root, 'npm'), '#!/bin/sh\nexit 0\n', {mode: 0o755});
    await writeFile(join(project, 'package.json'), '{"scripts":{"build":"echo ready"}}');
    await writeFile(join(project, 'index.html'), '<h1>ready</h1>');
    const offline = async () => { throw new Error('offline'); };
    const base = {origin: 'https://cellapp.example', configDirectory: root, path: root, home: root, fetchImpl: offline as typeof fetch};
    const unscoped = await diagnoseCellapp(base);
    assert(!unscoped.checks.some(check => check.id === 'project'));
    assert.equal(unscoped.checks.find(check => check.id === 'service')?.status, 'unknown');
    assert.equal(unscoped.checks.find(check => check.id === 'login')?.status, 'action');
    const scoped = await diagnoseCellapp({...base, project});
    assert.equal(scoped.checks.find(check => check.id === 'project')?.status, 'pass');
    assert.equal(scoped.checks.find(check => check.id === 'build')?.status, 'pass');
    assert.equal(scoped.checks.find(check => check.id === 'static-output')?.status, 'pass');
    assert(!JSON.stringify(scoped).includes(root));
    assert.deepEqual((await readdir(root)).sort(), ['npm', 'project']);
  } finally { await rm(root, {recursive: true, force: true}); }
});

test('set agent stores only a supported installed name and preserves selection on failure', {skip: process.platform === 'win32'}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'cellapp-agent-selection-'));
  try {
    await writeFile(join(root, 'codex'), '#!/bin/sh\nexit 0\n', {mode: 0o755});
    await setSelectedAgent('codex', root, {path: root, home: root});
    assert.equal(await selectedAgent(root), 'codex');
    assert.deepEqual(JSON.parse(await readFile(agentSelectionFile(root), 'utf8')), {agent: 'codex'});
    assert.equal((await stat(agentSelectionFile(root))).mode & 0o777, 0o600);
    await assert.rejects(setSelectedAgent('codex --danger', root, {path: root, home: root}), /Unsupported agent/);
    await assert.rejects(setSelectedAgent('claude', root, {path: root, home: root}), /not installed/);
    assert.equal(await selectedAgent(root), 'codex');
    await writeFile(join(root, 'claude'), '#!/bin/sh\nexit 0\n', {mode: 0o755});
    await setSelectedAgent('claude', root, {path: root, home: root});
    assert.equal(await selectedAgent(root), 'claude');
  } finally { await rm(root, {recursive: true, force: true}); }
});

test('doctor verifies existing login without exposing the credential or changing files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cellapp-doctor-login-'));
  const secret = 'private-doctor-credential';
  const calls: string[] = [];
  try {
    const {Client} = await import('../packages/cli/src/client.js');
    const client = new Client('https://cellapp.example', root);
    await writeFile(client.credentialFile, JSON.stringify({token: secret}));
    const before = await readFile(client.credentialFile, 'utf8');
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/apps')) {
        assert.equal(new Headers(init?.headers).get('Authorization'), `Bearer ${secret}`);
        return new Response('[]', {status: 200});
      }
      return new Response('{"stable":"1.2"}', {status: 200});
    }) as typeof fetch;
    const result = await diagnoseCellapp({origin: client.origin, configDirectory: root, path: '', home: root, fetchImpl});
    assert.equal(result.checks.find(check => check.id === 'login')?.status, 'pass');
    assert.equal(result.checks.find(check => check.id === 'service')?.status, 'pass');
    assert.equal(calls.length, 2);
    assert(!JSON.stringify(result).includes(secret));
    assert.equal(await readFile(client.credentialFile, 'utf8'), before);
  } finally { await rm(root, {recursive: true, force: true}); }
});

test('doctor distinguishes a responding control origin from an expired login', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cellapp-doctor-expired-'));
  try {
    const {Client} = await import('../packages/cli/src/client.js');
    const client = new Client('https://cellapp.example', root);
    await writeFile(client.credentialFile, JSON.stringify({token: 'private-expired-token'}));
    const fetchImpl = (async () => new Response('{}', {status: 401})) as typeof fetch;
    const report = await diagnoseCellapp({origin: client.origin, configDirectory: root, path: '', home: root, fetchImpl});
    assert.equal(report.checks.find(check => check.id === 'service')?.status, 'pass');
    assert.equal(report.checks.find(check => check.id === 'login')?.status, 'action');
    assert(!JSON.stringify(report).includes('private-expired-token'));
  } finally { await rm(root, {recursive: true, force: true}); }
});
