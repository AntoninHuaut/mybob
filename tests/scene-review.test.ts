import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Ray } from '@babylonjs/core/Culling/ray';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import { FurnitureLayer } from '../src/furniture/layer';
import { createFurniture } from '../src/furniture/model';
import { isSceneVisitDestination } from '../src/scene/navigation';
import { buildHouse } from '../src/scene/buildHouse';
import { buildExterior } from '../src/scene/buildExterior';
import type { Materials } from '../src/scene/materials';
import type { HouseProject } from '../src/model/types';

const demo: HouseProject = JSON.parse(
  await readFile(new URL('../public/projects/studio-demo.json', import.meta.url), 'utf8'),
);

function fixture() {
  const engine = new NullEngine(),
    scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  const level = structuredClone(demo.levels[0]);
  level.walls = [];
  level.rooms = [
    {
      id: 'room',
      name: 'Room',
      kind: 'living',
      polygon: level.outline,
      label: [4, 3],
      viewpoint: [4, 3],
    },
  ];
  return { engine, scene, level };
}

test('visit destinations respect the empty L corner and rotated furniture with visitor clearance', () => {
  const { engine, scene, level } = fixture();
  const layer = new FurnitureLayer(scene, level);
  const sofa = createFurniture({
    kind: 'sofa',
    width: 3,
    depth: 2.5,
    height: 1,
    position: [4, 3],
    sofa: { shape: 'chaise', side: 'left', seatDepth: 1, returnWidth: 1 },
  });
  for (const rotation of [0, Math.PI / 4]) {
    layer.setItems([{ ...sofa, rotation }]);
    const world = (x: number, z: number): [number, number] => [
      4 + x * Math.cos(rotation) + z * Math.sin(rotation),
      3 - x * Math.sin(rotation) + z * Math.cos(rotation),
    ];
    assert.equal(isSceneVisitDestination(scene, level, world(0.8, 0.8)), true);
    assert.equal(isSceneVisitDestination(scene, level, world(-1, 0.8)), false);
    assert.equal(
      isSceneVisitDestination(scene, level, world(-0.4, 0.8)),
      false,
      '17 cm body plus margin must remain clear of the return',
    );
  }
  const cabinet = createFurniture({
    kind: 'cabinet',
    width: 2,
    depth: 0.5,
    position: [4, 3],
    rotation: Math.PI / 4,
  });
  layer.setItems([cabinet]);
  assert.equal(isSceneVisitDestination(scene, level, [4.75, 3.75]), true);
  assert.equal(isSceneVisitDestination(scene, level, [4, 3]), false);
  layer.dispose();
  scene.dispose();
  engine.dispose();
});

test('the visible ceiling participates in solar occlusion and its enabled state controls coverage', () => {
  const { engine, scene, level } = fixture();
  const sun = new DirectionalLight('sun', new Vector3(0, -1, 0), scene);
  const shadows = new ShadowGenerator(128, sun);
  const mat = new StandardMaterial('test', scene);
  const materials = Object.fromEntries(
    ['plaster', 'wood', 'concrete', 'frame', 'glass', 'metal', 'slab', 'glow', 'selection'].map(
      (key) => [key, mat],
    ),
  ) as unknown as Materials;
  const house = buildHouse(level, scene, materials, shadows);
  const casters = shadows.getShadowMap()!.renderList!;
  assert.ok(casters.includes(house.ceiling));
  assert.equal(house.ceiling.isEnabled(), false);
  house.ceiling.setEnabled(true);
  house.ceiling.computeWorldMatrix(true);
  const ray = new Ray(new Vector3(4, 8, 3), new Vector3(0, -1, 0), 10);
  assert.ok(casters.some((mesh) => mesh.isEnabled() && ray.intersectsMesh(mesh).hit));
  scene.dispose();
  engine.dispose();
});

test('non-garage lowered rooms keep the exterior opening aligned with the interior', () => {
  const { engine, scene, level } = fixture();
  level.rooms[0].floorOffset = -0.12;
  level.walls = [
    {
      id: 'north',
      start: [0, 0],
      end: [8, 0],
      thickness: 0.3,
      exterior: true,
      openings: [{ id: 'door', kind: 'door', offset: 3, width: 1, height: 2.1 }],
    },
  ];
  const project = {
    ...demo,
    levels: [level],
    site: {
      boundary: [
        [-2, -2],
        [10, -2],
        [10, 8],
        [-2, 8],
      ] as [number, number][],
      elevation: -0.2,
      notes: [],
    },
  };
  const exterior = buildExterior(project, level, scene);
  exterior.facadeMeshes.forEach((mesh) => mesh.computeWorldMatrix(true));
  const throughDoor = new Ray(new Vector3(3.5, -0.06, -2), new Vector3(0, 0, 1), 4);
  const aboveDoor = new Ray(new Vector3(3.5, 2.02, -2), new Vector3(0, 0, 1), 4);
  assert.equal(
    exterior.facadeMeshes.some((mesh) => throughDoor.intersectsMesh(mesh).hit),
    false,
  );
  assert.equal(
    exterior.facadeMeshes.some((mesh) => aboveDoor.intersectsMesh(mesh).hit),
    true,
  );
  exterior.dispose();
  scene.dispose();
  engine.dispose();
});
