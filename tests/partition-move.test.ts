import assert from 'node:assert/strict';
import test from 'node:test';
import { createHouse } from '../src/model/createHouse';
import { addWallChain } from '../src/model/wallDraft';
import { movePartition } from '../src/model/partitionMove';
import { polygonArea } from '../src/model/geometry';

test('moving a partition updates both finished areas and carries the hosted door', () => {
  const level = dividedRoom();
  level.walls.at(-1)!.openings = [
    { id: 'door', kind: 'door', width: 0.9, height: 2, offset: 0.45, hinge: 'end', swing: -1 },
  ];
  level.rooms[0].planArea = 5.8;
  const next = movePartition(level, 'partition', 0.3);
  assert.deepEqual(
    next.rooms.map((r) => r.id),
    level.rooms.map((r) => r.id),
  );
  assert.ok(Math.abs(polygonArea(next.rooms[0].polygon) - 4.8) < 1e-9);
  assert.ok(Math.abs(polygonArea(next.rooms[1].polygon) - 6.6) < 1e-9);
  assert.deepEqual(next.walls.at(-1)!.openings, level.walls.at(-1)!.openings);
  assert.equal(next.rooms[0].planArea, 5.8);
});

/** A 0.20 m partition across the middle of a 4 × 3 m clear room. */
function dividedRoom() {
  const level = addWallChain(
    createHouse('project', 'Salon', 4, 3, 0.2).levels[0],
    [
      [2, -0.1],
      [2, 3.1],
    ],
    false,
    0.2,
  );
  level.walls[4].id = 'partition';
  return level;
}

test('a move past the host wall is rejected and leaves the level untouched', () => {
  const level = dividedRoom();
  const before = structuredClone(level);
  assert.throws(() => movePartition(level, 'partition', 5), /dépasse/);
  assert.deepEqual(level, before);
});

test('the spawn follows its room when the partition sweeps over it', () => {
  const level = dividedRoom();
  const partition = level.walls.find((w) => w.id === 'partition')!;
  const x = partition.start[0];
  level.spawn = { ...level.spawn, position: [x - 0.4, 1.5] };
  const next = movePartition(level, 'partition', x > 2 ? -0.6 : 0.6);
  assert.notDeepEqual(next.spawn.position, level.spawn.position);
  assert.ok(next.rooms.some((r) => r.viewpoint === next.spawn.position));
});
