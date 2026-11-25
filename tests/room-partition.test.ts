import assert from 'node:assert/strict';
import test from 'node:test';
import { createHouse } from '../src/model/createHouse';
import { polygonArea } from '../src/model/geometry';
import { divideRoom } from '../src/model/roomPartition';

test('a partition joins the host axes and removes its footprint from both rooms', () => {
  const house = createHouse('project', 'Séjour', 4, 3, 0.2);
  const level = house.levels[0];
  const result = divideRoom(
    level,
    'room-1',
    [
      { wallId: 'wall-1', offset: 2.1 },
      { wallId: 'wall-3', offset: 2.1 },
    ],
    0.2,
    ['Séjour', 'Bureau'],
    ['partition', 'office'],
  );
  assert.equal(result.rooms.length, 2);
  for (const room of result.rooms) assert.ok(Math.abs(polygonArea(room.polygon) - 5.7) < 1e-9);
  assert.equal(result.walls.length, 5);
  assert.equal(level.rooms.length, 1);
});

test('a diagonal joins opposite corners and checks the openings of both incident walls', () => {
  const level = createHouse('project', 'Pièce', 4, 3, 0.2).levels[0];
  const split = () =>
    divideRoom(
      level,
      'room-1',
      [
        { wallId: 'wall-1', offset: 0 },
        { wallId: 'wall-3', offset: 0 },
      ],
      0.2,
      ['A', 'B'],
      ['partition', 'room-2'],
    );
  assert.equal(split().rooms.length, 2);
  level.walls[1].openings = [{ id: 'door', kind: 'door', offset: 2.2, width: 0.95, height: 2 }];
  assert.throws(split, /ouverture/);
});
