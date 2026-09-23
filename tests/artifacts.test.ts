import { test } from 'node:test';
import assert from 'node:assert/strict';
import { manifest, sha256, validPath } from '../packages/shared/src/artifacts.js';

test('artifact paths reject traversal, credential files and platform namespace', () => {
  for (const path of ['../index.html', '/index.html', 'a/../b', 'a\\b', 'a/%2e/b', '.env', 'a/.git/config', '_hosting/index.html', 'credentials.json', 'private.pem']) assert.throws(() => validPath(path), path);
  validPath('assets/main-abc.js');
});
test('manifest checks the actual contract and quotas', () => {
  const file = {path: 'index.html', size: 1, sha256: sha256('a')};
  const limits = {files: 2, fileBytes: 10, deploymentBytes: 10};
  assert.equal(manifest([file], limits).length, 1);
  for (const input of [[file, file], [{...file, size: 11}], [{...file, type: 'symlink'}], [{...file, sha256: 'wrong'}], [{...file, path: 'server.js'}]]) assert.throws(() => manifest(input, limits));
});
