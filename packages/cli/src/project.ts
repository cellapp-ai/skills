import { join } from 'node:path';
import { readJSON, saveJSON, saveJSONExclusive } from './client.js';
import { DEFAULT_ORIGIN, officialOrigin } from './origin.js';
import type { Project } from './deploy.js';

export async function readProject(directory: string, selectedOrigin = DEFAULT_ORIGIN): Promise<Project | undefined> {
  const currentPath = join(directory, 'cellapp.json');
  const legacyPath = join(directory, 'ohmyapp.json');
  const current = await readJSON<Project>(currentPath);
  const legacy = await readJSON<Project>(legacyPath);
  const normalizedCurrent = current && {...current, origin: officialOrigin(current.origin)};
  const normalizedLegacy = legacy && {...legacy, origin: officialOrigin(legacy.origin)};
  if (current && legacy && (normalizedCurrent!.origin !== normalizedLegacy!.origin || (current.appId && legacy.appId && current.appId !== legacy.appId))) {
    throw new Error('cellapp.json conflicts with ohmyapp.json; choose the correct project association manually');
  }
  if (current) {
    if (current.origin !== normalizedCurrent!.origin && selectedOrigin === DEFAULT_ORIGIN) {
      const latest = await readJSON<Project>(currentPath);
      if (JSON.stringify(latest) !== JSON.stringify(current)) throw new Error('cellapp.json changed during migration; retry safely');
      await saveJSON(currentPath, normalizedCurrent);
      return normalizedCurrent;
    }
    return current;
  }
  if (!legacy) return undefined;
  const migratedValue = selectedOrigin === DEFAULT_ORIGIN ? normalizedLegacy! : legacy;
  try { await saveJSONExclusive(currentPath, migratedValue); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
  const migrated = await readJSON<Project>(currentPath);
  if (JSON.stringify(migrated) !== JSON.stringify(migratedValue)) {
    throw new Error('cellapp.json changed during migration; legacy ohmyapp.json was preserved');
  }
  return migrated;
}
