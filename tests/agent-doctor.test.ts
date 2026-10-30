import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {diagnoseLocalAgents} from '../packages/cli/src/agent-doctor.js';

test('agent discovery only runs fixed vendor status commands', {skip: process.platform === 'win32'}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'cellapp-doctor-'));
  const calls = join(root, 'calls');
  const fixtures = [
    ['codex', 'login status', 'signed-in', ''],
    ['claude', 'auth status --json', 'signed-out', '{"loggedIn":false,"email":"private@example.test"}'],
    ['cursor-agent', 'status', 'signed-out', 'Not authenticated'],
  ] as const;
  try {
    for (const [name, statusArgs, , statusOutput] of fixtures) {
      const script = `#!/bin/sh\nprintf '%s\\n' '${name}:'"$*" >> '${calls}'\nif [ "$*" = '--version' ]; then echo '1.2.3'; exit 0; fi\nif [ "$*" = '${statusArgs}' ]; then echo '${statusOutput}'; exit 0; fi\nexit 2\n`;
      await writeFile(join(root, name), script, {mode: 0o755});
    }
    const diagnosis = await diagnoseLocalAgents({path: root, home: root});
    assert.deepEqual(diagnosis.agents.map(agent => agent.loginState), fixtures.map(item => item[2]));
    assert(diagnosis.agents.every(agent => agent.installed && agent.version === '1.2.3'));
    assert(!JSON.stringify(diagnosis).includes('private@example.test'));
    const invoked = (await readFile(calls, 'utf8')).trim().split('\n');
    assert.deepEqual(invoked, ['codex:--version', 'codex:login status', 'claude:--version', 'claude:auth status --json', 'cursor-agent:--version', 'cursor-agent:status']);
    const absent = await diagnoseLocalAgents({path: join(root, 'missing'), home: join(root, 'missing')});
    assert(absent.agents.every(agent => !agent.installed && agent.loginState === 'unknown'));
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});

test('Windows discovers known CLI wrappers without executing them or reading credentials', {skip: process.platform !== 'win32'}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'cellapp-doctor-win-'));
  try {
    for (const name of ['codex', 'claude', 'cursor-agent']) await writeFile(join(root, `${name}.cmd`), '@echo off\r\necho should-not-run\r\n');
    const diagnosis = await diagnoseLocalAgents({path: root, home: root});
    assert(diagnosis.agents.every(agent => agent.installed && agent.loginState === 'unknown' && agent.version === undefined));
    const missing = await diagnoseLocalAgents({path: join(root, 'absent'), home: join(root, 'absent')});
    assert(missing.agents.every(agent => !agent.installed && agent.loginState === 'unknown'));
  } finally {
    await rm(root, {recursive: true, force: true});
  }
});
