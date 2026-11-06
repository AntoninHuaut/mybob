import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const demoName = 'projects/studio-demo.json';
const privateProject = JSON.parse(
  await readFile(new URL('../public/projects/maison-atelier.json', import.meta.url), 'utf8'),
);
const fingerprints = [
  privateProject.source.title,
  ...privateProject.levels[0].walls
    .map((wall) => wall.id)
    .filter((id) => id.length >= 10 && id.includes('-')),
];
export async function verifyPublicBuild(directory) {
  const root = resolve(directory);
  const files = [];
  async function inspect(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink())
        throw new Error(`Lien symbolique non autorisé : ${relative(root, path)}`);
      if (entry.isDirectory()) {
        await inspect(path);
        continue;
      }
      const name = relative(root, path).replaceAll('\\', '/');
      const allowed =
        ['index.html', 'favicon.svg', demoName].includes(name) ||
        /^assets\/[\w.-]+\.(?:js|css|woff2?)$/.test(name) ||
        /^assets\/bob-[\w-]+\.png$/.test(name);
      if (!allowed) throw new Error(`Fichier non prévu pour la publication : ${name}`);
      if (/\.(?:js|json|html|css|svg)$/.test(name)) {
        const source = await readFile(path, 'utf8');
        if (fingerprints.some((value) => source.includes(value)))
          throw new Error(`Données de maison personnelle détectées : ${name}`);
      }
      files.push(name);
    }
  }

  await inspect(root);
  if (!files.includes('index.html') || !files.includes(demoName))
    throw new Error('Application publique ou démonstration absente.');
  const demo = JSON.parse(await readFile(resolve(root, demoName), 'utf8'));
  if (demo.id !== 'studio-demo')
    throw new Error('Le seul projet embarqué doit être la démonstration.');
  return files;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const files = await verifyPublicBuild(process.argv[2] ?? 'dist');
    console.log(
      `Build public vérifié : ${files.length} fichiers, démonstration seule, sans plan personnel.`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
