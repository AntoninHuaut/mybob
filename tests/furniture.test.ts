import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createFurniture,
  footprint,
  FurnitureHistory,
  loadLayout,
  saveLayout,
  validateFurnitureList,
  layoutStorageKey,
} from '../src/furniture/model';
import {
  checkFurniture,
  furnitureDistances,
  polygonsOverlap,
  snapFurniture,
} from '../src/furniture/checks';
import type { Level } from '../src/model/types';

const near = (a: number, b: number, epsilon = 0.001) =>
  assert.ok(Math.abs(a - b) < epsilon, `${a} ≠ ${b}`);
const room: Level = {
  id: 'room',
  name: 'Pièce',
  elevation: 0,
  ceilingHeight: 2.5,
  outline: [
    [0, 0],
    [6, 0],
    [6, 5],
    [0, 5],
  ],
  walls: [
    { id: 'north', start: [0, 0.15], end: [6, 0.15], thickness: 0.3 },
    { id: 'east', start: [5.85, 0], end: [5.85, 5], thickness: 0.3 },
    { id: 'south', start: [0, 4.85], end: [6, 4.85], thickness: 0.3 },
    { id: 'west', start: [0.15, 0], end: [0.15, 5], thickness: 0.3 },
  ],
  rooms: [
    {
      id: 'inside',
      name: 'Intérieur',
      kind: 'living',
      polygon: [
        [0.3, 0.3],
        [5.7, 0.3],
        [5.7, 4.7],
        [0.3, 4.7],
      ],
      label: [3, 2.5],
      viewpoint: [3, 2.5],
    },
  ],
  lights: [],
  spawn: { position: [3, 2.5], yaw: Math.PI },
};

test('furniture footprints use metres and Babylon Y rotation', () => {
  const item = createFurniture({ width: 2, depth: 1, position: [3, 2], rotation: Math.PI / 2 });
  const points = footprint(item);
  near(Math.min(...points.map((p) => p[0])), 2.5);
  near(Math.max(...points.map((p) => p[0])), 3.5);
  near(Math.min(...points.map((p) => p[1])), 1);
  near(Math.max(...points.map((p) => p[1])), 3);
});

test('SAT detects rotated overlaps without treating exact contact as penetration', () => {
  const a = createFurniture({ width: 1, depth: 1, position: [2, 2] });
  const b = createFurniture({ width: 1, depth: 1, position: [3, 2] });
  assert.equal(polygonsOverlap(footprint(a), footprint(b)), false);
  b.rotation = Math.PI / 4;
  assert.equal(polygonsOverlap(footprint(a), footprint(b)), true);
});

test('fit checks detect furniture, walls, outside contours and ceilings', () => {
  const a = createFurniture({ name: 'Table', position: [3, 2] });
  const b = createFurniture({ name: 'Bureau', position: [3.2, 2] });
  assert.ok(checkFurniture([a, b], room).some((i) => i.itemId === a.id && i.severity === 'error'));
  const collision = createFurniture({ position: [0.3, 2] });
  assert.ok(checkFurniture([collision], room).some((i) => i.message.includes('mur')));
  const outside = createFurniture({ position: [-3, 2] });
  assert.ok(checkFurniture([outside], room).some((i) => i.message.includes('contour')));
  const high = createFurniture({ position: [3, 2], height: 2.6 });
  assert.ok(checkFurniture([high], room).some((i) => i.message.includes('plafond')));
});

test('required clearances and drawer opening are conservative warnings', () => {
  const cabinet = createFurniture({
    position: [3, 3.8],
    depth: 0.5,
    opening: { kind: 'drawer', reach: 0.9 },
    clearances: { front: 1, back: 0, left: 0, right: 0 },
  });
  const issues = checkFurniture([cabinet], room);
  assert.equal(issues.filter((i) => i.severity === 'error').length, 0);
  assert.ok(issues.some((i) => i.message.includes('espace libre')));
  assert.ok(issues.some((i) => i.message.includes('ouverture')));
  assert.equal(issues.filter((issue) => issue.code === 'clearance').length, 1);
  const withoutClearances = issues.filter((issue) => issue.code !== 'clearance');
  assert.ok(withoutClearances.some((issue) => issue.message.includes('ouverture')));
  assert.ok(!withoutClearances.some((issue) => issue.message.includes('espace libre')));
});

test('door swing is checked even while the wall aperture is geometrically clear', () => {
  const level = structuredClone(room);
  level.walls[0].openings = [
    { id: 'entry', kind: 'door', offset: 2, width: 1, height: 2.1, hinge: 'start', swing: -1 },
  ];
  const item = createFurniture({ width: 0.3, depth: 0.3, position: [2.5, 0.65] });
  assert.ok(checkFurniture([item], level).some((i) => i.message.includes('débattement')));
});

test('face distances stop at solid walls and furniture, respecting a full-height doorway', () => {
  const item = createFurniture({ width: 1, depth: 1, position: [3, 2.5] });
  const distances = furnitureDistances(item, room, []);
  near(distances.find((d) => d.label === 'Devant')!.distance, 1.7);
  near(distances.find((d) => d.label === 'Derrière')!.distance, 1.7);
  const level = structuredClone(room);
  level.walls[0].openings = [{ id: 'entry', kind: 'door', offset: 2.3, width: 1.4, height: 2.1 }];
  near(furnitureDistances(item, level, []).find((d) => d.label === 'Derrière')!.distance, 2);
  const obstacle = createFurniture({ width: 1, depth: 0.3, position: [3, 3.5] });
  near(
    furnitureDistances(item, room, [obstacle]).find((d) => d.label === 'Devant')!.distance,
    0.35,
  );
});

test('neighbour gaps are real distances, capped and group-aware', () => {
  const table = createFurniture({
    id: 'table',
    kind: 'table',
    width: 1,
    depth: 1,
    position: [3, 2],
  });
  // Diagonal neighbour: none of the 4 rays reaches it, only the real dimension
  // between footprints must appear (corner to corner: 0.14 m).
  const diagonal = createFurniture({
    id: 'side',
    name: 'Table d’appoint',
    kind: 'side-table',
    width: 0.4,
    depth: 0.4,
    position: [3.8, 2.8],
  });
  const gaps = furnitureDistances(table, room, [table, diagonal]);
  const side = gaps.find((d) => d.label === 'Table d’appoint');
  assert.ok(side, 'la cote du voisin diagonal doit exister');
  near(side!.distance, Math.SQRT2 * 0.1);
  // Two chairs of its set are never dimensioned; only the neighbour remains.
  const chairs = [
    { ...createFurniture({ id: 'c1', position: [2.2, 2] }), groupId: 'ensemble' },
    { ...createFurniture({ id: 'c2', position: [3.8, 2] }), groupId: 'ensemble' },
  ];
  const linked = { ...table, groupId: 'ensemble' };
  const withGroup = furnitureDistances(linked, room, [linked, ...chairs, diagonal]);
  assert.equal(
    withGroup.filter((d) => d.label === 'Canapé' || d.label === 'Table').length,
    0,
    'aucun membre de l’ensemble ne doit être coté',
  );
  assert.ok(
    withGroup.some((d) => d.label === 'Table d’appoint'),
    'le voisin hors ensemble reste coté',
  );
  // Beyond one metre, no neighbour dimension.
  const far = createFurniture({ id: 'far', width: 0.4, depth: 0.4, position: [5.2, 4.2] });
  assert.equal(
    furnitureDistances(table, room, [table, far]).filter(
      (d) =>
        d.label !== 'Devant' &&
        d.label !== 'Derrière' &&
        d.label !== 'À gauche' &&
        d.label !== 'À droite',
    ).length,
    0,
  );
});

test('wall snapping retains contact without penetrating a wall', () => {
  const item = createFurniture({ width: 1, depth: 0.6, position: [3, 0.7] });
  const result = snapFurniture(item, room, [], 0.15);
  near(result.position[1], 0.6);
  assert.equal(
    checkFurniture([result], room).some((i) => i.severity === 'error'),
    false,
  );
  const far = createFurniture({ position: [3, 2.5] });
  assert.deepEqual(snapFurniture(far, room, []), far);
});

test('undo/redo isolate snapshots and new edits invalidate the redo branch', () => {
  const a = createFurniture({ position: [3, 2] });
  const history = new FurnitureHistory();
  history.commit([a]);
  const copy = history.items;
  copy[0].position[0] = 100;
  near(history.items[0].position[0], 3);
  history.commit([{ ...a, locked: true }]);
  assert.equal(history.undo(), true);
  assert.equal(history.items[0].locked, false);
  assert.equal(history.redo(), true);
  assert.equal(history.items[0].locked, true);
  history.undo();
  history.commit([{ ...a, name: 'Autre' }]);
  assert.equal(history.canRedo, false);
  history.reset([]);
  assert.equal(history.canUndo, false);
});

test('saved layouts stay isolated by project and level, and storage failures are explicit', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const entries = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => entries.set(key, value),
    },
  });
  try {
    const a = createFurniture({ name: 'Projet A' });
    saveLayout('a', 'rdc', [a]);
    saveLayout('b', 'rdc', []);
    assert.equal(loadLayout('a', 'rdc')[0].name, 'Projet A');
    assert.deepEqual(loadLayout('b', 'rdc'), []);
    assert.deepEqual(loadLayout('a', 'etage'), []);
    assert.notEqual(layoutStorageKey('a:b', 'c'), layoutStorageKey('a', 'b:c'));
    entries.set(layoutStorageKey('a', 'rdc'), '{oops');
    assert.throws(() => loadLayout('a', 'rdc'), /illisible/);
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        setItem() {
          throw new Error('quota');
        },
      },
    });
    assert.throws(() => saveLayout('a', 'rdc', [a]), /mémoire locale/);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('invalid dimensions, duplicated ids and unsafe clearances are rejected', () => {
  assert.throws(() => createFurniture({ width: -0.1 }));
  assert.throws(() => createFurniture({ height: NaN }));
  const item = createFurniture();
  assert.throws(() => validateFurnitureList([item, item]));
  assert.throws(() => createFurniture({ clearances: { front: -1, back: 0, left: 0, right: 0 } }));
});

test('duplicating with an undefined id creates a fresh id without discarding factory defaults', () => {
  const original = createFurniture({ kind: 'sofa' });
  const duplicate = createFurniture({ ...original, id: undefined, name: 'Copie' });
  assert.notEqual(duplicate.id, original.id);
  assert.equal(duplicate.width, original.width);
  assert.equal(duplicate.name, 'Copie');
  const defaulted = createFurniture({ kind: 'sofa', width: undefined });
  assert.equal(defaulted.width, 2.1);
});

test('an L kitchen keeps its empty corner free and validates appliance positions', () => {
  const kitchen = createFurniture({
    kind: 'kitchen',
    kitchen: {
      runDepth: 0.6,
      runs: [{ length: 3.2, turn: 'right' }, { length: 2.1 }],
      worktopHeight: 0.9,
      worktopColor: '#aa8855',
      slots: [
        { run: 0, offset: 0, width: 0.6, kind: 'fridge' },
        { run: 0, offset: 1.4, width: 0.6, kind: 'hob' },
        { run: 1, offset: 0.8, width: 0.6, kind: 'sink' },
      ],
    },
  });
  near(kitchen.width, 3.2);
  near(kitchen.depth, 2.1);
  assert.equal(kitchen.height, 2.2);
  assert.equal(validateFurnitureList([kitchen]).length, 1);
  assert.throws(() =>
    validateFurnitureList([
      {
        ...kitchen,
        kitchen: {
          ...kitchen.kitchen!,
          slots: [{ run: 1, offset: 2, width: 0.6, kind: 'sink' }],
        },
      },
    ]),
  );
});

test('an L kitchen fits against two walls without filling the free inside corner', () => {
  const kitchen = createFurniture({
    kind: 'kitchen',
    position: [1.9, 1.35],
    kitchen: {
      runs: [{ length: 3.2, turn: 'right' }, { length: 2.1 }],
    },
  });
  const table = createFurniture({ kind: 'table', width: 0.4, depth: 0.4, position: [1, 1.5] });
  assert.deepEqual(
    checkFurniture([kitchen, table], room).filter((i) => i.severity === 'error'),
    [],
  );
  const throughWall = { ...kitchen, position: [1.9, 1.3] as [number, number] };
  assert.ok(checkFurniture([throughWall], room).some((i) => i.severity === 'error'));
});
