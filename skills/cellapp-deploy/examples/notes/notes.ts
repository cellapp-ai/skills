import { createClient } from '@supabase/supabase-js';

const client = createClient(window.location.origin, 'cellapp-public', {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
});

export async function currentAppUser(): Promise<string> {
  const response = await fetch('/_cellapp/me', { credentials: 'same-origin' });
  if (!response.ok) throw new Error(response.status === 401 ? 'Sign in to Cellapp' : 'Application access required');
  const value: unknown = await response.json();
  if (!value || typeof value !== 'object' || !('id' in value) || typeof value.id !== 'string') throw new Error('Invalid application identity');
  return value.id;
}

export async function addNote(body: string) {
  const ownerId = await currentAppUser();
  const result = await client.from('notes').insert({ id: crypto.randomUUID(), owner_id: ownerId, body }).select('id,body');
  if (result.error) throw result.error;
  return result.data;
}

export async function listNotes() {
  const result = await client.from('notes').select('id,body').order('id').range(0, 49);
  if (result.error) throw result.error;
  return result.data;
}

export async function updateNote(id: string, body: string) {
  const result = await client.from('notes').update({ body }).eq('id', id).select('id,body');
  if (result.error) throw result.error;
  return result.data;
}

export async function deleteNote(id: string) {
  const result = await client.from('notes').delete().eq('id', id);
  if (result.error) throw result.error;
}
