import assert from 'node:assert/strict';
import test from 'node:test';
import { createFurniture, footprint } from '../src/furniture/model';
import {
  constrainFurnitureDrag,
  findFurniturePlacement,
  getBuildingPlacementIssues,
} from '../src/furniture/placement';
import { polygonsOverlap } from '../src/furniture/checks';
import { pointInPolygon } from '../src/model/geometry';
import type { Level } from '../src/model/types';

const level: Level = {
  id: 'test-level',
  name: 'Niveau',
  elevation: 0,
  ceilingHeight: 2.5,
  outline: [
    [0, 0],
    [10, 0],
    [10, 6],
    [0, 6],
  ],
  walls: [
    { id: 'n', start: [0, 0.1], end: [10, 0.1], thickness: 0.2 },
    { id: 'e', start: [9.9, 0], end: [9.9, 6], thickness: 0.2 },
    { id: 's', start: [0, 5.9], end: [10, 5.9], thickness: 0.2 },
    { id: 'w', start: [0.1, 0], end: [0.1, 6], thickness: 0.2 },
    { id: 'partition', start: [5, 0], end: [5, 6], thickness: 0.07 },
  ],
  rooms: [
    {
      id: 'left',
      name: 'Gauche',
      kind: 'living',
      polygon: [
        [0.2, 0.2],
        [4.965, 0.2],
        [4.965, 5.8],
        [0.2, 5.8],
      ],
      label: [2.5, 3],
      viewpoint: [2.5, 3],
    },
    {
      id: 'right',
      name: 'Droite',
      kind: 'bedroom',
      polygon: [
        [5.035, 0.2],
        [9.8, 0.2],
        [9.8, 5.8],
        [5.035, 5.8],
      ],
      label: [7.5, 3],
      viewpoint: [7.5, 3],
    },
  ],
  lights: [],
  spawn: { position: [2.5, 3], yaw: Math.PI },
};

test('a pointer jump to another valid room stops the whole sofa before a thin partition', () => {
  const from = createFurniture({ kind: 'sofa', position: [2, 3] });
  const result = constrainFurnitureDrag(from, { ...from, position: [8, 3] }, level);
  assert.ok(result.position[0] > 3 && result.position[0] < 4);
  assert.equal(getBuildingPlacementIssues(result, level).length, 0);
  assert.equal(getBuildingPlacementIssues({ ...from, position: [8, 3] }, level).length, 0);
  assert.ok(Math.max(...footprint(result).map((p) => p[0])) <= 4.9671);
});

test('rotated furniture cannot tunnel through glass or an angled wall', () => {
  const glass = structuredClone(level);
  glass.walls[4].openings = [
    { id: 'glass', kind: 'window', offset: 0, width: 6, height: 2.5, sill: 0 },
  ];
  const from = createFurniture({ width: 1, depth: 0.6, rotation: Math.PI / 4, position: [2, 3] });
  const result = constrainFurnitureDrag(from, { ...from, position: [8, 3] }, glass);
  assert.ok(result.position[0] < 5);
  assert.equal(getBuildingPlacementIssues(result, glass).length, 0);
  const diagonal = structuredClone(level);
  diagonal.walls[4] = { id: 'diagonal', start: [3, 0], end: [7, 6], thickness: 0.07 };
  assert.ok(constrainFurnitureDrag(from, { ...from, position: [8, 3] }, diagonal).position[0] < 6);
});

test('wall contact is permitted, moving away is free, and locked objects stay put', () => {
  const from = createFurniture({ width: 1, depth: 1, position: [2, 3] });
  const contact = { ...from, position: [4.465, 3] as [number, number] };
  assert.deepEqual(constrainFurnitureDrag(from, contact, level).position, contact.position);
  assert.deepEqual(constrainFurnitureDrag(contact, from, level).position, from.position);
  assert.deepEqual(
    constrainFurnitureDrag({ ...from, locked: true }, { ...contact, locked: true }, level).position,
    from.position,
  );
});

test('a clear doorway can be crossed but its lintel blocks tall furniture', () => {
  const doorway = structuredClone(level);
  doorway.walls[4].openings = [{ id: 'door', kind: 'door', offset: 2, width: 2, height: 2.04 }];
  const short = createFurniture({ width: 0.5, depth: 0.5, height: 1.8, position: [2, 3] });
  assert.deepEqual(
    constrainFurnitureDrag(short, { ...short, position: [8, 3] }, doorway).position,
    [8, 3],
  );
  const tall = { ...short, height: 2.2 };
  assert.ok(constrainFurnitureDrag(tall, { ...tall, position: [8, 3] }, doorway).position[0] < 5);
});

test('a drag never crosses an empty concave notch even when both endpoints are inside', () => {
  const notch: Level = {
    ...structuredClone(level),
    walls: [],
    outline: [
      [0, 0],
      [10, 0],
      [10, 6],
      [6, 6],
      [6, 2],
      [4, 2],
      [4, 6],
      [0, 6],
    ],
    rooms: [],
  };
  const from = createFurniture({ width: 0.5, depth: 0.5, position: [2, 4] });
  const result = constrainFurnitureDrag(from, { ...from, position: [8, 4] }, notch);
  assert.ok(result.position[0] < 4);
  assert.equal(getBuildingPlacementIssues(result, notch).length, 0);
});

test('legacy wall intersections can escape, but cannot continue through another wall', () => {
  const from = createFurniture({ width: 1, depth: 1, position: [5, 3] });
  assert.ok(getBuildingPlacementIssues(from, level).length);
  const escaped = constrainFurnitureDrag(from, { ...from, position: [7, 3] }, level);
  assert.deepEqual(escaped.position, [7, 3]);
  assert.equal(getBuildingPlacementIssues(escaped, level).length, 0);
  const stopped = constrainFurnitureDrag(from, { ...from, position: [15, 3] }, level);
  assert.ok(stopped.position[0] < 9.4 && stopped.position[0] > 6);
  assert.equal(getBuildingPlacementIssues(stopped, level).length, 0);
});

test('automatic additions find a deterministic free place only in the requested room', () => {
  const item = createFurniture({ kind: 'sofa', position: [5, 3] });
  const obstacle = createFurniture({ width: 2, depth: 2, position: [2.5, 3] });
  const first = findFurniturePlacement(item, level, [obstacle], 'left');
  assert.ok(first);
  assert.ok(pointInPolygon(first.position, level.rooms[0].polygon));
  assert.equal(getBuildingPlacementIssues(first, level).length, 0);
  assert.equal(polygonsOverlap(footprint(first), footprint(obstacle)), false);
  assert.deepEqual(
    findFurniturePlacement(item, level, [obstacle], 'left')?.position,
    first.position,
  );
  const enormous = { ...item, width: 7, depth: 7 };
  assert.equal(findFurniturePlacement(enormous, level, [], 'left'), undefined);
  assert.equal(findFurniturePlacement(item, level, [], 'missing-room'), undefined);
});

test('overlapping other furniture stays a diagnostic, not a building movement barrier', () => {
  const item = createFurniture({ width: 1, depth: 1, position: [1, 2] });
  const other = createFurniture({ width: 1, depth: 1, position: [3, 2] });
  const result = constrainFurnitureDrag(item, { ...item, position: [3, 2] }, level);
  assert.deepEqual(result.position, other.position);
});

test('automatic placement refuses an occupied requested room even when another room is free', () => {
  const item = createFurniture({ width: 0.5, depth: 0.5, position: [2.5, 3] });
  const fullRoom = createFurniture({ width: 4.765, depth: 5.6, position: [2.5825, 3] });
  assert.equal(findFurniturePlacement(item, level, [fullRoom], 'left'), undefined);
  assert.ok(findFurniturePlacement(item, level, [fullRoom], 'right'));
});

test('a floor datum change cannot move tall furniture into a lower clear-height volume', () => {
  const split = structuredClone(level);
  split.walls = [];
  split.rooms[0].floorOffset = -0.12;
  const item = createFurniture({ width: 0.5, depth: 0.5, height: 2.6, position: [2, 3] });
  assert.equal(getBuildingPlacementIssues(item, split).length, 0);
  const result = constrainFurnitureDrag(item, { ...item, position: [8, 3] }, split);
  assert.ok(result.position[0] < 5);
  assert.equal(getBuildingPlacementIssues(result, split).length, 0);
});
