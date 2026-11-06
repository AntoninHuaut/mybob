import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createFurniture,
  footprint,
  footprintParts,
  FURNITURE_PRESETS,
  validateFurnitureList,
} from '../src/furniture/model';
import { checkFurniture, polygonsOverlap } from '../src/furniture/checks';
import { polygonArea } from '../src/model/geometry';
import type { Level } from '../src/model/types';

const level: Level = {
  id: 'room',
  name: 'Pièce',
  elevation: 0,
  ceilingHeight: 2.5,
  outline: [
    [0, 0],
    [10, 0],
    [10, 8],
    [0, 8],
  ],
  walls: [],
  rooms: [
    {
      id: 'inside',
      name: 'Intérieur',
      kind: 'living',
      polygon: [
        [0, 0],
        [10, 0],
        [10, 8],
        [0, 8],
      ],
      label: [5, 4],
      viewpoint: [5, 4],
    },
  ],
  lights: [],
  spawn: { position: [3, 3], yaw: Math.PI },
};
const cornerDressing = () =>
  createFurniture({
    kind: 'dressing',
    width: 3,
    depth: 2,
    height: 2.2,
    position: [3, 3],
    dressing: { side: 'left', runDepth: 0.8, returnWidth: 1 },
  });

test('a straight dressing keeps a single rectangular footprint', () => {
  const dressing = createFurniture({ kind: 'dressing', position: [3, 3] });
  assert.equal(dressing.dressing, undefined);
  assert.equal(dressing.depth, FURNITURE_PRESETS.dressing.depth);
  const parts = footprintParts(dressing);
  assert.equal(parts.length, 1);
  assert.deepEqual(parts[0], footprint(dressing));
});

test('a corner dressing occupies two convex runs and leaves the inside corner free', () => {
  const dressing = cornerDressing();
  const parts = footprintParts(dressing);
  assert.equal(parts.length, 2);
  assert.ok(Math.abs(parts.reduce((sum, part) => sum + polygonArea(part), 0) - 3.6) < 0.0001);
  assert.equal(polygonsOverlap(parts[0], parts[1]), false);
  // The bounding rectangle alone would reject a stool standing in the empty corner.
  const stool = createFurniture({
    kind: 'ottoman',
    width: 0.4,
    depth: 0.4,
    height: 0.4,
    position: [3.75, 3.4],
  });
  assert.ok(polygonsOverlap(footprint(dressing), footprint(stool)));
  assert.equal(
    checkFurniture([dressing, stool], level).some((issue) => issue.severity === 'error'),
    false,
  );
  stool.position = [2, 3.4];
  assert.ok(checkFurniture([dressing, stool], level).some((issue) => issue.severity === 'error'));
});

test('the dressing return follows its side and the overall rotation', () => {
  const dressing = cornerDressing();
  assert.ok(footprintParts(dressing)[1].every((point) => point[0] <= 2.5));
  dressing.dressing!.side = 'right';
  assert.ok(footprintParts(dressing)[1].every((point) => point[0] >= 3.5));
  dressing.rotation = Math.PI / 2;
  assert.ok(footprintParts(dressing)[1].every((point) => point[1] <= 2.5));
  assert.equal(dressing.width, 3);
  assert.equal(dressing.depth, 2);
});

test('a corner dressing defaults to a usable return and rejects impossible measurements', () => {
  const created = createFurniture({ kind: 'dressing', dressing: {} });
  assert.equal(created.depth, 1.2);
  assert.deepEqual(created.dressing, { side: 'left', runDepth: 0.6, returnWidth: 0.6 });
  assert.throws(() => createFurniture({ kind: 'dressing', dressing: { runDepth: 10 } }));
  assert.throws(() => createFurniture({ kind: 'dressing', dressing: { returnWidth: 10 } }));
  assert.throws(() =>
    createFurniture({ kind: 'dressing', dressing: { side: 'middle' as 'left' } }),
  );
  assert.throws(() => createFurniture({ kind: 'table', dressing: {} }));
  // A run as deep as the whole footprint leaves no room for the return.
  assert.throws(() =>
    createFurniture({
      kind: 'dressing',
      width: 2,
      depth: 0.6,
      dressing: { runDepth: 0.6, returnWidth: 0.6 },
    }),
  );
});

test('a corner dressing survives validation and duplication with its exact measurements', () => {
  const dressing = cornerDressing();
  const [validated] = validateFurnitureList([dressing]);
  assert.deepEqual(validated.dressing, dressing.dressing);
  const copy = createFurniture({ ...dressing, id: undefined, name: 'Dressing (copie)' });
  assert.deepEqual(copy.dressing, dressing.dressing);
  assert.equal(copy.depth, dressing.depth);
});
