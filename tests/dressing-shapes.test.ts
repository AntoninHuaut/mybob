import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createFurniture,
  dressingBounds,
  dressingStrips,
  footprint,
  footprintParts,
  FURNITURE_PRESETS,
  validateFurnitureList,
  type FurnitureItem,
  type ShowerPanelSide,
} from '../src/furniture/model';
import { checkFurniture, polygonsOverlap } from '../src/furniture/checks';
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
/** Metres accumulate floating-point noise; compare at the millimetre. */
const near = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 0.0005, `${actual} != ${expected}`);
const dressing = (runs: { length: number; turn?: 'left' | 'right' }[], runDepth = 0.6) =>
  createFurniture({
    kind: 'dressing',
    height: 2.2,
    position: [3, 3],
    dressing: { runDepth, runs },
  });

test('a straight dressing is one run and keeps the preset depth', () => {
  const item = createFurniture({ kind: 'dressing', position: [3, 3] });
  assert.deepEqual(item.dressing, { runDepth: 0.6, runs: [{ length: 1.8 }] });
  near(item.width, FURNITURE_PRESETS.dressing.width);
  near(item.depth, FURNITURE_PRESETS.dressing.depth);
  const parts = footprintParts(item);
  assert.equal(parts.length, 1);
  // Same rectangle as the bounding footprint, walked from the wall side.
  const corners = (points: [number, number][]) =>
    points
      .map(([x, z]) => [Math.round(x * 1000) / 1000, Math.round(z * 1000) / 1000])
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  assert.deepEqual(corners(parts[0]), corners(footprint(item)));
});

test('an L dressing occupies two runs and leaves its inside corner free', () => {
  const item = dressing([{ length: 1.8, turn: 'right' }, { length: 1.2 }]);
  near(item.width, 1.8);
  near(item.depth, 1.2);
  const parts = footprintParts(item);
  assert.equal(parts.length, 2);
  // The bounding rectangle alone would reject a stool standing in the empty corner.
  const stool = createFurniture({
    kind: 'ottoman',
    width: 0.4,
    depth: 0.4,
    height: 0.4,
    position: [2.4, 3.3],
  });
  assert.ok(polygonsOverlap(footprint(item), footprint(stool)));
  assert.equal(
    checkFurniture([item, stool], level).some((issue) => issue.severity === 'error'),
    false,
  );
  stool.position = [3.6, 3.3];
  assert.ok(checkFurniture([item, stool], level).some((issue) => issue.severity === 'error'));
});

test('a U dressing follows two turns and keeps the room side open', () => {
  const item = dressing([
    { length: 1.8, turn: 'right' },
    { length: 2.4, turn: 'right' },
    { length: 1.8 },
  ]);
  near(item.width, 1.8);
  near(item.depth, 2.4);
  assert.equal(footprintParts(item).length, 3);
  const stool = createFurniture({
    kind: 'ottoman',
    width: 0.4,
    depth: 0.4,
    height: 0.4,
    position: [2.4, 3.3],
  });
  assert.equal(
    checkFurniture([item, stool], level).some((issue) => issue.severity === 'error'),
    false,
  );
});

test('a zigzag dressing alternates its turns and widens the footprint', () => {
  const item = dressing([
    { length: 1.8, turn: 'right' },
    { length: 1.2, turn: 'left' },
    { length: 1.8 },
  ]);
  near(item.width, 3.6);
  near(item.depth, 1.8);
  assert.equal(footprintParts(item).length, 3);
});

test('the chain geometry is measured from the wall side and centred on the item', () => {
  const runs = [{ length: 1.8, turn: 'right' as const }, { length: 1.2 }];
  const bounds = dressingBounds(0.6, runs);
  near(bounds.width, 1.8);
  near(bounds.depth, 1.2);
  near(bounds.centerX, 0.9);
  near(bounds.centerZ, 0.6);
  const strips = dressingStrips(0.6, runs).map((strip) =>
    strip.map(([x, z]) => [Math.round(x * 1000) / 1000, Math.round(z * 1000) / 1000]),
  );
  assert.deepEqual(strips[0], [
    [0, 0],
    [0, 0.6],
    [1.8, 0.6],
    [1.8, 0],
  ]);
  assert.deepEqual(strips[1], [
    [1.8, 0],
    [1.2, 0],
    [1.2, 1.2],
    [1.8, 1.2],
  ]);
});

test('a dressing rejects impossible runs and inconsistent overall dimensions', () => {
  assert.throws(() => createFurniture({ kind: 'dressing', dressing: { runs: [] } }));
  assert.throws(() => createFurniture({ kind: 'dressing', dressing: { runs: [{ length: 0.1 }] } }));
  assert.throws(() =>
    createFurniture({ kind: 'dressing', dressing: { runs: [{ length: 1.8, turn: 'right' }] } }),
  );
  assert.throws(() =>
    createFurniture({
      kind: 'dressing',
      dressing: { runs: Array.from({ length: 13 }, () => ({ length: 1 })) },
    }),
  );
  assert.throws(() => createFurniture({ kind: 'table', dressing: {} }));
  const valid = dressing([{ length: 1.8 }]);
  assert.throws(() => validateFurnitureList([{ ...valid, width: 5 }]));
  assert.throws(() => validateFurnitureList([{ ...valid, depth: 5 }]));
});

test('a dressing survives validation and duplication with its exact runs', () => {
  const item = dressing([{ length: 1.8, turn: 'right' }, { length: 1.2 }]);
  const [validated] = validateFurnitureList([item]);
  assert.deepEqual(validated.dressing, item.dressing);
  const copy = createFurniture({ ...item, id: undefined, name: 'Dressing (copie)' });
  assert.deepEqual(copy.dressing, item.dressing);
  assert.equal(copy.width, item.width);
  assert.equal(copy.depth, item.depth);
});

test('a shower separates its tray height from its glass panels', () => {
  const shower = createFurniture({ kind: 'shower' });
  assert.equal(shower.showerTray, 0.06);
  assert.deepEqual(shower.showerPanels, ['left']);
  const walkIn = createFurniture({
    kind: 'shower',
    showerTray: 0,
    showerPanels: ['left', 'front'],
  });
  assert.equal(walkIn.showerTray, 0);
  assert.deepEqual(walkIn.showerPanels, ['left', 'front']);
  assert.throws(() => createFurniture({ kind: 'table', showerTray: 0.06 }));
  assert.throws(() => createFurniture({ kind: 'shower', showerTray: 0.5 }));
  assert.throws(() => createFurniture({ kind: 'shower', showerTray: 2 }));
  assert.throws(() =>
    createFurniture({ kind: 'shower', showerPanels: ['top'] as unknown as ShowerPanelSide[] }),
  );
  assert.throws(() => createFurniture({ kind: 'shower', showerPanels: ['left', 'left'] }));
});

test('older shower presets migrate to a tray height and panels', () => {
  const legacy = (showerType: string) => {
    const item = createFurniture({ kind: 'shower' }) as FurnitureItem & { showerType?: string };
    delete item.showerTray;
    delete item.showerPanels;
    item.showerType = showerType;
    return item;
  };
  const [italienne] = validateFurnitureList([legacy('italienne')]);
  assert.equal(italienne.showerTray, 0);
  assert.deepEqual(italienne.showerPanels, ['left', 'back']);
  assert.equal('showerType' in italienne, false);
  const [cabine] = validateFurnitureList([legacy('cabine')]);
  assert.equal(cabine.showerTray, 0.06);
  assert.deepEqual(cabine.showerPanels, ['left', 'back', 'front']);
  assert.throws(() => validateFurnitureList([legacy('hammam')]));
});
