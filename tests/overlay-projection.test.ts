import assert from 'node:assert/strict';
import test from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Viewport } from '@babylonjs/core/Maths/math.viewport';
import { HouseViewer } from '../src/scene/viewer';

const WIDTH = 1280;
const HEIGHT = 720;

function setup() {
  const engine = new NullEngine({
    renderWidth: WIDTH,
    renderHeight: HEIGHT,
    textureSize: 512,
    deterministicLockstep: false,
    lockstepMaxSteps: 4,
  });
  const scene = new Scene(engine);
  const camera = new ArcRotateCamera('overview', Math.PI * 0.66, 0.66, 20, Vector3.Zero(), scene);
  camera.fov = 0.66;
  scene.activeCamera = camera;
  camera.getViewMatrix(true);
  camera.getProjectionMatrix(true);
  scene.updateTransformMatrix();
  const viewer = Object.assign(Object.create(HouseViewer.prototype), {
    scene,
    engine,
    canvas: { clientWidth: WIDTH, clientHeight: HEIGHT },
    level: { elevation: 3 },
  }) as HouseViewer;
  return { scene, camera, viewer };
}

/** Babylon's temporal pipeline writes its Halton offset into row 2 of the cached projection. */
function jitter(camera: ArcRotateCamera, scene: Scene, x: number, y: number) {
  const projection = camera.getProjectionMatrix();
  projection.setRowFromFloats(2, x, y, projection.m[10], projection.m[11]);
  scene.updateTransformMatrix();
}

const point: [number, number] = [2, 1];

test('overlays project through the unjittered camera and leave the sample in place', () => {
  const { scene, camera, viewer } = setup();
  const settled = viewer.project(point);
  for (const [x, y] of [
    [0.4, -0.35],
    [-0.3, 0.45],
  ]) {
    jitter(camera, scene, x, y);
    assert.deepEqual(viewer.project(point), settled, 'labels stay put while samples accumulate');
    const projection = camera.getProjectionMatrix();
    assert.ok(
      Math.abs(projection.m[8] - x) < 1e-6 && Math.abs(projection.m[9] - y) < 1e-6,
      'the geometry pass keeps its jittered projection',
    );
  }
});

test('the jittered scene transform really moves a naive projection', () => {
  const { scene, camera, viewer } = setup();
  const settled = viewer.project(point);
  jitter(camera, scene, 0.4, -0.35);
  const naive = Vector3.Project(
    new Vector3(point[0], 3.04, point[1]),
    Matrix.IdentityReadOnly,
    scene.getTransformMatrix(),
    new Viewport(0, 0, WIDTH, HEIGHT),
  );
  assert.ok(
    Math.abs(naive.x - settled.x) > 0.1 || Math.abs(naive.y - settled.y) > 0.1,
    'projecting through the scene transform would shake the overlay',
  );
});

/** What the geometry pass would draw: the camera's own matrices, recomputed from scratch. */
function reference(camera: ArcRotateCamera, p: [number, number]) {
  const v = Vector3.Project(
    new Vector3(p[0], 3.04, p[1]),
    Matrix.IdentityReadOnly,
    camera.getViewMatrix(true).multiply(camera.getProjectionMatrix(true)),
    new Viewport(0, 0, WIDTH, HEIGHT),
  );
  return { x: v.x, y: v.y };
}

test('plan overlays follow the orthographic size after every zoom step', () => {
  const { camera, viewer } = setup();
  camera.mode = ArcRotateCamera.ORTHOGRAPHIC_CAMERA;
  const set = (half: number) => {
    camera.orthoTop = half;
    camera.orthoBottom = -half;
    camera.orthoLeft = (-half * WIDTH) / HEIGHT;
    camera.orthoRight = (half * WIDTH) / HEIGHT;
  };
  set(8);
  viewer.project(point);
  for (const half of [6, 4.5, 9, 3]) {
    set(half);
    const shown = viewer.project(point);
    const expected = reference(camera, point);
    assert.ok(
      Math.abs(shown.x - expected.x) < 0.01 && Math.abs(shown.y - expected.y) < 0.01,
      `ortho half-height ${half}: label at ${shown.x},${shown.y}, scene at ${expected.x},${expected.y}`,
    );
  }
});

test('reading an overlay leaves the camera matrix that the next frame draws with', () => {
  const { camera, viewer } = setup();
  camera.mode = ArcRotateCamera.ORTHOGRAPHIC_CAMERA;
  camera.orthoTop = 8;
  camera.orthoBottom = -8;
  camera.orthoLeft = -14;
  camera.orthoRight = 14;
  viewer.project(point);
  camera.orthoTop = 4;
  camera.orthoBottom = -4;
  camera.orthoLeft = -7;
  camera.orthoRight = 7;
  viewer.project(point);
  const drawn = camera.getProjectionMatrix().clone();
  const fresh = camera.getProjectionMatrix(true);
  assert.deepEqual(Array.from(drawn.m), Array.from(fresh.m), 'the cached projection is not stale');
});
