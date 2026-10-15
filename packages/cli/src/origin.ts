import type { Project } from './deploy.js';

export const DEFAULT_ORIGIN = 'https://cellapp.ai';
export const RETIRED_ORIGIN = 'https://console.cellapp.ai';

export function officialOrigin(origin: string): string {
  return origin === RETIRED_ORIGIN ? DEFAULT_ORIGIN : origin;
}

export function selectOrigin(explicit: string | undefined, current: Project | undefined, legacy: Project | undefined, environment: NodeJS.ProcessEnv) {
  const override = explicit ?? (environment.CELLAPP_ORIGIN || undefined) ?? (environment.OHMYAPP_ORIGIN || undefined);
  if (override === RETIRED_ORIGIN) throw new Error('The official console origin has retired; use https://cellapp.ai and authorize again');
  return override ?? officialOrigin(current?.origin ?? legacy?.origin ?? DEFAULT_ORIGIN);
}
