import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createFurniture } from '../src/furniture/model';
import {
  dropFurnitureInRoom,
  flipAgainstPartition,
  moveFurnitureToRoom,
  partitionBehind,
} from '../src/furniture/roomMove';
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

test('a drop lands on the valid spot of the room nearest to the pointer, ignoring other pieces', () => {
  const piece = cabinet();
  // A piece already sits where the pointer is: a drop, like a drag, may overlap it.
  const there = cabinet({ id: 'la', position: [1.3, 1.3] });
  const result = dropFurnitureInRoom([piece, there], level, 'commode', bathroom.id, [1.3, 1.3]);
  assert.ok(result.ok, result.ok ? '' : result.reason);
  const dropped = result.items.find((item) => item.id === 'commode')!.position;
  assert.ok(Math.hypot(dropped[0] - 1.3, dropped[1] - 1.3) < 1e-9, `${dropped}`);
  // Pointer in the partition's reach: the piece lands inside the room, as close as possible.
  const near = dropFurnitureInRoom([piece], level, 'commode', bathroom.id, [2.25, 1.3]);
  assert.ok(near.ok, near.ok ? '' : near.reason);
  const landed = near.items[0];
  assert.ok(pointInPolygon(landed.position, bathroom.polygon));
  assert.ok(landed.position[0] < 2.3 - 0.4 + 0.2, `${landed.position}`);
  assert.equal(landed.width, piece.width);
});

// Back against the partition at x = 2.35 (faces 2.30 and 2.40), front towards +x.
const dressing = (extra: Partial<Parameters<typeof createFurniture>[0]> = {}) =>
  cabinet({ id: 'dressing', rotation: Math.PI / 2, position: [2.4 + 0.225 + 0.01, 1.4], ...extra });

test('a piece against a partition flips to the other face with the same gap and dimensions', () => {
  const piece = dressing();
  assert.equal(partitionBehind(piece, level)?.id, 'studio-sdb-e');
  const result = flipAgainstPartition([piece], level, 'dressing');
  assert.ok(result.ok, result.ok ? '' : result.reason);
  const flipped = result.items[0];
  assert.ok(Math.abs(flipped.position[0] - (2.3 - 0.225 - 0.01)) < 1e-9, `${flipped.position}`);
  assert.equal(flipped.position[1], 1.4);
  assert.ok(Math.abs(flipped.rotation - (3 * Math.PI) / 2) < 1e-9);
  assert.ok(pointInPolygon(flipped.position, bathroom.polygon));
  for (const key of ['width', 'depth', 'height'] as const) assert.equal(flipped[key], piece[key]);
  // And back again.
  const back = flipAgainstPartition(result.items, level, 'dressing');
  assert.ok(back.ok);
  assert.ok(Math.abs(back.items[0].position[0] - piece.position[0]) < 1e-9);
});

test('no flip for a piece away from a partition, against an exterior wall, or blocked behind', () => {
  // Facing the partition, or 30 cm away from it: not against it.
  assert.equal(partitionBehind(dressing({ rotation: -Math.PI / 2 }), level), undefined);
  assert.equal(partitionBehind(dressing({ position: [2.95, 1.4] }), level), undefined);
  const outside = flipAgainstPartition([dressing({ position: [2.95, 1.4] })], level, 'dressing');
  assert.match(!outside.ok ? outside.reason : '', /pas adossé à une cloison/);
  // Back against the north exterior wall (inner face z = 0.30), front towards +z.
  assert.equal(partitionBehind(cabinet({ position: [5, 0.3 + 0.225 + 0.01] }), level), undefined);
  // A piece wider than the bathroom is deep: on the other side it would cross the wall.
  const long = dressing({ width: 2.6, position: [2.635, 1.6] });
  const blocked = flipAgainstPartition([long], level, 'dressing');
  assert.match(!blocked.ok ? blocked.reason : '', /De l’autre côté de la cloison/);
});
