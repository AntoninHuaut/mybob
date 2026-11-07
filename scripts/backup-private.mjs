// Copie les projets personnels vers reference-documents/, qui vit hors du dépôt.
//
// Les projets `private-*.json` sont git-ignorés : ils n'existent que sur ce
// clone. Cette copie est la seule sauvegarde hors du navigateur, donc elle doit
// être refaite après chaque passe de décision, sinon elle ment.
import { copyFile, mkdir, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const SOURCE = 'public/projects';
const TARGET = 'reference-documents';

const entries = await readdir(SOURCE);
const projects = entries.filter((name) => name.startsWith('private-') && name.endsWith('.json'));

if (projects.length === 0) {
  console.error(`Aucun projet personnel dans ${SOURCE}/.`);
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
