import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Observable } from '@babylonjs/core/Misc/observable';
import { WebXRSessionManager } from '@babylonjs/core/XR/webXRSessionManager';
import { WebXRCamera } from '@babylonjs/core/XR/webXRCamera';
import type { WebXRExperienceHelper } from '@babylonjs/core/XR/webXRExperienceHelper';
import '@babylonjs/core/Collisions/collisionCoordinator';
import type { HouseProject } from '../src/model/types';
import {
  applyDeadzone,
  floorCorrection,
  ImmersiveWalk,
  readControllerGamepad,
  snapTurn,
  snapTurnAngle,
  stickDisplacement,
  XR_WALK_SPEED,
} from '../src/scene/xrWalk';
import { createWalkCamera } from '../src/scene/walkCamera';
import { usePlanCoordinates, yawFromDirection } from '../src/scene/coordinates';

const project: HouseProject = JSON.parse(
  await readFile(new URL('../public/projects/maison-atelier.json', import.meta.url), 'utf8'),
);
const level = project.levels[0];

test('the stick dead zone ignores drift and still reaches full deflection', () => {
  assert.equal(applyDeadzone(0.15), 0);
  assert.equal(applyDeadzone(-0.2), 0);
  assert.equal(applyDeadzone(1), 1);
  assert.equal(applyDeadzone(-1), -1);
  assert.ok(Math.abs(applyDeadzone(0.6) - 0.5) < 1e-9);
  assert.equal(applyDeadzone(Number.NaN), 0);
});

test('a snap turn fires once per push and needs the stick back near the centre', () => {
  let armed = true;
  const turns: number[] = [];
  for (const axis of [0, 0.8, 0.9, 1, 0.5, 0.1, -0.9, -0.95, 0]) {
    const result = snapTurn(axis, armed);
    armed = result.armed;
    if (result.turn) turns.push(result.turn);
  }
  assert.deepEqual(turns, [1, -1]);
});

test('turning right moves the gaze towards +x in the right-handed plan frame', () => {
  const rotation = Quaternion.RotationAxis(Vector3.Up(), snapTurnAngle(1));
  const forward = new Vector3(0, 0, -1).applyRotationQuaternion(rotation);
  assert.ok(forward.x > 0.4, `x=${forward.x}`);
  assert.equal(snapTurnAngle(0), 0);
});

test('the left stick walks where the head looks, level, at a bounded speed', () => {
  // Head pitched down 45° and facing -z: the walk stays horizontal.
  const look = new Vector3(0, -1, -1).normalize();
  const ahead = stickDisplacement(look, 0, -1, XR_WALK_SPEED, 0.5);
  assert.ok(Math.abs(ahead.y) < 1e-9);
  assert.ok(Math.abs(ahead.x) < 1e-9);
  assert.ok(Math.abs(ahead.z + XR_WALK_SPEED * 0.5) < 1e-9);
  const right = stickDisplacement(new Vector3(0, 0, -1), 1, 0, 1, 1);
  assert.ok(Math.abs(right.x - 1) < 1e-9, `right=${right}`);
  // A full diagonal is not faster than straight ahead.
  const diagonal = stickDisplacement(new Vector3(0, 0, -1), 1, -1, 1, 1);
  assert.ok(Math.abs(diagonal.length() - 1) < 1e-9);
  assert.equal(stickDisplacement(new Vector3(0, 1, 0), 0, -1, 1, 1).length(), 0);
});

test('the floor correction puts the real floor on the ground under the visitor', () => {
  // Real head 1.70 m above the real floor, ground at 0.20 m: the head must be at 1.90 m.
  assert.ok(Math.abs(floorCorrection(1.7, 1.7, 0.2) - 0.2) < 1e-9);
  assert.equal(floorCorrection(1.9, 1.7, 0.2), 0);
});

test('controllers are read from the xr-standard gamepad, without a controller model', () => {
  const pressed = (value: boolean) => ({ pressed: value, touched: value, value: Number(value) });
  const gamepad = {
    axes: [0, 0, 0.6, -1],
    buttons: [
      pressed(true),
      pressed(false),
      pressed(false),
      pressed(false),
      pressed(false),
      pressed(true),
    ],
  } as unknown as Gamepad;
  const state = readControllerGamepad(gamepad);
  assert.ok(Math.abs(state.x - 0.5) < 1e-9);
  assert.equal(state.y, -1);
  assert.equal(state.trigger, true);
  assert.equal(state.secondary, true);
  assert.deepEqual(readControllerGamepad(null), { x: 0, y: 0, trigger: false, secondary: false });
});

test('leaving the headset keeps the gaze direction on the screen walk camera', () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  usePlanCoordinates(scene);
  const camera = createWalkCamera(scene, level);
  for (const yaw of [0, 0.7, -2.1, 3]) {
    camera.rotation.set(0, yaw, 0);
    camera.computeWorldMatrix();
    const direction = camera.getDirection(Vector3.Forward(true));
    const back = yawFromDirection(direction);
    assert.ok(Math.abs(Math.atan2(Math.sin(back - yaw), Math.cos(back - yaw))) < 1e-6);
  }
  scene.dispose();
  engine.dispose();
});

test('the headset camera collides with walls but not with a step', () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  usePlanCoordinates(scene);
  scene.collisionsEnabled = true;
  // Session plumbing the camera touches when its position is moved outside a pose.
  (globalThis as Record<string, unknown>).XRRigidTransform ??= class {};
  const manager = new WebXRSessionManager(scene);
  const offset = { getOffsetReferenceSpace: () => offset };
  Object.defineProperty(manager, 'referenceSpace', { get: () => offset, set: () => {} });
  const camera = new WebXRCamera('xr', scene, manager);
  const helper = {
    camera,
    sessionManager: { onXRSessionEnded: new Observable<unknown>() },
    dispose: () => {},
  } as unknown as WebXRExperienceHelper;
  const walk = new ImmersiveWalk(
    {
      scene,
      level,
      isDestination: () => true,
      toggleDoor: () => {},
      toggleEffects: () => {},
      onEnd: () => {},
    },
    helper,
  );
  const wall = MeshBuilder.CreateBox('wall', { width: 4, height: 2.5, depth: 0.2 }, scene);
  wall.position.set(0, 1.25, -2);
  wall.checkCollisions = true;
  const step = MeshBuilder.CreateBox('step', { width: 4, height: 0.18, depth: 0.5 }, scene);
  step.position.set(0, 0.09, 2);
  step.checkCollisions = true;
  // No frame is rendered here: place the colliders before the camera meets them.
  wall.computeWorldMatrix(true);
  step.computeWorldMatrix(true);
  scene.activeCamera = camera;
  const move = (dz: number) => {
    for (let i = 0; i < 80; i++) {
      camera.cameraDirection.set(0, 0, dz);
      camera.update();
      manager.onXRFrameObservable.notifyObservers({} as XRFrame);
    }
  };
  camera.position.set(0, 1.7, 0);
  move(-0.05);
  assert.ok(camera.position.z > -1.9 + 0.1, `stopped at z=${camera.position.z}`);
  assert.ok(camera.position.z < -1.5, `walked up to the wall, z=${camera.position.z}`);
  camera.position.set(0, 1.7, 0);
  move(0.05);
  assert.ok(camera.position.z > 2.5, `crossed the step, z=${camera.position.z}`);
  walk.dispose();
  scene.dispose();
  engine.dispose();
});
