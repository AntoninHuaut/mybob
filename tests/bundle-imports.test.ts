import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

async function sources(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return sources(path);
      return Promise.resolve(entry.name.endsWith('.ts') ? [path] : []);
    }),
  );
  return nested.flat();
}

// `MeshBuilder` re-exports every Babylon builder (decal, polyhedron, text, goldberg…):
// importing it put about 80 kB of unused minified code in the engine chunk every visitor
// downloads. Each builder is imported from `Meshes/Builders/<name>Builder` instead.
test('the application imports mesh builders one by one, never MeshBuilder', async () => {
  const offenders: string[] = [];
  for (const file of await sources(fileURLToPath(new URL('../src/', import.meta.url)))) {
    const text = await readFile(file, 'utf8');
    if (/from '@babylonjs\/core\/Meshes\/meshBuilder'/.test(text)) offenders.push(file);
  }
  assert.deepEqual(offenders, []);
});
