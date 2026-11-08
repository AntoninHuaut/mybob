import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { quarantinedEntries, restoreProjects } from '../src/projectStorage';
import type { HouseProject } from '../src/model/types';

const KEY = 'maison-atelier:projects:v1';
const validate = (value: unknown): HouseProject => {
  const p = value as { id?: string; schemaVersion?: number };
  if (p?.schemaVersion !== 1) throw new Error('schéma inconnu');
  return p as unknown as HouseProject;
};

test('une entrée illisible survit en quarantaine, hors de la clé réécrite', () => {
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
  // Simule import / renommage / suppression : la clé principale est réécrite sans l'entrée.
  storage.setItem(KEY, JSON.stringify(restored.projects));
  storage.setItem(KEY, JSON.stringify([]));
  const kept = quarantinedEntries(storage, KEY);
  assert.deepEqual(
    kept.map((entry) => JSON.parse(entry).id),
    ['futur'],
  );
  // Un redémarrage ne duplique pas la quarantaine.
  restoreProjects(storage, KEY, validate);
  assert.equal(quarantinedEntries(storage, KEY).length, 1);
});

test('un JSON tronqué est conservé octet pour octet', () => {
  const storage = new Window().localStorage as unknown as Storage;
  const truncated = '[{"id":"a","schemaVersion":1},{"id":"b"';
  storage.setItem(KEY, truncated);
  const restored = restoreProjects(storage, KEY, validate);
  assert.equal(restored.projects.length, 0);
  assert.deepEqual(quarantinedEntries(storage, KEY), [truncated]);
});

test('les entrées en quarantaine ne comptent pas dans la limite de 10', () => {
  const storage = new Window().localStorage as unknown as Storage;
  storage.setItem(
    KEY,
    JSON.stringify(Array.from({ length: 10 }, (_, i) => ({ id: `f${i}`, schemaVersion: 2 }))),
  );
  const restored = restoreProjects(storage, KEY, validate);
  assert.equal(restored.projects.length, 0);
  assert.equal(restored.quarantined, 10);
});
