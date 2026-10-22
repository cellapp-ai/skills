import { createCellappClient } from '@cellapp/sdk';

const client = createCellappClient();

export async function currentAppUser(): Promise<string> {
  return (await client.currentUser()).id;
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
