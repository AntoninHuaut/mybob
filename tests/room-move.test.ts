import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createFurniture } from '../src/furniture/model';
import { moveFurnitureToRoom } from '../src/furniture/roomMove';
import { pointInPolygon } from '../src/model/geometry';
import { validateProject } from '../src/model/validate';

// Studio demonstration: « Espace de vie » and « Salle d’eau », split by a thin partition.
const project = validateProject(
  JSON.parse(
    await readFile(new URL('../public/projects/studio-demo.json', import.meta.url), 'utf8'),
  ),
);
const level = project.levels[0];
const bathroom = level.rooms.find((room) => room.id === 'studio-sdb')!;
const living = level.rooms.find((room) => room.id === 'studio-vie')!;

const cabinet = (extra: Partial<Parameters<typeof createFurniture>[0]> = {}) =>
  createFurniture({
    kind: 'cabinet',
    id: 'commode',
    width: 0.8,
    depth: 0.45,
    height: 0.9,
    position: [4, 3],
    ...extra,
  });

test('a piece created in the wrong room arrives in the right one, dimensions untouched', () => {
  const piece = cabinet();
  const bystander = cabinet({ id: 'autre', position: [6, 4] });
  const result = moveFurnitureToRoom([piece, bystander], level, 'commode', bathroom.id);
  assert.ok(result.ok, result.ok ? '' : result.reason);
  const moved = result.items.find((item) => item.id === 'commode')!;
  assert.ok(pointInPolygon(moved.position, bathroom.polygon));
  for (const key of ['width', 'depth', 'height', 'rotation', 'color', 'name'] as const)
    assert.equal(moved[key], piece[key], key);
  assert.deepEqual(
    result.items.find((item) => item.id === 'autre'),
    bystander,
  );
});

test('a piece too big for the room is refused with the overshoot, even turned', () => {
  const sofa = createFurniture({
    kind: 'sofa',
    id: 'canape',
    width: 2.6,
    depth: 2.5,
    position: [4, 3],
  });
  const result = moveFurnitureToRoom([sofa], level, 'canape', bathroom.id);
  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.reason : '', /trop grand de \d+ cm pour « Salle d’eau »/);
});

test('a full room says that other pieces occupy it', () => {
  const crowd = Array.from({ length: 12 }, (_, index) =>
    cabinet({
      id: `plein-${index}`,
      width: 0.9,
      depth: 0.9,
      position: [0.8 + (index % 2), 0.8 + Math.floor(index / 2) * 0.35],
    }),
  );
  const result = moveFurnitureToRoom(
    [...crowd, cabinet({ width: 0.9, depth: 0.9 })],
    level,
    'commode',
    bathroom.id,
  );
  assert.equal(result.ok, false);
  assert.match(!result.ok ? result.reason : '', /place|occup|Aucun emplacement/);
});

test('moving into the room it is already in, or a locked piece, is refused', () => {
  const inside = moveFurnitureToRoom([cabinet()], level, 'commode', living.id);
  assert.equal(inside.ok, false);
  assert.match(!inside.ok ? inside.reason : '', /déjà dans « Espace de vie »/);
  const locked = moveFurnitureToRoom([cabinet({ locked: true })], level, 'commode', bathroom.id);
  assert.equal(locked.ok, false);
  assert.match(!locked.ok ? locked.reason : '', /verrouillé/);
});

test('a linked set moves rigidly with the piece that was chosen', () => {
  const a = cabinet({ id: 'a', position: [4, 3], groupId: 'g' });
  const b = cabinet({ id: 'b', position: [4, 3.5], groupId: 'g' });
  const result = moveFurnitureToRoom([a, b], level, 'a', bathroom.id);
  assert.ok(result.ok, result.ok ? '' : result.reason);
  const [ma, mb] = ['a', 'b'].map((id) => result.items.find((item) => item.id === id)!);
  assert.ok(pointInPolygon(ma.position, bathroom.polygon));
  assert.ok(Math.abs(mb.position[0] - ma.position[0]) < 1e-9);
  assert.ok(Math.abs(mb.position[1] - ma.position[1] - 0.5) < 1e-9);
  assert.equal(ma.groupId, mb.groupId);
});

test('a linked set whose follower would hit a wall is refused, saying the set does not fit', () => {
  // The follower sits far from the anchor: translated into the bathroom it lands in the wall.
  const a = cabinet({ id: 'a', position: [4, 3], groupId: 'g' });
  const b = cabinet({ id: 'b', name: 'Suiveur', position: [14, 3], groupId: 'g' });
  const result = moveFurnitureToRoom([a, b], level, 'a', bathroom.id);
  assert.equal(result.ok, false);
  assert.match(
    !result.ok ? result.reason : '',
    /ensemble lié à ce meuble ne tient pas dans « Salle d’eau »/,
  );
});
