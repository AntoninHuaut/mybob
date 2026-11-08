// Copies personal projects to reference-documents/, which lives outside the repository.
//
// `private-*.json` projects are git-ignored: they only exist on this
// clone. This copy is the only backup outside the browser, so it must
// be redone after every decision pass, otherwise it lies.
import { copyFile, mkdir, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const SOURCE = 'public/projects';
const TARGET = 'reference-documents';

const entries = await readdir(SOURCE);
const projects = entries.filter((name) => name.startsWith('private-') && name.endsWith('.json'));

if (projects.length === 0) {
  console.error(`No personal project in ${SOURCE}/.`);
  process.exit(1);
}

await mkdir(TARGET, { recursive: true });

for (const name of projects) {
  const path = join(SOURCE, name);
  const project = JSON.parse(await readFile(path, 'utf8'));
  const target = join(TARGET, `${project.id}.json`);
  await copyFile(path, target);
  const levels = project.levels.map((level) => level.id).join(', ');
  console.log(`${name} -> ${target}  (${project.name} · ${levels})`);
}
