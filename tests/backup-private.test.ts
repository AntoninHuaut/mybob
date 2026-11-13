import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const SCRIPT = resolve('scripts/backup-private.mjs');

function workspace() {
  const root = mkdtempSync(join(tmpdir(), 'backup-private-'));
  mkdirSync(join(root, 'public/projects'), { recursive: true });
  mkdirSync(join(root, 'reference-documents'));
  return root;
}

const project = (name: string) =>
  JSON.stringify({ id: 'maison-test', name, levels: [{ id: 'niveau-0' }] });

const run = (root: string, ...args: string[]) =>
  spawnSync(process.execPath, [SCRIPT, ...args], { cwd: root, encoding: 'utf8' });

function setMtime(path: string, seconds: number) {
  utimesSync(path, seconds, seconds);
}

test('a more recent, different reference is not overwritten by a stale working copy', () => {
  const root = workspace();
  try {
    const working = join(root, 'public/projects/private-test.json');
    const reference = join(root, 'reference-documents/maison-test.json');
    writeFileSync(working, project('ancienne'));
    writeFileSync(reference, project('corrigée'));
    setMtime(working, 1_000_000);
    setMtime(reference, 2_000_000);
    const refused = run(root);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /more recent, not overwritten/);
    assert.equal(readFileSync(reference, 'utf8'), project('corrigée'));
    assert.equal(run(root, '--force').status, 0);
    assert.equal(readFileSync(reference, 'utf8'), project('ancienne'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a more recent working copy replaces the reference, an absent one is created', () => {
  const root = workspace();
  try {
    const working = join(root, 'public/projects/private-test.json');
    const reference = join(root, 'reference-documents/maison-test.json');
    writeFileSync(working, project('v1'));
    assert.equal(run(root).status, 0);
    assert.equal(readFileSync(reference, 'utf8'), project('v1'));
    writeFileSync(working, project('v2'));
    setMtime(reference, 1_000_000);
    setMtime(working, 2_000_000);
    assert.equal(run(root).status, 0);
    assert.equal(readFileSync(reference, 'utf8'), project('v2'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
