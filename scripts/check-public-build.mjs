import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const demoName = 'projects/studio-demo.json';
const defaultProjects = new URL('../public/projects/', import.meta.url);

// A project inlined in an asset is recognised by its shape, whoever's house it is: the
// demonstration ships as a separate JSON file, never inside the JavaScript. Minified code
// writes object keys unquoted, so quoted keys only appear in embedded JSON.
const projectShape = [/schemaVersion/, /\\?"levels\\?"/, /\\?"outline\\?"/];

/** Identifiers of the personal plans present on this machine (`private-*.json`). */
export async function personalFingerprints(projectsDirectory = defaultProjects) {
  const values = new Set();
  const files = [];
  let entries = [];
  try {
    entries = await readdir(projectsDirectory);
  } catch {
    // No projects folder: nothing personal to derive.
  }
  for (const name of entries.filter((entry) => /^private-.*\.json$/.test(entry)).sort()) {
    const project = JSON.parse(await readFile(new URL(name, projectsDirectory), 'utf8'));
    files.push(name);
    if (typeof project.source?.title === 'string') values.add(project.source.title);
    for (const level of project.levels ?? [])
      for (const wall of level.walls ?? [])
        if (typeof wall.id === 'string' && wall.id.length >= 10 && wall.id.includes('-'))
          values.add(wall.id);
  }
  return { files, values: [...values] };
}

export async function verifyPublicBuild(directory, { projectsDirectory = defaultProjects } = {}) {
  const root = resolve(directory);
  const { values: fingerprints } = await personalFingerprints(projectsDirectory);
  const files = [];
  async function inspect(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink())
        throw new Error(`Symbolic link not allowed: ${relative(root, path)}`);
      if (entry.isDirectory()) {
        await inspect(path);
        continue;
      }
      const name = relative(root, path).replaceAll('\\', '/');
      const allowed =
        ['index.html', 'favicon.svg', '_headers', demoName].includes(name) ||
        /^assets\/[\w.-]+\.(?:js|css|woff2?)$/.test(name) ||
        /^assets\/bob-[\w-]+\.png$/.test(name);
      if (!allowed) throw new Error(`File not meant for publication: ${name}`);
      if (/\.(?:js|json|html|css|svg)$/.test(name)) {
        const source = await readFile(path, 'utf8');
        const leaked = fingerprints.find((value) => source.includes(value));
        if (leaked) throw new Error(`Personal house data detected: ${name} (contains "${leaked}")`);
        if (name.endsWith('.js') && projectShape.every((shape) => shape.test(source)))
          throw new Error(`Embedded house project detected: ${name}`);
      }
      files.push(name);
    }
  }

  await inspect(root);
  if (!files.includes('index.html') || !files.includes(demoName))
    throw new Error('Public application or demonstration missing.');
  const demo = JSON.parse(await readFile(resolve(root, demoName), 'utf8'));
  if (demo.id !== 'studio-demo')
    throw new Error('The only bundled project must be the demonstration.');
  return files;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const files = await verifyPublicBuild(process.argv[2] ?? 'dist');
    const { files: personal } = await personalFingerprints();
    console.log(
      `Public build verified: ${files.length} files, demonstration only, no embedded project.`,
    );
    console.log(
      personal.length
        ? `Personal fingerprints checked from: ${personal.join(', ')}.`
        : 'No private-*.json present: no personal fingerprint was checked, only file names and the project shape.',
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
