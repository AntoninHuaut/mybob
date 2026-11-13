import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { WebXRSessionManager } from '@babylonjs/core/XR/webXRSessionManager';
import { WebXRCamera } from '@babylonjs/core/XR/webXRCamera';
import type { WebXRExperienceHelper } from '@babylonjs/core/XR/webXRExperienceHelper';
import '@babylonjs/core/Collisions/collisionCoordinator';
import type { HouseProject } from '../src/model/types';
import {
  applyDeadzone,
  ImmersiveWalk,
  readControllerGamepad,
  snapTurn,
  snapTurnAngle,
  stickDisplacement,
  turnAround,
  XR_POSE_JUMP,
  XR_WALK_SPEED,
} from '../src/scene/xrWalk';
import { createWalkCamera } from '../src/scene/walkCamera';
import { FrameCounter, hudLines, XR_HUD_WINDOW_MS } from '../src/scene/xrHud';
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
  assert.deepEqual(readControllerGamepad(null), { x: 0, y: 0, trigger: false });
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

function headsetWalk(start: { point: [number, number]; yaw: number }) {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  usePlanCoordinates(scene);
  scene.collisionsEnabled = true;
  const manager = new WebXRSessionManager(scene);
  const camera = new WebXRCamera('xr', scene, manager);
  const helper = {
    camera,
    sessionManager: manager,
    dispose: () => {},
  } as unknown as WebXRExperienceHelper;
  const walk = new ImmersiveWalk(
    {
      scene,
      level,
      start,
      isDestination: () => true,
      toggleDoor: () => {},
      onEnd: () => {},
    },
    helper,
  );
  walk.placeCamera();
  // The tracked pose: a standing head 1.70 m above the real floor, at the session origin.
  camera.position.set(0, 1.7, 0);
  return {
    walk,
    camera,
    scene,
    dispose() {
      walk.dispose();
      scene.dispose();
      engine.dispose();
    },
  };
}

test('the headset starts where the screen walk stood, looking the same way', () => {
  const yaw = 0.9;
  const session = headsetWalk({ point: [4, 4.2], yaw });
  const [x, z] = session.walk.position;
  assert.ok(Math.abs(x - 4) < 1e-5 && Math.abs(z - 4.2) < 1e-5, `head at ${x}, ${z}`);
  session.camera.computeWorldMatrix();
  const back = yawFromDirection(session.camera.getDirection(Vector3.Forward(true)));
  assert.ok(Math.abs(back - yaw) < 1e-5, `yaw ${back}`);
  // The session camera is never moved by the visit: the rig carries it.
  assert.equal(session.camera.parent, session.walk.rig);
  session.dispose();
});

test('a snap turn happens on the spot, even with the head off the rig centre', () => {
  const session = headsetWalk({ point: [4, 4.2], yaw: 0 });
  session.camera.position.set(0.4, 1.7, -0.3);
  const before = session.walk.position;
  session.walk.turn(snapTurnAngle(1));
  const after = session.walk.position;
  assert.ok(Math.hypot(after[0] - before[0], after[1] - before[1]) < 1e-5, `${before} → ${after}`);
  const pivot = turnAround(new Vector3(1, 0, 0), new Vector3(0, 5, 0), Math.PI / 2);
  assert.ok(Math.abs(pivot.x) < 1e-9 && Math.abs(pivot.z + 1) < 1e-9 && pivot.y === 0);
  session.dispose();
});

test('the headset visitor collides with walls but not with a step', () => {
  const session = headsetWalk({ point: [0, 0], yaw: 0 });
  const { scene, walk } = session;
  const wall = MeshBuilder.CreateBox('wall', { width: 4, height: 2.5, depth: 0.2 }, scene);
  wall.position.set(0, 1.25, -2);
  wall.checkCollisions = true;
  const step = MeshBuilder.CreateBox('step', { width: 4, height: 0.18, depth: 0.5 }, scene);
  step.position.set(0, 0.09, 2);
  step.checkCollisions = true;
  // No frame is rendered here: place the colliders before the visitor meets them.
  wall.computeWorldMatrix(true);
  step.computeWorldMatrix(true);
  for (let i = 0; i < 80; i++) walk.walk(new Vector3(0, 0, -0.05));
  let z = walk.position[1];
  assert.ok(z > -1.9 + 0.1, `stopped at z=${z}`);
  assert.ok(z < -1.5, `walked up to the wall, z=${z}`);
  walk.rig.position.set(0, 0, 0);
  for (let i = 0; i < 80; i++) walk.walk(new Vector3(0, 0, 0.05));
  z = walk.position[1];
  assert.ok(z > 2.5, `crossed the step, z=${z}`);
  session.dispose();
});

test('a headset moved by room-scale steps advances monotonically and stops at a wall', () => {
  // The emulator's ZQSD translates the tracked pose, not the rig: each frame reads it.
  const session = headsetWalk({ point: [0, 0], yaw: 0 });
  const { scene, walk, camera } = session;
  const wall = MeshBuilder.CreateBox('wall', { width: 4, height: 2.5, depth: 0.2 }, scene);
  wall.position.set(0, 1.25, -2);
  wall.checkCollisions = true;
  wall.computeWorldMatrix(true);
  walk.followPose();
  let previous = walk.position[1];
  for (let i = 0; i < 25; i++) {
    camera.position.z -= 0.3 / 4;
    walk.followPose();
    const z = walk.position[1];
    assert.ok(z <= previous + 1e-6, `frame ${i}: went back from z=${previous} to z=${z}`);
    previous = z;
  }
  // 1.9 m of pose travel was asked for: the head stops in front of the wall face (-1.9).
  assert.ok(previous > -1.9 + 0.1, `crossed the wall: z=${previous}`);
  assert.ok(previous < -1.5, `stopped too early: z=${previous}`);
  // Sideways along the wall, the head moves freely again.
  const x = walk.position[0];
  for (let i = 0; i < 10; i++) {
    camera.position.x += 0.05;
    walk.followPose();
  }
  assert.ok(Math.abs(walk.position[0] - x - 0.5) < 0.01, `slid ${walk.position[0] - x}`);
  session.dispose();
});

test('a tracking reset is not collided: the head jumps with the pose', () => {
  const session = headsetWalk({ point: [0, 0], yaw: 0 });
  const { scene, walk, camera } = session;
  const wall = MeshBuilder.CreateBox('wall', { width: 4, height: 2.5, depth: 0.2 }, scene);
  wall.position.set(0, 1.25, -1);
  wall.checkCollisions = true;
  wall.computeWorldMatrix(true);
  walk.followPose();
  camera.position.z -= XR_POSE_JUMP + 1.5;
  walk.followPose();
  assert.ok(walk.position[1] < -1.9, `z=${walk.position[1]}`);
  session.dispose();
});

test('the headset counter reads the frame rate once per window', () => {
  const counter = new FrameCounter();
  assert.equal(counter.tick(1000), undefined, 'the first frame only starts the window');
  let rate: number | undefined;
  let now = 1000;
  // 72 Hz: a frame every 13.9 ms.
  while (rate === undefined) {
    now += 1000 / 72;
    rate = counter.tick(now);
  }
  assert.ok(now - 1000 >= XR_HUD_WINDOW_MS && now - 1000 < XR_HUD_WINDOW_MS + 14);
  assert.ok(Math.abs(rate - 72) < 2, `rate ${rate}`);
  assert.equal(counter.tick(now + 1), undefined, 'a new window starts after each reading');
});

test('the headset counter names the terrain limit only once it was hit', () => {
  assert.deepEqual(hudLines(71.6, 0), ['72 fps']);
  assert.deepEqual(hudLines(30, 3), ['30 fps', 'limite du terrain ×3']);
});
