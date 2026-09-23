import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const skill = join(root, 'skills', 'cellapp-deploy', 'SKILL.md');
const content = await readFile(skill, 'utf8');
const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(content);
if (!match || !/^name: cellapp-deploy$/m.test(match[1]) || !/^description: .{20,}$/m.test(match[1])) {
  throw new Error('Invalid CellApp Skill frontmatter');
}
if (!content.includes('`cellapp` CLI') || !content.includes('Installing this Skill does not install the CLI')) {
  throw new Error('CellApp Skill must explain the CLI prerequisite');
}
process.stdout.write('CellApp Skill structure passed.\n');
