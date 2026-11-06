import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Ray } from '@babylonjs/core/Culling/ray';
import type { HouseProject } from '../src/model/types';
import { alongWall } from '../src/model/geometry';
import { buildPlanOpenings } from '../src/scene/planOpenings';
import { HouseViewer } from '../src/scene/viewer';

const project: HouseProject = JSON.parse(
  await readFile(new URL('../public/projects/maison-atelier.json', import.meta.url), 'utf8'),
);
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

test('every window and sliding bay has a plan symbol at its exact source offset and width', () => {
  const engine = new NullEngine(),
    scene = new Scene(engine);
  const level = project.levels[0];
  const markers = buildPlanOpenings(scene, level);
  const expected = level.walls.flatMap((wall) =>
    (wall.openings ?? [])
      .filter((opening) => ['window', 'sliding'].includes(opening.kind))
      .map((opening) => ({ wall, opening })),
  );
  assert.equal(markers.meshes.length, expected.length);
  assert.ok(expected.some(({ opening }) => opening.kind === 'sliding'));
  for (const { wall, opening } of expected) {
    const mesh = markers.meshes.find((mesh) => mesh.metadata.id === opening.id)!;
    const vertices = mesh.getVerticesData('position')!;
    const halfGap = Math.max(0.025, Math.min(0.05, wall.thickness * 0.22));
    const start = alongWall(wall, opening.offset, -halfGap);
    const end = alongWall(wall, opening.offset + opening.width, -halfGap);
    near(vertices[0], start[0]);
    near(vertices[2], start[1]);
    near(vertices[3], end[0]);
    near(vertices[5], end[1]);
    near(Math.hypot(vertices[3] - vertices[0], vertices[5] - vertices[2]), opening.width);
    assert.equal(mesh.isPickable, false);
    assert.equal(mesh.checkCollisions, false);
    assert.equal(mesh.isEnabled(), false);
    assert.equal(vertices.length, opening.kind === 'sliding' ? 42 : 30);
  }
  markers.dispose();
  assert.equal(scene.meshes.length, 0);
  engine.dispose();
});

test('symbols follow rotated wall coordinates and adapt to low cuts on elevated levels', () => {
  const engine = new NullEngine(),
    scene = new Scene(engine);
  const level = structuredClone(project.levels[0]);
  level.elevation = 3;
  level.walls = [
    {
      id: 'diagonal',
      start: [2, 4],
      end: [5, 8],
      thickness: 0.3,
      exterior: true,
      openings: [{ id: 'bay', kind: 'sliding', offset: 1, width: 2, height: 2.15 }],
    },
  ];
  const glass = MeshBuilder.CreateBox('original-glass', {}, scene);
  glass.checkCollisions = true;
  const markers = buildPlanOpenings(scene, level);
  markers.setVisible(true, 0.4);
  const mesh = markers.meshes[0];
  assert.equal(mesh.isEnabled(), true);
  near(mesh.position.y, 3.388);
  const vertices = mesh.getVerticesData('position')!;
  const start = alongWall(level.walls[0], 1, -0.05);
  near(vertices[0], start[0]);
  near(vertices[2], start[1]);
  markers.setVisible(false);
  assert.equal(mesh.isEnabled(), false);
  assert.equal(glass.isEnabled(), true);
  assert.equal(glass.checkCollisions, true);
  markers.dispose();
  assert.deepEqual(scene.meshes, [glass]);
  scene.dispose();
  engine.dispose();
});

test('plan uses an opening-height cut by default and restores normal overview, visit and exterior volumes', () => {
  const engine = new NullEngine(),
    scene = new Scene(engine);
  const level = { ...project.levels[0], elevation: 2.8 };
  const markers = buildPlanOpenings(scene, level);
  const viewer = Object.assign(Object.create(HouseViewer.prototype), {
    scene,
    level,
    mode: 'plan',
    sectionHeight: undefined,
    exteriorView: false,
    planOpenings: markers,
  }) as HouseViewer;
  const update = () => (viewer as unknown as { updateSection(): void }).updateSection();
  update();
  near(scene.clipPlane!.d, -4);
  assert.ok(markers.meshes.every((mesh) => mesh.isEnabled()));
  assert.ok(scene.clipPlane!.dotCoordinate(new Vector3(0, markers.meshes[0].position.y, 0)) < 0);
  viewer.mode = 'walk';
  update();
  assert.equal(scene.clipPlane, null);
  assert.ok(markers.meshes.every((mesh) => !mesh.isEnabled()));
  viewer.mode = 'overview';
  update();
  assert.equal(scene.clipPlane, null);
  Object.assign(viewer, { sectionHeight: 0.6 });
  update();
  near(scene.clipPlane!.d, -3.4);
  viewer.mode = 'plan';
  update();
  near(scene.clipPlane!.d, -3.4);
  near(markers.meshes[0].position.y, 3.388);
  Object.assign(viewer, { exteriorView: true });
  update();
  assert.equal(scene.clipPlane, null);
  assert.ok(markers.meshes.every((mesh) => !mesh.isEnabled()));
  scene.dispose();
  engine.dispose();
});

test('horizontal section surfaces retain wall thickness while bays and doors stay open at the cut', () => {
  const engine = new NullEngine(),
    scene = new Scene(engine);
  const level = {
    ...project.levels[0],
    elevation: 2.8,
    walls: [
      {
        id: 'test',
        start: [0, 0] as [number, number],
        end: [5, 0] as [number, number],
        thickness: 0.3,
        height: 2.5,
        openings: [
          { id: 'window', kind: 'window' as const, offset: 1, width: 1, height: 0.9, sill: 1.1 },
          { id: 'bay', kind: 'sliding' as const, offset: 2.5, width: 1, height: 2.15 },
          { id: 'door', kind: 'door' as const, offset: 4, width: 0.8, height: 2.1 },
        ],
      },
    ],
  };
  const markers = buildPlanOpenings(scene, level);
  const hitAt = (x: number, z = 0) => {
    markers.wallCaps.forEach((mesh) => mesh.computeWorldMatrix(true));
    const ray = new Ray(new Vector3(x, level.elevation + 3, z), new Vector3(0, -1, 0), 4);
    return ray.intersectsMeshes(markers.wallCaps.filter((mesh) => mesh.isEnabled())).length > 0;
  };
  markers.setVisible(true, 1.2);
  assert.equal(hitAt(0.5, 0.14), true, 'solid cut retains the 30cm wall thickness');
  assert.equal(hitAt(0.5, 0.16), false);
  assert.equal(hitAt(1.5), false, 'window void remains open');
  assert.equal(hitAt(3), false, 'bay void remains open');
  assert.equal(hitAt(4.4), false, 'door void remains open');
  for (const mesh of markers.wallCaps.filter((mesh) => mesh.isEnabled())) {
    assert.equal(mesh.isPickable, false);
    assert.equal(mesh.checkCollisions, false);
    near(mesh.getBoundingInfo().boundingBox.maximumWorld.y, level.elevation + 1.2 - 0.018);
    assert.ok(mesh.getBoundingInfo().boundingBox.maximumWorld.y < markers.meshes[0].position.y);
  }
  markers.setVisible(true, 0.8);
  assert.equal(hitAt(1.5), true, 'a lower cut retains the solid window sill');
  assert.equal(hitAt(3), false, 'a bay has no solid sill');
  markers.setVisible(true, 2.3);
  assert.equal(hitAt(3), true, 'a high cut correctly crosses the bay lintel');
  markers.setVisible(false);
  assert.ok(markers.wallCaps.every((mesh) => !mesh.isEnabled()));
  markers.dispose();
  assert.equal(scene.meshes.length, 0);
  assert.equal(scene.materials.length, 0);
  scene.dispose();
  engine.dispose();
});

test('section surfaces use the built wall datum for a lowered garage opening', () => {
  const engine = new NullEngine(),
    scene = new Scene(engine);
  const level = {
    ...project.levels[0],
    elevation: 3,
    walls: [
      {
        id: 'garage',
        start: [0, 0] as [number, number],
        end: [5, 0] as [number, number],
        thickness: 0.3,
        openings: [
          { id: 'garage-bay', kind: 'sliding' as const, offset: 1, width: 2, height: 2.15 },
        ],
      },
    ],
  };
  // buildHouse has already placed this lintel 12cm lower than the main datum.
  const source = MeshBuilder.CreateBox(
    'wall:garage:1',
    { width: 2, height: 0.47, depth: 0.3 },
    scene,
  );
  source.position.y = level.elevation + 2.265;
  const markers = buildPlanOpenings(scene, level);
  markers.setVisible(true, 2.1);
  assert.equal(
    markers.wallCaps.find((mesh) => mesh.name === 'plan-wall-cap:garage:1')!.isEnabled(),
    true,
  );
  markers.setVisible(true, 2);
  assert.equal(
    markers.wallCaps.find((mesh) => mesh.name === 'plan-wall-cap:garage:1')!.isEnabled(),
    false,
  );
  scene.dispose();
  engine.dispose();
});
