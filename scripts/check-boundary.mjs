import { readFile, readdir } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const rules = JSON.parse(await readFile(join(root, 'public-boundary.json'), 'utf8'));
const patterns = rules.sensitiveContentPatterns.map(value => new RegExp(value));

function permitted(path) {
  if (path.split('/').some(part => part.startsWith('.env'))) return false;
  if (rules.forbiddenFiles.includes(path) || rules.forbiddenPrefixes.some(prefix => path.startsWith(prefix))) return false;
  return rules.allowedFiles.includes(path) || rules.allowedPrefixes.some(prefix => path.startsWith(prefix));
}

async function checkDirectory(directory) {
  const failures = [];
  async function visit(at) {
    for (const entry of await readdir(at, {withFileTypes: true})) {
      if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === 'dist') continue;
      const full = join(at, entry.name);
      const path = relative(directory, full).split(sep).join('/');
      if (entry.isSymbolicLink()) { failures.push(`symlink: ${path}`); continue; }
      if (entry.isDirectory()) { await visit(full); continue; }
      if (!entry.isFile() || !permitted(path)) { failures.push(`forbidden path: ${path}`); continue; }
      const value = await readFile(full, 'utf8');
      if (patterns.some(pattern => pattern.test(value))) failures.push(`sensitive content: ${path}`);
    }
  }
  await visit(directory);
  return failures;
}

const failures = await checkDirectory(root);
if (failures.length) {
  for (const failure of failures) process.stderr.write(`${failure}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('Public source boundary passed.\n');
}

export { permitted, checkDirectory };
