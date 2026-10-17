import { createHash } from 'node:crypto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '../packages/cli/src/client.js';
import { runData } from '../packages/cli/src/data.js';
import { parseDataManifest } from '../packages/shared/src/data.js';
import { AppError } from '../packages/shared/src/errors.js';

const appId = 'a'.repeat(32);
const manifest = {version: 1, tables: [{name: 'notes', columns: [{name: 'id', type: 'uuid'}, {name: 'owner_id', type: 'text'}], primaryKey: ['id'], policies: {select: 'own-rows', insert: 'own-rows', ownerColumn: 'owner_id'}}]};

test('data manifest rejects unsupported SQL and invalid own-row policies', () => {
  assert.equal(parseDataManifest(manifest).tables[0]?.name, 'notes');
  assert.throws(() => parseDataManifest({...manifest, tables: [{...manifest.tables[0], name: 'notes;drop'}]}), /identifier/);
  assert.throws(() => parseDataManifest({...manifest, tables: [{...manifest.tables[0], columns: [{name: 'id', type: 'serial'}]}]}), /column/);
  assert.throws(() => parseDataManifest({...manifest, tables: [{...manifest.tables[0], policies: {select: 'own-rows'}}]}), /owner/);
  assert.throws(() => parseDataManifest({...manifest, secret: 'do-not-store'}), /Unsupported field/);
  for (const name of ['users', 'applications', 'resources']) {
    assert.equal(parseDataManifest({...manifest, tables: [{...manifest.tables[0], name}]}).tables[0]?.name, name);
  }
  assert.throws(() => parseDataManifest({...manifest, tables: [{...manifest.tables[0], name: 'rpc'}]}), /Reserved/);
  assert.throws(() => parseDataManifest({...manifest, tables: [{...manifest.tables[0], columns: [{name: 'xmin', type: 'uuid'}, ...manifest.tables[0]!.columns.slice(1)]}]}), /Reserved/);
  const indexed = {...manifest.tables[0], indexes: [{columns: ['owner_id']}]};
  const generatedName = 'i_notes_' + createHash('sha256').update('notes:0').digest('hex').slice(0, 8);
  assert.throws(() => parseDataManifest({...manifest, tables: [indexed, {...indexed, name: generatedName, indexes: []}]}), /conflicts/);
});

test('data plan and apply keep destructive approval explicit and report denial', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cellapp-data-cli-'));
  try {
    await writeFile(join(directory, 'cellapp.data.json'), JSON.stringify({...manifest, allowDestructive: true}));
    const client = new Client('https://control.example', join(directory, 'credentials'));
    const seen: string[] = [];
    client.request = async function<T>(path: string): Promise<T> {
      seen.push(path);
      if (path.endsWith('/plan') || path.endsWith('/apply')) return {version: 1, digest: 'f'.repeat(64), operations: ['drop table old'], requiresDestructive: true, alreadyApplied: false} as T;
      if (path.endsWith('/verify')) return {ready: true, version: 1, digest: 'f'.repeat(64)} as T;
      throw new AppError(403, 'owner_required', 'Application not owned');
    };
    const project = {origin: client.origin, appId, name: 'Test', output: 'dist', spa: false, createRequestId: 'b'.repeat(32)};
    await assert.rejects(runData(client, 'apply', directory, project), /--allow-destructive/);
    assert.deepEqual(seen, [`/api/control/v1/apps/${appId}/data/plan`]);
    const result = await runData(client, 'apply', directory, project, undefined, undefined, true) as {tables: {digest: string}};
    assert.equal(result.tables.digest, 'f'.repeat(64));
    assert(seen.includes(`/api/control/v1/apps/${appId}/data/apply`));
    await assert.rejects(runData(client, 'status', directory, project), error => error instanceof AppError && error.status === 403);
    await assert.rejects(runData(client, 'plan', directory, undefined), /Link a project/);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});
