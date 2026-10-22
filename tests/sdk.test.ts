import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CellappAPIError, createCellappClient} from '../packages/sdk/src/index.js';

test('SDK pins current user and table requests to the page contract', async () => {
  const beforeFetch = globalThis.fetch;
  const beforeDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const beforeLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
  const seen: {url: URL; credentials: RequestCredentials; method: string}[] = [];
  try {
    Object.defineProperty(globalThis, 'location', {configurable: true, value: {protocol: 'https:', origin: 'https://notes.apps.example'}});
    Object.defineProperty(globalThis, 'document', {configurable: true, value: {querySelectorAll: () => [{getAttribute: () => '1.1'}]}});
    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      seen.push({url, credentials: request.credentials, method: request.method});
      if (url.pathname === '/_cellapp/me') return new Response(JSON.stringify({id: 'app-user', access: 'admitted'}), {headers: {'Content-Type': 'application/json'}});
      return new Response(JSON.stringify([{id: 'n1', body: 'hello'}]), {status: request.method === 'POST' ? 201 : 200, headers: {'Content-Type': 'application/json'}});
    };
    const sdk = createCellappClient();
    assert.equal(sdk.apiVersion, '1.1');
    assert.deepEqual(await sdk.currentUser(), {id: 'app-user', access: 'admitted'});
    const result = await sdk.from('notes').select('id,body').eq('id', 'n1').order('id').range(0, 4);
    assert.equal(result.error, null);
    assert.equal(result.data?.[0]?.id, 'n1');
    assert.equal((await sdk.from('notes').insert({id: 'n1', body: 'hello'}).select('id,body')).error, null);
    assert.equal((await sdk.from('notes').update({body: 'updated'}).eq('id', 'n1').select('id,body')).error, null);
    assert.equal((await sdk.from('notes').delete().eq('id', 'n1').select('id,body')).error, null);
    assert.deepEqual(seen.map(request => request.method), ['GET', 'GET', 'POST', 'PATCH', 'DELETE']);
    assert.deepEqual(seen.map(request => request.url.pathname), ['/_cellapp/me', '/_cellapp/db/notes', '/_cellapp/db/notes', '/_cellapp/db/notes', '/_cellapp/db/notes']);
    for (const request of seen) {
      assert.equal(request.url.origin, 'https://notes.apps.example');
      assert.equal(request.url.searchParams.get('v'), '1.1');
      assert.equal(request.credentials, 'same-origin');
    }
    assert.equal(seen[1]?.url.searchParams.get('id'), 'eq.n1');
    assert.equal(seen[1]?.url.searchParams.get('order'), 'id.asc');
    assert.equal(seen[1]?.url.searchParams.get('offset'), '0');
    assert.equal(seen[2]?.url.searchParams.get('select'), 'id,body');
    assert.equal(seen[3]?.url.searchParams.get('id'), 'eq.n1');
    assert.equal(seen[4]?.url.searchParams.get('id'), 'eq.n1');
    assert.throws(() => sdk.from('rpc'), /Unsupported application table/);
    assert.equal('auth' in sdk, false);
    assert.equal('rpc' in sdk, false);
  } finally {
    globalThis.fetch = beforeFetch;
    if (beforeDocument) Object.defineProperty(globalThis, 'document', beforeDocument); else Reflect.deleteProperty(globalThis, 'document');
    if (beforeLocation) Object.defineProperty(globalThis, 'location', beforeLocation); else Reflect.deleteProperty(globalThis, 'location');
  }
});

test('SDK reports missing versions and access errors without falling back to latest', async () => {
  const beforeFetch = globalThis.fetch;
  const beforeDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const beforeLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
  try {
    Object.defineProperty(globalThis, 'location', {configurable: true, value: {protocol: 'https:', origin: 'https://notes.apps.example'}});
    Object.defineProperty(globalThis, 'document', {configurable: true, value: {querySelectorAll: () => []}});
    assert.throws(() => createCellappClient(), /Expected one Cellapp API version marker/);
    Object.defineProperty(globalThis, 'document', {configurable: true, value: {querySelectorAll: () => [{getAttribute: () => '1.1'}]}});
    globalThis.fetch = async () => new Response(JSON.stringify({error: 'access_pending', message: 'Pending', details: null}), {status: 403});
    await assert.rejects(createCellappClient().currentUser(), error => error instanceof CellappAPIError && error.status === 403 && error.code === 'access_pending');
    for (const [status, code] of [[401, 'login_required'], [403, 'access_denied'], [403, 'access_required'], [400, 'unsupported_api_version']] as const) {
      globalThis.fetch = async () => new Response(JSON.stringify({error: code, message: code}), {status});
      await assert.rejects(createCellappClient().currentUser(), error => error instanceof CellappAPIError && error.status === status && error.code === code);
    }
    globalThis.fetch = async () => new Response('not json');
    await assert.rejects(createCellappClient().currentUser(), error => error instanceof CellappAPIError && error.code === 'invalid_response');
    globalThis.fetch = async () => new Response(JSON.stringify({code: '42501', message: 'permission denied'}), {status: 403, headers: {'Content-Type': 'application/json'}});
    const dataFailure = await createCellappClient().from('notes').select('id');
    assert.equal(dataFailure.data, null);
    assert.equal(dataFailure.error?.code, '42501');
    Object.defineProperty(globalThis, 'document', {configurable: true, value: {querySelectorAll: () => [{getAttribute: () => 'garbage'}]}});
    assert.throws(() => createCellappClient(), /Invalid Cellapp API version marker/);
    Object.defineProperty(globalThis, 'document', {configurable: true, value: {querySelectorAll: () => [{getAttribute: () => '1.1'}, {getAttribute: () => '1.1'}]}});
    assert.throws(() => createCellappClient(), /Expected one Cellapp API version marker/);
  } finally {
    globalThis.fetch = beforeFetch;
    if (beforeDocument) Object.defineProperty(globalThis, 'document', beforeDocument); else Reflect.deleteProperty(globalThis, 'document');
    if (beforeLocation) Object.defineProperty(globalThis, 'location', beforeLocation); else Reflect.deleteProperty(globalThis, 'location');
  }
});
