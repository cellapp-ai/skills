import { AppError, ensure } from './errors.js';

export type PublicData = { provider: 'supabase'; url: string; anonKey: string };

function jwtRole(token: string): string | undefined {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) return undefined;
  try {
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(parts[1].length / 4) * 4, '=');
    const claims = JSON.parse(atob(padded)) as {role?: unknown};
    return typeof claims.role === 'string' ? claims.role : undefined;
  } catch {
    return undefined;
  }
}

export function publicSupabaseData(input: {provider: string; url: string; anonKey: string}): PublicData {
  ensure(input.provider === 'supabase', 400, 'invalid_data', 'Only provider supabase is supported');
  let parsed: URL;
  try { parsed = new URL(input.url); }
  catch { throw new AppError(400, 'invalid_data', 'url must be an HTTPS origin'); }
  ensure(parsed.protocol === 'https:' && parsed.host !== '' && !parsed.username && !parsed.password && (parsed.pathname === '/' || parsed.pathname === '') && parsed.search === '' && parsed.hash === '', 400, 'invalid_data', 'url must be an HTTPS origin');
  ensure(input.anonKey.length > 0 && input.anonKey.length <= 4096 && !/\s/.test(input.anonKey), 400, 'invalid_data', 'anonKey must be the Supabase anon or publishable key');
  ensure(!input.anonKey.startsWith('sb_secret') && jwtRole(input.anonKey) !== 'service_role', 400, 'invalid_data', 'service role keys are not allowed');
  return {provider: 'supabase', url: parsed.origin, anonKey: input.anonKey};
}
