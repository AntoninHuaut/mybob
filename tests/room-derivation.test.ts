import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { polygonArea } from '../src/model/geometry';
import { deriveRooms } from '../src/model/roomDerivation';
import { enclosure } from '../src/model/wallChain';
import type { HouseProject, Point2, Room, Wall } from '../src/model/types';

// 4 × 3 m clear inside 0.20 m walls: axes 0.10 m outside the finished faces.
const box: Wall[] = [
  [
    [-0.1, -0.1],
    [4.1, -0.1],
  ],
  [
    [4.1, -0.1],
    [4.1, 3.1],
  ],
  [
    [4.1, 3.1],
    [-0.1, 3.1],
  ],
  [
    [-0.1, 3.1],
    [-0.1, -0.1],
  ],
].map(([start, end], i) => ({
  id: `wall-${i + 1}`,
  start: start as Point2,
  end: end as Point2,
  thickness: 0.2,
  exterior: true,
}));
// 0.10 m partition across the depth, 1.5 m from the left face.
const partition: Wall = { id: 'wall-5', start: [1.55, -0.1], end: [1.55, 3.1], thickness: 0.1 };
const area = (room: Room) => polygonArea(room.polygon);

test('a closed rectangle of walls gives one room on its finished faces', () => {
  const [room] = deriveRooms(box, []);
  assert.ok(Math.abs(area(room) - 12) < 1e-9);
  assert.equal(room.name, 'Pièce 1');
});

test('a partition splits the room; the larger part keeps the original identity', () => {
  const original: Room = {
    ...deriveRooms(box, [])[0],
    id: 'salon',
    name: 'Salon',
    kind: 'living',
    planArea: 12.1,
    wallColor: '#d8cbb4',
    wallFaces: [{ wallId: 'wall-1', side: 1, color: '#9fb39a' }],
  };
  const rooms = deriveRooms([...box, partition], [original]);
  assert.equal(rooms.length, 2);
  assert.ok(Math.abs(rooms.reduce((sum, r) => sum + area(r), 0) - (12 - 0.1 * 3)) < 1e-9);
  const [kept, added] = rooms;
  assert.deepEqual(
    [kept.id, kept.name, kept.planArea, kept.wallColor, kept.wallFaces],
    ['salon', 'Salon', 12.1, '#d8cbb4', original.wallFaces],
  );
  assert.ok(Math.abs(area(kept) - 2.4 * 3) < 1e-9);
  assert.equal(added.name, 'Pièce 2');
  assert.notEqual(added.id, 'salon');

  const merged = deriveRooms(box, rooms);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, 'salon');
  assert.ok(Math.abs(area(merged[0]) - 12) < 1e-9);
});

test('an angled chain gives the same finished outline as the drawing tool', () => {
  const axes: Point2[] = [
    [0, 0],
    [5, 0],
    [6, 3],
    [1, 4],
  ];
  const walls = axes.map((start, i) => ({
    id: `w${i}`,
    start,
    end: axes[(i + 1) % axes.length],
    thickness: 0.2,
  }));
  const [room] = deriveRooms(walls, []);
  assert.ok(Math.abs(area(room) - polygonArea(enclosure(axes, 0.2).polygon)) < 1e-9);
});

test('walls that close no loop give no room', () => {
  assert.deepEqual(deriveRooms(box.slice(0, 3), []), []);
  assert.deepEqual(deriveRooms([], []), []);
});

test('the rooms of the bundled demonstrations derive from their walls', () => {
  for (const file of ['studio-demo', 'maison-atelier']) {
    const project = JSON.parse(
      readFileSync(`public/projects/${file}.json`, 'utf8'),
    ) as HouseProject;
    for (const level of project.levels) {
      const derived = deriveRooms(level.walls, level.rooms);
      assert.deepEqual(
        derived.map((r) => r.id).sort(),
        level.rooms.map((r) => r.id).sort(),
        `${file} ${level.id}`,
      );
      for (const room of level.rooms) {
        const twin = derived.find((r) => r.id === room.id)!;
        assert.ok(
          Math.abs(area(twin) - area(room)) < 1e-3,
          `${file} ${room.id}: ${area(twin)} vs ${area(room)}`,
        );
        for (const corner of room.polygon)
          assert.ok(
            twin.polygon.some((p) => Math.hypot(p[0] - corner[0], p[1] - corner[1]) < 1e-3),
            `${file} ${room.id}: corner ${corner.join(', ')}`,
          );
      }
    }
  }
});
