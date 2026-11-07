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

function level(overrides: Partial<HouseProject['levels'][0]> = {}): HouseProject['levels'][0] {
  return {
    id: 'level',
    name: 'Level',
    elevation: 0,
    ceilingHeight: 2.5,
    outline: [
      [0, 0],
      [6, 0],
      [6, 4],
      [0, 4],
    ],
    spawn: { position: [1, 1], yaw: 0 },
    lights: [],
    walls: [],
    rooms: [],
    ...overrides,
  };
}

function project(levelOverrides: Partial<HouseProject['levels'][0]> = {}): HouseProject {
  return {
    schemaVersion: 1,
    units: 'm',
    id: 'synthetic',
    name: 'Synthetic',
    description: '',
    source: { title: 'Synthetic test', status: 'test', notes: [] },
    levels: [level(levelOverrides)],
  };
}

test('audit flags a wall end that stops just short of another wall', () => {
  const issues = auditPlan(
    project({
      walls: [
        { id: 'north-part', start: [3, 0], end: [3, 1.9], thickness: 0.1 },
        { id: 'south-part', start: [3, 2], end: [3, 4], thickness: 0.1 },
      ],
    }),
  ).issues;
  const gap = issues.find((i) => i.kind === 'wall-endpoint-gap');
  assert.ok(gap, 'expected a wall-endpoint-gap issue');
  assert.ok(Math.abs(gap!.value - 0.1) < 1e-6);
});

test('audit flags a room that no floor-level passage reaches', () => {
  const issues = auditPlan(
    project({
      walls: [{ id: 'solid', start: [3, 0], end: [3, 4], thickness: 0.1 }],
      rooms: [
        {
          id: 'west',
          name: 'West',
          kind: 'living',
          polygon: [
            [0.2, 0.2],
            [2.8, 0.2],
            [2.8, 3.8],
            [0.2, 3.8],
          ],
          label: [1.5, 2],
          viewpoint: [1.5, 2],
        },
        {
          id: 'east',
          name: 'East',
          kind: 'bedroom',
          polygon: [
            [3.2, 0.2],
            [5.8, 0.2],
            [5.8, 3.8],
            [3.2, 3.8],
          ],
          label: [4.5, 2],
          viewpoint: [4.5, 2],
        },
      ],
    }),
  ).issues;
  assert.ok(issues.some((i) => i.kind === 'room-unreachable' && i.ids.includes('east')));
  assert.ok(!issues.some((i) => i.kind === 'room-unreachable' && i.ids.includes('west')));
});

test('audit flags duplicate walls', () => {
  const issues = auditPlan(
    project({
      walls: [
        { id: 'a', start: [1, 1], end: [1, 3], thickness: 0.1 },
        { id: 'b', start: [1, 1], end: [1, 3], thickness: 0.1 },
      ],
      rooms: [],
    }),
  ).issues;
  assert.ok(issues.some((i) => i.kind === 'duplicate-wall'));
});

test('audit flags a partition floating outside the outline, not a straddling exterior wall', () => {
  const issues = auditPlan(
    project({
      walls: [
        // entièrement au-delà du contour : le mur fantôme de cage d'escalier
        { id: 'ghost', start: [2, 4.6], end: [4, 4.6], thickness: 0.12 },
        // mur extérieur à cheval sur le contour : un arêtier d'étage en retrait
        { id: 'knee', start: [6.05, 0], end: [6.05, 4], thickness: 0.2, exterior: true },
        // cloison moitié dedans moitié dehors : elle garde un contact de plancher
        { id: 'straddle', start: [0, 1], end: [0, 3], thickness: 0.1 },
      ],
    }),
  ).issues;
  const ghost = issues.find((i) => i.kind === 'interior-wall-outside-outline');
  assert.ok(ghost, 'expected an interior-wall-outside-outline issue for the ghost wall');
  assert.ok(ghost!.ids.includes('ghost'));
  assert.ok(Math.abs(ghost!.value - 0.24) < 1e-6);
  assert.ok(
    !issues.some((i) => i.kind === 'interior-wall-outside-outline' && i.ids.includes('knee')),
  );
  assert.ok(
    !issues.some((i) => i.kind === 'interior-wall-outside-outline' && i.ids.includes('straddle')),
  );
});

test('audit flags a spawn outside every room', () => {
  const issues = auditPlan(
    project({
      spawn: { position: [5, 3], yaw: 0 },
      rooms: [
        {
          id: 'room',
          name: 'Room',
          kind: 'living',
          polygon: [
            [0.2, 0.2],
            [2, 0.2],
            [2, 2],
            [0.2, 2],
          ],
          label: [1, 1],
          viewpoint: [1, 1],
        },
      ],
    }),
  ).issues;
  assert.ok(issues.some((i) => i.kind === 'spawn-outside-room'));
});
