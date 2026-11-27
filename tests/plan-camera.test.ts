import assert from 'node:assert/strict';
import test from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { HouseViewer } from '../src/scene/viewer';
import type { Level, Point2 } from '../src/model/types';
import { setPlanView } from '../src/scene/coordinates';

const level = (outline: Point2[]): Level => ({
  id: 'level',
  name: 'Plan',
  elevation: 0,
  ceilingHeight: 2.5,
  outline,
  walls: [],
  rooms: [],
  lights: [],
  spawn: { position: [1, 1], yaw: 0 },
});

function fixture(outline: Point2[]) {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const camera = new ArcRotateCamera('plan', Math.PI / 2, 0.001, 20, Vector3.Zero(), scene);
  const viewer = Object.assign(Object.create(HouseViewer.prototype), {
    engine,
    scene,
    orbit: camera,
    currentMode: 'plan',
    planZoom: 1,
    level: level(outline),
    canvas: { clientWidth: 800, clientHeight: 600 },
  }) as HouseViewer;
  const inner = viewer as unknown as { level: Level; planZoom: number; zoomPlan(f: number): void };
  setPlanView(camera, inner.level);
  inner.zoomPlan(1);
  return { engine, camera, viewer, inner };
}

const ground: Point2[] = [
  [0, 0],
  [12, 0],
  [12, 8],
  [0, 8],
];
const room: Point2[] = [
  [3, 2],
  [7.2, 2],
  [7.2, 5.2],
  [3, 5.2],
];

test('a plan edit keeps the framing the visitor chose, even when the outline changes', () => {
  const { engine, camera, viewer, inner } = fixture(ground);
  inner.zoomPlan(0.5);
  camera.setTarget(new Vector3(4, 0, 3), false, true, true);
  const kept = viewer.planView()!;
  const span = camera.orthoTop! - camera.orthoBottom!;

  // What a reload does: a new outline, the plan framed again around it.
  inner.level = level(room);
  setPlanView(camera, inner.level);
  inner.planZoom = 1;
  inner.zoomPlan(1);
  assert.notEqual(camera.orthoTop! - camera.orthoBottom!, span);

  viewer.restorePlanView(kept);
  assert.deepEqual(camera.target.asArray(), [4, 0, 3]);
  assert.ok(Math.abs(camera.orthoTop! - camera.orthoBottom! - span) < 1e-9);
  // The next wheel step zooms from the kept framing, without a jump.
  inner.zoomPlan(1);
  assert.ok(Math.abs(camera.orthoTop! - camera.orthoBottom! - span) < 1e-9);
  engine.dispose();
});

test('there is no plan framing to keep outside Plan', () => {
  const { engine, viewer } = fixture(ground);
  (viewer as unknown as { currentMode: string }).currentMode = 'overview';
  assert.equal(viewer.planView(), undefined);
  engine.dispose();
});
