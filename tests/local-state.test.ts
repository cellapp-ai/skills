import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const schema = JSON.parse(await readFile(new URL('../contracts/local-state-v1.json', import.meta.url), 'utf8')) as {
  required: string[]; properties: Record<string, {type: string | string[]; pattern?: string; required?: string[]; properties?: Record<string, {type?: string | string[]; pattern?: string}>}>;
};

function conforms(value: Record<string, unknown>, expected = schema) {
  for (const key of expected.required) assert.ok(Object.hasOwn(value, key), `missing ${key}`);
  for (const [key, data] of Object.entries(value)) {
    const rule = expected.properties[key];
    assert.ok(rule, `unknown ${key}`);
    if (data === null) assert.ok(Array.isArray(rule.type) && rule.type.includes('null'), key);
    else if (rule.type === 'object') conforms(data as Record<string, unknown>, rule as typeof schema);
    else assert.equal(typeof data, rule.type, key);
    if (rule.pattern) assert.match(String(data), new RegExp(rule.pattern), key);
  }
}

test('new and migrated project files satisfy the published local-state schema', () => {
  const legacy = {origin: 'https://control.example', appId: 'a'.repeat(32), name: 'Existing', output: 'dist', spa: false, createRequestId: 'b'.repeat(32), pending: {requestId: 'c'.repeat(32), fingerprint: 'd'.repeat(64), baseVersion: null}};
  conforms(legacy);
  const {pending: _pending, ...current} = legacy;
  conforms(current);
});
