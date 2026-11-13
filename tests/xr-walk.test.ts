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
  XR_RATE_FALLBACK_WINDOWS,
  XR_RATE_PROBE_WINDOWS,
  XR_RATE_WARMUP_WINDOWS,
  seatedLift,
  XR_WALK_SPEED,
  snapTurn,
  teleportArc,
  aimPhase,
  staleSources,
  XR_AIM_HOLD_MAX,
  readXrPreferences,
  XR_PREFERENCES,
  XR_ARC_SEGMENTS,
  XR_HUD_FLASH_SECONDS,
  XR_SNAP_DEGREES,
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
  BlinkFade,
  BLINK_IN_SECONDS,
  BLINK_OUT_SECONDS,
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
  // Button 4 is A or X, button 5 is B or Y.
  assert.equal(state.face, false);
  assert.equal(state.upper, true);
  assert.equal(
    readControllerGamepad({
      ...gamepad,
      buttons: [0, 1, 2, 3, 4].map((i) => pressed(i === 4)),
    } as unknown as Gamepad).face,
    true,
  );
  assert.deepEqual(readControllerGamepad(null), {
    x: 0,
    y: 0,
    trigger: false,
    face: false,
    upper: false,
  });
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

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

function headsetWalk(
  start: { point: [number, number]; yaw: number },
  storage: Pick<Storage, 'getItem' | 'setItem'> = memoryStorage(),
) {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  usePlanCoordinates(scene);
  scene.collisionsEnabled = true;
  const manager = new WebXRSessionManager(scene);
  const camera = new WebXRCamera('xr', scene, manager);
  const stairActions: { id: string; direction: 'up' | 'down' }[] = [];
  const doorActions: string[] = [];
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
      toggleDoor: (id) => {
        doorActions.push(id);
      },
      takeStair: (id, direction) => {
        stairActions.push({ id, direction });
        return true;
      },
      isReady: () => true,
      onEnd: () => {},
      storage,
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
    manager,
    stairActions,
    doorActions,
    dispose() {
      walk.dispose();
      scene.dispose();
      engine.dispose();
    },
  };
}

test('the controller trigger takes the aimed stair once per press and respects occluding walls', () => {
  const session = headsetWalk({ point: [4, 4.2], yaw: 0 });
  try {
    const internals = session.walk as unknown as { veil?: { dispose(): void } };
    internals.veil?.dispose();
    internals.veil = undefined;
    const trigger = { pressed: false, value: 0, touched: false };
    const source = {
      targetRayMode: 'tracked-pointer',
      handedness: 'right',
      targetRaySpace: {},
      gamepad: { axes: [0, 0, 0, 0], buttons: [trigger] },
    } as unknown as XRInputSource;
    session.manager.session = { inputSources: [source] } as unknown as XRSession;
    session.manager.currentFrame = {
      getPose: () => ({
        transform: { position: { x: 0, y: 1.2, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } },
      }),
    } as unknown as XRFrame;
    const stair = MeshBuilder.CreateBox(
      'stair-target',
      { width: 1, height: 1, depth: 0.2 },
      session.scene,
    );
    stair.position.set(4, 1.2, 2.2);
    stair.metadata = { kind: 'stair', id: 'flight', direction: 'up' };
    stair.computeWorldMatrix(true);
    const step = (pressed: boolean) => {
      trigger.pressed = pressed;
      session.walk.step(1 / 90);
    };
    step(true);
    step(true);
    assert.deepEqual(session.stairActions, [{ id: 'flight', direction: 'up' }]);
    step(false);
    stair.metadata.direction = 'down';
    step(true);
    assert.deepEqual(session.stairActions.at(-1), { id: 'flight', direction: 'down' });
    const wall = MeshBuilder.CreateBox(
      'occluder',
      { width: 1, height: 2, depth: 0.2 },
      session.scene,
    );
    wall.position.set(4, 1.2, 3.2);
    wall.computeWorldMatrix(true);
    step(false);
    step(true);
    assert.equal(
      session.stairActions.length,
      2,
      'a wall must block interaction with the stair behind it',
    );
    wall.dispose();
    stair.metadata = { kind: 'door', id: 'door' };
    step(false);
    step(true);
    assert.deepEqual(session.doorActions, ['door']);
    stair.metadata = { kind: 'stair', id: 'far', direction: 'up' };
    stair.position.z = -2;
    stair.computeWorldMatrix(true);
    step(false);
    step(true);
    assert.equal(
      session.stairActions.length,
      2,
      'stairs beyond controller reach must not activate',
    );
  } finally {
    session.dispose();
  }
});

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

test('A switches seated mode: the eyes go to the eye height, then back to the real height', () => {
  assert.ok(Math.abs(seatedLift(1.11, 1.65) - 0.54) < 1e-9);
  assert.ok(Math.abs(seatedLift(2.2, 1.65) + 0.55) < 1e-9, 'a misplaced floor is lowered back');
  assert.equal(seatedLift(4, 1.65), -1, 'within limits');
  assert.equal(seatedLift(0, 1.65), 1.2);
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
  const governor = new FrameRateGovernor(90, [60, 72, 80, 90, 120]);
  // The first 3 s after opening are loading hitches, not the machine.
  for (let i = 0; i < XR_RATE_WARMUP_WINDOWS; i++) assert.equal(governor.observe(20), undefined);
  assert.equal(governor.observe(88), undefined);
  for (let i = 0; i < XR_RATE_FALLBACK_WINDOWS - 1; i++)
    assert.equal(governor.observe(70), undefined);
  assert.equal(governor.observe(70), 80, '3 s of slow windows in a row');
  for (let i = 0; i < XR_RATE_WARMUP_WINDOWS; i++) governor.observe(20);
  assert.equal(governor.observe(79), undefined, 'holding 80 is fine');
  for (let i = 0; i < XR_RATE_FALLBACK_WINDOWS - 1; i++) governor.observe(60);
  assert.equal(governor.observe(60), 72);
  for (let i = 0; i < XR_RATE_WARMUP_WINDOWS; i++) governor.observe(20);
  for (let i = 0; i < 20; i++)
    assert.equal(governor.observe(40), undefined, 'never 60 Hz: it flickers on a Quest 2');
  assert.equal(governor.current, 72);
});

test('a session holding 90 Hz tries 120 Hz, and goes back for good if it cannot hold it', () => {
  const governor = new FrameRateGovernor(90, [72, 80, 90, 120]);
  for (let i = 0; i < XR_RATE_WARMUP_WINDOWS; i++) governor.observe(90);
  for (let i = 0; i < XR_RATE_PROBE_WINDOWS - 1; i++) assert.equal(governor.observe(90), undefined);
  assert.equal(governor.observe(90), 120, '5 s held at 90 Hz');
  for (let i = 0; i < XR_RATE_WARMUP_WINDOWS; i++) governor.observe(40);
  for (let i = 0; i < XR_RATE_FALLBACK_WINDOWS - 1; i++) governor.observe(100);
  assert.equal(governor.observe(100), 90, '120 Hz did not hold');
  for (let i = 0; i < 40; i++) assert.equal(governor.observe(90), undefined, 'no second probe');
  assert.equal(governor.current, 90);
});

test('a session holding 120 Hz stays there', () => {
  const governor = new FrameRateGovernor(90, [72, 80, 90, 120]);
  for (let i = 0; i < XR_RATE_WARMUP_WINDOWS + XR_RATE_PROBE_WINDOWS; i++) governor.observe(90);
  assert.equal(governor.current, 120);
  for (let i = 0; i < 60; i++) assert.equal(governor.observe(119.5), undefined);
});

test('a headset offering nothing at 72 Hz or above keeps its own rates', () => {
  assert.equal(pickFrameRate([60]), 60);
});

test('a released stick springing back through the middle still jumps', () => {
  assert.equal(aimPhase(-0.9, false), 'aim');
  assert.equal(aimPhase(-0.4, false), 'idle', 'a half push does not start an aim');
  // The spring-back, frame by frame at 120 fps: hold, hold, then release near the centre.
  const frames = [-0.9, -0.55, -0.35, -0.21, -0.05].map((y) => aimPhase(y, true));
  assert.deepEqual(frames, ['aim', 'hold', 'hold', 'hold', 'release']);
});

test('controllers the session no longer reports, after standby, are dropped', () => {
  const asleep = { handedness: 'right' };
  const awake = { handedness: 'right' };
  const left = { handedness: 'left' };
  assert.deepEqual(staleSources([asleep, left], [awake, left]), [asleep]);
  assert.deepEqual(staleSources([awake], [awake]), []);
});

test('the hold outlasts a spring-back but not a thumb resting on the stick', () => {
  // Three frames at 72 Hz cross the band; a resting thumb stays there for seconds.
  assert.ok(XR_AIM_HOLD_MAX > 3 / 72);
  assert.ok(XR_AIM_HOLD_MAX <= 0.5);
});

test('the teleport-only turn steps 30° once per push and re-arms near the centre', () => {
  const step = (XR_SNAP_DEGREES * Math.PI) / 180;
  let state = snapTurn(true, 0.5);
  assert.deepEqual(state, { angle: 0, armed: true }, 'a light push does not turn');
  state = snapTurn(true, 0.9);
  assert.ok(Math.abs(state.angle + step) < 1e-12, 'right is a negative yaw');
  assert.equal(state.armed, false);
  // Held over: no second step, frame after frame.
  for (let i = 0; i < 90; i++) {
    state = snapTurn(state.armed, 1);
    assert.equal(state.angle, 0);
  }
  state = snapTurn(state.armed, 0.5);
  assert.equal(state.armed, false, 'not re-armed half way back');
  state = snapTurn(state.armed, 0.1);
  assert.equal(state.armed, true);
  assert.ok(Math.abs(snapTurn(true, -0.8).angle - step) < 1e-12, 'left is positive');
});

test('the teleport arc starts at the hand, follows the aim and falls', () => {
  const origin = new Vector3(1, 1.2, 2);
  const level45 = new Vector3(0, 1, -1);
  const points = teleportArc(origin, level45);
  assert.equal(points.length, XR_ARC_SEGMENTS + 1);
  assert.ok(points[0].equals(origin));
  assert.ok(
    points.every((p) => Math.abs(p.x - 1) < 1e-9),
    'stays in the aimed vertical plane',
  );
  for (let i = 1; i < points.length; i++) assert.ok(points[i].z < points[i - 1].z, 'goes ahead');
  // Rises first, then comes down below the hand: a raised wrist reaches the far floor.
  assert.ok(points[3].y > origin.y);
  const landing = points.findIndex((p, i) => i > 0 && p.y < 0);
  assert.ok(landing > 0, 'reaches the floor');
  const reach = origin.z - points[landing].z;
  assert.ok(reach > 6 && reach < 10, `reach ${reach}`);
});

test('the teleport blink goes dark, moves the visitor unseen, and clears', () => {
  const blink = new BlinkFade();
  assert.equal(blink.active, false);
  let moved = 0;
  blink.start(() => moved++);
  const frame = 1 / 90;
  let alpha = 0;
  let frames = 0;
  while (moved === 0 && frames < 100) {
    alpha = blink.tick(frame);
    frames++;
    if (moved === 0) assert.ok(alpha < 1, 'moved only once fully dark');
  }
  assert.equal(alpha, 1);
  assert.ok(frames <= Math.ceil(BLINK_OUT_SECONDS / frame) + 1, `out in ${frames} frames`);
  frames = 0;
  while (blink.active && frames < 100) {
    alpha = blink.tick(frame);
    frames++;
  }
  assert.equal(alpha, 0);
  assert.equal(moved, 1);
  assert.ok(frames <= Math.ceil(BLINK_IN_SECONDS / frame) + 1, `in in ${frames} frames`);
});

test('the headset choices are read with defaults and survive a damaged value', () => {
  assert.deepEqual(readXrPreferences(undefined), { teleport: false, counter: true });
  assert.deepEqual(readXrPreferences(memoryStorage({ [XR_PREFERENCES]: '{not json' })), {
    teleport: false,
    counter: true,
  });
  assert.deepEqual(
    readXrPreferences(
      memoryStorage({ [XR_PREFERENCES]: JSON.stringify({ teleport: true, counter: 'x' }) }),
    ),
    { teleport: true, counter: true },
  );
});

test('X hides the counter and B or Y switches teleport-only, both remembered', () => {
  const storage = memoryStorage();
  const session = headsetWalk({ point: [4, 4.2], yaw: 0 }, storage);
  const walk = session.walk;
  assert.equal(walk.counterVisible, true, 'counter shown by default');
  assert.equal(walk.teleportOnly, false, 'smooth walk by default');
  walk.toggleCounter();
  assert.equal(walk.counterVisible, false);
  walk.toggleTeleportOnly();
  assert.equal(walk.teleportOnly, true);
  // A mode change shows the hidden counter a moment, so the new mode is read.
  assert.equal(walk.counterVisible, true);
  session.dispose();
  assert.deepEqual(JSON.parse(storage.values.get(XR_PREFERENCES)!), {
    teleport: true,
    counter: false,
  });

  const next = headsetWalk({ point: [4, 4.2], yaw: 0 }, storage);
  assert.equal(next.walk.teleportOnly, true, 'remembered for the next session');
  assert.equal(next.walk.counterVisible, false);
  next.dispose();
});

test('the headset counter sits in the lower right of the view and names teleport-only', () => {
  const session = headsetWalk({ point: [4, 4.2], yaw: 0 });
  const hud = session.scene.getMeshByName('xr-hud')!;
  assert.ok(hud.position.x > 0 && hud.position.y < 0 && hud.position.z < 0);
  session.dispose();
  assert.deepEqual(hudLines(72, 0, true, true).slice(1), ['téléportation · mode assis']);
  assert.ok(XR_HUD_FLASH_SECONDS > 1);
});
