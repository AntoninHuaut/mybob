import assert from 'node:assert/strict';
import test from 'node:test';
import type { Level } from '../src/model/types';
import { bounds } from '../src/model/geometry';
import { createFurniture, footprintParts, FurnitureHistory } from '../src/furniture/model';
import {
  alignFurniture,
  distributeFurniture,
  snapDraggedFurniture,
  defaultSnapSettings,
} from '../src/furniture/arrangement';

const level: Level = {
  id: 'floor',
  name: 'Pièce',
  elevation: 0,
  ceilingHeight: 3,
  outline: [
    [0, 0],
    [12, 0],
    [12, 12],
    [0, 12],
  ],
  walls: [],
  rooms: [],
  lights: [],
  spawn: { position: [3, 3], yaw: 0 },
};
const chair = (id: string, x: number, z: number) =>
  createFurniture({ id, kind: 'chair', width: 1, depth: 0.5, position: [x, z] });
const box = (item: ReturnType<typeof chair>) => bounds(footprintParts(item).flat());
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);

test('alignment uses rotated footprint edges and the first selected reference without mutating input', () => {
  const items = [chair('a', 3, 2), { ...chair('b', 6, 4), rotation: Math.PI / 2 }];
  const source = structuredClone(items);
  const next = alignFurniture(items, ['b', 'a'], level, 'x', 'min');
  near(box(next[0]).minX, box(next[1]).minX);
  assert.deepEqual(next[1], items[1]);
  assert.deepEqual(items, source);
  const history = new FurnitureHistory(items);
  history.commit(next);
  history.undo();
  assert.deepEqual(history.items, source);
});

test('distribution produces equal edge gaps for different sizes and rotations while keeping endpoints', () => {
  const items = [
    chair('a', 2, 4),
    { ...chair('b', 4, 4), rotation: Math.PI / 2 },
    { ...chair('c', 9, 4), width: 2 },
  ];
  const next = distributeFurniture(items, ['c', 'a', 'b'], level, 'x');
  const boxes = next.map(box);
  near(boxes[1].minX - boxes[0].maxX, boxes[2].minX - boxes[1].maxX);
  assert.deepEqual(next[0], items[0]);
  assert.deepEqual(next[2], items[2]);
});

test('complete linked groups move as rigid units and partial or locked groups are refused', () => {
  const items = [
    { ...chair('a', 2, 2), groupId: 'g' },
    { ...chair('b', 3, 2), groupId: 'g' },
    chair('c', 6, 6),
  ];
  assert.throws(() => alignFurniture(items, ['a', 'c'], level, 'z', 'center'), /tous les meubles/);
  const next = alignFurniture(items, ['c', 'a', 'b'], level, 'z', 'center');
  near(next[1].position[0] - next[0].position[0], 1);
  near(next[0].position[1], 6);
  near(next[1].position[1], 6);
  assert.equal(next[0].groupId, 'g');
  assert.throws(
    () =>
      alignFurniture(
        [{ ...items[0], locked: true }, ...items.slice(1)],
        ['a', 'b', 'c'],
        level,
        'z',
        'center',
      ),
    /Déverrouillez/,
  );
});

test('invalid building placement and insufficient distribution room reject the whole operation', () => {
  const items = [chair('a', 2, 2), chair('b', 5, 5)];
  const walled = {
    ...level,
    walls: [
      {
        id: 'wall',
        start: [0, 5] as [number, number],
        end: [12, 5] as [number, number],
        thickness: 0.2,
      },
    ],
  };
  const source = structuredClone(items);
  assert.throws(
    () => alignFurniture(items, ['b', 'a'], walled, 'z', 'center'),
    /Placement impossible/,
  );
  assert.deepEqual(items, source);
  assert.throws(
    () =>
      distributeFurniture(
        [chair('a', 2, 2), chair('b', 2.3, 4), chair('c', 2.5, 6)],
        ['a', 'b', 'c'],
        level,
        'x',
      ),
    /Écartez/,
  );
});

test('disabled snapping preserves exact position; grid and wall snapping are independent', () => {
  const item = chair('a', 2.12345, 3.45678);
  assert.deepEqual(snapDraggedFurniture(item, level, [item], defaultSnapSettings), item);
  const grid = snapDraggedFurniture(item, level, [item], {
    grid: true,
    walls: false,
    gridSize: 0.1,
  });
  near(grid.position[0], 2.1);
  near(grid.position[1], 3.5);
  const walled = {
    ...level,
    walls: [
      {
        id: 'wall',
        start: [0, 0] as [number, number],
        end: [0, 12] as [number, number],
        thickness: 0.2,
      },
    ],
  };
  const nearWall = chair('a', 0.67, 4.12345);
  const snapped = snapDraggedFurniture(nearWall, walled, [nearWall], {
    grid: false,
    walls: true,
    gridSize: 0.1,
  });
  near(snapped.position[0], 0.6);
  near(snapped.position[1], nearWall.position[1]);
});

test('snapping preserves a candidate whose group is locked or would cross a wall', () => {
  const item = { ...chair('a', 2.14, 2), groupId: 'g' };
  const partner = { ...chair('b', 4.14, 2), groupId: 'g', locked: true };
  assert.deepEqual(
    snapDraggedFurniture(item, level, [item, partner], { grid: true, walls: false, gridSize: 1 }),
    item,
  );
  const wall = {
    ...level,
    walls: [
      {
        id: 'thin',
        start: [3.1, 0] as [number, number],
        end: [3.1, 12] as [number, number],
        thickness: 0.02,
      },
    ],
  };
  const candidate = { ...chair('a', 3.2, 3), width: 0.1 };
  assert.deepEqual(
    snapDraggedFurniture(candidate, wall, [candidate], { grid: true, walls: false, gridSize: 1 }),
    candidate,
  );
});
