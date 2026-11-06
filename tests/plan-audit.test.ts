import assert from 'node:assert/strict';
import test from 'node:test';
import { auditPlan, intersectionArea } from '../scripts/audit-plan';
import type { HouseProject, Point2 } from '../src/model/types';

test('plan audit intersects concave polygons, reversed winding and boundary-only contacts', () => {
  const concave: Point2[] = [
    [0, 0],
    [3, 0],
    [3, 1],
    [1, 1],
    [1, 3],
    [0, 3],
  ];
  const square: Point2[] = [
    [0.5, 0.5],
    [2, 0.5],
    [2, 2],
    [0.5, 2],
  ];
  assert.ok(Math.abs(intersectionArea(concave, square) - 1.25) < 1e-8);
  assert.ok(Math.abs(intersectionArea([...concave].reverse(), square) - 1.25) < 1e-8);
  assert.equal(
    intersectionArea(concave, [
      [3, 0],
      [4, 0],
      [4, 1],
      [3, 1],
    ]),
    0,
  );
});

test('audit distinguishes a door threshold from a solid cross-wall and detects overlap/clearance', () => {
  const project: HouseProject = {
    schemaVersion: 1,
    units: 'm',
    id: 'synthetic',
    name: 'Synthetic',
    description: '',
    source: { title: 'Synthetic test', status: 'test', notes: [] },
    levels: [
      {
        id: 'level',
        name: 'Level',
        elevation: 0,
        ceilingHeight: 2.5,
        outline: [
          [0, 0],
          [5, 0],
          [5, 5],
          [0, 5],
        ],
        spawn: { position: [2.5, 2.5], yaw: 0 },
        lights: [],
        walls: [
          {
            id: 'wall',
            start: [2, 0],
            end: [2, 5],
            thickness: 0.2,
            openings: [{ id: 'door', kind: 'door', offset: 2, width: 1, height: 2.1 }],
          },
        ],
        rooms: [
          {
            id: 'threshold',
            name: 'Threshold',
            kind: 'circulation',
            polygon: [
              [1.5, 2.1],
              [2.5, 2.1],
              [2.5, 2.9],
              [1.5, 2.9],
            ],
            label: [2, 2.5],
            viewpoint: [2, 2.5],
          },
        ],
      },
    ],
  };
  assert.equal(auditPlan(project).issues.length, 0);
  project.levels[0].walls.push({
    id: 'cross-wall',
    start: [1, 2.5],
    end: [3, 2.5],
    thickness: 0.1,
  });
  project.levels[0].rooms.push({ ...structuredClone(project.levels[0].rooms[0]), id: 'overlap' });
  const issues = auditPlan(project).issues;
  assert.ok(issues.some((i) => i.kind === 'room-solid-wall' && i.ids.includes('cross-wall')));
  assert.ok(issues.some((i) => i.kind === 'room-room' && Math.abs(i.value - 0.8) < 1e-8));
  assert.ok(issues.some((i) => i.kind === 'visitor-wall-clearance' && i.value === 0));
});
