import type { Project } from './deploy.js';

export const DEFAULT_ORIGIN = 'https://console.cellapp.ai';

export function selectOrigin(explicit: string | undefined, current: Project | undefined, legacy: Project | undefined, environment: NodeJS.ProcessEnv) {
  return explicit ?? current?.origin ?? (environment.CELLAPP_ORIGIN || undefined) ?? legacy?.origin ?? (environment.OHMYAPP_ORIGIN || undefined) ?? DEFAULT_ORIGIN;
}
