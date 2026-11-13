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
        // entirely beyond the outline: the phantom stairwell wall
        { id: 'ghost', start: [2, 4.6], end: [4, 4.6], thickness: 0.12 },
        // exterior wall straddling the outline: a ridge of a recessed upper level
        { id: 'knee', start: [6.05, 0], end: [6.05, 4], thickness: 0.2, exterior: true },
        // partition half inside half outside: it keeps a floor contact
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

test('audit accepts tiny door jambs on the floor and still flags the same host outside it', () => {
  const issues = auditPlan(
    project({
      walls: [1, 5].map((z) => ({
        id: `host-${z}`,
        start: [1, z] as Point2,
        end: [2, z] as Point2,
        thickness: 0.07,
        openings: [
          { id: `door-${z}`, kind: 'door' as const, offset: 0.04, width: 0.92, height: 2.1 },
        ],
      })),
    }),
  ).issues.filter((i) => i.kind === 'interior-wall-outside-outline');
  assert.equal(issues.length, 1);
  assert.deepEqual(issues[0].ids, ['host-5']);
  assert.ok(Math.abs(issues[0].value - 0.0056) < 1e-8);
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

test('audit flags a wall standing over a stairwell void, not one flanking it', () => {
  const stairwell: Point2[] = [
    [2, 1],
    [3.5, 1],
    [3.5, 2.5],
    [2, 2.5],
  ];
  const issues = auditPlan(
    project({
      floorVoids: [stairwell],
      walls: [
        // invented partition blocking the floor opening: it floats over the void
        { id: 'over-the-void', start: [2.5, 0.6], end: [2.5, 3.2], thickness: 0.07 },
        // balustrade rendered as a partition in the floor opening, between two walls
        { id: 'railing-as-wall', start: [2.55, 1], end: [2.55, 2.5], thickness: 0.07 },
        // legitimate wall bordering the opening's face: its face is flush with the edge
        { id: 'flank', start: [1.95, 1], end: [1.95, 2.5], thickness: 0.1 },
      ],
      rooms: [
        {
          id: 'room',
          name: 'Room',
          kind: 'living',
          polygon: [
            [0.2, 0.2],
            [5.8, 0.2],
            [5.8, 3.8],
            [0.2, 3.8],
          ],
          label: [3, 3],
          viewpoint: [3, 3],
        },
      ],
    }),
  ).issues;
  const over = issues.filter((i) => i.kind === 'wall-over-void');
  assert.ok(
    over.some((i) => i.ids.includes('over-the-void') && Math.abs(i.value - 0.105) < 1e-6),
    `overlap attendu 0.105, reçu ${JSON.stringify(over)}`,
  );
  assert.ok(over.some((i) => i.ids.includes('railing-as-wall')));
  assert.ok(!over.some((i) => i.ids.includes('flank')));
});

const square = (x0: number, z0: number, x1: number, z1: number): Point2[] => [
  [x0, z0],
  [x1, z0],
  [x1, z1],
  [x0, z1],
];

test('audit flags a wall whose face sits more than 3 cm off the room it bounds', () => {
  const room = (id: string): HouseProject['levels'][0]['rooms'][0] => ({
    id,
    name: id,
    kind: 'circulation',
    polygon: square(1, 1, 3, 3),
    label: [2, 2],
    viewpoint: [2, 2],
  });
  const wall = (x: number) => ({
    id: 'w',
    start: [x, 0.9] as Point2,
    end: [x, 3.1] as Point2,
    thickness: 0.1,
  });
  const gaps = (x: number) =>
    auditPlan(project({ rooms: [room('r')], walls: [wall(x)] })).issues.filter(
      (i) => i.kind === 'wall-room-gap',
    );
  assert.equal(gaps(0.95).length, 0, 'flush: inner face on the room edge');
  assert.equal(gaps(0.98).length, 0, 'within 3 cm');
  const off = gaps(0.88);
  assert.equal(off.length, 1);
  assert.ok(Math.abs(off[0].value - 0.07) < 1e-9);
});

test('audit flags an opening under the roof covering that no roof window or dormer carries', () => {
  const base = project({
    ceilingHeight: 2,
    walls: [
      {
        id: 'knee',
        start: [1, 1],
        end: [5, 1],
        thickness: 0.05,
        height: 1.2,
        exterior: true,
        openings: [{ id: 'skylight', kind: 'window', offset: 1.5, width: 1, height: 0.8 }],
      },
      {
        id: 'back',
        start: [1, 2.5],
        end: [2, 2.5],
        thickness: 0.1,
        height: 1.1,
        exterior: true,
        openings: [{ id: 'dormer-window', kind: 'window', offset: 0, width: 0.9, height: 1 }],
      },
    ],
  });
  base.site = {
    boundary: [
      [-5, -5],
      [15, -5],
      [15, 9],
      [-5, 9],
    ],
    elevation: 0,
    notes: [],
    roofs: [
      {
        id: 'roof',
        vertices: [
          [0, 1.5, 0],
          [6, 1.5, 0],
          [0, 2.5, 4],
          [6, 2.5, 4],
        ],
        faces: [[0, 1, 3, 2]],
      },
    ],
  };
  const uncarried = () =>
    auditPlan(base)
      .issues.filter((i) => i.kind === 'opening-under-roof-uncarried')
      .map((i) => i.ids[1])
      .sort();
  assert.deepEqual(uncarried(), ['dormer-window', 'skylight']);
  const roof = base.site!.roofs![0];
  roof.windows = [{ id: 'fenetre', center: [3, 1.2], width: 1, height: 0.8 }];
  assert.deepEqual(uncarried(), ['dormer-window']);
  base.levels[0].walls[1].height = 2.3;
  roof.dormers = [{ id: 'lucarne', start: [1, 1.5], end: [2, 2.45], wallId: 'back' }];
  assert.deepEqual(uncarried(), []);
});
