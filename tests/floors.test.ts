import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Ray } from '@babylonjs/core/Culling/ray';
import '@babylonjs/core/Collisions/collisionCoordinator';
import { buildHouse, polygonMesh, poseDoor, THRESHOLD_SINK } from '../src/scene/buildHouse';
import type { Materials } from '../src/scene/materials';
import type { HouseProject, Level } from '../src/model/types';
import { polygonArea } from '../src/model/geometry';
import { createWalkCamera, EYE_HEIGHT, prepareWalkStep } from '../src/scene/walkCamera';

const project: HouseProject = JSON.parse(
  await readFile(new URL('../public/projects/maison-atelier.json', import.meta.url), 'utf8'),
);
const near = (actual: number, expected: number, tolerance = 0.001) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≠ ${expected}`);

function garageScene(elevation = 0, floorOffset = -0.12) {
  const level = structuredClone(project.levels[0]);
  level.elevation = elevation;
  level.rooms.find((room) => room.id === 'garage')!.floorOffset = floorOffset;
  const engine = new NullEngine(),
    scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  scene.collisionsEnabled = true;
  scene.gravity = new Vector3(0, -0.25, 0);
  const material = new StandardMaterial('test', scene);
  const materials = {
    plaster: material,
    wood: material,
    concrete: material,
    frame: material,
    glass: material,
    metal: material,
    slab: material,
    glow: material,
    selection: material,
  } as unknown as Materials;
  const house = buildHouse(level, scene, materials);
  scene.meshes.forEach((mesh) => mesh.computeWorldMatrix(true));
  return { engine, scene, level, house };
}

test('triangulated floor holes remove exactly their area', () => {
  const engine = new NullEngine(),
    scene = new Scene(engine);
  const outer: [number, number][] = [
    [0, 0],
    [8, 0],
    [8, 6],
    [0, 6],
  ];
  const hole: [number, number][] = [
    [1, 1],
    [3, 1],
    [3, 3],
    [1, 3],
  ];
  const mesh = polygonMesh('floor-with-hole', outer, 0, scene, [hole]);
  const indices = mesh.getIndices()!,
    positions = mesh.getVerticesData('position')!;
  let area = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = [indices[i] * 3, indices[i + 1] * 3, indices[i + 2] * 3];
    area +=
      Math.abs(
        (positions[b] - positions[a]) * (positions[c + 2] - positions[a + 2]) -
          (positions[c] - positions[a]) * (positions[b + 2] - positions[a + 2]),
      ) / 2;
  }
  near(area, polygonArea(outer) - polygonArea(hole));
  scene.dispose();
  engine.dispose();
});

test('garage floor is 12 cm lower, with no hidden zero-level floor or collision above it', () => {
  for (const elevation of [0, 2.8]) {
    const { engine, scene, level, house } = garageScene(elevation);
    const ray = new Ray(new Vector3(3, elevation + 1, 1.5), new Vector3(0, -1, 0), 2);
    const mainFloor = scene.getMeshByName('finished-floor')!;
    assert.equal(
      ray.intersectsMesh(mainFloor, false).hit,
      false,
      'a zero-level floor must not remain above the lowered garage',
    );
    const hits = ray.intersectsMeshes(
      scene.meshes.filter((mesh) => mesh.metadata?.kind === 'floor'),
    );
    assert.equal(hits.length, 1);
    near(hits[0].pickedPoint!.y, elevation - 0.12);
    near(level.elevation + level.ceilingHeight - hits[0].pickedPoint!.y, 2.62);
    assert.equal(hits[0].pickedMesh!.checkCollisions, true);
    near(
      house.highlights.get('garage')!.getBoundingInfo().boundingBox.minimumWorld.y,
      elevation - 0.12 + 0.017,
    );
    scene.dispose();
    engine.dispose();
  }
});

test('garage walls reach the lower floor and service-door datum remains the higher house floor', () => {
  const { engine, scene, house } = garageScene();
  const north = scene.getMeshByName('wall:garage-nord:0')!.getBoundingInfo().boundingBox;
  near(north.minimumWorld.y, -0.12);
  near(north.maximumWorld.y, 2.5);
  const garageDoor = house.doors.find((door) => door.id === 'porte-garage')!;
  const serviceDoor = house.doors.find((door) => door.id === 'porte-service')!;
  near(garageDoor.baseElevation, -0.12);
  near(serviceDoor.baseElevation, 0);
  garageDoor.progress = 0;
  poseDoor(garageDoor);
  near(garageDoor.pivot.position.y, -0.12);
  // Closed: stacked vertical panels centered in the door plane.
  const count = garageDoor.leaves.length;
  assert.ok(count >= 4, 'a sectional curtain needs several panels');
  for (const [j, panel] of garageDoor.leaves.entries()) {
    near(panel.position.y, ((j + 0.5) * garageDoor.opening.height) / count);
    near(panel.position.z, 0);
    near(panel.rotation.x, 0);
  }
  garageDoor.progress = 1;
  poseDoor(garageDoor);
  // Open: the curtain rolled under the lintel and lies flat inside the garage.
  for (const panel of garageDoor.leaves) {
    near(panel.rotation.x, (garageDoor.fold * Math.PI) / 2, 0.01);
    assert.ok(panel.position.z * garageDoor.fold > 0, 'each panel must fold into the garage');
  }
  garageDoor.leaves.forEach((mesh) => mesh.computeWorldMatrix(true));
  for (const panel of garageDoor.leaves) {
    const box = panel.getBoundingInfo().boundingBox;
    assert.ok(
      box.maximumWorld.y <= garageDoor.baseElevation + garageDoor.opening.height + 0.02,
      'the rolled curtain stays under the lintel',
    );
  }
  const threshold = scene.getMeshByName('threshold:porte-service')!;
  assert.equal(threshold.checkCollisions, true);
  near(threshold.getBoundingInfo().boundingBox.minimumWorld.y, -0.12);
  // Just under the upper floor, which runs under the wall: no fight between the two tops.
  near(threshold.getBoundingInfo().boundingBox.maximumWorld.y, -THRESHOLD_SINK);
  scene.dispose();
  engine.dispose();
});

test('a floor lowered farther than the nominal slab thickness remains visible above the slab base', () => {
  const { engine, scene } = garageScene(0, -0.4);
  const ray = new Ray(new Vector3(3, 1, 1.5), new Vector3(0, -1, 0), 2);
  const hits = ray.intersectsMeshes(
    scene.meshes.filter((mesh) => mesh.isEnabled() && mesh.isPickable),
  );
  assert.equal(hits[0].pickedMesh!.name, 'floor:garage');
  near(hits[0].pickedPoint!.y, -0.4);
  const bottom = scene.getMeshByName('slab-bottom')!.getBoundingInfo().boundingBox;
  near(bottom.minimumWorld.y, -0.57);
  const edge = scene.getMeshByName('slab-edge-0')!.getBoundingInfo().boundingBox;
  near(edge.minimumWorld.y, -0.57);
  near(edge.maximumWorld.y, 0);
  scene.dispose();
  engine.dispose();
});

test('the actual visitor crosses the 12 cm service threshold at different frame rates', () => {
  const { engine, scene, level } = garageScene();
  for (const step of [0.008, 0.0175, 0.035, 0.07]) {
    scene.gravity.y = (-15 * step) / 2.1;
    for (const direction of [1, -1]) {
      const camera = createWalkCamera(scene, level);
      camera.position.set(
        5.545,
        EYE_HEIGHT + (direction === 1 ? -0.12 : 0),
        direction === 1 ? 2.2 : 3.8,
      );
      const collider = camera as unknown as { _collideWithWorld: (displacement: Vector3) => void };
      for (let i = 0; i < Math.ceil(1.4 / step); i++) {
        const movement = new Vector3(0, 0, direction * step);
        prepareWalkStep(camera, level, movement);
        collider._collideWithWorld(movement);
      }
      assert.ok(
        direction === 1 ? camera.position.z > 3.4 : camera.position.z < 2.6,
        `threshold crossing failed with ${step}m steps (${direction}): z=${camera.position.z}`,
      );
      near(camera.position.y, EYE_HEIGHT + (direction === 1 ? 0 : -0.12), 0.025);
      camera.dispose();
    }
  }
  scene.dispose();
  engine.dispose();
});

test('threshold assistance preserves closed-door collisions and restores gravity when movement stops', () => {
  const { engine, scene, level, house } = garageScene();
  const service = house.doors.find((door) => door.id === 'porte-service')!;
  service.progress = 0;
  poseDoor(service);
  scene.meshes.forEach((mesh) => mesh.computeWorldMatrix(true));
  const camera = createWalkCamera(scene, level);
  camera.position.set(5.545, EYE_HEIGHT - 0.12, 2.8);
  scene.gravity.y = (-15 * 0.008) / 2.1;
  const collider = camera as unknown as { _collideWithWorld: (displacement: Vector3) => void };
  for (let i = 0; i < 100; i++) {
    const movement = new Vector3(0, 0, 0.008);
    prepareWalkStep(camera, level, movement);
    collider._collideWithWorld(movement);
  }
  assert.ok(camera.position.z < 3.0, 'assistance must not lift through a closed service door');
  assert.equal(camera.applyGravity, true);
  service.progress = 1;
  poseDoor(service);
  scene.meshes.forEach((mesh) => mesh.computeWorldMatrix(true));
  camera.position.set(5.545, EYE_HEIGHT - 0.12, 2.9);
  prepareWalkStep(camera, level, new Vector3(0, 0, 0.008));
  assert.equal(camera.applyGravity, false);
  prepareWalkStep(camera, level, Vector3.Zero());
  assert.equal(camera.applyGravity, true);
  scene.dispose();
  engine.dispose();
});

test('a merged frozen doorway passes the 34 cm visitor while its adjacent solid wall blocks', () => {
  const { engine, scene, level, house } = garageScene();
  try {
    const wall = scene.meshes.find((mesh) => mesh.name.startsWith('wall:garage-nord:'))!;
    assert.ok(wall.checkCollisions && wall.isWorldMatrixFrozen);
    assert.ok(
      wall.getBoundingInfo().boundingBox.intersectsPoint(new Vector3(5.545, 1.3, 3.05)),
      'the merged broad-phase box spans the empty doorway',
    );
    const service = house.doors.find((door) => door.id === 'porte-service')!;
    service.progress = 1;
    poseDoor(service);
    const step = 0.0175;
    scene.gravity.y = (-15 * step) / 2.1;
    for (const x of [5.545, 4]) {
      const camera = createWalkCamera(scene, level);
      try {
        assert.equal(camera.ellipsoid.x, 0.17);
        assert.equal(camera.ellipsoid.z, 0.17);
        camera.position.set(x, EYE_HEIGHT - 0.12, 2.2);
        const collider = camera as unknown as { _collideWithWorld(displacement: Vector3): void };
        for (let i = 0; i < 80; i++) {
          const movement = new Vector3(0, 0, step);
          prepareWalkStep(camera, level, movement);
          collider._collideWithWorld(movement);
        }
        if (x === 5.545)
          assert.ok(camera.position.z > 3.4, 'actual collision triangles leave the doorway open');
        else
          assert.ok(camera.position.z < 2.9, 'adjacent solid wall still blocks the same visitor');
      } finally {
        camera.dispose();
      }
    }
  } finally {
    scene.dispose();
    engine.dispose();
  }
});

test('the visitor climbs the parcel step back into the house', () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  const square: [number, number][] = [
    [0, 0],
    [4, 0],
    [4, 4],
    [0, 4],
  ];
  const level: Level = {
    id: 'rdc',
    name: 'RDC',
    elevation: 0,
    ceilingHeight: 2.5,
    outline: square,
    walls: [],
    rooms: [
      {
        id: 'piece',
        name: 'Pièce',
        kind: 'living',
        polygon: square,
        label: [2, 2],
        viewpoint: [2, 2],
      },
    ],
    lights: [],
    spawn: { position: [2, 2], yaw: 0 },
  };
  // The terrain sits 20 cm under the finished floor, as the owner's site plan states.
  const site = {
    boundary: [
      [-5, -5],
      [9, -5],
      [9, 9],
      [-5, 9],
    ] as [number, number][],
    elevation: -0.2,
    notes: [],
  };
  const camera = createWalkCamera(scene, level);
  const step = new Vector3(0, 0, 0.05);
  camera.position.set(2, site.elevation + EYE_HEIGHT, -0.3);
  prepareWalkStep(camera, level, step, site);
  near(camera.position.y, EYE_HEIGHT + 0.008);
  assert.equal(camera.applyGravity, false, 'the step up is assisted, not left to collisions');
  // Without a site the terrain is the level datum: there is no step to climb.
  camera.position.set(2, site.elevation + EYE_HEIGHT, -0.3);
  prepareWalkStep(camera, level, step);
  near(camera.position.y, site.elevation + EYE_HEIGHT);
  assert.equal(camera.applyGravity, true);
  scene.dispose();
  engine.dispose();
});
