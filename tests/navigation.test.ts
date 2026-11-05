import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import '@babylonjs/core/Collisions/collisionCoordinator';
import type { HouseProject } from '../src/model/types';
import {
  applyLookSensitivity,
  createWalkCamera,
  DEFAULT_WALK_SPEED,
  ELLIPSOID_HALF_HEIGHT,
  walkDisplacement,
} from '../src/scene/walkCamera';
import {
  applyEyeHeight,
  isVisitDestination,
  sectionPlane,
  wallFacesCamera,
} from '../src/scene/navigation';

const project: HouseProject = JSON.parse(
  await readFile(new URL('../public/projects/private-project.json', import.meta.url), 'utf8'),
);
const level = project.levels[0];

test('real camera travel matches metres per second at 30–240 Hz and stops immediately', () => {
  for (const fps of [30, 60, 144, 240]) {
    const engine = new NullEngine();
    engine.getDeltaTime = () => 1000 / fps;
    const scene = new Scene(engine);
    const camera = createWalkCamera(scene, level);
    camera.applyGravity = camera.checkCollisions = false;
    camera.needMoveForGravity = false;
    const start = camera.position.clone();
    for (let frame = 0; frame < fps; frame++) {
      camera.cameraDirection.copyFrom(walkDisplacement(camera, 1, 1, DEFAULT_WALK_SPEED, 1 / fps));
      camera.update();
    }
    assert.ok(
      Math.abs(Vector3.Distance(start, camera.position) - DEFAULT_WALK_SPEED) < 0.00001,
      `walking distance must stay in metres at ${fps} Hz`,
    );
    const stopped = camera.position.clone();
    camera.update();
    assert.ok(
      Vector3.Distance(stopped, camera.position) < 0.00001,
      'no residual movement on release',
    );
    const sprint = walkDisplacement(camera, 1, 0, DEFAULT_WALK_SPEED, 1, true);
    assert.ok(Math.abs(sprint.length() - DEFAULT_WALK_SPEED * 1.7) < 0.00001);
    scene.dispose();
    engine.dispose();
  }
});

test('mouse sensitivity is adjustable without changing the collision body or travel speed', () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const camera = createWalkCamera(scene, level);
  const before = camera.ellipsoid.clone();
  assert.equal(camera.angularSensibility, 900);
  assert.equal(applyLookSensitivity(camera, 2), 2);
  assert.equal(camera.angularSensibility, 450);
  assert.equal(applyLookSensitivity(camera, 0.1), 0.5);
  assert.equal(camera.angularSensibility, 1800);
  assert.equal(applyLookSensitivity(camera, NaN), 1);
  assert.ok(camera.ellipsoid.equals(before));
  scene.dispose();
  engine.dispose();
});

test('seated and standing viewpoints keep the collision body on the lowered garage floor', () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const camera = createWalkCamera(scene, level);
  const garage = level.rooms.find((room) => room.id === 'garage')!;
  camera.position.x = garage.viewpoint[0];
  camera.position.z = garage.viewpoint[1];
  const floor = level.elevation + (garage.floorOffset ?? 0);
  for (const height of [1.1, 1.65, 1.8]) {
    assert.equal(applyEyeHeight(camera, level, height), height);
    assert.equal(camera.metadata.eyeHeight, height);
    assert.ok(Math.abs(camera.position.y - height - floor) < 1e-9);
    const bodyBottom = camera.position.y - 2 * ELLIPSOID_HALF_HEIGHT + camera.ellipsoidOffset.y;
    assert.ok(Math.abs(bodyBottom - floor) < 1e-9);
  }
  assert.equal(applyEyeHeight(camera, level, Number.NaN), 1.65);
  assert.equal(applyEyeHeight(camera, level, -1), 0.85);
  scene.dispose();
  engine.dispose();
});

test('visit destinations reject outside points, walls, and non-finite coordinates', () => {
  assert.equal(isVisitDestination(level, level.spawn.position), true);
  assert.equal(isVisitDestination(level, [-100, -100]), false);
  assert.equal(isVisitDestination(level, [NaN, 1]), false);
  const wall = level.walls[0];
  assert.equal(
    isVisitDestination(level, [
      (wall.start[0] + wall.end[0]) / 2,
      (wall.start[1] + wall.end[1]) / 2,
    ]),
    false,
  );
});

test('section plane respects the level elevation and keeps the lower half-space', () => {
  const elevated = { ...level, elevation: 3 };
  const plane = sectionPlane(elevated, 1.2)!;
  assert.ok(plane.dotCoordinate(new Vector3(0, 4, 0)) < 0);
  assert.ok(plane.dotCoordinate(new Vector3(0, 4.4, 0)) > 0);
  assert.equal(sectionPlane(level, undefined), null);
  assert.equal(sectionPlane(level, NaN), null);
});

test('cutaway follows exterior direction independently of wall endpoint order', () => {
  const square = {
    ...level,
    outline: [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ] as [number, number][],
  };
  const wall = {
    id: 'north',
    start: [0, 0] as [number, number],
    end: [4, 0] as [number, number],
    thickness: 0.3,
    exterior: true,
  };
  assert.equal(wallFacesCamera(square, wall, [2, -5]), true);
  assert.equal(wallFacesCamera(square, wall, [2, 5]), false);
  assert.equal(
    wallFacesCamera(square, { ...wall, start: wall.end, end: wall.start }, [2, -5]),
    true,
  );
});

test('a seated visitor stays on the floor and cutaway-hidden walls still stop collisions', () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  scene.collisionsEnabled = true;
  scene.gravity = new Vector3(0, -0.1, 0);
  const camera = createWalkCamera(scene, level);
  const [x, z] = level.spawn.position;
  const floor = MeshBuilder.CreateBox('floor', { width: 10, depth: 10, height: 0.2 }, scene);
  floor.position.set(x, level.elevation - 0.1, z);
  floor.checkCollisions = true;
  const wall = MeshBuilder.CreateBox('wall', { width: 0.2, height: 3, depth: 4 }, scene);
  wall.position.set(x + 0.7, level.elevation + 1.5, z);
  wall.checkCollisions = true;
  wall.visibility = 0;
  scene.meshes.forEach((mesh) => mesh.computeWorldMatrix(true));
  applyEyeHeight(camera, level, 1.1);
  const collide = camera as unknown as { _collideWithWorld(direction: Vector3): void };
  for (let frame = 0; frame < 60; frame++) collide._collideWithWorld(new Vector3(0.03, 0, 0));
  assert.ok(Math.abs(camera.position.y - level.elevation - 1.1) < 0.03);
  assert.ok(camera.position.x < x + 0.45, 'hidden wall must keep its physical collision');
  scene.dispose();
  engine.dispose();
});
