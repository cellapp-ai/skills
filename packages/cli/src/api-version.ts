import {lstat, readdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {AppError} from '../../shared/src/errors.js';
import {Client} from './client.js';
import {CONTROL_API} from './paths.js';

export interface APIContract {version: string; date: string; status: string}
interface APIVersions {stable: string; latest: string; versions: APIContract[]}
const canonical = /^[1-9][0-9]*\.[0-9]+$/;
const dateAlias = /^[0-9]{6}$/;
const markerName = /<meta\b[^>]*\bname\s*=\s*(?:["']cellapp-api-version["']|cellapp-api-version(?=[\s/>]))[^>]*>/gi;
const head = /<head(?:\s[^>]*)?>/i;
const htmlTag = /<html(?:\s[^>]*)?>/i;
const doctype = /<!doctype\s+html\s*>/i;

export function parseAPIVersions(value: unknown): APIVersions {
  if (!value || typeof value !== 'object') throw new Error('Invalid application API version catalog');
  const source = value as Record<string, unknown>;
  if (typeof source.stable !== 'string' || typeof source.latest !== 'string' || !Array.isArray(source.versions)) throw new Error('Invalid application API version catalog');
  const versions: APIContract[] = source.versions.map((item: unknown) => {
    if (!item || typeof item !== 'object') throw new Error('Invalid application API contract');
    const contract = item as Record<string, unknown>;
    if (typeof contract.version !== 'string' || !canonical.test(contract.version) || typeof contract.date !== 'string' || !dateAlias.test(contract.date) ||
      (contract.status !== 'supported' && contract.status !== 'retired')) throw new Error('Invalid application API contract');
    return {version: contract.version, date: contract.date, status: contract.status};
  });
  if (!versions.some(v => v.version === source.stable && v.status === 'supported')) throw new Error('Stable application API version is unavailable');
  return {stable: source.stable, latest: source.latest, versions};
}

export async function resolveAPIVersion(client: Client, requested?: string): Promise<APIContract> {
  const catalog = parseAPIVersions(await client.request<unknown>(`${CONTROL_API}/app-api/versions`));
  const alias = requested ?? catalog.stable;
  const match = catalog.versions.find(v => (v.version === alias || v.date === alias) && v.status === 'supported');
  if (!match) throw new AppError(400, 'unsupported_api_version', `Unsupported application API version: ${alias}`);
  return match;
}

export function stampAPIHTML(html: string, version: string): string {
  if (!canonical.test(version)) throw new Error('Invalid canonical application API version');
  const existing = [...html.matchAll(markerName)];
  if (existing.length > 1) throw new Error('Multiple Cellapp API version markers');
  const marker = `<meta name="cellapp-api-version" content="${version}">`;
  if (existing.length === 1) {
    const old = existing[0]?.[0] ?? '';
    const content = old.match(/\bcontent\s*=\s*["']([^"']*)["']/i)?.[1];
    if (content !== version) throw new Error('Conflicting Cellapp API version marker');
    return html;
  }
  if (head.test(html)) return html.replace(head, value => `${value}\n${marker}`);
  if (htmlTag.test(html)) return html.replace(htmlTag, value => `${value}\n<head>${marker}</head>`);
  if (doctype.test(html)) return html.replace(doctype, value => `${value}\n<head>${marker}</head>`);
  return `<head>${marker}</head>\n${html}`;
}

export async function stampAPIOutput(root: string, version: string): Promise<void> {
  let count = 0;
  async function visit(directory: string): Promise<void> {
    for (const name of await readdir(directory)) {
      const path = join(directory, name);
      const stat = await lstat(path);
      if (stat.isSymbolicLink()) throw new Error(`Symlink not allowed: ${path}`);
      if (stat.isDirectory()) await visit(path);
      else if (name.toLowerCase().endsWith('.html')) {
        if (!stat.isFile()) throw new Error(`Invalid HTML entrypoint: ${path}`);
        const original = await readFile(path, 'utf8');
        const stamped = stampAPIHTML(original, version);
        if (stamped !== original) await writeFile(path, stamped);
        count++;
      }
    }
  }
  await visit(root);
  if (count === 0) throw new Error('No HTML entrypoint to pin application API version');
}
