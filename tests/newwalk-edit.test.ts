import assert from 'node:assert/strict';
import test from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { HouseViewer, findEditableFurniture, type FrameInfo } from '../src/scene/viewer';

function fixture() {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  const camera = new UniversalCamera('walk', new Vector3(0, 1.65, 0), scene);
  camera.setTarget(new Vector3(0, 1.65, -1));
  camera.getViewMatrix(true);
  const furniture = MeshBuilder.CreateBox('wardrobe', { width: 1, height: 2, depth: 0.4 }, scene);
  furniture.position.set(0, 1, -2.5);
  furniture.metadata = { kind: 'furniture', id: 'wardrobe' };
  furniture.computeWorldMatrix(true);
  return { engine, scene, camera, furniture };
}

test('walk editing targets the first furniture within three metres, independent of its lock', () => {
  const { engine, scene, camera, furniture } = fixture();
  furniture.metadata.locked = true;
  assert.equal(findEditableFurniture(camera, scene), 'wardrobe');
  assert.equal(findEditableFurniture(camera, scene, 2), undefined);
  furniture.position.z = -3.3;
  furniture.computeWorldMatrix(true);
  assert.equal(findEditableFurniture(camera, scene), undefined);
  scene.dispose();
  engine.dispose();
});

test('walls and closed doors occlude the edit ray; opening a door exposes the furniture', () => {
  const { engine, scene, camera } = fixture();
  const obstruction = MeshBuilder.CreateBox(
    'obstruction',
    { width: 1, height: 2, depth: 0.1 },
    scene,
  );
  obstruction.position.set(0, 1, -1);
  obstruction.computeWorldMatrix(true);
  assert.equal(findEditableFurniture(camera, scene), undefined);
  obstruction.metadata = { kind: 'door', id: 'door' };
  assert.equal(findEditableFurniture(camera, scene), undefined);
  obstruction.position.x = 1.5;
  obstruction.computeWorldMatrix(true);
  assert.equal(findEditableFurniture(camera, scene), 'wardrobe');
  scene.dispose();
  engine.dispose();
});

test('F routes once only during an active unpaused visit and keeps E for doors', () => {
  const { engine, scene, camera } = fixture();
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const canvas = {};
  const documentStub = { activeElement: canvas as unknown, pointerLockElement: null as unknown };
  Object.defineProperty(globalThis, 'document', { value: documentStub, configurable: true });
  const edits: string[] = [],
    doors: string[] = [];
  const viewer = Object.assign(Object.create(HouseViewer.prototype), {
    canvas,
    scene,
    walk: camera,
    mode: 'walk',
    paused: false,
    keyState: new Set<string>(),
    onEditFurniture: (id: string) => edits.push(id),
    toggleDoor: (id: string) => doors.push(id),
  }) as HouseViewer;
  const key = (code: string, options: Record<string, unknown> = {}) =>
    (viewer as unknown as { handleKeydown(event: KeyboardEvent): void }).handleKeydown({
      code,
      repeat: false,
      preventDefault() {},
      ...options,
    } as KeyboardEvent);
  try {
    key('KeyF');
    key('KeyF', { repeat: true });
    assert.deepEqual(edits, ['wardrobe']);
    Object.assign(viewer, { paused: true });
    key('KeyF');
    Object.assign(viewer, { paused: false });
    viewer.mode = 'overview';
    key('KeyF');
    viewer.mode = 'walk';
    documentStub.activeElement = {};
    key('KeyF');
    documentStub.activeElement = canvas;
    key('KeyF', { ctrlKey: true });
    assert.deepEqual(edits, ['wardrobe']);
    documentStub.activeElement = {};
    documentStub.pointerLockElement = canvas;
    key('KeyF');
    assert.equal(edits.length, 2, 'pointer lock also owns the keyboard');
    const door = MeshBuilder.CreateBox('door', { width: 1, height: 2, depth: 0.1 }, scene);
    door.position.set(0, 1, -1);
    door.metadata = { kind: 'door', id: 'entry' };
    door.computeWorldMatrix(true);
    key('KeyE');
    key('KeyE', { repeat: true });
    key('KeyF');
    assert.deepEqual(doors, ['entry']);
    assert.equal(edits.length, 2);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'document', descriptor);
    else Reflect.deleteProperty(globalThis, 'document');
    scene.dispose();
    engine.dispose();
  }
});

test('walk HUD exposes furniture at three metres while keeping the shorter door range', () => {
  const { engine, scene, camera, furniture } = fixture();
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {
    value: { activeElement: {}, pointerLockElement: null },
    configurable: true,
  });
  let frame: FrameInfo | undefined;
  const viewer = Object.assign(Object.create(HouseViewer.prototype), {
    engine,
    scene,
    walk: camera,
    mode: 'walk',
    paused: false,
    keyState: new Set(),
    house: { doors: [] },
    level: {
      elevation: 0,
      ceilingHeight: 2.5,
      outline: [
        [-5, -5],
        [5, -5],
        [5, 5],
        [-5, 5],
      ],
      rooms: [],
    },
    updateCutaway() {},
    planUpDegrees: () => 0,
    onFrame: (value: FrameInfo) => {
      frame = value;
    },
  });
  try {
    viewer.beforeFrame();
    assert.equal(frame!.nearFurnitureId, 'wardrobe');
    assert.equal(frame!.nearDoor, false);
    furniture.setEnabled(false);
    const door = MeshBuilder.CreateBox('door', { width: 1, height: 2, depth: 0.1 }, scene);
    door.position.set(0, 1, -2.7);
    door.metadata = { kind: 'door', id: 'far-door' };
    door.computeWorldMatrix(true);
    viewer.beforeFrame();
    assert.equal(frame!.nearFurnitureId, undefined);
    assert.equal(frame!.nearDoor, false);
    door.position.z = -2.2;
    door.computeWorldMatrix(true);
    viewer.beforeFrame();
    assert.equal(frame!.nearDoor, true);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'document', descriptor);
    else Reflect.deleteProperty(globalThis, 'document');
    scene.dispose();
    engine.dispose();
  }
});
