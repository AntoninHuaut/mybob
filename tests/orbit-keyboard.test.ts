import assert from 'node:assert/strict';
import test from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Camera } from '@babylonjs/core/Cameras/camera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { configureOrbitInteractions } from '../src/scene/viewer';
import { usePlanCoordinates } from '../src/scene/coordinates';
import { panOrbitWithKeys } from '../src/scene/orbitNavigation';

function fixture(plan: boolean, size = 20) {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  usePlanCoordinates(scene);
  const camera = new ArcRotateCamera(
    'test',
    plan ? Math.PI / 2 : Math.PI * 0.66,
    plan ? 0.001 : 0.66,
    size,
    new Vector3(5, 1.25, 5),
    scene,
  );
  camera.fov = 0.66;
  if (plan) {
    camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
    camera.orthoTop = size / 2;
    camera.orthoBottom = -size / 2;
  }
  configureOrbitInteractions(camera);
  camera.getViewMatrix(true);
  return { engine, scene, camera };
}

test('keyboard pan moves in ground screen directions without changing orbit angles or zoom', () => {
  for (const plan of [false, true]) {
    const { engine, scene, camera } = fixture(plan);
    const origin = camera.target.clone(),
      angles = [camera.alpha, camera.beta, camera.radius];
    const right = camera.getDirection(Vector3.Right());
    right.y = 0;
    right.normalize();
    const ahead = Vector3.Cross(Vector3.UpReadOnly, right);
    panOrbitWithKeys(camera, 1, 0, 1 / 30);
    const delta = camera.target.subtract(origin);
    assert.ok(Vector3.Dot(delta, ahead) > 0);
    assert.ok(Math.abs(Vector3.Dot(delta, right)) < 1e-8);
    assert.equal(delta.y, 0);
    assert.deepEqual([camera.alpha, camera.beta, camera.radius], angles);
    if (plan) {
      assert.ok(camera.target.z < origin.z);
      assert.ok(Math.abs(camera.target.x - origin.x) < 1e-8);
    }
    const next = camera.target.clone();
    panOrbitWithKeys(camera, 0, 1, 1 / 30);
    assert.ok(Vector3.Dot(camera.target.subtract(next), right) > 0);
    assert.equal(
      camera.inputs.attached.keyboard,
      undefined,
      'default arrow rotation must be removed',
    );
    scene.dispose();
    engine.dispose();
  }
});

test('keyboard pan is frame-rate independent, normalizes diagonals and stops without inertia', () => {
  for (const plan of [false, true])
    for (const fps of [30, 60, 144, 240]) {
      const { engine, scene, camera } = fixture(plan);
      const initial = camera.target.clone();
      const span = plan ? 20 : 2 * 20 * Math.tan(camera.fov / 2);
      for (let i = 0; i < fps; i++) {
        panOrbitWithKeys(camera, 1, 1, 1 / fps);
        camera.getViewMatrix(true);
      }
      assert.ok(
        Math.abs(Vector3.Distance(initial, camera.target) - span * 0.25) < 1e-7,
        `${plan ? 'plan' : '3D'} ${fps}Hz`,
      );
      const stopped = camera.target.clone();
      panOrbitWithKeys(camera, 0, 0, 1 / fps);
      camera._checkInputs();
      assert.ok(Vector3.Distance(stopped, camera.target) < 1e-8);
      scene.dispose();
      engine.dispose();
    }
});

test('keyboard pan scales with visible area and Shift doubles its speed', () => {
  for (const plan of [false, true]) {
    const travel = (size: number, fast = false) => {
      const { engine, scene, camera } = fixture(plan, size);
      const origin = camera.target.clone();
      panOrbitWithKeys(camera, 1, 0, 0.02, fast);
      const distance = Vector3.Distance(origin, camera.target);
      scene.dispose();
      engine.dispose();
      return distance;
    };
    assert.ok(Math.abs(travel(20) / travel(10) - 2) < 1e-8);
    assert.ok(Math.abs(travel(20, true) / travel(20) - 2) < 1e-8);
  }
});

test('keyboard pan drops the temporal history on every moving frame, never when idle', () => {
  for (const plan of [false, true]) {
    const { engine, scene, camera } = fixture(plan);
    const start = camera._viewHistoryResetId;
    // An idle key returns before touching the camera, so the still image is not reset:
    // its temporal samples must keep accumulating.
    panOrbitWithKeys(camera, 0, 0, 1 / 30);
    assert.equal(camera._viewHistoryResetId, start, `${plan ? 'plan' : '3D'} idle key`);
    for (let frame = 1; frame <= 3; frame++) {
      panOrbitWithKeys(camera, 1, 0, 1 / 30);
      assert.equal(
        camera._viewHistoryResetId,
        start + frame,
        `${plan ? 'plan' : '3D'} pan frame ${frame} must drop the history`,
      );
    }
    scene.dispose();
    engine.dispose();
  }
});
