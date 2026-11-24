import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { HouseProject } from '../src/model/types';
import type { GateInstance } from '../src/scene/buildExterior';
import { anySwinging, HeldKeys, outsideVisit, stepSwings, WalkAim } from '../src/scene/frameMotion';

test('held keys give ZQSD, WASD and arrow axes, Shift for speed', () => {
  const keys = new HeldKeys();
  assert.deepEqual(keys.axes(), { forward: 0, side: 0, fast: false });
  assert.equal(keys.any, false);
  keys.press('KeyZ');
  keys.press('KeyQ');
  assert.deepEqual(keys.axes(), { forward: 1, side: -1, fast: false });
  keys.press('ArrowDown');
  keys.press('ShiftLeft');
  assert.deepEqual(keys.axes(), { forward: 0, side: -1, fast: true });
  keys.release('KeyQ');
  keys.press('KeyD');
  assert.equal(keys.axes().side, 1);
  keys.clear();
  assert.equal(keys.any, false);
});

test('swinging gates move at 2.5 per second towards their target and stop there', () => {
  const gate = {
    pivot: { rotation: { y: 0 } },
    closed: 0,
    progress: 0,
    target: 1,
  } as unknown as GateInstance;
  assert.equal(anySwinging([], [gate]), true);
  assert.equal(stepSwings(0.1, [], [gate]), true);
  assert.ok(Math.abs(gate.progress - 0.25) < 1e-9);
  assert.ok(Math.abs(gate.pivot.rotation.y + 0.25 * Math.PI * 0.5) < 1e-9, 'the gate is posed');
  stepSwings(1, [], [gate]);
  assert.equal(gate.progress, 1, 'never overshoots');
  assert.equal(anySwinging([], [gate]), false);
  assert.equal(stepSwings(0.1, [], [gate]), false);
});

test('the visit stays on the parcel and is sent back only outside it', async () => {
  const project: HouseProject = JSON.parse(
    await readFile(new URL('../public/projects/maison-atelier.json', import.meta.url), 'utf8'),
  );
  const level = project.levels[0];
  const at = (x: number, y: number, z: number) => new Vector3(x, y, z);
  assert.equal(outsideVisit(level, project.site, at(3, 1.65, -1.5)), false, 'lawn');
  assert.equal(outsideVisit(level, project.site, at(3, 1.65, 4.6)), false, 'inside the house');
  assert.equal(outsideVisit(level, project.site, at(-100, 1.65, -100)), true, 'beyond');
  assert.equal(outsideVisit(level, project.site, at(3, 0.2, -1.5)), true, 'under the ground');
  assert.equal(
    outsideVisit(level, project.site, at(3, level.elevation + level.ceilingHeight + 2, 4.6)),
    true,
    'above the ceiling',
  );
});

function aimFixture() {
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
  const done = () => {
    scene.dispose();
    engine.dispose();
  };
  return { scene, camera, furniture, done };
}

test('the walk aim reaches furniture at three metres but doors only within reach', () => {
  const { scene, camera, furniture, done } = aimFixture();
  const aim = new WalkAim();
  assert.deepEqual(aim.update(scene, camera, true), {
    nearDoor: false,
    nearStair: undefined,
    furnitureId: 'wardrobe',
  });
  furniture.setEnabled(false);
  const door = MeshBuilder.CreateBox('door', { width: 1, height: 2, depth: 0.1 }, scene);
  door.position.set(0, 1, -2.7);
  door.metadata = { kind: 'door', id: 'far-door' };
  door.computeWorldMatrix(true);
  assert.deepEqual(aim.update(scene, camera, true), {
    nearDoor: false,
    nearStair: undefined,
    furnitureId: undefined,
  });
  door.position.z = -2.2;
  door.computeWorldMatrix(true);
  assert.equal(aim.update(scene, camera, true).nearDoor, true);
  done();
});

test('a still walk aim reuses its hit until the view changes or it is invalidated', (t) => {
  const { scene, camera, done } = aimFixture();
  const aim = new WalkAim();
  const pick = t.mock.method(scene, 'pickWithRay');
  aim.update(scene, camera, false);
  aim.update(scene, camera, false);
  assert.equal(pick.mock.callCount(), 1, 'the first frame always picks');
  aim.update(scene, camera, true);
  assert.equal(pick.mock.callCount(), 2);
  aim.invalidate();
  aim.update(scene, camera, false);
  assert.equal(pick.mock.callCount(), 3);
  aim.forget();
  assert.equal(aim.update(scene, camera, false).furnitureId, 'wardrobe');
  assert.equal(pick.mock.callCount(), 4);
  done();
});
