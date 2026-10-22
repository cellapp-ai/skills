import {createClient} from '@supabase/supabase-js';

const versionPattern = /^[1-9][0-9]*\.[0-9]+$/;
const tablePattern = /^[a-z][a-z0-9_]{0,62}$/;

export interface AppUser {id: string; access: 'admitted'}

export class CellappAPIError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details: unknown = null) {
    super(message);
    this.name = 'CellappAPIError';
  }
}

function pageVersion(): string {
  if (typeof document === 'undefined') throw new Error('Cellapp SDK requires a browser page');
  const markers = document.querySelectorAll('meta[name="cellapp-api-version"]');
  if (markers.length !== 1) throw new Error('Expected one Cellapp API version marker in the page');
  const version = markers[0]?.getAttribute('content') ?? '';
  if (!versionPattern.test(version)) throw new Error('Invalid Cellapp API version marker');
  return version;
}

function appOrigin(): string {
  if (typeof location === 'undefined' || location.protocol !== 'https:') throw new Error('Cellapp SDK requires an HTTPS application origin');
  return location.origin;
}

async function responseError(response: Response): Promise<CellappAPIError> {
  let value: unknown;
  try { value = await response.json(); } catch { /* A gateway may return a non-JSON failure. */ }
  const error = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return new CellappAPIError(response.status, typeof error.error === 'string' ? error.error : 'invalid_response',
    typeof error.message === 'string' ? error.message : `Cellapp request failed (${response.status})`, error.details ?? null);
}

export function createCellappClient() {
  const apiVersion = pageVersion();
  const origin = appOrigin();
  const versionedFetch: typeof fetch = (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), origin);
    if (url.origin !== origin) throw new Error('Cellapp SDK request escaped the application origin');
    if (url.pathname.startsWith('/rest/v1/')) url.pathname = `/_cellapp/db/${url.pathname.slice('/rest/v1/'.length)}`;
    if (url.pathname !== '/_cellapp/me' && !url.pathname.startsWith('/_cellapp/db/')) throw new Error('Unsupported Cellapp SDK endpoint');
    url.searchParams.set('v', apiVersion);
    if (input instanceof Request) return fetch(new Request(url, input), {...init, credentials: 'same-origin'});
    return fetch(url, {...init, credentials: 'same-origin'});
  };
  const tables = createClient(origin, 'cellapp-public', {
    auth: {autoRefreshToken: false, persistSession: false, detectSessionInUrl: false},
    global: {fetch: versionedFetch},
  });
  return {
    apiVersion,
    async currentUser(): Promise<AppUser> {
      const response = await versionedFetch(`${origin}/_cellapp/me`);
      if (!response.ok) throw await responseError(response);
      let value: unknown;
      try { value = await response.json(); } catch { throw new CellappAPIError(502, 'invalid_response', 'Invalid application identity response'); }
      if (!value || typeof value !== 'object' || typeof (value as Record<string, unknown>).id !== 'string' ||
        (value as Record<string, unknown>).access !== 'admitted') {
        throw new CellappAPIError(502, 'invalid_response', 'Invalid application identity response');
      }
      return {id: (value as {id: string}).id, access: 'admitted'};
    },
    from(table: string) {
      if (!tablePattern.test(table) || table.startsWith('_cellapp_') || table === 'rpc') throw new Error('Unsupported application table name');
      return tables.from(table);
    },
  };
}
