import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ORIGIN, RETIRED_ORIGIN, selectOrigin } from '../packages/cli/src/origin.js';
import type { Project } from '../packages/cli/src/deploy.js';

test('Cellapp origin precedence keeps the old environment variable as a fallback', () => {
  const current = {origin: 'https://current.example'} as Project;
  const legacy = {origin: 'https://legacy.example'} as Project;
  const environment = {CELLAPP_ORIGIN: 'https://new-env.example', OHMYAPP_ORIGIN: 'https://old-env.example'};
  assert.equal(selectOrigin('https://explicit.example', current, legacy, environment), 'https://explicit.example');
  assert.equal(selectOrigin(undefined, current, legacy, environment), environment.CELLAPP_ORIGIN);
  assert.equal(selectOrigin(undefined, undefined, legacy, environment), environment.CELLAPP_ORIGIN);
  assert.equal(selectOrigin(undefined, undefined, legacy, {OHMYAPP_ORIGIN: environment.OHMYAPP_ORIGIN}), environment.OHMYAPP_ORIGIN);
  assert.equal(selectOrigin(undefined, undefined, undefined, {OHMYAPP_ORIGIN: environment.OHMYAPP_ORIGIN}), environment.OHMYAPP_ORIGIN);
  assert.equal(selectOrigin(undefined, undefined, undefined, {}), DEFAULT_ORIGIN);
  assert.equal(selectOrigin(undefined, undefined, undefined, {CELLAPP_ORIGIN: '', OHMYAPP_ORIGIN: ''}), DEFAULT_ORIGIN);
  assert.equal(DEFAULT_ORIGIN, 'https://cellapp.ai');
  assert.equal(selectOrigin(undefined, {origin: RETIRED_ORIGIN} as Project, undefined, {}), DEFAULT_ORIGIN);
  assert.throws(() => selectOrigin(RETIRED_ORIGIN, current, legacy, {}), /retired/);
  assert.throws(() => selectOrigin(undefined, current, legacy, {CELLAPP_ORIGIN: RETIRED_ORIGIN}), /retired/);
});
