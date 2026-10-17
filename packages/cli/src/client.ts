import { chmod, link, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { AppError } from '../../shared/src/errors.js';
import { CURRENT_CREDENTIAL, DEVICE_AUTH, DEVICE_POLL } from './paths.js';

export const randomKey = () => randomBytes(32).toString('hex');
export const requestID = () => randomBytes(16).toString('hex');
export async function saveJSON(path: string, value: unknown, privateFile = false) {
  await mkdir(dirname(path), {recursive: true, mode: 0o700});
  const temporary = `${path}.${requestID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', {mode: privateFile ? 0o600 : 0o644, flag: 'wx'});
  await rename(temporary, path);
  if (privateFile) await chmod(path, 0o600);
}
export async function readJSON<T>(path: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(path, 'utf8')) as T; }
  catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw e; }
}
export async function saveJSONExclusive(path: string, value: unknown, privateFile = false) {
  await mkdir(dirname(path), {recursive: true, mode: 0o700});
  const temporary = `${path}.${requestID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', {mode: privateFile ? 0o600 : 0o644, flag: 'wx'});
    await link(temporary, path);
    if (privateFile) await chmod(path, 0o600);
  } finally {
    await unlink(temporary).catch((e: NodeJS.ErrnoException) => { if (e.code !== 'ENOENT') throw e; });
  }
}
export class Client {
  readonly credentialFile: string;
  readonly legacyCredentialFile?: string;
  token?: string;
  constructor(readonly origin: string, configDirectory?: string, legacyConfigDirectory?: string) {
    const url = new URL(origin);
    if (url.protocol !== 'https:' || url.origin !== origin) throw new Error('The control origin must be an HTTPS origin');
    const identity = createHash('sha256').update(origin).digest('hex').slice(0, 24);
    this.credentialFile = join(configDirectory ?? join(homedir(), '.config', 'cellapp'), `${identity}.json`);
    if (legacyConfigDirectory || configDirectory === undefined) {
      this.legacyCredentialFile = join(legacyConfigDirectory ?? join(homedir(), '.config', 'ohmyapp'), `${identity}.json`);
    }
  }
  async load() {
    const current = await readJSON<{token: string}>(this.credentialFile);
    if (current) { this.token = current.token; return; }
    if (!this.legacyCredentialFile) return;
    const legacy = await readJSON<{token: string}>(this.legacyCredentialFile);
    if (!legacy) return;
    try { await saveJSONExclusive(this.credentialFile, legacy, true); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
    const migrated = await readJSON<{token: string}>(this.credentialFile);
    if (migrated?.token !== legacy.token) throw new Error('Cellapp credential conflicts with legacy credential; resolve the files manually');
    this.token = migrated.token;
  }
  async request<T>(path: string, method = 'GET', body?: unknown, binary = false): Promise<T> {
    const headers: Record<string, string> = {};
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (body !== undefined) headers['Content-Type'] = binary ? 'application/octet-stream' : 'application/json';
    const response = await fetch(this.origin + path, {method, headers, redirect: 'error', body: body === undefined ? undefined : binary ? new Uint8Array(body as Buffer) : JSON.stringify(body), signal: AbortSignal.timeout(120_000)});
    const value = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new AppError(response.status, String(value.error), String(value.message), value.details as Record<string, unknown>);
    return value as T;
  }
  async login(notify: (message: string) => void) {
    const auth = await this.request<{deviceSecret: string; userCode: string; verificationUri: string; interval: number; expiresIn: number}>(DEVICE_AUTH, 'POST', {});
    notify(`请在浏览器打开 ${auth.verificationUri}\n核对授权码：${auth.userCode}`);
    const deadline = Date.now() + auth.expiresIn * 1000;
    let interval = auth.interval * 1000;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, interval));
      try {
        const credential = await this.request<{token: string; expiresIn: number}>(DEVICE_POLL, 'POST', {deviceSecret: auth.deviceSecret});
        await saveJSON(this.credentialFile, {...credential, origin: this.origin}, true);
        this.token = credential.token;
        return;
      } catch (e) {
        if (e instanceof AppError && e.code === 'authorization_pending') continue;
        if (e instanceof AppError && e.code === 'slow_down') { interval += 5000; continue; }
        throw e;
      }
    }
    throw new AppError(400, 'expired_token', 'Authorization expired; run login again');
  }
  async logout() {
    try { if (this.token) await this.request(CURRENT_CREDENTIAL, 'DELETE'); }
    catch (e) { if (!(e instanceof AppError && e.status === 401)) throw e; }
    await unlink(this.credentialFile).catch((e: NodeJS.ErrnoException) => { if (e.code !== 'ENOENT') throw e; });
    if (this.legacyCredentialFile) {
      await unlink(this.legacyCredentialFile).catch((e: NodeJS.ErrnoException) => { if (e.code !== 'ENOENT') throw e; });
    }
    this.token = undefined;
  }
}
