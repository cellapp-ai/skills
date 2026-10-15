import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const skill = join(root, 'skills', 'cellapp-deploy', 'SKILL.md');
const content = await readFile(skill, 'utf8');
const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(content);
if (!match || !/^name: cellapp-deploy$/m.test(match[1]) || !/^description: .{20,}$/m.test(match[1])) {
  throw new Error('Invalid Cellapp Skill frontmatter');
}
if (!content.includes('official `cellapp` client') || !content.includes('the user installs only this Skill')) {
  throw new Error('Cellapp Skill must explain Agent-managed client execution');
}
if (!content.includes('npm exec --yes --package=@cellapp/cli@latest -- cellapp --help') || !content.includes('Node.js is at least 22.12') || content.includes('npm install -g')) {
  throw new Error('Cellapp Skill must verify the on-demand client without global installation');
}
process.stdout.write('Cellapp Skill structure passed.\n');
