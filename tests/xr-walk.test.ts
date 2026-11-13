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
  smoothTurnAngle,
  stickDisplacement,
  turnAround,
  turnAxis,
  XR_TURN_DEGREES_PER_SECOND,
  XR_POSE_JUMP,
  FrameRateGovernor,
  pickFrameRate,
  seatedLift,
  XR_WALK_SPEED,
} from '../src/scene/xrWalk';
import { createWalkCamera } from '../src/scene/walkCamera';
import {
  FrameCounter,
  hudLines,
  LoadingGate,
  XR_DEFAULT_LAYERS,
  XR_HUD_WINDOW_MS,
  XR_LOADING_STEADY_FRAMES,
  XR_LOADING_TIMEOUT_MS,
  XR_VEIL_LAYER,
  XR_VEIL_ONLY_FRAMES,
  approachStrength,
  VIGNETTE_CLEAR_DEGREES,
  VIGNETTE_DARK_DEGREES,
  VIGNETTE_FADE_SECONDS,
  vignetteAlpha,
  vignetteTextureData,
} from '../src/scene/xrHud';
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

test('the smooth turn follows the stick deflection and frame time', () => {
  const second = smoothTurnAngle(1, 1);
  assert.ok(Math.abs(Math.abs(second) - (XR_TURN_DEGREES_PER_SECOND * Math.PI) / 180) < 1e-9);
  assert.ok(Math.abs(smoothTurnAngle(0.5, 0.1) - second * 0.05) < 1e-12);
  assert.equal(smoothTurnAngle(0, 1), 0);
  // Ninety frames at 90 Hz add up to the one-second turn: no snap, no lost frame.
  let total = 0;
  for (let i = 0; i < 90; i++) total += smoothTurnAngle(1, 1 / 90);
  assert.ok(Math.abs(total - second) < 1e-9);
});

test('the right stick turns sideways but never while it is pushed to aim', () => {
  assert.equal(turnAxis(0.8, 0.1), 0.8);
  assert.equal(turnAxis(-0.6, 0.2), -0.6);
  assert.equal(turnAxis(0.5, -0.7), 0);
  assert.equal(turnAxis(0, -1), 0);
});

test('turning right moves the gaze towards +x in the right-handed plan frame', () => {
  const rotation = Quaternion.RotationAxis(Vector3.Up(), smoothTurnAngle(1, 0.5));
  const forward = new Vector3(0, 0, -1).applyRotationQuaternion(rotation);
  assert.ok(forward.x > 0.4, `x=${forward.x}`);
});

test('the comfort vignette is clear in the centre, dark at the edges, and fades', () => {
  assert.equal(vignetteAlpha(0), 0);
  assert.equal(vignetteAlpha(VIGNETTE_CLEAR_DEGREES), 0);
  assert.equal(vignetteAlpha(VIGNETTE_DARK_DEGREES), 1);
  assert.equal(vignetteAlpha(80), 1);
  const middle = vignetteAlpha((VIGNETTE_CLEAR_DEGREES + VIGNETTE_DARK_DEGREES) / 2);
  assert.ok(Math.abs(middle - 0.5) < 1e-9);
  const size = 64;
  const data = vignetteTextureData(size);
  const alphaAt = (row: number, column: number) => data[(row * size + column) * 4 + 3];
  assert.equal(alphaAt(size / 2, size / 2), 0, 'clear centre');
  assert.equal(alphaAt(0, 0), 255, 'dark corner');
  assert.equal(alphaAt(size / 2, 0), 255, 'dark side');
  // Starting the stick closes the vignette over the fade time, not in one frame.
  let strength = 0;
  strength = approachStrength(strength, 1, 1 / 90);
  assert.ok(strength > 0 && strength < 0.1, `first frame ${strength}`);
  for (let t = 0; t < VIGNETTE_FADE_SECONDS; t += 1 / 90)
    strength = approachStrength(strength, 1, 1 / 90);
  assert.equal(strength, 1);
  assert.equal(approachStrength(0.5, 0.4, 1), 0.4);
  assert.equal(approachStrength(0, 3, 1), 1);
});

test('the headset session darkens the view edges while the visitor turns, then clears', () => {
  const session = headsetWalk({ point: [4, 4.2], yaw: 0 });
  const vignette = (
    session.walk as unknown as { vignette: { opacity: number; update(m: number, s: number): void } }
  ).vignette;
  assert.equal(vignette.opacity, 0);
  for (let i = 0; i < 30; i++) vignette.update(1, 1 / 90);
  assert.ok(vignette.opacity > 0.8, `opacity ${vignette.opacity}`);
  for (let i = 0; i < 30; i++) vignette.update(0, 1 / 90);
  assert.equal(vignette.opacity, 0);
  session.dispose();
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
  // Button 4 is A or X; button 5 (B or Y) is not read.
  assert.equal(state.face, false);
  assert.equal(
    readControllerGamepad({
      ...gamepad,
      buttons: [0, 1, 2, 3, 4].map((i) => pressed(i === 4)),
    } as unknown as Gamepad).face,
    true,
  );
  assert.deepEqual(readControllerGamepad(null), { x: 0, y: 0, trigger: false, face: false });
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
      eyeHeight: 1.65,
      isDestination: () => true,
      toggleDoor: () => {},
      takeStair: () => false,
      isReady: () => true,
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

test('a turn happens on the spot, even with the head off the rig centre', () => {
  const session = headsetWalk({ point: [4, 4.2], yaw: 0 });
  session.camera.position.set(0.4, 1.7, -0.3);
  const before = session.walk.position;
  session.walk.turn(smoothTurnAngle(1, 0.4));
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

test('the headset veil is shown alone, then hides the house until it is steadily ready', () => {
  const gate = new LoadingGate();
  let asked = 0;
  let ready = false;
  const isReady = () => {
    asked++;
    return ready;
  };
  for (let frame = 0; frame < XR_VEIL_ONLY_FRAMES; frame++)
    assert.equal(gate.tick(frame * 14, isReady), 'veil');
  assert.equal(asked, 0, 'readiness is not asked while the veil is drawn alone');
  let now = 100;
  for (let frame = 0; frame < 5; frame++)
    assert.equal(gate.tick((now += 14), isReady), 'compiling');
  ready = true;
  for (let frame = 1; frame < XR_LOADING_STEADY_FRAMES; frame++)
    assert.equal(gate.tick((now += 14), isReady), 'compiling');
  assert.equal(gate.tick((now += 14), isReady), 'done');
  assert.equal(gate.tick((now += 14), isReady), 'done');
});

test('the headset veil lifts after its time limit even if a shader never links', () => {
  const gate = new LoadingGate();
  assert.equal(
    gate.tick(0, () => false),
    'veil',
  );
  assert.equal(
    gate.tick(10, () => false),
    'veil',
  );
  assert.equal(
    gate.tick(XR_LOADING_TIMEOUT_MS - 1, () => false),
    'compiling',
  );
  assert.equal(
    gate.tick(XR_LOADING_TIMEOUT_MS, () => false),
    'done',
  );
});

test('the headset session starts with the veil alone in its camera layers', () => {
  const session = headsetWalk({ point: [0, 0], yaw: 0 });
  assert.equal(session.camera.layerMask, XR_VEIL_LAYER);
  const veil = session.scene.meshes.filter((mesh) => mesh.name.startsWith('xr-veil'));
  assert.equal(veil.length, 2);
  assert.ok(veil.every((mesh) => mesh.layerMask === XR_VEIL_LAYER && mesh.renderingGroupId === 3));
  session.walk.dispose();
  assert.equal(session.camera.layerMask, XR_DEFAULT_LAYERS);
  assert.ok(session.scene.meshes.every((mesh) => !mesh.name.startsWith('xr-veil')));
  session.dispose();
});

test('A or X switches seated mode: the eyes go to the eye height, then back to the real height', () => {
  assert.ok(Math.abs(seatedLift(1.11, 1.65) - 0.54) < 1e-9);
  assert.equal(seatedLift(1.8, 1.65), 0, 'never lowered');
  assert.equal(seatedLift(Number.NaN, 1.65), 0);
  const session = headsetWalk({ point: [4, 4.2], yaw: 0 });
  session.camera.position.y = 1.11;
  const walk = session.walk;
  const floor = walk.rig.position.y;
  assert.equal(walk.seatedOffset, 0, 'standing by default, nothing guessed');
  walk.toggleSeated();
  assert.ok(Math.abs(walk.seatedOffset - 0.54) < 1e-9, `offset ${walk.seatedOffset}`);
  assert.ok(Math.abs(walk.head().y - floor - 1.65) < 1e-6, 'eyes at the walk eye height');
  walk.toggleSeated();
  assert.equal(walk.seatedOffset, 0);
  assert.ok(Math.abs(walk.head().y - floor - 1.11) < 1e-6, 'real height back');
  session.dispose();
});

test('the headset counter names the seated mode', () => {
  assert.deepEqual(hudLines(72, 0, true).slice(1), ['mode assis']);
  assert.deepEqual(hudLines(72, 2, true).slice(1), ['mode assis · limite du terrain ×2']);
});

test('the headset asks for the highest rate up to 90 Hz and steps down when it cannot hold it', () => {
  assert.equal(pickFrameRate([72, 80, 90, 120]), 90);
  assert.equal(pickFrameRate([60, 72]), 72);
  assert.equal(pickFrameRate(undefined), undefined);
  const governor = new FrameRateGovernor(90, [72, 80, 90, 120]);
  assert.equal(governor.observe(88), undefined);
  assert.equal(governor.observe(70), undefined);
  assert.equal(governor.observe(70), undefined);
  assert.equal(governor.observe(70), 80, 'three slow windows in a row');
  assert.equal(governor.observe(79), undefined, 'holding 80 is fine');
  for (let i = 0; i < 2; i++) governor.observe(60);
  assert.equal(governor.observe(60), 72);
  for (let i = 0; i < 5; i++) assert.equal(governor.observe(40), undefined, 'nothing lower');
});
