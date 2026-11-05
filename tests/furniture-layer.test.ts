import assert from 'node:assert/strict';
import test from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Ray } from '@babylonjs/core/Culling/ray';
import { PointerEventTypes, PointerInfo } from '@babylonjs/core/Events/pointerEvents';
import { PickingInfo } from '@babylonjs/core/Collisions/pickingInfo';
import { FurnitureLayer } from '../src/furniture/layer';
import type { FurnitureItem } from '../src/furniture/model';
import type { Level } from '../src/model/types';

const level: Level = {
  id: 'test',
  name: 'Test',
  elevation: 2,
  ceilingHeight: 2.5,
  outline: [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ],
  walls: [{ id: 'wall', start: [0, 0], end: [10, 0], thickness: 0.2 }],
  rooms: [
    {
      id: 'lower',
      name: 'Lower',
      kind: 'garage',
      polygon: [
        [0, 0],
        [5, 0],
        [5, 5],
        [0, 5],
      ],
      label: [2, 2],
      viewpoint: [2, 2],
      floorOffset: -0.12,
    },
  ],
  lights: [],
  spawn: { position: [6, 6], yaw: 0 },
};
const item = (kind: FurnitureItem['kind'] = 'sofa'): FurnitureItem => ({
  id: 'f',
  name: 'Furniture',
  kind,
  width: 2,
  depth: 1,
  height: 0.9,
  position: [2, 2],
  rotation: 0,
  locked: false,
  color: '#aabbcc',
});
function setup() {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  const layer = new FurnitureLayer(scene, level);
  return {
    engine,
    scene,
    layer,
    cleanup: () => {
      layer.dispose();
      scene.dispose();
      engine.dispose();
    },
  };
}

test('all parametric furniture stays inside its real dimensions and follows finished floor', () => {
  const { scene, layer, cleanup } = setup();
  const kinds: FurnitureItem['kind'][] = [
    'sofa',
    'table',
    'chair',
    'bed',
    'wardrobe',
    'desk',
    'cabinet',
    'custom',
  ];
  for (const kind of kinds) {
    layer.setItems([item(kind)]);
    const parts = scene.meshes.filter((mesh) => mesh.metadata?.kind === 'furniture');
    assert.ok(parts.length > 0);
    for (const part of parts) {
      part.computeWorldMatrix(true);
      const box = part.getBoundingInfo().boundingBox;
      assert.ok(box.minimumWorld.x >= 1 - 1e-6 && box.maximumWorld.x <= 3 + 1e-6, kind);
      assert.ok(box.minimumWorld.z >= 1.5 - 1e-6 && box.maximumWorld.z <= 2.5 + 1e-6, kind);
      assert.ok(box.minimumWorld.y >= 1.88 - 1e-6 && box.maximumWorld.y <= 2.78 + 1e-6, kind);
      assert.equal(part.checkCollisions, true);
      assert.equal(part.metadata.id, 'f');
    }
  }
  layer.setItems([{ ...item(), position: [6, 6], rotation: Math.PI / 2 }]);
  const root = scene.getTransformNodeByName('furniture:f')!;
  assert.equal(root.position.y, 2);
  assert.equal(root.rotation.y, Math.PI / 2);
  cleanup();
});

test('overlays are non-pickable, do not allocate a canvas headlessly, and dispose fully', () => {
  const { scene, layer, cleanup } = setup();
  layer.setItems([
    {
      ...item(),
      clearances: { front: 0.8, back: 0.1, left: 0.2, right: 0.2 },
      opening: { kind: 'hinged', reach: 0.6 },
    },
  ]);
  layer.select('f');
  layer.setOverlays({ distances: true, clearances: true, openings: true });
  assert.ok(scene.getMeshByName('furniture:clearance'));
  assert.ok(scene.getMeshByName('furniture:opening'));
  assert.ok(scene.meshes.some((mesh) => mesh.metadata?.label === '2.00 m'));
  assert.ok(
    scene.meshes
      .filter((mesh) => mesh.metadata?.kind === 'furniture-overlay')
      .every((mesh) => !mesh.isPickable),
  );
  const count = scene.materials.length;
  for (let i = 0; i < 5; i++) layer.setItems([item()]);
  assert.ok(scene.materials.length <= count);
  layer.setMode('walk');
  assert.equal(scene.getMeshByName('furniture:selection'), null);
  layer.dispose();
  assert.equal(scene.meshes.length, 0);
  assert.equal(scene.transformNodes.length, 0);
  assert.equal(scene.materials.length, 0);
  cleanup();
});

test('drag emits live positions and exactly one final commit, respecting lock and walk mode', () => {
  const { scene, layer, cleanup } = setup();
  scene.activeCamera = new UniversalCamera('test', new Vector3(0, 10, 0), scene);
  let x = 2,
    z = 2;
  scene.createPickingRay = () => new Ray(new Vector3(x, 10, z), new Vector3(0, -1, 0));
  layer.setItems([item()]);
  const pick = new PickingInfo();
  pick.pickedMesh = scene.meshes.find((mesh) => mesh.metadata?.kind === 'furniture')!;
  pick.hit = true;
  const emit = (type: number) =>
    scene.onPointerObservable.notifyObservers(
      new PointerInfo(type, { button: 0 } as PointerEvent, pick),
    );
  const changes: { position: number[]; final: boolean }[] = [];
  const states: boolean[] = [];
  layer.onChange = (items, final) => changes.push({ position: items[0].position, final });
  layer.onDragState = (state) => states.push(state);
  emit(PointerEventTypes.POINTERDOWN);
  x = 3;
  z = 4;
  emit(PointerEventTypes.POINTERMOVE);
  x = 4;
  emit(PointerEventTypes.POINTERMOVE);
  emit(PointerEventTypes.POINTERUP);
  emit(PointerEventTypes.POINTERUP);
  assert.deepEqual(
    changes.map((change) => change.final),
    [false, false, true],
  );
  assert.deepEqual(changes[2].position, [4, 4]);
  assert.deepEqual(states, [true, false]);
  layer.setItems([{ ...item(), locked: true }]);
  emit(PointerEventTypes.POINTERDOWN);
  emit(PointerEventTypes.POINTERMOVE);
  emit(PointerEventTypes.POINTERUP);
  layer.setItems([item()]);
  layer.setMode('walk');
  emit(PointerEventTypes.POINTERDOWN);
  emit(PointerEventTypes.POINTERMOVE);
  emit(PointerEventTypes.POINTERUP);
  assert.equal(changes.length, 3);
  cleanup();
});
