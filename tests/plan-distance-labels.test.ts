import assert from 'node:assert/strict';
import test from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { FurnitureLayer } from '../src/furniture/layer';
import { setPlanView } from '../src/scene/coordinates';
import { rectanglesOverlap } from '../src/ui/labelLayout';
import type { Level } from '../src/model/types';

test('plan distance tags separate in screen space, keep nearest anchor, and hide when crowded', () => {
  const engine = new NullEngine(),
    scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  const level: Level = {
    id: 'test',
    name: 'Test',
    elevation: 0,
    ceilingHeight: 3,
    outline: [
      [0, 0],
      [8, 0],
      [8, 6],
      [0, 6],
    ],
    rooms: [],
    walls: [],
    lights: [],
    spawn: { position: [4, 3], yaw: 0 },
  };
  const camera = new ArcRotateCamera('plan', 0, 0.001, 10, new Vector3(4, 0, 3), scene);
  scene.activeCamera = camera;
  setPlanView(camera, level);
  camera.orthoTop = 5;
  camera.orthoBottom = -5;
  camera.orthoLeft = -10;
  camera.orthoRight = 10;
  const layer = new FurnitureLayer(scene, level);
  layer.setMode('plan');
  const root = new TransformNode('furniture:overlays', scene);
  Object.assign(layer, { overlayRoot: root });
  const tag = (text: string, x: number, priority: number) => {
    const mesh = MeshBuilder.CreatePlane(
      'furniture:dimension-label',
      { width: 0.72, height: 0.18 },
      scene,
    );
    mesh.parent = root;
    mesh.position.set(x, 0.2, 3);
    mesh.metadata = {
      kind: 'furniture-overlay',
      label: text,
      anchor: mesh.position.asArray(),
      priority,
    };
    return mesh;
  };
  const near = tag('0.90 m', 4, 199.1),
    far = tag('2.65 m', 4.1, 197.35);
  const line = MeshBuilder.CreateLines(
    'distance',
    { points: [new Vector3(3, 0, 3), new Vector3(5, 0, 3)] },
    scene,
  );
  const originalLine = Array.from(line.getVerticesData('position')!);
  const project = (position: Vector3) =>
    Vector3.Project(
      position,
      Matrix.IdentityReadOnly,
      camera.getViewMatrix().multiply(camera.getProjectionMatrix()),
      camera.viewport.toGlobal(engine.getRenderWidth(), engine.getRenderHeight()),
    );
  const update = () => scene.onBeforeRenderObservable.notifyObservers(scene);
  try {
    const nearAnchor = project(Vector3.FromArray(near.metadata.anchor));
    update();
    assert.ok(near.isVisible && far.isVisible);
    const nearScreen = project(near.position),
      farScreen = project(far.position);
    assert.ok(Math.hypot(nearScreen.x - nearAnchor.x, nearScreen.y - nearAnchor.y) < 1e-5);
    assert.equal(
      rectanglesOverlap(
        { x: nearScreen.x - 48, y: nearScreen.y - 12, width: 96, height: 24 },
        { x: farScreen.x - 48, y: farScreen.y - 12, width: 96, height: 24 },
      ),
      false,
    );
    const previous = far.position.clone();
    update();
    assert.ok(Vector3.Distance(previous, far.position) < 1e-5, 'no frame-to-frame drift');
    assert.deepEqual(Array.from(line.getVerticesData('position')!), originalLine);
    const obstacles = layer.getLabelObstacles((point, height = 0) =>
      project(new Vector3(point[0], height, point[1])),
    );
    assert.equal(obstacles.length, 2);
    engine.getRenderWidth = () => 80;
    engine.getRenderHeight = () => 50;
    update();
    assert.equal(near.isVisible, false);
    assert.equal(far.isVisible, false);
    assert.equal(layer.getLabelObstacles((point) => ({ x: point[0], y: point[1] })).length, 0);
  } finally {
    layer.dispose();
    scene.dispose();
    engine.dispose();
  }
});
