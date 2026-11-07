import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Ray } from '@babylonjs/core/Culling/ray';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { buildExterior } from '../src/scene/buildExterior';
import { polygonArea, resolveRoofDormer, resolveRoofWindow } from '../src/model/geometry';
import { validateProject } from '../src/model/validate';
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
 * height 7, eaves 3: the south versant follows y = 11 − z.
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
  // The emprise is opened from the back join (z 5.5) to the outer face of the
  // mur de fond (axis 7.05 + thickness/2): 1.6 m deep.
  const hole = (1 + 2 * 0.003) * (7.1 - 5.5);
  near(
    meshPlanArea(pierced.getVerticesData('position')!, Array.from(pierced.getIndices()!)),
    10 * 4 - hole,
    0.001,
  );
  // The untouched north pan keeps its plain quadrilateral.
  const north = pans.find((mesh) => mesh.name === 'roof:toiture:0')!;
  near(
    meshPlanArea(north.getVerticesData('position')!, Array.from(north.getIndices()!)),
    10 * 4,
    0.001,
  );
  // Two joues: a triangle from the pan at the mur de fond (y = 11 − 7.1 = 3.9)
  // up to the top of the mur (combles floor 2.5 + height 2), rejoining the pan
  // at the back of the emprise (y = 11 − 5.5 = 5.5).
  const joues = built.roofMeshes.filter((mesh) => mesh.name.startsWith('dormer-joue:'));
  assert.equal(joues.length, 2);
  for (const joue of joues) {
    const positions = joue.getVerticesData('position')!;
    assert.equal(positions.length, 9);
    const ys = Array.from(positions.filter((_, i) => i % 3 === 1)).sort((a, b) => a - b);
    near(ys[0], 3.9);
    near(ys[1], 4.5);
    near(ys[2], 5.5);
    // The cheeks sit at the sides of the emprise, outside the wall body.
    const xs = Array.from(
      new Set(positions.filter((_, i) => i % 3 === 0).map((x) => Math.round(x * 1000) / 1000)),
    );
    assert.ok(xs.includes(3 - 0.003) || xs.includes(4 + 0.003));
  }
  // The dormer roof runs from the top of the mur to the pan at the back.
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
  // from the top of the mur (4.5) above the pan at the front (3.9):
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
  // One mur de fond wide enough for two chiens-assis, and an outline carrying both.
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
  // A mur de fond below the roofing stays rejected: the dormer would be invisible.
  bad((p) => {
    p.levels[1].walls[2].height = 1.2;
  });
  // Only a dormer mur de fond may exceed the ceiling height of its level.
  const p = dormerProject();
  p.levels[1].walls[2].height = 2.2;
  validateProject(p);
  const q = dormerProject();
  q.site!.roofs![0].dormers = [];
  q.levels[1].walls[2].height = 2.2;
  assert.throws(() => validateProject(q), /Hauteur de mur invalide/);
});

/**
 * Le versant nord de la fixture synthétique va de l'égout (z = 0) au faîtage
 * (z = 4) à 45° : y = 3 + z. Une fenêtre de toit s'y lit par son centre en plan
 * et sa hauteur le long du rampant ; rien n'appartient à une maison réelle.
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
/** Cote le long du rampant ramenée en plan : à 45°, z = d/√2. */
const slopeToPlan = (alongRamp: number) => alongRamp / Math.SQRT2;
type ExteriorMesh = ReturnType<typeof buildExterior>['roofMeshes'][number];
const verticesOf = (mesh: ExteriorMesh) => Array.from(mesh.getVerticesData('position')!);
const axisOf = (mesh: ExteriorMesh, axis: 0 | 1 | 2) =>
  verticesOf(mesh).filter((_, i) => i % 3 === axis);
const chasisOf = (built: ReturnType<typeof buildExterior>, part: string) =>
  built.roofMeshes.filter((mesh) => mesh.name.startsWith(`roof-window-${part}:`));
const distance = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

test('une fenêtre de toit perce le pan et pose son châssis dans le plan du rampant', () => {
  // Bas de baie à 2,00 m du chéneau le long du rampant, hauteur 1 m : le centre
  // tombe à 2,50 m, soit z = 2,50/√2 en plan.
  const project = veluxProject({
    id: 'velux-palier',
    center: [5, slopeToPlan(2.5)],
    width: 0.8,
    height: 1,
  });
  const p = validateProject(project);
  const { built, scene, engine } = exterior(p);
  const pan = built.roofMeshes.find((mesh) => mesh.name === 'roof:toiture:0')!;
  // Le percement enlève la projection de la baie : largeur × hauteur × cos 45°.
  near(
    meshPlanArea(pan.getVerticesData('position')!, Array.from(pan.getIndices()!)),
    10 * 4 - 0.8 * Math.SQRT1_2,
    0.001,
  );
  const [cadre] = chasisOf(built, 'cadre');
  const [vitrage] = chasisOf(built, 'vitrage');
  const [meneau] = chasisOf(built, 'meneau');
  assert.ok(cadre && vitrage && meneau, 'cadre, vitrage et meneau');
  // Chaque pièce est posée dans le plan du rampant y = 3 + z ; le vitrage seul
  // recule de 6 mm sous la couverture. Aucun sommet ne sort du pan : le châssis
  // ne traverse plus la couverture.
  for (const [mesh, expected] of [
    [cadre, 0],
    [meneau, 0],
    [vitrage, -0.006],
  ] as const) {
    const positions = verticesOf(mesh);
    for (let i = 0; i < positions.length; i += 3)
      near((positions[i + 1] - 3 - positions[i + 2]) / Math.SQRT2, expected, 1e-6);
  }
  // La cote du chéneau se lit sur le bas du cadre : 2 m le long du rampant,
  // jamais à l'aplomb de la gouttière.
  near(Math.min(...axisOf(cadre, 2)) * Math.SQRT2, 2, 0.001);
  assert.ok(Math.min(...axisOf(cadre, 2)) > 1, 'aucun châssis à l’aplomb du chéneau');
  // Largeur imprimée conservée à l'horizontale, hauteur le long du rampant.
  const xs = axisOf(cadre, 0);
  near(Math.max(...xs) - Math.min(...xs), 0.8, 0.001);
  const ring = verticesOf(cadre).slice(0, 12);
  near(distance(ring.slice(0, 3), ring.slice(3, 6)), 0.8, 0.001);
  near(distance(ring.slice(3, 6), ring.slice(6, 9)), 1, 0.001);
  // Le châssis suit la toiture : masqué avec elle dans les vues intérieures.
  assert.ok(built.roofMeshes.every((mesh) => !mesh.isEnabled()));
  built.dispose();
  scene.dispose();
  engine.dispose();
});

test('deux fenêtres de toit sur le même pan ouvrent chacune leur percement', () => {
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

test('une fenêtre de toit se résout depuis la seule toiture, quel que soit le versant', () => {
  // Un pan oblique dans les deux axes du plan : le versant suit y = 0,3x + 0,8z.
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
  // Base du pan : `up` monte le versant dans le plan, `across` reste horizontal.
  near(Math.hypot(...frame.up), 1, 1e-9);
  near(Math.hypot(...frame.across), 1, 1e-9);
  near(frame.across[1], 0, 1e-9);
  near(
    frame.up[0] * frame.normal[0] + frame.up[1] * frame.normal[1] + frame.up[2] * frame.normal[2],
    0,
    1e-9,
  );
  // Les quatre coins sont sur le pan et forment la baie cotée : 1 m à
  // l'horizontale, 1 m le long du rampant.
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

test('la validation refuse une fenêtre de toit que le rendu ne peut pas poser', () => {
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
  // Aucun pan ne porte la baie.
  bad((p) => {
    p.site!.roofs![0].windows![0].center = [5, 9];
  }, /Aucun pan ne porte/);
  // Trop petite pour les profils du modèle.
  bad((p) => {
    p.site!.roofs![0].windows![0].width = 0.05;
  }, /au moins 10 cm/);
  // Déborde du pan qui la porte.
  bad((p) => {
    p.site!.roofs![0].windows![0].width = 12;
  }, /déborde du pan/);
  // Posée sur l'arête du pan.
  bad((p) => {
    p.site!.roofs![0].windows![0].center = [0, slopeToPlan(2.5)];
  }, /déborde du pan/);
  // Le défaut de l'issue : une baie collée à l'arête basse, à l'aplomb du chéneau.
  bad((p) => {
    p.site!.roofs![0].windows![0].center = [5, slopeToPlan(0.5)];
  }, /déborde du pan/);
  // Identifiant dupliqué.
  bad((p) => {
    p.site!.roofs![0].windows![0].id = 'velux-autre';
    p.site!.roofs![0].windows![1] = { ...p.site!.roofs![0].windows![0] };
  }, /dupliqué/);
  // Un pan vertical ne peut pas porter de châssis : la baie s'y tiendrait debout.
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
  // Un pan horizontal non plus : le versant n'a pas de direction de montée.
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
