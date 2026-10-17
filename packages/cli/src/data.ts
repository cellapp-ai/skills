import { controlApp } from './paths.js';
import { join, resolve } from 'node:path';
import { Client, readJSON } from './client.js';
import type { Project } from './deploy.js';
import { parseDataManifest } from '../../shared/src/data.js';

type DataAction = 'plan' | 'apply' | 'status' | 'verify' | 'reconcile';
type DataPlan = { version: number; digest: string; operations: string[]; requiresDestructive: boolean; alreadyApplied: boolean };

function plan(value: unknown): DataPlan {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Unexpected data plan response');
  const data = value as Record<string, unknown>;
  if (!Number.isSafeInteger(data.version) || typeof data.digest !== 'string' || !/^[a-f0-9]{64}$/.test(data.digest) ||
      !Array.isArray(data.operations) || data.operations.some(item => typeof item !== 'string') ||
      typeof data.requiresDestructive !== 'boolean' || typeof data.alreadyApplied !== 'boolean') throw new Error('Unexpected data plan response');
  return data as DataPlan;
}

export async function runData(client: Client, action: string | undefined, projectPath: string, project: Project | undefined,
  explicitAppID?: string, manifestPath?: string, allowDestructive = false): Promise<unknown> {
  if (!['plan', 'apply', 'status', 'verify', 'reconcile'].includes(action ?? '')) throw new Error('Use data plan, apply, status, verify, or reconcile');
  const operation = action as DataAction;
  const appID = explicitAppID ?? project?.appId;
  if (!appID || !/^[a-f0-9]{32}$/.test(appID)) throw new Error('Link a project or provide a valid app ID');
  const path = `${controlApp(appID)}/data`;
  if (operation === 'status') return {appId: appID, status: await client.request(path)};
  if (operation === 'reconcile') return {appId: appID, reconciliation: await client.request(`${path}/reconcile`, 'POST', {})};
  if (operation === 'verify') return {appId: appID, verification: await client.request(`${path}/verify`, 'POST')};
  const input = await readJSON<unknown>(resolve(projectPath, manifestPath ?? 'cellapp.data.json'));
  if (input === undefined) throw new Error(`Data manifest not found: ${join(projectPath, manifestPath ?? 'cellapp.data.json')}`);
  const manifest = parseDataManifest(input);
  const preview = plan(await client.request(`${path}/plan`, 'POST', manifest));
  if (operation === 'plan') return {appId: appID, plan: preview};
  if (preview.requiresDestructive && !allowDestructive) throw new Error('Destructive table changes require --allow-destructive after reviewing data plan');
  const applied = plan(await client.request(`${path}/apply`, 'POST', manifest));
  if (applied.digest !== preview.digest) throw new Error('Applied data digest differs from the reviewed plan; run data status');
  return {appId: appID, tables: applied, verification: await client.request(`${path}/verify`, 'POST')};
}
