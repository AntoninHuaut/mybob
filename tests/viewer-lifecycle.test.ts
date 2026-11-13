import assert from 'node:assert/strict';
import test from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { PointerEventTypes, PointerInfo } from '@babylonjs/core/Events/pointerEvents';
import { PickingInfo } from '@babylonjs/core/Collisions/pickingInfo';
import { HouseViewer } from '../src/scene/viewer';
import type { Level } from '../src/model/types';

test('replacing scene resources clears old input observers and disposes the scene headset', () => {
  const engine = new NullEngine();
  const level: Level = {
    id: 'test',
    name: 'Test',
    elevation: 0,
    ceilingHeight: 2.5,
    outline: [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ],
    walls: [],
    lights: [],
    spawn: { position: [2, 2], yaw: 0 },
    rooms: [
      {
        id: 'room',
        name: 'Room',
        kind: 'living',
        polygon: [
          [0, 0],
          [4, 0],
          [4, 4],
          [0, 4],
        ],
        label: [2, 2],
        viewpoint: [2, 2],
      },
    ],
  };
  let selections = 0;
  let frames = 0;
  let headsets = 0;
  const viewer = Object.assign(Object.create(HouseViewer.prototype), {
    engine,
    currentMode: 'overview',
    keyState: new Set(),
    onSelectRoom() {
      selections++;
    },
    beforeFrame() {
      frames++;
    },
  }) as HouseViewer;
  const lifecycle = viewer as unknown as {
    attachSceneInput(scene: Scene): void;
    releaseScene(): void;
  };
  const pick = new PickingInfo();
  pick.pickedPoint = new Vector3(2, 0, 2);
  const click = (scene: Scene) =>
    scene.onPointerObservable.notifyObservers(
      new PointerInfo(PointerEventTypes.POINTERTAP, { button: 0 } as PointerEvent, pick),
    );
  try {
    for (let i = 0; i < 3; i++) {
      const scene = new Scene(engine);
      Object.assign(viewer, {
        scene,
        level,
        immersive: {
          dispose() {
            headsets++;
          },
        },
      });
      lifecycle.attachSceneInput(scene);
      click(scene);
      scene.onBeforeAnimationsObservable.notifyObservers(scene);
      assert.equal(selections, i + 1);
      assert.equal(frames, i + 1);
      lifecycle.releaseScene();
      assert.equal(scene.isDisposed, true);
      assert.equal(scene.onPointerObservable.observers.length, 0);
      assert.equal(scene.onBeforeAnimationsObservable.observers.length, 0);
      click(scene);
      scene.onBeforeAnimationsObservable.notifyObservers(scene);
      assert.equal(selections, i + 1, 'old scene callbacks cannot select a room');
      assert.equal(frames, i + 1, 'old scene callbacks cannot drive a frame');
      assert.equal(headsets, i + 1);
      assert.equal(viewer.immersiveActive, false);
      assert.equal(viewer.exteriorView, false);
    }
  } finally {
    engine.dispose();
  }
});
