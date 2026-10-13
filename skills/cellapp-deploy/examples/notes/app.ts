import { addNote, currentAppUser, deleteNote, listNotes, updateNote } from './notes.js';

const form = document.querySelector<HTMLFormElement>('#create-form')!;
const input = document.querySelector<HTMLInputElement>('#note-body')!;
const notes = document.querySelector<HTMLUListElement>('#notes')!;
const identity = document.querySelector<HTMLElement>('#identity')!;
const status = document.querySelector<HTMLElement>('#status')!;
const check = document.querySelector<HTMLButtonElement>('#crud')!;

function report(message: string, error = false): void {
  status.textContent = message;
  status.classList.toggle('error', error);
}

function failure(error: unknown): void {
  report(error instanceof Error ? error.message : String(error), true);
}

async function refresh(): Promise<void> {
  const rows = await listNotes();
  notes.replaceChildren();
  if (!rows?.length) {
    const empty = document.createElement('li');
    empty.textContent = '还没有笔记。';
    notes.append(empty);
    return;
  }
  for (const row of rows) {
    const item = document.createElement('li');
    const body = document.createElement('span');
    body.textContent = row.body;
    const actions = document.createElement('div');
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'secondary';
    edit.textContent = '编辑';
    edit.setAttribute('aria-label', `编辑笔记 ${row.body}`);
    edit.addEventListener('click', async () => {
      const next = prompt('修改笔记', row.body);
      if (next === null || !next.trim()) return;
      edit.disabled = true;
      try {
        await updateNote(row.id, next.trim());
        await refresh();
        report('笔记已更新');
      } catch (error) { failure(error); }
      finally { edit.disabled = false; }
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'secondary';
    remove.textContent = '删除';
    remove.setAttribute('aria-label', `删除笔记 ${row.body}`);
    remove.addEventListener('click', async () => {
      remove.disabled = true;
      try {
        await deleteNote(row.id);
        await refresh();
        report('笔记已删除');
      } catch (error) { failure(error); }
      finally { remove.disabled = false; }
    });
    actions.append(edit, remove);
    item.append(body, actions);
    notes.append(item);
  }
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  const body = input.value.trim();
  if (!body) return;
  const save = form.querySelector<HTMLButtonElement>('button')!;
  save.disabled = true;
  try {
    await addNote(body);
    input.value = '';
    await refresh();
    report('笔记已保存');
  } catch (error) { failure(error); }
  finally { save.disabled = false; }
});

check.addEventListener('click', async () => {
  check.disabled = true;
  const marker = `CRUD ${crypto.randomUUID()}`;
  try {
    const inserted = await addNote(marker);
    if (inserted?.length !== 1) throw new Error('创建后未返回笔记');
    const row = inserted[0]!;
    const selected = await listNotes();
    if (!selected?.some(note => note.id === row.id && note.body === marker)) throw new Error('未读到刚创建的笔记');
    const changed = await updateNote(row.id, marker + ' updated');
    if (changed?.[0]?.body !== marker + ' updated') throw new Error('更新后的内容不一致');
    await deleteNote(row.id);
    const remaining = await listNotes();
    if (remaining?.some(note => note.id === row.id)) throw new Error('删除后仍能读到笔记');
    await refresh();
    report('CRUD passed');
  } catch (error) { failure(error); }
  finally { check.disabled = false; }
});

void (async () => {
  try {
    const user = await currentAppUser();
    document.body.dataset.user = user;
    identity.textContent = `当前应用用户：${user.slice(0, 8)}…`;
    await refresh();
    report('应用数据库已连接');
  } catch (error) {
    identity.textContent = '无法连接应用数据库';
    failure(error);
  }
})();
