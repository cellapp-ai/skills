import { homedir } from 'node:os';
import { join } from 'node:path';
import { readJSON, saveJSON } from './client.js';
import { CLI_VERSION } from './version.js';

const REGISTRY_URL = 'https://registry.npmjs.org/@cellapp%2Fcli/latest';

function localDate(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function stableVersion(value: unknown): number[] | undefined {
  if (typeof value !== 'string' || !/^\d+\.\d+\.\d+$/.test(value)) return undefined;
  const parts = value.split('.').map(Number);
  return parts.every(Number.isSafeInteger) ? parts : undefined;
}

export function isNewerVersion(latest: unknown, current: string): boolean {
  const next = stableVersion(latest);
  const installed = stableVersion(current);
  if (!next || !installed) return false;
  for (let i = 0; i < 3; i++) {
    if (next[i]! > installed[i]!) return true;
    if (next[i]! < installed[i]!) return false;
  }
  return false;
}

export async function checkForUpdates(
  configDirectory: string | undefined,
  notify: (message: string) => void,
  now = new Date(),
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const statePath = join(configDirectory ?? join(homedir(), '.config', 'cellapp'), 'update-check.json');
  const date = localDate(now);
  try {
    let state: unknown;
    try { state = await readJSON<unknown>(statePath); } catch { /* Replace invalid local state. */ }
    if (state && typeof state === 'object' && 'date' in state && state.date === date) return;
    // Record the attempt first so an offline machine does not retry on every command.
    await saveJSON(statePath, {date}, true);
    const response = await fetcher(REGISTRY_URL, {
      headers: {Accept: 'application/json'},
      redirect: 'error',
      signal: AbortSignal.timeout(2_000),
    });
    if (!response.ok) return;
    const metadata: unknown = await response.json();
    if (!metadata || typeof metadata !== 'object' || !('version' in metadata)) return;
    if (isNewerVersion(metadata.version, CLI_VERSION)) {
      notify(`发现新版 @cellapp/cli ${metadata.version}（当前 ${CLI_VERSION}）。运行 npm install -g @cellapp/cli@latest 更新。`);
    }
  } catch { /* Update checks never change the requested command's result. */ }
}
