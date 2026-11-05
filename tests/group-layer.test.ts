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
import { createFurniture, type FurnitureItem } from '../src/furniture/model';
import type { Level } from '../src/model/types';

const level: Level = {
  id: 'test',
  name: 'Test',
  elevation: 0,
  ceilingHeight: 3,
  outline: [
    [0, 0],
    [12, 0],
    [12, 10],
    [0, 10],
  ],
  walls: [],
  rooms: [],
  lights: [],
  spawn: { position: [2, 2], yaw: 0 },
};
function setup(items: FurnitureItem[], selectedId: string, withWall = false) {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  const building = structuredClone(level);
  if (withWall) building.walls = [{ id: 'partition', start: [6, 0], end: [6, 10], thickness: 0.1 }];
  const layer = new FurnitureLayer(scene, building);
  layer.setItems(items);
  scene.activeCamera = new UniversalCamera('camera', new Vector3(0, 10, 0), scene);
  const selected = items.find((item) => item.id === selectedId)!;
  let pointer = [...selected.position];
  scene.createPickingRay = () =>
    new Ray(new Vector3(pointer[0], 10, pointer[1]), new Vector3(0, -1, 0));
  const changes: { items: FurnitureItem[]; final: boolean }[] = [];
  const states: boolean[] = [];
  layer.onChange = (items, final) => changes.push({ items, final });
  layer.onDragState = (state) => states.push(state);
  const emit = (type: number) => {
    const picked = new PickingInfo();
    picked.hit = true;
    picked.pickedMesh = scene.meshes.find(
      (mesh) => mesh.metadata?.id === selectedId && mesh.metadata.kind === 'furniture',
    )!;
    scene.onPointerObservable.notifyObservers(
      new PointerInfo(type, { button: 0 } as PointerEvent, picked),
    );
  };
  return {
    scene,
    layer,
    changes,
    states,
    down: () => emit(PointerEventTypes.POINTERDOWN),
    move: (x: number, z: number) => {
      pointer = [x, z];
      emit(PointerEventTypes.POINTERMOVE);
    },
    up: () => emit(PointerEventTypes.POINTERUP),
    cleanup: () => {
      layer.dispose();
      scene.dispose();
      engine.dispose();
    },
  };
}
function assembly() {
  return [
    createFurniture({
      id: 'stand',
      kind: 'tv-stand',
      position: [2, 3],
      width: 1.5,
      depth: 0.5,
      groupId: 'tv-set',
    }),
    createFurniture({
      id: 'tv',
      kind: 'tv',
      position: [2, 3],
      width: 1,
      depth: 0.2,
      elevation: 0.6,
      rotation: 0.25,
      groupId: 'tv-set',
    }),
    createFurniture({ id: 'other', kind: 'chair', position: [2, 7] }),
  ];
}

test('dragging either linked member moves the whole assembly with a single final commit', () => {
  for (const selected of ['stand', 'tv']) {
    const initial = assembly();
    const { scene, layer, changes, states, down, move, up, cleanup } = setup(initial, selected);
    layer.select(selected);
    assert.ok(
      scene.getMeshByName(`furniture:group-selection:${selected === 'stand' ? 'tv' : 'stand'}`),
    );
    down();
    move(3, 4);
    move(4, 4);
    up();
    up();
    assert.deepEqual(
      changes.map((change) => change.final),
      [false, false, true],
    );
    assert.deepEqual(states, [true, false]);
    const final = changes.at(-1)!.items;
    for (const id of ['stand', 'tv']) {
      const item = final.find((item) => item.id === id)!;
      assert.deepEqual(item.position, [4, 4]);
      assert.equal(item.rotation, initial.find((member) => member.id === id)!.rotation);
      assert.equal(item.elevation, initial.find((member) => member.id === id)!.elevation);
      assert.equal(scene.getTransformNodeByName(`furniture:${id}`)!.position.x, 4);
    }
    assert.deepEqual(
      final.find((item) => item.id === 'other'),
      initial[2],
    );
    cleanup();
  }
});

test('a wall hit by the other linked member stops the entire group, including large pointer jumps', () => {
  const items = assembly();
  items[0].position = [2, 3];
  items[1].position = [4, 3];
  items[1].rotation = 0;
  const { changes, down, move, up, cleanup } = setup(items, 'stand', true);
  down();
  move(10, 5);
  up();
  assert.equal(changes.at(-1)?.final, true);
  const final = changes.at(-1)!.items;
  const stand = final.find((item) => item.id === 'stand')!,
    tv = final.find((item) => item.id === 'tv')!;
  assert.ok(tv.position[0] <= 5.452, `TV crossed wall: ${tv.position[0]}`);
  assert.ok(tv.position[0] > 5.4);
  assert.ok(Math.abs(tv.position[0] - stand.position[0] - 2) < 1e-8);
  assert.ok(Math.abs(tv.position[1] - stand.position[1]) < 1e-8);
  assert.ok(Math.abs((stand.position[1] - 3) / 2 - (stand.position[0] - 2) / 8) < 1e-8);
  cleanup();
});

test('any locked member prevents dragging the group and releasing it creates no history entry', () => {
  const items = assembly();
  items[1].locked = true;
  const { changes, states, down, move, up, cleanup } = setup(items, 'stand');
  down();
  move(4, 4);
  up();
  assert.deepEqual(changes, []);
  assert.deepEqual(states, []);
  cleanup();
});

test('locking a linked member during a live drag releases the camera and commits just once', () => {
  const { layer, changes, states, down, move, up, cleanup } = setup(assembly(), 'stand');
  down();
  move(3, 4);
  const current = structuredClone(changes.at(-1)!.items);
  current.find((item) => item.id === 'tv')!.locked = true;
  layer.setItems(current);
  move(4, 4);
  up();
  assert.deepEqual(
    changes.map((change) => change.final),
    [false, true],
  );
  assert.deepEqual(states, [true, false]);
  cleanup();
});
