import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { personalFingerprints, verifyPublicBuild } from '../scripts/check-public-build.mjs';

async function fixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'public-house-'));
  try {
    await mkdir(join(root, 'projects'));
    await mkdir(join(root, 'assets'));
    await writeFile(join(root, 'index.html'), '<html lang="fr"></html>');
    await copyFile(
      new URL('../public/projects/studio-demo.json', import.meta.url),
      join(root, 'projects/studio-demo.json'),
    );
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('public build accepts only the application and the generic demonstration', () =>
  fixture(async (root) => {
    await writeFile(join(root, 'assets/app.js'), 'console.log("atelier")');
    await writeFile(join(root, 'assets/bob-test.png'), 'image');
    const files = await verifyPublicBuild(root);
    assert.ok(files.includes('index.html'));
    assert.deepEqual(
      files.filter((name) => name.endsWith('.json')),
      ['projects/studio-demo.json'],
    );
  }));

test('public build rejects the personal project even when it is not referenced by the app', () =>
  fixture(async (root) => {
    await copyFile(
      new URL('../public/projects/maison-atelier.json', import.meta.url),
      join(root, 'projects/maison-atelier.json'),
    );
    await assert.rejects(verifyPublicBuild(root), /File not meant for publication/);
  }));

test('public build rejects the wall ids of a private plan embedded inside a JavaScript asset', () =>
  fixture(async (root) => {
    const projects = new URL(`file://${root}/private-source/`);
    await mkdir(projects, { recursive: true });
    await writeFile(
      new URL('private-test.json', projects),
      JSON.stringify({ levels: [{ walls: [{ id: 'mur-secret-chambre' }] }] }),
    );
    await writeFile(join(root, 'assets/app.js'), 'const walls = ["mur-secret-chambre"]');
    await assert.rejects(
      verifyPublicBuild(root, { projectsDirectory: projects }),
      /Personal house data detected: assets\/app\.js \(contains "mur-secret-chambre"\)/,
    );
    const { files, values } = await personalFingerprints(projects);
    assert.deepEqual(files, ['private-test.json']);
    assert.deepEqual(values, ['mur-secret-chambre']);
  }));

test('public build announces when no private plan provides a fingerprint', async () => {
  const empty = new URL(`file://${await mkdtemp(join(tmpdir(), 'no-private-'))}/`);
  assert.deepEqual(await personalFingerprints(empty), { files: [], values: [] });
});

test('public build rejects any project embedded in an asset, whoever it belongs to', () =>
  fixture(async (root) => {
    await writeFile(
      join(root, 'assets/app.js'),
      `JSON.parse('{"schemaVersion":3,"levels":[{"outline":[[0,0]]}]}')`,
    );
    await assert.rejects(verifyPublicBuild(root), /Embedded house project/);
    // Minified application code writes keys unquoted: not a project.
    await writeFile(join(root, 'assets/app.js'), 'const a={schemaVersion:3,levels:[],outline:[]}');
    await verifyPublicBuild(root);
  }));

test('public build rejects original documents and missing demonstrations', () =>
  fixture(async (root) => {
    await writeFile(join(root, 'plans.pdf'), '%PDF-private');
    await assert.rejects(verifyPublicBuild(root), /File not meant for publication/);
    await rm(join(root, 'plans.pdf'));
    await rm(join(root, 'projects/studio-demo.json'));
    await assert.rejects(verifyPublicBuild(root), /demonstration missing/);
  }));

test('public build rejects unapproved image assets', () =>
  fixture(async (root) => {
    await writeFile(join(root, 'assets/personal-photo.png'), 'image');
    await assert.rejects(verifyPublicBuild(root), /File not meant for publication/);
  }));
