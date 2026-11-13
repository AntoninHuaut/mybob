import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Ray } from '@babylonjs/core/Culling/ray';
import {
  ceilingHeightAt,
  ceilingProfile,
  ceilingSteps,
  ceilingTriangles,
  roofWindowWells,
} from '../src/model/ceiling';
import { validateProject } from '../src/model/validate';
import { polygonArea } from '../src/model/geometry';
import {
  packShareDocument,
  unpackShareDocument,
  type ShareDocument,
} from '../src/model/linkPacker';
import { buildHouse } from '../src/scene/buildHouse';
import type { Materials } from '../src/scene/materials';
import type { CeilingSlope, HouseProject, Level } from '../src/model/types';

const studio = (): HouseProject =>
  JSON.parse(readFileSync('public/projects/studio-demo.json', 'utf8')) as HouseProject;

const near = (actual: number, expected: number, tolerance = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≠ ${expected}`);

/**
 * The studio as an attic: an 8 × 6 m plan, a 2.70 m flat ceiling, a north slope
 * rising from 1.20 m on the inner face of the north wall, at 45°. Drawn east to west,
 * so its left — the rising side — is the south.
 */
const NORTH: CeilingSlope = { id: 'r-n', start: [7.7, 0.3], end: [0.3, 0.3], height: 1.2, rise: 1 };

function attic(slopes: CeilingSlope[] = [NORTH]): Level {
  const level = structuredClone(studio().levels[0]);
  level.ceilingSlopes = slopes;
  return level;
}

test('the ceiling is the lowest of the flat ceiling and of each slope', () => {
  const level = attic();
  near(ceilingHeightAt(level, [4, 0.3]), 1.2);
  near(ceilingHeightAt(level, [4, 1]), 1.9);
  near(ceilingHeightAt(level, [4, 3]), 2.7);
  // Behind the foot line the slope keeps going down.
  near(ceilingHeightAt(level, [4, 0.15]), 1.05);
  // Without a slope, the flat ceiling everywhere.
  near(ceilingHeightAt(studio().levels[0], [4, 0.3]), 2.7);
});

test('a gap interrupts the slope under a dormer, along the foot line', () => {
  // From the east end: 3 to 4 m along the foot line is x 3.7 to 4.7.
  const level = attic([{ ...NORTH, gaps: [[3, 4]] }]);
  near(ceilingHeightAt(level, [4.2, 0.5]), 2.7);
  near(ceilingHeightAt(level, [3.5, 0.5]), 1.4);
  near(ceilingHeightAt(level, [4.9, 0.5]), 1.4);
});

test('a partition across the slope gets a sloping run, then a flat one', () => {
  const runs = ceilingProfile(attic(), [2.35, 0.3], [2.35, 2.65]);
  assert.equal(runs.length, 2);
  near(runs[0].start, 0);
  near(runs[0].end, 1.5);
  near(runs[0].from, 1.2);
  near(runs[0].to, 2.7);
  near(runs[1].from, 2.7);
  near(runs[1].to, 2.7);
  near(runs[1].end, 2.35);
});

test('a wall caps its own profile, and a wall along the slope stays one flat run', () => {
  const capped = ceilingProfile(attic(), [2.35, 0.3], [2.35, 2.65], 2);
  near(capped[0].to, 2);
  near(capped[capped.length - 1].to, 2);
  const along = ceilingProfile(attic(), [0.3, 0.5], [7.7, 0.5]);
  assert.equal(along.length, 1);
  near(along[0].from, 1.4);
  near(along[0].to, 1.4);
});

test('the profile steps at the edges of a gap', () => {
  const level = attic([{ ...NORTH, gaps: [[3, 4]] }]);
  const runs = ceilingProfile(level, [2, 0.5], [6, 0.5]);
  assert.deepEqual(
    runs.map((run) =>
      [run.start, run.end, run.from, run.to].map((v) => Math.round(v * 1000) / 1000),
    ),
    [
      [0, 1.7, 1.4, 1.4],
      [1.7, 2.7, 2.7, 2.7],
      [2.7, 4, 1.4, 1.4],
    ],
  );
});

test('the ceiling surface covers the outline once and lies on the ceiling', () => {
  for (const level of [
    attic(),
    attic([
      { ...NORTH, gaps: [[3, 4]] },
      { id: 'r-s', start: [0.3, 5.7], end: [7.7, 5.7], height: 1.2, rise: 1 },
    ]),
    studio().levels[0],
  ]) {
    const triangles = ceilingTriangles(level);
    let area = 0;
    for (const [a, b, c] of triangles) {
      area += Math.abs((b[0] - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (b[2] - a[2])) / 2;
      const centre: [number, number] = [(a[0] + b[0] + c[0]) / 3, (a[2] + b[2] + c[2]) / 3];
      near((a[1] + b[1] + c[1]) / 3, ceilingHeightAt(level, centre), 1e-6);
    }
    near(area, 48, 1e-6);
  }
});

test('beside a gap, a vertical step closes the ceiling from the slope up to the flat part', () => {
  const steps = ceilingSteps(attic([{ ...NORTH, gaps: [[3, 4]] }]));
  // Each edge of the gap (x 4.7 and 3.7) gets a triangle of 1.8 × 1.8 m: from 0.90 m at
  // the north outline (z 0) up to 2.70 m, where the slope meets the flat ceiling (z 1.8).
  let area = 0;
  for (const { points } of steps) {
    const [b0, b1, t1, t0] = points;
    const run = Math.hypot(b1[0] - b0[0], b1[2] - b0[2]);
    area += (run * (t0[1] - b0[1] + (t1[1] - b1[1]))) / 2;
    assert.ok([3.7, 4.7].some((x) => Math.abs(b0[0] - x) < 1e-9));
  }
  near(area, 2 * 1.62, 1e-6);
  assert.deepEqual(ceilingSteps(attic()), []);
});

function validated(level: Level) {
  const project = studio();
  project.levels[0] = level;
  return () => validateProject(structuredClone(project));
}

test('validation: a slope rising toward the inside of the plan is accepted', () => {
  // High enough at the north wall axis (2.25 m) for the 0.90 + 1.30 m window.
  validated(attic([{ ...NORTH, height: 2.4 }]))();
});

test('validation: a gapped slope can rise into one wing of a concave attic', () => {
  const level = attic([]);
  level.outline = [
    [0, 0],
    [7, 0],
    [7, 7],
    [4, 7],
    [4, 3],
    [0, 3],
  ];
  level.walls = [];
  level.rooms = [
    {
      id: 'loft',
      name: 'Combles',
      kind: 'storage',
      polygon: structuredClone(level.outline),
      label: [5.5, 5],
      viewpoint: [5.5, 5],
    },
  ];
  level.spawn = { position: [5.5, 5], yaw: 0 };
  level.ceilingSlopes = [
    { id: 'wing', start: [4, -1], end: [4, 8], height: 1.2, rise: 1, gaps: [[0, 4.1]] },
  ];
  validated(level)();
  near(ceilingHeightAt(level, [4.5, 5]), 1.7);
  near(ceilingHeightAt(level, [1, 1]), level.ceilingHeight);
  const area = ceilingTriangles(level).reduce(
    (sum, [a, b, c]) =>
      sum + Math.abs((b[0] - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (b[2] - a[2])) / 2,
    0,
  );
  near(area, polygonArea(level.outline));
  const project = studio();
  project.levels = [level];
  const decoded = unpackShareDocument(packShareDocument(project as ShareDocument));
  validateProject(decoded);
  assert.deepEqual(decoded.levels[0].ceilingSlopes![0].gaps, [[0, 4.1]]);
  // Without the gap, this plane would cut the other wing below the floor.
  delete level.ceilingSlopes[0].gaps;
  assert.throws(validated(level), /monter vers l’intérieur/);
  // Gaps must not make an outward-facing active wing valid.
  level.ceilingSlopes = [
    { id: 'backwards', start: [7, 8], end: [7, -1], height: 1.2, rise: 1, gaps: [[0, 4.1]] },
  ];
  // Reverse it so the active floor lies entirely on the wrong side.
  [level.ceilingSlopes[0].start, level.ceilingSlopes[0].end] = [
    level.ceilingSlopes[0].end,
    level.ceilingSlopes[0].start,
  ];
  assert.throws(validated(level), /monter vers l’intérieur/);
});

test('validation: an opening above the slope is refused, unless a gap carries it', () => {
  assert.throws(validated(attic()), /plafond en pente/);
  // The north window spans x 3.5 to 6.0, 1.7 to 4.2 m along the foot line.
  validated(attic([{ ...NORTH, height: 2.2, gaps: [[1.6, 4.3]] }]))();
});

test('validation: a slope drawn backwards, or with unordered gaps, is refused', () => {
  const backwards = { ...NORTH, height: 2.4, start: NORTH.end, end: NORTH.start };
  assert.throws(validated(attic([backwards])), /monter vers l’intérieur/);
  assert.throws(
    validated(
      attic([
        {
          ...NORTH,
          height: 2.4,
          gaps: [
            [3, 4],
            [2, 2.5],
          ],
        },
      ]),
    ),
    /Interruptions/,
  );
  assert.throws(validated(attic([{ ...NORTH, height: 3 }])), /Rampant invalide/);
});

test('validation: a visit point under a low slope is refused', () => {
  // The window is in the gap; the bathroom visit point (z 1.5) is 1.70 m under the slope.
  assert.throws(
    validated(attic([{ ...NORTH, height: 0.5, gaps: [[1.6, 4.3]] }])),
    /point de visite/,
  );
});

test('the share link carries the slopes and their gaps', () => {
  const project = studio();
  project.levels[0].ceilingSlopes = [{ ...NORTH, height: 2.4, gaps: [[1.6, 4.3]] }];
  const decoded = unpackShareDocument(packShareDocument(project as ShareDocument));
  assert.deepEqual(decoded.levels[0].ceilingSlopes, [
    {
      id: 'rampant-0-0',
      start: [7.7, 0.3],
      end: [0.3, 0.3],
      height: 2.4,
      rise: 1,
      gaps: [[1.6, 4.3]],
    },
  ]);
  validateProject(structuredClone(decoded));
});

function scene(level: Level) {
  const engine = new NullEngine(),
    built = new Scene(engine);
  built.useRightHandedSystem = true;
  const material = new StandardMaterial('test', built);
  const materials = Object.fromEntries(
    ['plaster', 'wood', 'concrete', 'frame', 'glass', 'metal', 'slab', 'glow', 'selection'].map(
      (key) => [key, material],
    ),
  ) as unknown as Materials;
  const house = buildHouse(level, built, materials);
  built.meshes.forEach((mesh) => mesh.computeWorldMatrix(true));
  return { built, house };
}

const hit = (built: Scene, origin: Vector3, direction: Vector3, prefix: string) =>
  built.pickWithRay(new Ray(origin, direction, 20), (mesh) => mesh.name.startsWith(prefix))
    ?.pickedPoint?.y;

test('scene: a partition across the slope follows it, and so does the ceiling', () => {
  const { built, house } = scene(attic());
  const down = new Vector3(0, -1, 0);
  // The bathroom partition runs north–south at x 2.35: 1.50 m high 0.3 m from the foot line.
  near(hit(built, new Vector3(2.35, 5, 0.6), down, 'wall:studio-sdb-e')!, 1.5, 0.01);
  near(hit(built, new Vector3(2.35, 5, 2.4), down, 'wall:studio-sdb-e')!, 2.7, 0.01);
  house.ceiling.setEnabled(true);
  near(hit(built, new Vector3(4, 1, 1), new Vector3(0, 1, 0), 'ceiling')!, 1.9, 0.001);
  near(hit(built, new Vector3(4, 1, 4), new Vector3(0, 1, 0), 'ceiling')!, 2.7, 0.001);
});

test('scene: a fixture under the slope hangs from the slope', () => {
  const level = attic();
  level.lights = [{ id: 'l', position: [4, 1] }];
  const { house } = scene(level);
  near(house.fixtures[0].position.y, 1.9 - 0.025, 1e-6);
});

test('a roof window opens a well through the sloping ceiling, on to the height of its top', () => {
  const project = studio();
  project.levels[0] = attic();
  // The roof face runs 0.60 m above the north slope of the ceiling (0.90 + z): 1.50 + z.
  project.site = {
    boundary: [
      [-2, -2],
      [10, -2],
      [10, 8],
      [-2, 8],
    ],
    elevation: 0,
    notes: [],
    roofs: [
      {
        id: 'toit',
        vertices: [
          [-1, 1, -0.5],
          [9, 1, -0.5],
          [9, 4.5, 3],
          [-1, 4.5, 3],
        ],
        faces: [[0, 1, 2, 3]],
        windows: [{ id: 'velux', center: [4, 0.9], width: 0.8, height: 0.8 }],
      },
    ],
  };
  const level = project.levels[0];
  const wells = roofWindowWells(project, level);
  assert.equal(wells.cutouts.length, 1);
  // In plan the window spans z 0.617–1.183; its top edge is 2.683 m above the floor,
  // which the ceiling reaches 0.60 m further in, at z 1.783.
  const half = 0.4 * Math.SQRT1_2;
  const topEdge = 0.9 + half;
  const top = 1.5 + topEdge;
  const inner = topEdge + (top - (0.9 + topEdge));
  let area = 0;
  for (const [a, b, c] of ceilingTriangles(level, undefined, [], wells.cutouts))
    area += Math.abs((b[0] - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (b[2] - a[2])) / 2;
  near(area, 48 - 0.8 * (inner - (0.9 - half)), 1e-6);
  // Eave side, two sides cut where the roof passes the top height, and the flat top.
  assert.equal(wells.reveals.length, 6);
  for (const { points, normal } of wells.reveals) {
    if (normal[1] === -1) {
      for (const p of points) near(p[1], top, 1e-6);
      continue;
    }
    const [b0, b1, t1, t0] = points;
    for (const [bottom, upper] of [
      [b0, t0],
      [b1, t1],
    ]) {
      near(bottom[1], ceilingHeightAt(level, [bottom[0], bottom[2]]), 1e-6);
      near(upper[1], Math.min(1.5 + upper[2], top), 1e-6);
    }
  }
  // A level with a flat ceiling gets no well.
  project.levels[0] = studio().levels[0];
  assert.deepEqual(roofWindowWells(project, project.levels[0]), { cutouts: [], reveals: [] });
});
