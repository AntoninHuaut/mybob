import assert from 'node:assert/strict';
import test from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import type { ArcRotateCameraPointersInput } from '@babylonjs/core/Cameras/Inputs/arcRotateCameraPointersInput';
import type { IPointerEvent } from '@babylonjs/core/Events/deviceInputEvents';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { HouseViewer, configureOrbitInteractions } from '../src/scene/viewer';

function cameraScene(fps = 60) {
  const engine = new NullEngine();
  engine.getDeltaTime = () => 1000 / fps;
  const scene = new Scene(engine);
  const camera = new ArcRotateCamera('overview', 2, 0.66, 30, Vector3.Zero(), scene);
  camera.inertia = 0.7;
  configureOrbitInteractions(camera);
  camera.getViewMatrix(true);
  return { engine, camera };
}

function drag(camera: ArcRotateCamera, button: number, pixels: number, fps: number) {
  const input = camera.inputs.attached.pointers as ArcRotateCameraPointersInput;
  const event = { button, ctrlKey: false, altKey: false, shiftKey: false } as IPointerEvent;
  input.onButtonDown(event);
  input.onTouch(null, pixels, 0);
  input.onButtonUp(event);
  for (let i = 0; i < fps * 2; i++) {
    camera._checkInputs();
    camera.getViewMatrix(true);
  }
}

test('right drag pans a comfortable world distance at different frame rates', () => {
  for (const fps of [30, 60, 120]) {
    const { engine, camera } = cameraScene(fps);
    const initial = camera.target.clone();
    const alpha = camera.alpha;
    drag(camera, 2, 100, fps);
    const distance = Vector3.Distance(initial, camera.target);
    assert.ok(distance > 0.8 && distance < 1.2, `${fps} fps: 100px pan moved ${distance}m`);
    assert.equal(camera.alpha, alpha, 'right drag must not orbit');
    engine.dispose();
  }
});

test('left drag rotates without moving the target', () => {
  const { engine, camera } = cameraScene();
  const initial = camera.target.clone();
  const alpha = camera.alpha;
  drag(camera, 0, 100, 60);
  assert.ok(Math.abs(camera.alpha - alpha) > 0.2);
  assert.ok(Vector3.Distance(initial, camera.target) < 1e-8);
  engine.dispose();
});

test('an empty-floor gesture restores detached orbit input but furniture and visits retain control', () => {
  const { engine, camera } = cameraScene();
  const canvas = {
    focus: () => {},
    getBoundingClientRect: () => ({ left: 10, top: 20 }),
  } as HTMLCanvasElement;
  let kind = 'floor',
    attachments = 0;
  const picks: number[][] = [];
  const viewer = Object.assign(Object.create(HouseViewer.prototype), {
    scene: {
      pick: (x: number, y: number) => {
        picks.push([x, y]);
        return { pickedMesh: { metadata: { kind } } };
      },
    },
    orbit: camera,
    canvas,
    currentMode: 'overview',
    paused: false,
  }) as HouseViewer;
  camera.inputs.attachedToElement = false;
  camera.attachControl = () => {
    attachments++;
    camera.inputs.attachedToElement = true;
  };
  const recover = (button = 0) =>
    (viewer as unknown as { recoverOrbitControls(event: PointerEvent): void }).recoverOrbitControls(
      { button, clientX: 100, clientY: 100 } as PointerEvent,
    );
  recover();
  assert.equal(attachments, 1);
  assert.deepEqual(picks[0], [90, 80]);
  recover();
  assert.equal(attachments, 1, 'an attached input must not be reset during a gesture');
  camera.inputs.attachedToElement = false;
  kind = 'furniture';
  recover();
  assert.equal(attachments, 1, 'furniture owns its drag');
  kind = 'floor';
  Object.assign(viewer, { currentMode: 'walk' });
  recover();
  assert.equal(attachments, 1, 'first person input must remain separate');
  Object.assign(viewer, { currentMode: 'plan' });
  recover(2);
  assert.equal(attachments, 2, 'right pan can recover in plan mode too');
  camera.inputs.attachedToElement = false;
  engine.dispose();
});
