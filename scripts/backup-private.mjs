// Copies personal projects to reference-documents/, which lives outside the repository.
//
// `private-*.json` projects are git-ignored working copies: `reference-documents/<id>.json` is
// the reference. A copy that is already there, different and more recent than the working copy
// is never overwritten: the working copy is the stale one (it happened: an old
// `private-*.json` would have replaced the corrected reference). `--force` overwrites anyway.
import { copyFile, mkdir, readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const SOURCE = 'public/projects';
const TARGET = 'reference-documents';
const force = process.argv.includes('--force');

const entries = await readdir(SOURCE);
const projects = entries.filter((name) => name.startsWith('private-') && name.endsWith('.json'));

if (projects.length === 0) {
  console.error(`No personal project in ${SOURCE}/.`);
  process.exit(1);
}

await mkdir(TARGET, { recursive: true });

let refused = 0;
for (const name of projects) {
  const path = join(SOURCE, name);
  const text = await readFile(path, 'utf8');
  const project = JSON.parse(text);
  const target = join(TARGET, `${project.id}.json`);
  const existing = await readFile(target, 'utf8').catch(() => undefined);
  if (existing === text) {
    console.log(`${name} = ${target}  (unchanged)`);
    continue;
  }
  if (existing !== undefined && !force) {
    const [source, reference] = await Promise.all([stat(path), stat(target)]);
    if (reference.mtimeMs > source.mtimeMs) {
      console.error(
        `${name}: ${target} differs and is more recent, not overwritten. ` +
          `Copy the reference over ${path}, or rerun with --force if ${path} is the right one.`,
      );
      refused++;
      continue;
    }
  }
  await copyFile(path, target);
  const levels = project.levels.map((level) => level.id).join(', ');
  console.log(`${name} -> ${target}  (${project.name} · ${levels})`);
}

if (refused > 0) process.exit(1);
