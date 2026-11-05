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
import {
  constrainFurnitureDrag,
  findFurniturePlacement,
  getBuildingPlacementIssues,
} from '../src/furniture/placement';
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
const lSofa = () =>
  createFurniture({
    kind: 'sofa',
    width: 3,
    depth: 2,
    height: 0.85,
    position: [3, 3],
    sofa: { shape: 'corner', side: 'left', seatDepth: 0.8, returnWidth: 1 },
  });

test('corner and chaise have real occupied L footprints, with the empty corner excluded', () => {
  for (const shape of ['corner', 'chaise'] as const) {
    const sofa = lSofa();
    sofa.sofa!.shape = shape;
    const parts = footprintParts(sofa);
    assert.equal(parts.length, 2);
    assert.ok(Math.abs(parts.reduce((a, p) => a + polygonArea(p), 0) - 3.6) < 0.0001);
    assert.equal(polygonsOverlap(parts[0], parts[1]), false);
    const table = createFurniture({
      kind: 'coffee-table',
      width: 0.4,
      depth: 0.4,
      height: 0.4,
      position: [3.75, 3.4],
    });
    assert.ok(
      polygonsOverlap(footprint(sofa), footprint(table)),
      'the bounding rectangle alone would be too conservative',
    );
    assert.equal(
      checkFurniture([sofa, table], level).some((i) => i.severity === 'error'),
      false,
    );
    table.position = [2, 3.4];
    assert.ok(checkFurniture([sofa, table], level).some((i) => i.severity === 'error'));
  }
});

test('left return is local negative X and follows rotation while overall dimensions stay unchanged', () => {
  const sofa = lSofa();
  const extension = footprintParts(sofa)[1];
  assert.ok(extension.every((p) => p[0] <= 2.5));
  sofa.sofa!.side = 'right';
  assert.ok(footprintParts(sofa)[1].every((p) => p[0] >= 3.5));
  sofa.rotation = Math.PI / 2;
  assert.ok(footprintParts(sofa)[1].every((p) => p[1] <= 2.5));
  assert.equal(sofa.width, 3);
  assert.equal(sofa.depth, 2);
});

test('the actual L can fit a concave outline even when the unused bounding corner is outside', () => {
  const notch = structuredClone(level);
  notch.outline = [
    [0, 0],
    [6, 0],
    [6, 2.8],
    [2.5, 2.8],
    [2.5, 6],
    [0, 6],
  ];
  assert.equal(getBuildingPlacementIssues(lSofa(), notch).length, 0);
  const ordinary = createFurniture({ kind: 'sofa', width: 3, depth: 2, position: [3, 3] });
  assert.ok(getBuildingPlacementIssues(ordinary, notch).some((i) => i.message.includes('contour')));
});

test('swept constraints allow a wall in the empty corner but block the occupied arm', () => {
  const emptyCorner = structuredClone(level);
  emptyCorner.walls = [{ id: 'short', start: [4, 3.1], end: [4, 3.8], thickness: 0.07 }];
  const origin = lSofa();
  origin.position = [2.5, 3];
  const target = { ...origin, position: [3, 3] as [number, number] };
  assert.deepEqual(constrainFurnitureDrag(origin, target, emptyCorner).position, target.position);
  const partition = structuredClone(level);
  partition.walls = [{ id: 'partition', start: [5, 0], end: [5, 8], thickness: 0.07 }];
  const result = constrainFurnitureDrag(lSofa(), { ...lSofa(), position: [7, 3] }, partition);
  assert.ok(result.position[0] < 3.5);
  assert.equal(getBuildingPlacementIssues(result, partition).length, 0);
});

test('automatic placement can put a table in the unoccupied inside corner of an L', () => {
  const sofa = lSofa();
  const table = createFurniture({
    kind: 'coffee-table',
    width: 0.4,
    depth: 0.4,
    position: [3.75, 3.4],
  });
  assert.deepEqual(
    findFurniturePlacement(table, level, [sofa], 'inside')?.position,
    table.position,
  );
});

test('a television above its stand does not collide, but a lowered television does', () => {
  const stand = createFurniture({ kind: 'tv-stand', position: [3, 3] });
  const tv = createFurniture({ kind: 'tv', position: [3, 3] });
  assert.equal(tv.elevation, 0.6);
  assert.equal(
    checkFurniture([stand, tv], level).some((i) => i.severity === 'error'),
    false,
  );
  assert.deepEqual(findFurniturePlacement(tv, level, [stand], 'inside')?.position, tv.position);
  tv.elevation = 0.5;
  assert.ok(checkFurniture([stand, tv], level).some((i) => i.severity === 'error'));
  tv.elevation = 2;
  assert.ok(getBuildingPlacementIssues(tv, level).some((i) => i.message.includes('plafond')));
});

test('elevation participates in lintel constraints and continuous dragging', () => {
  const doorway = structuredClone(level);
  doorway.walls = [
    {
      id: 'wall',
      start: [5, 0],
      end: [5, 8],
      thickness: 0.07,
      openings: [{ id: 'door', kind: 'door', offset: 2, width: 2, height: 2.04 }],
    },
  ];
  const tv = createFurniture({
    kind: 'tv',
    width: 0.7,
    depth: 0.1,
    height: 0.5,
    elevation: 1.2,
    position: [3, 3],
  });
  assert.deepEqual(
    constrainFurnitureDrag(tv, { ...tv, position: [7, 3] }, doorway).position,
    [7, 3],
  );
  tv.elevation = 1.8;
  const stopped = constrainFurnitureDrag(tv, { ...tv, position: [7, 3] }, doorway);
  assert.ok(stopped.position[0] < 5);
  assert.equal(getBuildingPlacementIssues(stopped, doorway).length, 0);
});

test('variants and elevation validate without altering legacy rectangular sofas', () => {
  const old = createFurniture({ kind: 'sofa' });
  assert.equal(old.width, 2.1);
  assert.equal(old.depth, 0.9);
  assert.equal(old.sofa, undefined);
  assert.equal(footprintParts(old).length, 1);
  const defaultL = createFurniture({ kind: 'sofa', sofa: { shape: 'corner', side: 'right' } });
  assert.equal(defaultL.width, 2.8);
  assert.equal(defaultL.depth, 1.8);
  assert.ok(defaultL.sofa!.seatDepth > 0);
  assert.throws(() => createFurniture({ kind: 'table', sofa: { shape: 'corner' } }));
  assert.throws(() => createFurniture({ kind: 'sofa', sofa: { seatDepth: 10 } }));
  assert.throws(() => createFurniture({ kind: 'sofa', sofa: { returnWidth: 10 } }));
  assert.throws(() => createFurniture({ elevation: -0.01 }));
  assert.throws(() => createFurniture({ elevation: Infinity }));
  for (const kind of [
    'tv-stand',
    'tv',
    'coffee-table',
    'bookcase',
    'ottoman',
    'side-table',
  ] as const) {
    assert.ok(FURNITURE_PRESETS[kind]);
    assert.equal(validateFurnitureList([createFurniture({ kind })])[0].kind, kind);
  }
});
