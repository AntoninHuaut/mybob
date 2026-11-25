import assert from 'node:assert/strict';
import test from 'node:test';
import { pointInPolygon, polygonArea } from '../src/model/geometry';
import {
  deleteOpening,
  deleteWall,
  pickPlan,
  setWallLength,
  setWallThickness,
  updateOpening,
  updateRoom,
} from '../src/model/planEdit';
import type { Level } from '../src/model/types';
import { addWallChain, emptyHouse } from '../src/model/wallDraft';

// 4 × 3 m clear inside 0.20 m walls, split by a 0.10 m partition 1.5 m from the left face.
function house(): Level {
  const empty = emptyHouse('test').levels[0];
  const box = addWallChain(
    empty,
    [
      [-0.1, -0.1],
      [4.1, -0.1],
      [4.1, 3.1],
      [-0.1, 3.1],
    ],
    true,
    0.2,
  );
  const level = addWallChain(
    box,
    [
      [1.55, -0.1],
      [1.55, 3.1],
    ],
    false,
    0.1,
  );
  const partition = level.walls.find((w) => w.id === 'wall-5')!;
  partition.openings = [{ id: 'door', kind: 'door', offset: 1, width: 0.9, height: 2.05 }];
  return level;
}
const areas = (level: Level) => level.rooms.map((r) => polygonArea(r.polygon));
const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;
const rightRoom = (level: Level) => level.rooms.find((r) => pointInPolygon([3, 1.5], r.polygon))!;

test('a click picks an opening before its wall, a wall before a room, and nothing outside', () => {
  const level = house();
  assert.deepEqual(pickPlan(level, [1.55, 1.4], 0.05), {
    kind: 'opening',
    wallId: 'wall-5',
    id: 'door',
  });
  assert.deepEqual(pickPlan(level, [1.58, 2.5], 0.05), { kind: 'wall', id: 'wall-5' });
  assert.deepEqual(pickPlan(level, [3, 1.5], 0.05), { kind: 'room', id: rightRoom(level).id });
  assert.equal(pickPlan(level, [8, 6], 0.05), undefined);
});

test('a thicker partition shrinks both rooms it separates and keeps their identity', () => {
  const level = house();
  const next = setWallThickness(level, 'wall-5', 0.15);
  assert.equal(next.walls.find((w) => w.id === 'wall-5')!.thickness, 0.15);
  assert.deepEqual(
    next.rooms.map((r) => r.id),
    level.rooms.map((r) => r.id),
  );
  areas(next).forEach((a, i) => assert.ok(close(a, areas(level)[i] - 0.025 * 3)));
  assert.throws(() => setWallThickness(level, 'wall-5', 0), /épaisseur/i);
});

test('a new length moves the end corner and every wall meeting there follows', () => {
  const level = house();
  const next = setWallLength(level, 'wall-2', 3.7);
  const [bottom, right, top] = ['wall-1', 'wall-2', 'wall-3'].map((id) =>
    next.walls.find((w) => w.id === id)!,
  );
  assert.ok(close(right.end[0], 4.1) && close(right.end[1], 3.6));
  assert.deepEqual(top.start, right.end);
  assert.deepEqual(bottom, level.walls[0]);
  assert.throws(() => setWallLength(level, 'wall-5', 1.5), /bout du mur/);
});

test('deleting the partition merges its rooms into the one that overlaps most', () => {
  const level = house();
  const next = deleteWall(level, 'wall-5');
  assert.equal(next.walls.length, 4);
  assert.equal(next.rooms.length, 1);
  assert.equal(next.rooms[0].id, rightRoom(level).id);
});

test('rooms are renamed and retyped without touching their geometry', () => {
  const level = house();
  const id = level.rooms[0].id;
  const next = updateRoom(level, id, { name: 'Bureau', kind: 'bedroom' });
  assert.equal(next.rooms[0].name, 'Bureau');
  assert.equal(next.rooms[0].kind, 'bedroom');
  assert.equal(next.rooms[0].polygon, level.rooms[0].polygon);
  assert.throws(() => updateRoom(level, id, { name: ' ' }), /nom/);
});

test('openings are edited from either jamb, refused past the wall, and deleted', () => {
  const level = house();
  const moved = updateOpening(level, 'wall-5', 'door', { reference: 'end', distance: 0.5 });
  const door = moved.walls.find((w) => w.id === 'wall-5')!.openings![0];
  assert.ok(close(door.offset, 3.2 - 0.9 - 0.5));
  assert.equal(door.height, 2.05);
  assert.throws(() => updateOpening(level, 'wall-5', 'door', { width: 4 }), /bout du mur/);
  assert.equal(level.walls[4].openings![0].width, 0.9);
  assert.deepEqual(deleteOpening(level, 'wall-5', 'door').walls[4].openings, []);
});
