import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyPublicBuild } from '../scripts/check-public-build.mjs';

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
    await assert.rejects(verifyPublicBuild(root), /Fichier non prévu/);
  }));

test('public build rejects personal geometry embedded inside a JavaScript asset', () =>
  fixture(async (root) => {
    await writeFile(join(root, 'assets/app.js'), 'const walls = ["mur-ouest-garage"]');
    await assert.rejects(verifyPublicBuild(root), /Données de maison personnelle/);
  }));

test('public build rejects original documents and missing demonstrations', () =>
  fixture(async (root) => {
    await writeFile(join(root, 'plans.pdf'), '%PDF-private');
    await assert.rejects(verifyPublicBuild(root), /Fichier non prévu/);
    await rm(join(root, 'plans.pdf'));
    await rm(join(root, 'projects/studio-demo.json'));
    await assert.rejects(verifyPublicBuild(root), /démonstration absente/);
  }));

test('public build rejects unapproved image assets', () =>
  fixture(async (root) => {
    await writeFile(join(root, 'assets/personal-photo.png'), 'image');
    await assert.rejects(verifyPublicBuild(root), /Fichier non prévu/);
  }));
