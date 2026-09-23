import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectOrigin } from '../packages/cli/src/origin.js';
import type { Project } from '../packages/cli/src/deploy.js';

test('CellApp origin precedence keeps the old environment variable as a fallback', () => {
  const current = {origin: 'https://current.example'} as Project;
  const legacy = {origin: 'https://legacy.example'} as Project;
  const environment = {CELLAPP_ORIGIN: 'https://new-env.example', OHMYAPP_ORIGIN: 'https://old-env.example'};
  assert.equal(selectOrigin('https://explicit.example', current, legacy, environment), 'https://explicit.example');
  assert.equal(selectOrigin(undefined, current, legacy, environment), current.origin);
  assert.equal(selectOrigin(undefined, undefined, legacy, environment), environment.CELLAPP_ORIGIN);
  assert.equal(selectOrigin(undefined, undefined, legacy, {OHMYAPP_ORIGIN: environment.OHMYAPP_ORIGIN}), legacy.origin);
  assert.equal(selectOrigin(undefined, undefined, undefined, {OHMYAPP_ORIGIN: environment.OHMYAPP_ORIGIN}), environment.OHMYAPP_ORIGIN);
});
