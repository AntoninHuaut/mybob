import assert from 'node:assert/strict';
import test from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import type { ArcRotateCameraPointersInput } from '@babylonjs/core/Cameras/Inputs/arcRotateCameraPointersInput';
import type { IPointerEvent } from '@babylonjs/core/Events/deviceInputEvents';
import { Camera } from '@babylonjs/core/Cameras/camera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { HouseViewer, configureOrbitInteractions } from '../src/scene/viewer';
import type { Level } from '../src/model/types';
import { setPlanView } from '../src/scene/coordinates';

function fixture(fps = 60) {
  const engine = new NullEngine();
  engine.getDeltaTime = () => 1000 / fps;
  const scene = new Scene(engine);
  const camera = new ArcRotateCamera('plan', Math.PI / 2, 0.001, 20, Vector3.Zero(), scene);
  const level: Level = {
    id: 'level',
    name: 'Plan',
    elevation: 0,
    ceilingHeight: 2.5,
    outline: [
      [0, 0],
      [8, 0],
      [8, 6],
      [0, 6],
    ],
    walls: [],
    rooms: [],
    lights: [],
    spawn: { position: [4, 3], yaw: 0 },
  };
  const viewer = Object.assign(Object.create(HouseViewer.prototype), {
    engine,
    scene,
    orbit: camera,
    mode: 'plan',
    planZoom: 1,
    level,
    canvas: { clientWidth: 390, clientHeight: 788 },
  }) as HouseViewer;
  const zoom = (viewer as unknown as { zoomPlan(factor: number): void }).zoomPlan.bind(viewer);
  configureOrbitInteractions(camera, zoom);
  setPlanView(camera, level);
  zoom(1);
  camera.getViewMatrix(true);
  const pointer = camera.inputs.attached.pointers as ArcRotateCameraPointersInput;
  return { engine, scene, camera, viewer, pointer, zoom };
}

test('a single-pointer plan drag pans instead of rotating a locked orthographic camera', () => {
  for (const fps of [30, 60, 120]) {
    const { engine, camera, pointer } = fixture(fps);
    const target = camera.target.clone();
    const radius = camera.radius;
    pointer.onButtonDown({
      button: 0,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
    } as IPointerEvent);
    pointer.onTouch(null, 100, 0);
    pointer.onButtonUp({ button: 0 } as IPointerEvent);
    for (let i = 0; i < fps * 2; i++) {
      camera._checkInputs();
      camera.getViewMatrix(true);
    }
    assert.ok(Vector3.Distance(target, camera.target) > 0.7);
    assert.equal(camera.radius, radius);
    assert.equal(camera.alpha, Math.PI / 2);
    engine.dispose();
  }
});

test('native multitouch pinches change plan projection and respect bounds without changing camera radius', () => {
  const { engine, camera, pointer } = fixture();
  const span = () => camera.orthoTop! - camera.orthoBottom!;
  const initial = span();
  const radius = camera.radius;
  pointer.onMultiTouch(null, null, 10000, 40000, null, null);
  assert.ok(Math.abs(span() - initial / 2) < 1e-8);
  assert.equal(camera.radius, radius);
  pointer.onMultiTouch(null, null, 40000, 10000, null, null);
  assert.ok(Math.abs(span() - initial) < 1e-8);
  pointer.onMultiTouch(null, null, 1, 1e20, null, null);
  assert.ok(Math.abs(span() - initial * 0.18) < 1e-8);
  pointer.onMultiTouch(null, null, 1e20, 1, null, null);
  assert.ok(Math.abs(span() - initial * 4) < 1e-8);
  assert.equal(camera.radius, radius);
  engine.dispose();
});

test('the pointer extension retains perspective orbit and pinch behavior', () => {
  const { engine, camera, pointer } = fixture();
  camera.mode = Camera.PERSPECTIVE_CAMERA;
  camera.lowerAlphaLimit = camera.upperAlphaLimit = null;
  camera.lowerBetaLimit = 0.03;
  camera.upperBetaLimit = Math.PI * 0.48;
  camera.beta = 0.66;
  const alpha = camera.alpha;
  const radius = camera.radius;
  pointer.onButtonDown({
    button: 0,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
  } as IPointerEvent);
  pointer.onTouch(null, 100, 0);
  pointer.onButtonUp({ button: 0 } as IPointerEvent);
  pointer.onMultiTouch(null, null, 10000, 20000, null, null);
  for (let i = 0; i < 120; i++) {
    camera._checkInputs();
    camera.getViewMatrix(true);
  }
  assert.notEqual(camera.alpha, alpha);
  assert.notEqual(camera.radius, radius);
  engine.dispose();
});
