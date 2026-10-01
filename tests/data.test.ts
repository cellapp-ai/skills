import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicSupabaseData } from '../packages/shared/src/data.js';
import { AppError } from '../packages/shared/src/errors.js';

function jwt(role: string) {
  const payload = Buffer.from(JSON.stringify({role})).toString('base64url');
  return `eyJhbGciOiJub25lIn0.${payload}.sig`;
}

test('public supabase config accepts anon keys and rejects service role', () => {
  const bound = publicSupabaseData({provider: 'supabase', url: 'https://demo.supabase.co/', anonKey: jwt('anon')});
  assert.equal(bound.url, 'https://demo.supabase.co');
  assert.equal(publicSupabaseData({provider: 'supabase', url: 'https://demo.supabase.co', anonKey: 'sb_publishable_x'}).anonKey, 'sb_publishable_x');
  assert.throws(() => publicSupabaseData({provider: 'postgres', url: 'https://demo.supabase.co', anonKey: jwt('anon')}), AppError);
  assert.throws(() => publicSupabaseData({provider: 'supabase', url: 'http://demo.supabase.co', anonKey: jwt('anon')}), AppError);
  assert.throws(() => publicSupabaseData({provider: 'supabase', url: 'https://demo.supabase.co', anonKey: jwt('service_role')}), AppError);
  assert.throws(() => publicSupabaseData({provider: 'supabase', url: 'https://demo.supabase.co', anonKey: 'sb_secret_x'}), AppError);
});
