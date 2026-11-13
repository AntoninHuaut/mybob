import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Ray } from '@babylonjs/core/Culling/ray';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { buildExterior, planeUv } from '../src/scene/buildExterior';
import type { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial';
import type { Texture } from '@babylonjs/core/Materials/Textures/texture';
import {
  groundElevationAt,
  polygonArea,
  resolveRoofDormer,
  resolveRoofWindow,
} from '../src/model/geometry';
import { validateProject } from '../src/model/validate';
import { pointInOrOnPolygon, roofFaceHeightAt, roofFacePlanOutline } from '../src/model/geometry';
import type { HouseProject } from '../src/model/types';

const source: HouseProject = JSON.parse(
  await readFile(new URL('../public/projects/maison-atelier.json', import.meta.url), 'utf8'),
);
const near = (actual: number, expected: number, tolerance = 0.01) =>
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} ≠ ${expected}`);

function exterior(project = source) {
  const engine = new NullEngine(),
    scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  const built = buildExterior(project, project.levels[0], scene);
  scene.meshes.forEach((mesh) => mesh.computeWorldMatrix(true));
  return { scene, engine, built };
}
function meshPlanArea(positions: ArrayLike<number>, indices: number[]) {
  let area = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3,
      b = indices[i + 1] * 3,
      c = indices[i + 2] * 3;
    area +=
      Math.abs(
        (positions[b] - positions[a]) * (positions[c + 2] - positions[a + 2]) -
          (positions[c] - positions[a]) * (positions[b + 2] - positions[a + 2]),
      ) / 2;
  }
  return area;
}

test('parcel reconstruction preserves its declared area, four side dimensions and front setback', () => {
  const p = validateProject(source),
    boundary = p.site!.boundary;
  near(polygonArea(boundary), p.site!.declaredArea!);
  const lengths = boundary.map((a, i) =>
    Math.hypot(a[0] - boundary[(i + 1) % 4][0], a[1] - boundary[(i + 1) % 4][1]),
  );
  [24, 18, 24, 18].forEach((length, i) => near(lengths[i], length));
  near(-boundary[3][0], 9);
});

test('lawn triangulation excludes the entire house even where it touches the parcel boundary', () => {
  const { built, engine, scene } = exterior();
  const lawn = built.meshes.find((mesh) => mesh.name === 'parcel-lawn')!;
  near(
    meshPlanArea(lawn.getVerticesData('position')!, Array.from(lawn.getIndices()!)),
    polygonArea(source.site!.boundary) - polygonArea(source.levels[0].outline),
    0.001,
  );
  const ray = new Ray(new Vector3(2, 10, 1), new Vector3(0, -1, 0));
  // Direct mesh intersection ignores isPickable and ensures the garage has no grass beneath it.
  assert.equal(ray.intersectsMesh(lawn).hit, false);
  assert.equal(
    new Ray(new Vector3(-3, 10, 10), new Vector3(0, -1, 0)).intersectsMesh(lawn).hit,
    true,
  );
  assert.ok(lawn.checkCollisions);
  built.dispose();
  scene.dispose();
  engine.dispose();
});

test('roof envelope covers the L footprint, keeps its measured heights, and starts hidden', () => {
  const { built, scene, engine } = exterior();
  const roof = built.roofMeshes.filter((m) => m.name.startsWith('roof:'));
  const projected = roof.reduce(
    (sum, m) => sum + meshPlanArea(m.getVerticesData('position')!, Array.from(m.getIndices()!)),
    0,
  );
  near(projected, polygonArea(source.levels[0].outline), 0.001);
  near(built.height, 5.2);
  assert.ok(built.roofMeshes.every((m) => !m.isEnabled()));
  assert.ok(built.facadeMeshes.every((m) => typeof m.metadata.wallId === 'string'));
  const peak = Math.max(
    ...roof.flatMap((m) =>
      Array.from(m.getVerticesData('position')!).filter((_, i) => i % 3 === 1),
    ),
  );
  near(peak, 5.2, 0.001);
  built.dispose();
  assert.equal(scene.meshes.length, 0);
  assert.equal(scene.transformNodes.length, 0);
  scene.dispose();
  engine.dispose();
});

test('a roof overhang closes the wall band up to the pan, not the drip edge', () => {
  // The eave hangs 0.4 m past the walls: the roof face sits at 2.99 m over the wall
  // plane while the drip edge stays at 2.70 m. A band cut at the drip edge
  // leaves a slit into the attic all around the house.
  const project: HouseProject = structuredClone(source);
  const roof = project.site!.roofs![0];
  roof.vertices = roof.vertices.map(([x, y, z]) => [
    x === 0 ? -0.4 : x === 12 ? 12.4 : x,
    y,
    z === 0 ? -0.4 : z === 6 ? 6.4 : z,
  ]);
  const { built, scene, engine } = exterior(project);
  const bands = built.roofMeshes.filter((m) => m.name.startsWith('roof-wall-band:'));
  assert.ok(bands.length > 0);
  // Walls one roof face covers end to end: their band must reach it. The walls at the
  // junction of the two roofs only have to stay under the lowest roof face.
  const covered = new Set([
    'mur-sud-01',
    'mur-sud-02',
    'mur-est-01',
    'mur-ouest-01',
    'mur-ouest-garage',
  ]);
  for (const band of bands) {
    const id = band.name.slice('roof-wall-band:'.length);
    const box = band.getBoundingInfo().boundingBox;
    const top = box.maximumWorld.y;
    let lowest = Number.POSITIVE_INFINITY;
    for (let i = 0; i <= 20; i++)
      for (let j = 0; j <= 20; j++) {
        const x = box.minimumWorld.x + ((box.maximumWorld.x - box.minimumWorld.x) * i) / 20;
        const z = box.minimumWorld.z + ((box.maximumWorld.z - box.minimumWorld.z) * j) / 20;
        for (const roof of project.site!.roofs!)
          for (const face of roof.faces) {
            if (!pointInOrOnPolygon([x, z], roofFacePlanOutline(roof.vertices, face))) continue;
            lowest = Math.min(lowest, roofFaceHeightAt(roof.vertices, face, x, z));
          }
      }
    assert.ok(top <= lowest + 0.01, `${id} pokes through the pan (${top} > ${lowest})`);
    if (covered.has(id))
      assert.ok(top >= lowest - 0.01, `${id} stops below the pan (${top} < ${lowest})`);
  }
  built.dispose();
  scene.dispose();
  engine.dispose();
});

test('garage exterior cladding preserves the lowered garage door opening', () => {
  const { built, scene, engine } = exterior();
  const garageWall = source.levels[0].walls.find((wall) =>
    wall.openings?.some((o) => o.kind === 'garage'),
  )!;
  const opening = garageWall.openings!.find((o) => o.kind === 'garage')!;
  const ray = new Ray(
    new Vector3(-2, 0.1, garageWall.start[1] + opening.offset + opening.width / 2),
    new Vector3(1, 0, 0),
  );
  const facade = built.facadeMeshes.filter((m) => m.metadata.wallId === garageWall.id);
  assert.ok(facade.length > 0);
  assert.ok(facade.every((m) => !ray.intersectsMesh(m).hit));
  built.dispose();
  scene.dispose();
  engine.dispose();
});

test('site geometry rejects self-crossings, escaped access paths and corrupt roof faces', () => {
  const bad = (edit: (p: HouseProject) => void) => {
    const p = structuredClone(source);
    edit(p);
    assert.throws(() => validateProject(p));
  };
  bad((p) => {
    p.site!.boundary = [
      [-15, -2],
      [25, 20],
      [-15, 20],
      [25, -2],
    ];
  });
  bad((p) => {
    p.site!.surfaces![0].polygon[0] = [-100, 0];
  });
  bad((p) => {
    p.site!.roofs![0].faces[0][0] = -1;
  });
  bad((p) => {
    p.site!.roofs![0].faces[0][0] = 100;
  });
  bad((p) => {
    p.site!.roofs![0].faces[0][0] = 1.5;
  });
  bad((p) => {
    p.site!.roofs![0].vertices[0][1] = Number.NaN;
  });
  bad((p) => {
    p.site!.roofs![0].faces[0] = [0, 7, 1, 6];
  });
  bad((p) => {
    p.site!.roofs![0].faces[0] = [0, 1, 2, 6];
  });
  bad((p) => {
    p.site!.facadeColor = 'red';
  });
});

test('site remains optional and personal geometry is not a rendering prerequisite', () => {
  const p = structuredClone(source);
  delete p.site;
  validateProject(p);
  const { built, scene, engine } = exterior(p);
  assert.equal(built.meshes.length, 0);
  assert.equal(built.roofMeshes.length, 0);
  near(built.height, p.levels[0].ceilingHeight);
  built.dispose();
  scene.dispose();
  engine.dispose();
});

/**
 * A synthetic two-level house with a gable roof and one chien-assis: generic
 * coordinates, no personal plan. Ridge at z=4, eaves at z=0 and z=8, ridge
 * height 7, eaves 3: the south slope follows y = 11 − z.
 */
function dormerProject(): HouseProject {
  const project: HouseProject = {
    schemaVersion: 1,
    id: 'maison-synthetique',
    name: 'Maison synthétique',
    description: 'Une maison à lucarne pour tester le percement',
    units: 'm',
    source: { title: 'Fixture de test', status: 'Test', notes: [] },
    levels: [
      {
        id: 'rdc',
        name: 'Rez-de-chaussée',
        elevation: 0,
        ceilingHeight: 2.5,
        outline: [
          [0, 0],
          [10, 0],
          [10, 8],
          [0, 8],
        ],
        walls: [],
        rooms: [],
        lights: [],
        spawn: { position: [5, 4], yaw: 0 },
      },
      {
        id: 'combles',
        name: 'Combles aménagés',
        elevation: 2.5,
        ceilingHeight: 2,
        outline: [
          [0.2, 0.3],
          [9.8, 0.3],
          [9.8, 5.5],
          [4.2, 5.5],
          [4.2, 7.1],
          [2.8, 7.1],
          [2.8, 5.5],
          [0.2, 5.5],
        ],
        walls: [
          {
            id: 'h-rampant-nord',
            start: [0.2, 0.35],
            end: [9.8, 0.35],
            thickness: 0.1,
            height: 1.2,
            exterior: true,
          },
          {
            id: 'h-rampant-sud',
            start: [0.2, 5.45],
            end: [9.8, 5.45],
            thickness: 0.1,
            height: 1.2,
            exterior: true,
          },
          {
            id: 'h-d-fond',
            start: [3, 7.05],
            end: [4, 7.05],
            thickness: 0.1,
            height: 2,
            exterior: true,
            openings: [
              { id: 'd-fenetre', kind: 'window', offset: 0.05, width: 0.9, height: 1, sill: 0.8 },
            ],
          },
        ],
        rooms: [],
        lights: [],
        spawn: { position: [5, 4], yaw: 0 },
      },
    ],
    site: {
      boundary: [
        [-5, -5],
        [15, -5],
        [15, 13],
        [-5, 13],
      ],
      elevation: 0,
      notes: [],
      roofs: [
        {
          id: 'toiture',
          vertices: [
            [0, 3, 0],
            [10, 3, 0],
            [0, 7, 4],
            [10, 7, 4],
            [0, 3, 8],
            [10, 3, 8],
          ],
          faces: [
            [0, 1, 3, 2],
            [2, 3, 5, 4],
          ],
          gables: [
            [0, 2, 4],
            [1, 3, 5],
          ],
          dormers: [
            {
              id: 'lucarne-test',
              start: [3, 7],
              end: [4, 5.5],
              wallId: 'h-d-fond',
            },
          ],
        },
      ],
    },
  };
  return project;
}

test('a dormer pierces the pan on its emprise, builds the joues and the dormer roof', () => {
  const source = dormerProject();
  const p = validateProject(source);
  const { built, scene, engine } = exterior(p);
  const pans = built.roofMeshes.filter((mesh) => mesh.name.startsWith('roof:toiture:'));
  const pierced = pans.find((mesh) => mesh.name === 'roof:toiture:1')!;
  assert.ok(pierced, 'le versant sud existe');
  // The footprint is opened from the back join (z 5.5) to the outer face of the
  // back wall (axis 7.05 + thickness/2): 1.6 m deep.
  const hole = (1 + 2 * 0.003) * (7.1 - 5.5);
  near(
    meshPlanArea(pierced.getVerticesData('position')!, Array.from(pierced.getIndices()!)),
    10 * 4 - hole,
    0.001,
  );
  // The untouched north roof face keeps its plain quadrilateral.
  const north = pans.find((mesh) => mesh.name === 'roof:toiture:0')!;
  near(
    meshPlanArea(north.getVerticesData('position')!, Array.from(north.getIndices()!)),
    10 * 4,
    0.001,
  );
  // Two cheeks: a triangle from the roof face at the back wall (y = 11 − 7.1 = 3.9)
  // up to the top of the mur (combles floor 2.5 + height 2), rejoining the roof face
  // at the back of the footprint (y = 11 − 5.5 = 5.5).
  const joues = built.roofMeshes.filter((mesh) => mesh.name.startsWith('dormer-joue:'));
  assert.equal(joues.length, 2);
  for (const joue of joues) {
    const positions = joue.getVerticesData('position')!;
    assert.equal(positions.length, 9);
    const ys = Array.from(positions.filter((_, i) => i % 3 === 1)).sort((a, b) => a - b);
    near(ys[0], 3.9);
    near(ys[1], 4.5);
    near(ys[2], 5.5);
    // The cheeks sit at the sides of the footprint, outside the wall body.
    const xs = Array.from(
      new Set(positions.filter((_, i) => i % 3 === 0).map((x) => Math.round(x * 1000) / 1000)),
    );
    assert.ok(xs.includes(3 - 0.003) || xs.includes(4 + 0.003));
  }
  // The dormer roof runs from the top of the mur to the roof face at the back.
  const toit = built.roofMeshes.filter((mesh) => mesh.name.startsWith('dormer-toit:'));
  assert.equal(toit.length, 2);
  for (const panel of toit) {
    const positions = panel.getVerticesData('position')!;
    near(Math.min(...positions.filter((_, i) => i % 3 === 1)), 4.5);
    near(Math.max(...positions.filter((_, i) => i % 3 === 1)), 5.5);
  }
  assert.ok(built.roofMeshes.every((mesh) => !mesh.isEnabled()));
  built.dispose();
  scene.dispose();
  engine.dispose();
});

test('a declared dormer slope changes where the dormer roof meets the pan', () => {
  const project = dormerProject();
  project.site!.roofs![0].dormers![0].slope = 0.25;
  const p = validateProject(project);
  // Pan rising 1 m per metre of retreat; the dormer roof rises 0.25 per metre
  // from the top of the mur (4.5) above the roof face at the front (3.9):
  // they join 0.8 m behind the mur, at y = 3.9 + 0.8 = 4.7.
  const { built, scene, engine } = exterior(p);
  const toit = built.roofMeshes.filter((mesh) => mesh.name.startsWith('dormer-toit:'));
  for (const panel of toit) {
    const positions = panel.getVerticesData('position')!;
    near(Math.min(...positions.filter((_, i) => i % 3 === 1)), 4.5);
    near(Math.max(...positions.filter((_, i) => i % 3 === 1)), 4.7);
  }
  const pierced = built.roofMeshes.find((mesh) => mesh.name === 'roof:toiture:1')!;
  const hole = (1 + 2 * 0.003) * 0.8;
  near(
    meshPlanArea(pierced.getVerticesData('position')!, Array.from(pierced.getIndices()!)),
    10 * 4 - hole,
    0.001,
  );
  built.dispose();
  scene.dispose();
  engine.dispose();
});

test('a flat dormer roof clears the top of its back wall instead of sharing its plane', () => {
  const project = dormerProject();
  // Back wall top at 2.5 + 3 = 5.5, the height of the pan at the back of the footprint: the
  // dormer roof would be flat at the very height of the wall's top, through its thickness.
  project.levels[1].walls.find((wall) => wall.id === 'h-d-fond')!.height = 3;
  const { built, scene, engine } = exterior(validateProject(project));
  // Lifted at the front so that over the wall's inner face (0.1 m into a 1.6 m retreat) it
  // stays 2 cm above the wall: 5.5 + 0.02 / (1.5 / 1.6).
  const front = 5.5 + 0.02 / (1.5 / 1.6);
  for (const panel of built.roofMeshes.filter((mesh) => mesh.name.startsWith('dormer-toit:'))) {
    const ys = Array.from(panel.getVerticesData('position')!.filter((_, i) => i % 3 === 1));
    near(Math.min(...ys), 5.5);
    near(Math.max(...ys), front);
  }
  // The cheeks and the front rise to the lifted roof, leaving no gap under it.
  for (const name of ['dormer-joue:', 'dormer-facade:']) {
    for (const mesh of built.roofMeshes.filter((candidate) => candidate.name.startsWith(name))) {
      const ys = Array.from(mesh.getVerticesData('position')!.filter((_, i) => i % 3 === 1));
      near(Math.max(...ys), front);
    }
  }
  built.dispose();
  scene.dispose();
  engine.dispose();
});

test('gables and wall bands stand in the facade skin plane, clear of the upper walls', () => {
  // An upper level's exterior wall shown with the roof shares the wall plane: a gable or a
  // band left in it flickered. Both stand at the skin's outer face, 0.012 + 0.018 / 2 out.
  const skin = 0.021;
  const project = dormerProject();
  const { built, scene, engine } = exterior(validateProject(project));
  const gables = built.roofMeshes.filter((mesh) => mesh.name.startsWith('gable:'));
  assert.equal(gables.length, 2);
  const xs = gables.map((gable) => {
    const positions = Array.from(gable.getVerticesData('position')!.filter((_, i) => i % 3 === 0));
    near(Math.min(...positions), Math.max(...positions));
    return positions[0];
  });
  assert.deepEqual(
    xs.sort((a, b) => a - b).map((x) => Math.round(x * 1000) / 1000),
    [-skin, 10 + skin],
  );
  built.dispose();
  scene.dispose();
  engine.dispose();
  const atelier = exterior();
  const walls = new Map(source.levels.flatMap((level) => level.walls).map((w) => [w.id, w]));
  let checked = 0;
  for (const band of atelier.built.roofMeshes.filter((m) => m.name.startsWith('roof-wall-band:'))) {
    const wall = walls.get(band.name.slice('roof-wall-band:'.length).split(':')[0])!;
    const alongX = Math.abs(wall.end[1] - wall.start[1]) < 1e-6;
    if (!alongX && Math.abs(wall.end[0] - wall.start[0]) > 1e-6) continue;
    const box = band.getBoundingInfo().boundingBox;
    const axis = alongX ? wall.start[1] : wall.start[0];
    const [low, high] = alongX
      ? [box.minimumWorld.z, box.maximumWorld.z]
      : [box.minimumWorld.x, box.maximumWorld.x];
    const outward = Math.max(axis - low, high - axis);
    near(outward, wall.thickness / 2 + skin, 0.0005);
    checked++;
  }
  assert.ok(checked > 0);
  atelier.built.dispose();
  atelier.scene.dispose();
  atelier.engine.dispose();
});

test('dormers resolve from the project data alone, whatever the house', () => {
  const project = dormerProject();
  const p = validateProject(project);
  const frame = resolveRoofDormer(
    p,
    p.site!.roofs![0].vertices,
    p.site!.roofs![0].faces,
    p.site!.roofs![0].dormers![0],
  );
  assert.ok(frame.frame);
  assert.equal(frame.frame.faceIndex, 1);
  near(frame.frame.meet, 5.5);
  near(frame.frame.front, 7.1, 0.001);
  near(frame.frame.frontTop, 4.5);
});

test('two dormers on the same pan each open their own hole', () => {
  const twin = dormerProject();
  // One back wall wide enough for two dormers, and an outline carrying both.
  const mur = twin.levels[1].walls.find((w) => w.id === 'h-d-fond')!;
  mur.start = [3, 7.05];
  mur.end = [6, 7.05];
  mur.openings = [
    { id: 'd-fenetre-1', kind: 'window', offset: 0.05, width: 0.9, height: 1, sill: 0.8 },
    { id: 'd-fenetre-2', kind: 'window', offset: 2.05, width: 0.9, height: 1, sill: 0.8 },
  ];
  twin.levels[1].outline = [
    [0.2, 0.3],
    [9.8, 0.3],
    [9.8, 5.5],
    [6.2, 5.5],
    [6.2, 7.1],
    [4.8, 7.1],
    [4.8, 5.5],
    [4.2, 5.5],
    [4.2, 7.1],
    [2.8, 7.1],
    [2.8, 5.5],
    [0.2, 5.5],
  ];
  twin.site!.roofs![0].dormers = [
    { id: 'lucarne-a', start: [3, 5.5], end: [4, 7], wallId: 'h-d-fond' },
    { id: 'lucarne-b', start: [5, 5.5], end: [6, 7], wallId: 'h-d-fond' },
  ];
  const p = validateProject(twin);
  const { built, scene, engine } = exterior(p);
  const pierced = built.roofMeshes.find((mesh) => mesh.name === 'roof:toiture:1')!;
  const hole = (1 + 2 * 0.003) * (7.1 - 5.5);
  near(
    meshPlanArea(pierced.getVerticesData('position')!, Array.from(pierced.getIndices()!)),
    10 * 4 - 2 * hole,
    0.001,
  );
  assert.equal(built.roofMeshes.filter((m) => m.name.startsWith('dormer-joue:')).length, 4);
  assert.equal(built.roofMeshes.filter((m) => m.name.startsWith('dormer-toit:')).length, 4);
  built.dispose();
  scene.dispose();
  engine.dispose();
});

test('dormer validation rejects misaligned emprises, hidden walls and runaway slopes', () => {
  const bad = (edit: (p: HouseProject) => void) => {
    const p = dormerProject();
    edit(p);
    assert.throws(() => validateProject(p));
  };
  bad((p) => {
    p.site!.roofs![0].dormers![0].wallId = 'inconnu';
  });
  bad((p) => {
    p.site!.roofs![0].dormers![0].start = [3, 7.02];
    p.site!.roofs![0].dormers![0].end = [4, 7.04];
  });
  bad((p) => {
    p.site!.roofs![0].dormers![0].start = [3, 9];
    p.site!.roofs![0].dormers![0].end = [4, 11];
  });
  bad((p) => {
    p.site!.roofs![0].dormers![0].slope = 42;
  });
  bad((p) => {
    p.levels[1].walls[2].exterior = false;
  });
  // A back wall below the roofing stays rejected: the dormer would be invisible.
  bad((p) => {
    p.levels[1].walls[2].height = 1.2;
  });
  // Only a dormer back wall may exceed the ceiling height of its level.
  const p = dormerProject();
  p.levels[1].walls[2].height = 2.2;
  validateProject(p);
  const q = dormerProject();
  q.site!.roofs![0].dormers = [];
  q.levels[1].walls[2].height = 2.2;
  assert.throws(() => validateProject(q), /Hauteur de mur invalide/);
});

test('facade skins reach the corner instead of uncovering the neighbour end cap', () => {
  const { built, engine, scene } = exterior();
  const facades = (id: string) => built.meshes.filter((m) => m.name.startsWith(`facade:${id}:`));
  const facadeMax = (id: string, axis: 'x' | 'z') =>
    Math.max(...facades(id).map((m) => m.getBoundingInfo().boundingBox.maximumWorld[axis]));
  const facadeMin = (id: string, axis: 'x' | 'z') =>
    Math.min(...facades(id).map((m) => m.getBoundingInfo().boundingBox.minimumWorld[axis]));
  // A centreline-to-centreline corner: the east skin must reach the north
  // wall's outer skin plane, 6.112 m, not stop at the centreline endpoint 6.
  near(facadeMax('mur-est-01', 'z'), 6.112, 0.01);
  near(facadeMax('mur-nord-01', 'x'), 12.112, 0.01);
  // Collinear joins keep their span: the west garage section starts where the
  // first west section ends, no stretch over its neighbour.
  near(facadeMin('mur-ouest-garage', 'z'), 0.391, 0.01);
  built.dispose();
  scene.dispose();
  engine.dispose();
});

/**
 * The north slope of the synthetic fixture goes from the eaves (z = 0) to the ridge
 * (z = 4) at 45°: y = 3 + z. A roof window is read there by its centre in plan
 * and its height along the rafter; nothing belongs to a real house.
 */
interface VeluxFixture {
  id: string;
  center: [number, number];
  width: number;
  height: number;
}
function veluxProject(...windows: VeluxFixture[]): HouseProject {
  const project = dormerProject();
  project.site!.roofs![0].windows = windows;
  return project;
}
/** Dimension along the rafter brought back to plan: at 45°, z = d/√2. */
const slopeToPlan = (alongRamp: number) => alongRamp / Math.SQRT2;
type ExteriorMesh = ReturnType<typeof buildExterior>['roofMeshes'][number];
const verticesOf = (mesh: ExteriorMesh) => Array.from(mesh.getVerticesData('position')!);
const axisOf = (mesh: ExteriorMesh, axis: 0 | 1 | 2) =>
  verticesOf(mesh).filter((_, i) => i % 3 === axis);
const chasisOf = (built: ReturnType<typeof buildExterior>, part: string) =>
  built.roofMeshes.filter((mesh) => mesh.name.startsWith(`roof-window-${part}:`));
const distance = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

test('a roof window pierces the roof face and sets its frame in the rafter plane', () => {
  // Window bottom 2.00 m from the gutter along the rafter, height 1 m: the centre
  // falls at 2.50 m, i.e. z = 2.50/√2 in plan.
  const project = veluxProject({
    id: 'velux-palier',
    center: [5, slopeToPlan(2.5)],
    width: 0.8,
    height: 1,
  });
  const p = validateProject(project);
  const { built, scene, engine } = exterior(p);
  const pan = built.roofMeshes.find((mesh) => mesh.name === 'roof:toiture:0')!;
  // The piercing removes the window's projection: width × height × cos 45°.
  near(
    meshPlanArea(pan.getVerticesData('position')!, Array.from(pan.getIndices()!)),
    10 * 4 - 0.8 * Math.SQRT1_2,
    0.001,
  );
  const [cadre] = chasisOf(built, 'cadre');
  const [vitrage] = chasisOf(built, 'vitrage');
  const [meneau] = chasisOf(built, 'meneau');
  assert.ok(cadre && vitrage && meneau, 'cadre, vitrage et meneau');
  // Every part is set in the rafter plane y = 3 + z; only the glazing
  // sits 6 mm back under the covering. No vertex leaves the roof face: the frame
  // no longer crosses the covering.
  for (const [mesh, expected] of [
    [cadre, 0],
    [meneau, 0],
    [vitrage, -0.006],
  ] as const) {
    const positions = verticesOf(mesh);
    for (let i = 0; i < positions.length; i += 3)
      near((positions[i + 1] - 3 - positions[i + 2]) / Math.SQRT2, expected, 1e-6);
  }
  // The gutter dimension is read on the bottom of the frame: 2 m along the rafter,
  // never plumb with the gutter.
  near(Math.min(...axisOf(cadre, 2)) * Math.SQRT2, 2, 0.001);
  assert.ok(Math.min(...axisOf(cadre, 2)) > 1, 'aucun châssis à l’aplomb du chéneau');
  // Printed width kept horizontal, height along the rafter.
  const xs = axisOf(cadre, 0);
  near(Math.max(...xs) - Math.min(...xs), 0.8, 0.001);
  const ring = verticesOf(cadre).slice(0, 12);
  near(distance(ring.slice(0, 3), ring.slice(3, 6)), 0.8, 0.001);
  near(distance(ring.slice(3, 6), ring.slice(6, 9)), 1, 0.001);
  // The frame follows the roof: hidden with it in interior views.
  assert.ok(built.roofMeshes.every((mesh) => !mesh.isEnabled()));
  built.dispose();
  scene.dispose();
  engine.dispose();
});

test('two roof windows on the same roof face each open their own piercing', () => {
  const project = veluxProject(
    { id: 'velux-a', center: [3, slopeToPlan(2.5)], width: 0.8, height: 1 },
    { id: 'velux-b', center: [7, slopeToPlan(2.5)], width: 1.2, height: 1 },
  );
  const p = validateProject(project);
  const { built, scene, engine } = exterior(p);
  const pan = built.roofMeshes.find((mesh) => mesh.name === 'roof:toiture:0')!;
  near(
    meshPlanArea(pan.getVerticesData('position')!, Array.from(pan.getIndices()!)),
    10 * 4 - (0.8 + 1.2) * Math.SQRT1_2,
    0.001,
  );
  assert.equal(chasisOf(built, 'cadre').length, 2);
  assert.equal(chasisOf(built, 'vitrage').length, 2);
  assert.equal(chasisOf(built, 'meneau').length, 2);
  built.dispose();
  scene.dispose();
  engine.dispose();
});

test('a roof window is resolved from the roof alone, whatever the slope', () => {
  // A roof face oblique on both plan axes: the slope follows y = 0.3x + 0.8z.
  const vertices: [number, number, number][] = [
    [0, 0, 0],
    [10, 3, 0],
    [10, 7, 5],
    [0, 4, 5],
  ];
  const resolved = resolveRoofWindow(vertices, [[0, 1, 2, 3]], {
    id: 'velux-oblique',
    center: [5, 2.5],
    width: 1,
    height: 1,
  });
  assert.ok(resolved.frame);
  const { frame } = resolved;
  assert.equal(frame.faceIndex, 0);
  near(frame.center[1], 3.5, 0.001);
  // Roof face basis: `up` climbs the slope in the plane, `across` stays horizontal.
  near(Math.hypot(...frame.up), 1, 1e-9);
  near(Math.hypot(...frame.across), 1, 1e-9);
  near(frame.across[1], 0, 1e-9);
  near(
    frame.up[0] * frame.normal[0] + frame.up[1] * frame.normal[1] + frame.up[2] * frame.normal[2],
    0,
    1e-9,
  );
  // The four corners are on the roof face and form the dimensioned window: 1 m
  // horizontally, 1 m along the rafter.
  for (const [x, y, z] of frame.corners)
    assert.ok(Math.abs(y - (0.3 * x + 0.8 * z)) < 0.001, 'coin dans le plan du rampant');
  near(distance(frame.corners[0], frame.corners[1]), 1, 0.001);
  near(distance(frame.corners[1], frame.corners[2]), 1, 0.001);
  near(
    Math.hypot(
      frame.corners[1][0] - frame.corners[0][0],
      frame.corners[1][2] - frame.corners[0][2],
    ),
    1,
    0.001,
  );
});

test('validation refuses a roof window the renderer cannot place', () => {
  const bad = (edit: (p: HouseProject) => void, pattern: RegExp) => {
    const p = veluxProject({
      id: 'velux-test',
      center: [5, slopeToPlan(2.5)],
      width: 0.8,
      height: 1,
    });
    edit(p);
    assert.throws(() => validateProject(p), pattern);
  };
  // No roof face carries the window.
  bad((p) => {
    p.site!.roofs![0].windows![0].center = [5, 9];
  }, /Aucun pan ne porte/);
  // Too small for the model's profiles.
  bad((p) => {
    p.site!.roofs![0].windows![0].width = 0.05;
  }, /au moins 10 cm/);
  // Overflows the roof face carrying it.
  bad((p) => {
    p.site!.roofs![0].windows![0].width = 12;
  }, /déborde du pan/);
  // Set on the edge of the roof face.
  bad((p) => {
    p.site!.roofs![0].windows![0].center = [0, slopeToPlan(2.5)];
  }, /déborde du pan/);
  // The issue's defect: a window stuck to the low edge, plumb with the gutter.
  bad((p) => {
    p.site!.roofs![0].windows![0].center = [5, slopeToPlan(0.5)];
  }, /déborde du pan/);
  // Duplicate identifier.
  bad((p) => {
    p.site!.roofs![0].windows![0].id = 'velux-autre';
    p.site!.roofs![0].windows![1] = { ...p.site!.roofs![0].windows![0] };
  }, /dupliqué/);
  // A vertical roof face cannot carry a frame: the window would stand upright.
  const vertical = veluxProject({ id: 'velux-raide', center: [0, 2.5], width: 1, height: 1 });
  vertical.site!.roofs![0] = {
    id: 'toiture-raide',
    vertices: [
      [0, 0, 0],
      [0, 3, 0],
      [0, 3, 5],
      [0, 0, 5],
    ],
    faces: [[0, 1, 2, 3]],
    windows: [{ id: 'velux-raide', center: [0, 2.5], width: 1, height: 1 }],
  };
  assert.throws(() => validateProject(vertical), /pan vertical/);
  // A horizontal roof face neither: the slope has no rising direction.
  const flat = veluxProject({ id: 'velux-plat', center: [5, 2.5], width: 1, height: 1 });
  flat.site!.roofs![0] = {
    id: 'toiture-plate',
    vertices: [
      [0, 3, 0],
      [10, 3, 0],
      [10, 3, 5],
      [0, 3, 5],
    ],
    faces: [[0, 1, 2, 3]],
    windows: [{ id: 'velux-plat', center: [5, 2.5], width: 1, height: 1 }],
  };
  assert.throws(() => validateProject(flat), /pan horizontal/);
});

/** Does a horizontal ray from outside hit one of the named meshes first? */
function hits(
  meshes: { name: string }[],
  prefix: string,
  origin: [number, number, number],
  direction: [number, number, number],
) {
  const ray = new Ray(new Vector3(...origin), new Vector3(...direction), 50);
  return (meshes as Parameters<Ray['intersectsMesh']>[0][]).some(
    (mesh) => mesh.name.startsWith(prefix) && ray.intersectsMesh(mesh).hit,
  );
}

test('a dormer front closes the back wall above the pan and opens for its window', () => {
  const { built, scene, engine } = exterior(validateProject(dormerProject()));
  const front = built.roofMeshes.find((mesh) => mesh.name === 'dormer-facade:toiture:lucarne-test');
  assert.ok(front, 'the dormer front exists');
  // From the pan 12 mm in front of the wall (y = 11 − 7.112) to the top of the
  // back wall (combles floor 2.5 + 2), with one hole for the window.
  const ys = Array.from(front.getVerticesData('position')!).filter((_, i) => i % 3 === 1);
  near(Math.min(...ys), 3.888);
  near(Math.max(...ys), 4.5);
  assert.equal(ys.length, 8);
  // Window 3.3–4.3 m high, x 3.05–3.95: seen from the street, glass where it
  // rises above the pan, render above it.
  assert.equal(hits(built.roofMeshes, 'dormer-facade:', [3.5, 4.1, 12], [0, 0, -1]), false);
  assert.ok(
    hits(built.roofMeshes, 'level-window-vitrage:combles:d-fenetre', [3.5, 4.1, 12], [0, 0, -1]),
  );
  assert.ok(hits(built.roofMeshes, 'dormer-facade:', [3.5, 4.4, 12], [0, 0, -1]));
  assert.ok(built.roofMeshes.every((mesh) => !mesh.isEnabled()));
  built.dispose();
  scene.dispose();
  engine.dispose();
});

test('an attic window in the gable wall opens the band and the gable, a knee-wall window stays inside', () => {
  const project = dormerProject();
  const [rdc, combles] = project.levels;
  rdc.walls.push({ id: 'ouest', start: [0.15, 0], end: [0.15, 8], thickness: 0.3, exterior: true });
  // Gable wall of the attic, outer face on the gable plane x = 0. Its window
  // (z 2.3–3.3, y 2.8–3.8) straddles the band top (3, the eaves) and the gable.
  combles.walls.push({
    id: 'h-ouest',
    start: [0.15, 0.3],
    end: [0.15, 5.5],
    thickness: 0.3,
    exterior: true,
    openings: [{ id: 'g-fenetre', kind: 'window', offset: 2, width: 1, sill: 0.3, height: 1 }],
  });
  combles.walls[0].openings = [
    { id: 'k-fenetre', kind: 'window', offset: 4, width: 0.8, sill: 0.2, height: 0.8 },
  ];
  const { built, scene, engine } = exterior(project);
  const fromWest = (y: number, z: number, prefix: string) =>
    hits(built.roofMeshes, prefix, [-3, y, z], [1, 0, 0]);
  // The band stays whole below the window and beside it.
  assert.ok(fromWest(2.6, 2.8, 'roof-wall-band:ouest'));
  assert.ok(fromWest(2.9, 1.5, 'roof-wall-band:ouest'));
  assert.equal(fromWest(2.9, 2.8, 'roof-wall-band:ouest'), false);
  // The gable keeps its render around the window and opens over it.
  assert.ok(fromWest(3.5, 1.5, 'gable:toiture:0'));
  assert.equal(fromWest(3.5, 2.8, 'gable:toiture:0'), false);
  for (const y of [2.9, 3.5]) assert.ok(fromWest(y, 2.8, 'level-window-vitrage:combles:g-fenetre'));
  // The knee wall stands under the north pan: nothing opens for its window.
  assert.equal(
    built.roofMeshes.some((mesh) => mesh.name.includes(':combles:k-fenetre')),
    false,
  );
  built.dispose();
  scene.dispose();
  engine.dispose();
});

test('face UVs are metres along the eave and up the slope, whatever the face', () => {
  // A 30° roof face rising towards +z: the slope, not its plan depth, is the v span.
  const normal = [0, Math.cos(Math.PI / 6), -Math.sin(Math.PI / 6)];
  const eave = planeUv([2, 3, 0], normal);
  const ridge = planeUv([2, 3 + Math.tan(Math.PI / 6) * 4, 4], normal);
  const along = planeUv([7, 3, 0], normal);
  near(Math.abs(along[0] - eave[0]), 5);
  near(along[1], eave[1]);
  near(ridge[1] - eave[1], 4 / Math.cos(Math.PI / 6));
  near(ridge[0], eave[0]);
  // The opposite normal gives the same slope: the winding of a face does not matter.
  const flipped = planeUv(
    [2, 3 + Math.tan(Math.PI / 6) * 4, 4],
    normal.map((v) => -v),
  );
  near(
    flipped[1] -
      planeUv(
        [2, 3, 0],
        normal.map((v) => -v),
      )[1],
    4 / Math.cos(Math.PI / 6),
  );
  // A wall: v is the height. A level face: plan axes.
  near(planeUv([1, 2.5, 3], [1, 0, 0])[1], 2.5);
  assert.deepEqual(planeUv([1, 2, 3], [0, 1, 0]), [1, 3]);
});

test('the lawn, roof and render carry their generated maps, on metric UVs', () => {
  const { engine, built, scene } = exterior();
  try {
    const lawn = scene.getMaterialByName('lawn') as PBRMaterial;
    assert.equal(lawn.albedoTexture?.name, 'lawn-albedo');
    assert.ok(lawn.detailMap.isEnabled && lawn.detailMap.texture?.name === 'lawn-detail');
    near((lawn.albedoTexture as Texture).uScale, 1 / 16, 1e-9);
    const roof = scene.getMaterialByName('slate-roof') as PBRMaterial;
    assert.equal(roof.bumpTexture?.name, 'slate-normal');
    assert.equal(roof.microSurfaceTexture?.name, 'slate-roughness');
    const render = scene.getMaterialByName('exterior-render') as PBRMaterial;
    assert.equal(render.bumpTexture?.name, 'render-normal');
    // Lawn UVs are plan metres.
    const ground = built.meshes.find((mesh) => mesh.name === 'parcel-lawn')!;
    const positions = ground.getVerticesData('position')!;
    const uvs = ground.getVerticesData('uv')!;
    near(uvs[0], positions[0], 1e-6);
    near(uvs[1], positions[2], 1e-6);
    // A façade panel spans its width in metres on its large faces, not 0..1.
    const facade = built.facadeMeshes.reduce((widest, mesh) =>
      mesh.getBoundingInfo().boundingBox.extendSize.x >
      widest.getBoundingInfo().boundingBox.extendSize.x
        ? mesh
        : widest,
    );
    const width = facade.getBoundingInfo().boundingBox.extendSize.x * 2;
    const facadeUvs = facade.getVerticesData('uv')!;
    const normals = facade.getVerticesData('normal')!;
    const u = Array.from({ length: normals.length / 3 }, (_, i) => i)
      .filter((i) => Math.abs(normals[i * 3 + 2]) > 0.5)
      .map((i) => facadeUvs[i * 2]);
    assert.ok(width > 1, 'the widest façade panel is wider than a metre');
    near(Math.max(...u) - Math.min(...u), width, 1e-4);
  } finally {
    scene.dispose();
    engine.dispose();
  }
});

/** #259: the four garden elements of the acceptance criterion, on the atelier plot. */
function gardenProject(): HouseProject {
  const p = structuredClone(source);
  p.site!.surfaces = [
    {
      id: 'terrasse',
      kind: 'terrace',
      height: 0.15,
      polygon: [
        [0.5, 12],
        [5.5, 12],
        [5.5, 14],
        [0.5, 14],
      ],
    },
    {
      id: 'allee-garage',
      kind: 'gravel',
      polygon: [
        [7, 7.5],
        [11.5, 7.5],
        [11.5, 11],
        [7, 11],
      ],
    },
    {
      id: 'pelouse',
      kind: 'lawn',
      polygon: [
        [-8, -2],
        [-2, -2],
        [-2, 3],
        [-8, 3],
      ],
    },
  ];
  p.site!.boundaries = [
    {
      id: 'mur-fond',
      kind: 'wall',
      height: 1.8,
      points: [
        [-9, 14.9],
        [15, 14.9],
      ],
    },
    {
      id: 'cloture-est',
      kind: 'fence',
      height: 1.2,
      points: [
        [14.98, -3],
        [14.98, 14.8],
      ],
    },
    {
      id: 'haie-sud',
      kind: 'hedge',
      height: 1.5,
      thickness: 0.8,
      points: [
        [-9, -2.6],
        [5, -2.6],
        [5, -1],
      ],
    },
  ];
  return validateProject(p);
}

test('#259: terrace, gravel drive, boundary wall and fence render at their positions and heights', () => {
  const project = gardenProject();
  const { built, scene, engine } = exterior(project);
  const box = (name: string) => {
    const mesh = scene.getMeshByName(name)!;
    assert.ok(mesh, `${name} is built`);
    mesh.computeWorldMatrix(true);
    mesh.refreshBoundingInfo({});
    return mesh.getBoundingInfo().boundingBox;
  };
  const terrace = box('site-surface:terrasse');
  near(terrace.maximumWorld.y, 0.15);
  near(terrace.minimumWorld.x, 0.5);
  near(terrace.maximumWorld.z, 14);
  near(box('site-surface-edge:terrasse').minimumWorld.y, 0);
  const drive = box('site-surface:allee-garage');
  near(drive.minimumWorld.x, 7);
  near(drive.maximumWorld.z, 11);
  assert.ok(drive.maximumWorld.y < 0.01, 'the drive stays flush with the ground');
  assert.ok(scene.getMeshByName('site-surface:pelouse'));

  const wall = box('site-boundary:mur-fond');
  near(wall.maximumWorld.y, 1.8);
  near(wall.minimumWorld.y, 0);
  near(wall.minimumWorld.z, 14.8);
  near(wall.maximumWorld.z, 15);
  near(wall.minimumWorld.x, -9.1);
  const fence = box('site-boundary-posts:cloture-est');
  near(fence.maximumWorld.y, 1.2);
  near(fence.minimumWorld.z, -3.04);
  near(fence.maximumWorld.z, 14.84);
  near((fence.minimumWorld.x + fence.maximumWorld.x) / 2, 14.98);
  const panel = box('site-boundary:cloture-est');
  assert.ok(panel.maximumWorld.x - panel.minimumWorld.x < 0.01, 'a single plane of mesh');
  const wire = scene.getMeshByName('site-boundary:cloture-est')!.material as PBRMaterial;
  assert.equal(wire.transparencyMode, 1, 'the wire panel is alpha-tested');
  assert.ok(wire.useAlphaFromAlbedoTexture && wire.albedoTexture, 'cut out by the mesh texture');
  const hedge = box('site-boundary:haie-sud');
  near(hedge.maximumWorld.y, 1.5);
  near(hedge.minimumWorld.z, -3);
  near(hedge.maximumWorld.x, 5.4);

  // The wall, the hedge, and the fence's panels and posts.
  assert.equal(built.boundaryMeshes.length, 4);
  assert.ok(built.boundaryMeshes.every((mesh) => mesh.checkCollisions));
  built.dispose();
  scene.dispose();
  engine.dispose();
});

test('#259: the visit stands on a raised terrace, not under it', () => {
  const project = gardenProject();
  const level = project.levels[0];
  near(groundElevationAt(level, project.site, [3, 13]), level.elevation + 0.15);
  near(groundElevationAt(level, project.site, [9, 9]), level.elevation);
  near(groundElevationAt(level, project.site, [-4, 0]), level.elevation);
});

test('#259: garden surfaces and boundaries reject what the engine cannot draw', () => {
  const bad = (edit: (p: HouseProject) => void) => {
    const p = structuredClone(gardenProject());
    edit(p);
    assert.throws(() => validateProject(p));
  };
  bad((p) => {
    p.site!.surfaces![1].height = 0.2; // only a terrace has a slab
  });
  bad((p) => {
    p.site!.surfaces![0].height = 2;
  });
  bad((p) => {
    (p.site!.surfaces![0] as { kind: string }).kind = 'pool';
  });
  bad((p) => {
    p.site!.boundaries![0].points = [[0, 14.9]];
  });
  bad((p) => {
    p.site!.boundaries![0].points[1] = [30, 14.9];
  });
  bad((p) => {
    p.site!.boundaries![1].points[1] = [...p.site!.boundaries![1].points[0]];
  });
  bad((p) => {
    p.site!.boundaries![0].height = 5;
  });
  bad((p) => {
    p.site!.boundaries![2].thickness = 0;
  });
  bad((p) => {
    (p.site!.boundaries![2] as { kind: string }).kind = 'gate';
  });
});

test('#259: a project without garden boundaries builds none', () => {
  const { built, scene, engine } = exterior();
  assert.equal(built.boundaryMeshes.length, 0);
  built.dispose();
  scene.dispose();
  engine.dispose();
});
