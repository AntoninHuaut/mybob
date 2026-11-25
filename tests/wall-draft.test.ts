import assert from 'node:assert/strict';
import test from 'node:test';
import { polygonArea } from '../src/model/geometry';
import type { Level, Point2 } from '../src/model/types';
import { validateProject } from '../src/model/validate';
import { addWallChain, emptyHouse, snapDraftPoint } from '../src/model/wallDraft';

const empty: Level = {
  id: 'level-1',
  name: 'Rez-de-chaussée',
  elevation: 0,
  ceilingHeight: 2.5,
  outline: [
    [0, 0],
    [12, 0],
    [12, 8],
    [0, 8],
  ],
  walls: [],
  rooms: [],
  lights: [],
  spawn: { position: [6, 4], yaw: 0 },
};
// Axes of a 4 × 3 m clear room with 0.20 m walls, from the top-left axis corner.
const box: Point2[] = [
  [1, 1],
  [5.2, 1],
  [5.2, 4.2],
  [1, 4.2],
];
const near = (a: Point2, b: Point2) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-9;

test('the first closed chain becomes the exterior walls, outline, room and start', () => {
  const level = addWallChain(empty, box, true, 0.2);
  assert.equal(level.walls.length, 4);
  assert.ok(level.walls.every((w) => w.exterior && w.thickness === 0.2));
  assert.equal(level.rooms.length, 1);
  assert.ok(Math.abs(polygonArea(level.rooms[0].polygon) - 12) < 1e-9);
  assert.ok(Math.abs(polygonArea(level.outline) - 4.4 * 3.4) < 1e-9);
  assert.deepEqual(level.spawn.position, level.rooms[0].viewpoint);
});

test('a partition ending on two walls joins them, keeps their openings and divides the room', () => {
  const house = addWallChain(empty, box, true, 0.2);
  house.walls[0].openings = [
    { id: 'left', kind: 'window', offset: 0.5, width: 1, height: 1, sill: 1 },
    { id: 'right', kind: 'window', offset: 3, width: 0.8, height: 1, sill: 1 },
  ];
  house.rooms[0] = { ...house.rooms[0], id: 'salon', name: 'Salon' };
  const level = addWallChain(
    house,
    [
      [2.65, 1],
      [2.65, 4.2],
    ],
    false,
    0.1,
  );
  assert.equal(level.walls.length, 5);
  assert.deepEqual(level.walls.slice(0, 4), house.walls);
  const partition = level.walls[4];
  assert.equal(partition.exterior, undefined);
  assert.equal(level.rooms.length, 2);
  const [salon, other] = level.rooms;
  assert.equal(salon.id, 'salon');
  assert.ok(Math.abs(polygonArea(salon.polygon) - 2.4 * 3) < 1e-9);
  assert.ok(Math.abs(polygonArea(other.polygon) - 1.5 * 3) < 1e-9);
  assert.deepEqual(level.outline, house.outline);
});

test('a partition junction inside an opening is refused', () => {
  const house = addWallChain(empty, box, true, 0.2);
  house.walls[0].openings = [
    { id: 'w', kind: 'window', offset: 1.2, width: 1, height: 1, sill: 1 },
  ];
  assert.throws(
    () =>
      addWallChain(
        house,
        [
          [2.65, 1],
          [2.65, 4.2],
        ],
        false,
        0.1,
      ),
    /ouverture/,
  );
});

test('the draft snaps to corners, then walls, then 45° steps of 5 cm', () => {
  const walls = addWallChain(empty, box, true, 0.2).walls;
  const options = { angle: true, grid: true, tolerance: 0.15 };
  assert.deepEqual(snapDraftPoint(walls, [5.1, 4.1], options), {
    point: [5.2, 4.2],
    kind: 'corner',
  });
  const onWall = snapDraftPoint(walls, [2.63, 1.08], options);
  assert.equal(onWall.kind, 'wall');
  assert.ok(near(onWall.point, [2.65, 1]));
  assert.deepEqual(snapDraftPoint([], [2.63, 1.08], options), { point: [2.65, 1.1], kind: 'grid' });
  const step = snapDraftPoint([], [3.03, 1.2], { ...options, last: [1, 1] });
  assert.equal(step.kind, 'grid');
  assert.ok(near(step.point, [3.05, 1]));
  const free = snapDraftPoint([], [3.03, 1.2], {
    ...options,
    last: [1, 1],
    angle: false,
    grid: false,
  });
  assert.deepEqual(free, { point: [3.03, 1.2], kind: 'free' });
  // The first corner of the chain closes it.
  assert.deepEqual(
    snapDraftPoint([], [1.05, 0.95], { ...options, last: [1, 4.2], corners: [[1, 1]] }),
    { point: [1, 1], kind: 'corner' },
  );
});

test('a new house validates empty, then with its first drawn room', () => {
  const house = emptyHouse('local');
  house.levels[0] = addWallChain(house.levels[0], box, true, 0.2);
  assert.doesNotThrow(() => validateProject(house));
});

test('the first closed chain moves the start into its room even around the placeholder', () => {
  const around = box.map(([x, z]) => [x + 4, z + 2] as Point2);
  const level = addWallChain(empty, around, true, 0.2);
  assert.deepEqual(level.spawn.position, level.rooms[0].viewpoint);
});
