import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error The boundary checker is a small standalone JavaScript tool.
import { checkDirectory, permitted } from '../scripts/check-boundary.mjs';

test('public boundary rejects private paths and representative secrets', async () => {
  for (const path of ['apps/server/main.go', 'infra/compose.yaml', '.env', '.env.example', 'docs/operations.md', 'dist/main.js']) {
    assert.equal(permitted(path), false, path);
  }
  for (const path of ['packages/cli/src/main.ts', 'packages/shared/src/artifacts.ts', 'skills/cellapp-deploy/SKILL.md', 'contracts/http-v1.json']) {
    assert.equal(permitted(path), true, path);
  }
  const root = await mkdtemp(join(tmpdir(), 'cellapp-boundary-'));
  try {
    await mkdir(join(root, 'tests'));
    await writeFile(join(root, 'tests', 'fake.txt'), '-----BEGIN ' + 'PRIVATE KEY-----\nnot-a-real-key');
    await mkdir(join(root, 'infra'));
    await writeFile(join(root, 'infra', 'compose.yaml'), 'fixture');
    assert.deepEqual((await checkDirectory(root)).sort(), ['forbidden path: infra/compose.yaml', 'sensitive content: tests/fake.txt']);
  } finally { await rm(root, {recursive: true, force: true}); }
});
