import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {Client} from '../packages/cli/src/client.js';
import {resolveAPIVersion, stampAPIHTML, stampAPIOutput} from '../packages/cli/src/api-version.js';
import {collect} from '../packages/cli/src/deploy.js';

test('stable selection and both aliases resolve to one canonical contract', async () => {
  const client = new Client('https://control.example');
  let stable = '1.1';
  client.request = async () => ({stable, latest: '2.0', versions: [
    {version: '1.1', date: '261022', status: 'supported'},
    {version: '2.0', date: '261023', status: 'supported'},
  ]}) as never;
  assert.equal((await resolveAPIVersion(client)).version, '1.1');
  assert.deepEqual(await resolveAPIVersion(client, '261022'), await resolveAPIVersion(client, '1.1'));
  stable = '2.0';
  assert.equal((await resolveAPIVersion(client)).version, '2.0');
  await assert.rejects(resolveAPIVersion(client, '261024'), /Unsupported application API version/);
  client.request = async () => { throw new Error('discovery failed'); };
  await assert.rejects(resolveAPIVersion(client), /discovery failed/);
});

test('every HTML entrypoint has one pinned marker before hashing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cellapp-api-version-'));
  try {
    await mkdir(join(root, 'nested'));
    await writeFile(join(root, 'index.html'), '<!doctype html><html><head><title>App</title></head><body>App</body></html>');
    await writeFile(join(root, 'nested', 'page.html'), '<h1>Page</h1>');
    await stampAPIOutput(root, '1.1');
    const first = await readFile(join(root, 'index.html'), 'utf8');
    const second = await readFile(join(root, 'nested', 'page.html'), 'utf8');
    assert.match(first, /<meta name="cellapp-api-version" content="1\.1">/);
    assert.match(second, /<meta name="cellapp-api-version" content="1\.1">/);
    await stampAPIOutput(root, '1.1');
    assert.equal(await readFile(join(root, 'index.html'), 'utf8'), first);
    assert.equal(await readFile(join(root, 'nested', 'page.html'), 'utf8'), second);
    const files = await collect(root, {files: 3, fileBytes: 1000, deploymentBytes: 2000});
    assert.deepEqual(files.map(file => file.path), ['index.html', 'nested/page.html']);
    assert.equal(files[0]?.sha256, createHash('sha256').update(first).digest('hex'));
    assert.throws(() => stampAPIHTML(first, '2.0'), /Conflicting/);
    assert.throws(() => stampAPIHTML('<head><meta name="cellapp-api-version" content="1.1"><meta name="cellapp-api-version" content="1.1">', '1.1'), /Multiple/);
    assert.throws(() => stampAPIHTML('<head><meta name=cellapp-api-version content=1.1>', '1.1'), /Conflicting/);
    assert.match(stampAPIHTML('<!doctype html><html><body>Hi</body></html>', '1.1'), /^<!doctype html><html>\n<head><meta name=/);
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});
