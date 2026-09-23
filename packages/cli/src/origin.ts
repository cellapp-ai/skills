import type { Project } from './deploy.js';

export function selectOrigin(explicit: string | undefined, current: Project | undefined, legacy: Project | undefined, environment: NodeJS.ProcessEnv) {
  return explicit ?? current?.origin ?? environment.CELLAPP_ORIGIN ?? legacy?.origin ?? environment.OHMYAPP_ORIGIN;
}
