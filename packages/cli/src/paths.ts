export const CONTROL_API = '/api/control/v1';
export const controlApp = (appId: string) => `${CONTROL_API}/apps/${appId}`;
export const DEVICE_AUTH = '/auth/device';
export const DEVICE_POLL = '/auth/device/poll';
export const CURRENT_CREDENTIAL = '/auth/credentials/current';
