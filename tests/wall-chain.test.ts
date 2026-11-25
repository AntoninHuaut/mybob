import assert from 'node:assert/strict';
import test from 'node:test';
import { enclosure } from '../src/model/wallChain';
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
