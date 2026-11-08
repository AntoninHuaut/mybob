import assert from 'node:assert/strict';
import test from 'node:test';
import type { Level } from '../src/model/types';
import { createFurniture } from '../src/furniture/model';
import {
  CIRCULATION_SHOWN,
  CIRCULATION_TIGHT,
  circulationBands,
} from '../src/furniture/circulation';

const level: Level = {
  id: 'floor',
  name: 'Pièce',
  elevation: 0,
  ceilingHeight: 3,
  outline: [
    [0, 0],
    [6, 0],
    [6, 6],
    [0, 6],
  ],
  walls: [
    {
      id: 'north',
      start: [0, 0],
      end: [6, 0],
      thickness: 0.2,
    },
  ],
  rooms: [],
  lights: [],
  spawn: { position: [3, 3], yaw: 0 },
};
const sofa = (z: number) =>
  createFurniture({ id: 'sofa', kind: 'sofa', width: 2, depth: 0.9, position: [3, z] });

test('a key item near a wall shows a tight passage strip on that side only', () => {
  // The north wall occupies z [-0.1; 0.1]; the sofa (depth 0.9) placed at z = 0.75
  // leaves a 0.2 m passage on the north side, free on the south side.
  const bands = circulationBands([sofa(0.75)], level);
  assert.equal(bands.length, 1);
  assert.equal(bands[0].axis, 'z');
  assert.ok(bands[0].distance < CIRCULATION_TIGHT);
  assert.ok(bands[0].rect.minZ < bands[0].rect.maxZ);
  assert.ok(Math.abs(bands[0].distance - 0.2) < 1e-9);
});

test('an amber strip appears beyond the tight threshold and disappears above the limit', () => {
  // Back of the sofa 0.8 m from the wall: 0.7 m passage, amber.
  const visible = circulationBands([sofa(1.25)], level);
  assert.equal(visible.length, 1);
  const amber = visible[0];
  assert.ok(amber.distance >= CIRCULATION_TIGHT && amber.distance <= CIRCULATION_SHOWN);
  assert.ok(Math.abs(amber.distance - 0.7) < 1e-9);
  // 0.81 m passage: above the threshold, nothing is shown.
  const hidden = circulationBands([sofa(1.36)], level);
  assert.equal(hidden.length, 0);
});

test('a wardrobe blocking the bedside shows the exact remaining gap', () => {
  const bed = createFurniture({
    id: 'bed',
    kind: 'bed',
    width: 1.6,
    depth: 2,
    position: [1.3, 3.5],
  });
  const wardrobe = createFurniture({
    id: 'wardrobe',
    kind: 'wardrobe',
    width: 0.6,
    depth: 0.6,
    position: [2.95, 3.9],
  });
  const bands = circulationBands([bed, wardrobe], level);
  const east = bands.find((band) => band.itemId === 'bed');
  assert.ok(east, 'le passage à l\u2019est du lit doit être montré');
  assert.ok(Math.abs(east!.distance - 0.55) < 1e-9, '0,55 m doit rester chiffré');
  assert.ok(east!.distance < CIRCULATION_TIGHT);
});

test('linked group members do not count as passage obstacles', () => {
  const table = createFurniture({
    id: 'table',
    kind: 'table',
    width: 1,
    depth: 1,
    position: [3, 0.75],
    groupId: 'ensemble',
  });
  const chair = createFurniture({
    id: 'chair',
    kind: 'chair',
    width: 0.45,
    depth: 0.45,
    position: [4.3, 0.75],
    groupId: 'ensemble',
  });
  // Without the link, the chair would narrow the table's east passage to ~0.55 m.
  const withoutGroup = circulationBands([table, { ...chair, groupId: undefined }] as never, level);
  assert.ok(
    withoutGroup.some((band) => band.itemId === 'table' && band.axis === 'x'),
    'la chaise indépendante doit créer une bande',
  );
  const bands = circulationBands([table, chair], level);
  const east = bands.find((band) => band.itemId === 'table' && band.axis === 'x');
  assert.equal(east, undefined, 'un membre lié n\u2019est pas un obstacle');
});

test('non-key furniture is ignored', () => {
  const cabinet = createFurniture({
    id: 'cabinet',
    kind: 'cabinet',
    width: 0.8,
    depth: 0.45,
    position: [3, 0.75],
  });
  assert.equal(circulationBands([cabinet], level).length, 0);
});
