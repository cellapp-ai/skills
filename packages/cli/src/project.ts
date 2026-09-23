import { join } from 'node:path';
import { readJSON, saveJSONExclusive } from './client.js';
import type { Project } from './deploy.js';

export async function readProject(directory: string): Promise<Project | undefined> {
  const currentPath = join(directory, 'cellapp.json');
  const legacyPath = join(directory, 'ohmyapp.json');
  const current = await readJSON<Project>(currentPath);
  const legacy = await readJSON<Project>(legacyPath);
  if (current && legacy && (current.origin !== legacy.origin || (current.appId && legacy.appId && current.appId !== legacy.appId))) {
    throw new Error('cellapp.json conflicts with ohmyapp.json; choose the correct project association manually');
  }
  if (current || !legacy) return current;
  try { await saveJSONExclusive(currentPath, legacy); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
  const migrated = await readJSON<Project>(currentPath);
  if (JSON.stringify(migrated) !== JSON.stringify(legacy)) {
    throw new Error('cellapp.json changed during migration; legacy ohmyapp.json was preserved');
  }
  return migrated;
}
