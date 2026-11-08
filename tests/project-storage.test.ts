import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { quarantineExport, quarantinedEntries, restoreProjects } from '../src/projectStorage';
import type { HouseProject } from '../src/model/types';

const KEY = 'maison-atelier:projects:v1';
const validate = (value: unknown): HouseProject => {
  const p = value as { id?: string; schemaVersion?: number };
  if (p?.schemaVersion !== 1) throw new Error('schéma inconnu');
  return p as unknown as HouseProject;
};

test('an unreadable entry survives in quarantine, outside the rewritten key', () => {
  const storage = new Window().localStorage as unknown as Storage;
  storage.setItem(
    KEY,
    JSON.stringify([
      { id: 'garde', schemaVersion: 1 },
      { id: 'futur', schemaVersion: 2 },
    ]),
  );
  const restored = restoreProjects(storage, KEY, validate);
  assert.deepEqual(
    restored.projects.map((p) => p.id),
    ['garde'],
  );
  assert.equal(restored.unreadable, 1);
  // Simulates import / rename / delete: the main key is rewritten without the entry.
  storage.setItem(KEY, JSON.stringify(restored.projects));
  storage.setItem(KEY, JSON.stringify([]));
  const kept = quarantinedEntries(storage, KEY);
  assert.deepEqual(
    kept.map((entry) => JSON.parse(entry).id),
    ['futur'],
  );
  // A restart does not duplicate the quarantine.
  restoreProjects(storage, KEY, validate);
  assert.equal(quarantinedEntries(storage, KEY).length, 1);
});

test('a truncated JSON is kept byte for byte', () => {
  const storage = new Window().localStorage as unknown as Storage;
  const truncated = '[{"id":"a","schemaVersion":1},{"id":"b"';
  storage.setItem(KEY, truncated);
  const restored = restoreProjects(storage, KEY, validate);
  assert.equal(restored.projects.length, 0);
  assert.deepEqual(quarantinedEntries(storage, KEY), [truncated]);
});

test('quarantined entries do not count towards the limit of 10', () => {
  const storage = new Window().localStorage as unknown as Storage;
  storage.setItem(
    KEY,
    JSON.stringify(Array.from({ length: 10 }, (_, i) => ({ id: `f${i}`, schemaVersion: 2 }))),
  );
  const restored = restoreProjects(storage, KEY, validate);
  assert.equal(restored.projects.length, 0);
  assert.equal(restored.quarantined, 10);
});

test('the rescue file returns readable entries as JSON and the rest as raw text', () => {
  const storage = new Window().localStorage as unknown as Storage;
  storage.setItem(
    KEY + ':quarantine',
    JSON.stringify(['{"id":"futur","schemaVersion":2}', '[{"id":"b"']),
  );
  assert.deepEqual(JSON.parse(quarantineExport(storage, KEY)), [
    { id: 'futur', schemaVersion: 2 },
    '[{"id":"b"',
  ]);
});
