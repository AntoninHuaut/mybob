import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Ray } from '@babylonjs/core/Culling/ray';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { buildExterior } from '../src/scene/buildExterior';
import { validateProject } from '../src/model/validate';
import { polygonArea } from '../src/model/geometry';
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
