import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import '@babylonjs/core/Collisions/collisionCoordinator';
import type { HouseProject, ProjectSite } from '../src/model/types';
import { HouseViewer } from '../src/scene/viewer';
import {
  applyLookSensitivity,
  createWalkCamera,
  DEFAULT_WALK_SPEED,
  ELLIPSOID_HALF_HEIGHT,
  walkDisplacement,
} from '../src/scene/walkCamera';
import {
  applyEyeHeight,
  isParcelDestination,
  isVisitArea,
  isVisitDestination,
  sectionPlane,
  visitorGroundElevation,
  wallFacesCamera,
} from '../src/scene/navigation';

const project: HouseProject = JSON.parse(
  await readFile(new URL('../public/projects/maison-atelier.json', import.meta.url), 'utf8'),
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

test('the visit walks out onto the parcel but never past it', () => {
  const site = project.site!;
  const lawn: [number, number] = [3, -1.5];
  assert.equal(isVisitArea(level, site, lawn), true);
  assert.equal(isVisitArea(level, site, [-100, -100]), false);
  assert.equal(isVisitArea(level, undefined, lawn), false, 'no site keeps the outline');
  assert.equal(isVisitArea(level, undefined, level.spawn.position), true);
  assert.equal(isParcelDestination(level, site, lawn), true);
  assert.equal(
    isParcelDestination(level, site, level.spawn.position),
    false,
    'inside the house is not a parcel destination',
  );
  assert.equal(isParcelDestination(level, site, [-100, -100]), false);
  assert.equal(isParcelDestination(level, undefined, lawn), false);
  assert.equal(isParcelDestination(level, site, [NaN, 1]), false);
  // Just outside the south facade: the visitor's radius still overlaps the wall.
  assert.equal(isParcelDestination(level, site, [3, -0.15]), false);
});

test('the visitor stands on the room floor inside and on the parcel ground outside', () => {
  const site = project.site!;
  const garage = level.rooms.find((room) => room.id === 'garage')!;
  assert.equal(visitorGroundElevation(level, site, garage.viewpoint), level.elevation - 0.12);
  assert.equal(visitorGroundElevation(level, site, [3, -1.5]), level.elevation);
  const lowered: ProjectSite = { ...site, elevation: -0.4 };
  assert.equal(visitorGroundElevation(level, lowered, [3, -1.5]), level.elevation - 0.4);
  assert.equal(
    visitorGroundElevation(level, lowered, garage.viewpoint),
    level.elevation - 0.12,
    'a lowered parcel never moves the floor of a room',
  );
  assert.equal(visitorGroundElevation(level, undefined, [3, -1.5]), level.elevation);
});

test('changing the eye height outside keeps the collision body on the lawn', () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const camera = createWalkCamera(scene, level);
  camera.position.set(3, 1.65, -1.5);
  const ground = visitorGroundElevation(level, project.site, [3, -1.5]);
  for (const height of [1.1, 1.65, 1.8]) {
    assert.equal(applyEyeHeight(camera, level, height, ground), height);
    assert.ok(Math.abs(camera.position.y - ground - height) < 1e-9);
    const bodyBottom = camera.position.y - 2 * ELLIPSOID_HALF_HEIGHT + camera.ellipsoidOffset.y;
    assert.ok(Math.abs(bodyBottom - ground) < 1e-9);
  }
  scene.dispose();
  engine.dispose();
});

test('the visit guard keeps the visitor on the parcel and resets only outside it', () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const walk = createWalkCamera(scene, level);
  scene.activeCamera = walk;
  let resets = 0;
  const viewer = Object.assign(Object.create(HouseViewer.prototype), {
    scene,
    engine,
    level,
    walk,
    canvas: { clientWidth: 800, clientHeight: 600 },
    site: project.site,
    mode: 'walk',
    paused: true,
    capturing: false,
    keyState: new Set<string>(),
    house: { doors: [] },
    updateCutaway() {},
    reset() {
      resets++;
    },
    onFrame() {},
  }) as HouseViewer;
  const frame = () => (viewer as unknown as { beforeFrame(): void }).beforeFrame();
  const place = (x: number, z: number) => walk.position.set(x, 1.65, z);
  const previousDocument = globalThis.document;
  globalThis.document = { activeElement: null, pointerLockElement: null } as unknown as Document;
  try {
    place(3, -1.5); // lawn, south of the house
    frame();
    assert.equal(resets, 0, 'the parcel is walkable');
    place(3, 4.6); // inside the house
    frame();
    assert.equal(resets, 0);
    place(-100, -100); // beyond the parcel
    frame();
    assert.equal(resets, 1);
    place(3, -1.5);
    walk.position.y = 0.2; // under the ground
    frame();
    assert.equal(resets, 2);
  } finally {
    globalThis.document = previousDocument;
    scene.dispose();
    engine.dispose();
  }
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
