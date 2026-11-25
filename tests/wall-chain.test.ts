import assert from 'node:assert/strict';
import test from 'node:test';
import { enclosure, nextCorner } from '../src/model/wallChain';
import { pointInPolygon, polygonArea } from '../src/model/geometry';

test('finished faces meet at the corners of a closed axis chain', () => {
  const room = enclosure(
    [
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ],
    0.2,
  );
  assert.ok(Math.abs(polygonArea(room.polygon) - 10.64) < 1e-10);
  assert.ok(pointInPolygon(room.viewpoint, room.polygon));
});

test('a narrow angled enclosure places its viewpoint clear of all three walls', () => {
  const shape = enclosure(
    [
      [0, 0],
      [10, 0],
      [0, 0.6],
    ],
    0.1,
  );
  assert.ok(pointInPolygon(shape.viewpoint, shape.polygon));
});

test('the next corner snaps to a right angle and takes the typed length exactly', () => {
  assert.deepEqual(nextCorner([1.003, 0.998], [3.02, 1.07], 4.2), [1.003 + 4.2, 0.998]);
  assert.deepEqual(nextCorner([5.2, 1], [5.31, 2.9]), [5.2, 2.9]);
  const [x, z] = nextCorner([0, 0], [2.1, 1.9], 1)!;
  assert.ok(Math.abs(x - Math.SQRT1_2) < 1e-12 && Math.abs(z - Math.SQRT1_2) < 1e-12);
});

test('a free angle keeps the pointed direction', () => {
  assert.deepEqual(nextCorner([0, 0], [3, 1], undefined, false), [3, 1]);
  const [x, z] = nextCorner([0, 0], [3, 4], 10, false)!;
  assert.ok(Math.abs(x - 6) < 1e-12 && Math.abs(z - 8) < 1e-12);
});
