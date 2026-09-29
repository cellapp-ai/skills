import { execFileSync } from 'node:child_process';

const output = execFileSync('npm', ['pack', '--dry-run', '--json'], {encoding: 'utf8'});
const [{files}] = JSON.parse(output);
const paths = files.map(file => file.path);
for (const required of ['LICENSE', 'README.md', 'NOTICE', 'package.json', 'skills/cellapp-deploy/SKILL.md', 'dist/packages/cli/src/main.js', 'dist/packages/shared/src/artifacts.js']) {
  if (!paths.includes(required)) throw new Error(`Package missing ${required}`);
}
for (const path of paths) {
  if (path.startsWith('apps/') || path.startsWith('infra/') || path.startsWith('openspec/') || path.endsWith('.env')) {
    throw new Error(`Private path in package: ${path}`);
  }
}
process.stdout.write(`Cellapp package contains ${paths.length} approved files.\n`);
