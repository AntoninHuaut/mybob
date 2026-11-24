import assert from 'node:assert/strict';
import test from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { HeadsetSession, sceneReadiness } from '../src/scene/headsetSession';
import type { ImmersiveWalk } from '../src/scene/xrWalk';

test('headset readiness counts only enabled, visible meshes and waits for every one', (t) => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const a = MeshBuilder.CreateBox('a', {}, scene);
  const b = MeshBuilder.CreateBox('b', {}, scene);
  const hidden = MeshBuilder.CreateBox('hidden', {}, scene);
  hidden.isVisible = false;
  const off = MeshBuilder.CreateBox('off', {}, scene);
  off.setEnabled(false);
  t.mock.method(a, 'isReady', () => true);
  t.mock.method(hidden, 'isReady', () => false);
  t.mock.method(off, 'isReady', () => false);
  const slow = t.mock.method(b, 'isReady', () => false);
  assert.deepEqual(sceneReadiness(scene, engine), { fraction: 0.5, ready: false });
  slow.mock.mockImplementation(() => true);
  assert.equal(sceneReadiness(scene, engine).fraction, 1);
  t.mock.method(engine, 'areAllEffectsReady', () => false);
  assert.equal(sceneReadiness(scene, engine).ready, false, 'shaders still linking');
  scene.dispose();
  engine.dispose();
});

test('an empty scene is ready at once', () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  assert.deepEqual(sceneReadiness(scene, engine), { fraction: 1, ready: true });
  scene.dispose();
  engine.dispose();
});

test('an idle session releases nothing and can be disposed with no headset', async () => {
  const session = new HeadsetSession();
  assert.equal(session.busy, false);
  assert.equal(session.walk, undefined);
  let disposed = false;
  const stranger = { dispose: () => (disposed = true) } as unknown as ImmersiveWalk;
  assert.equal(session.release(stranger), false, 'a session that is not this one stays alone');
  assert.equal(disposed, false);
  assert.equal(await session.exit(), undefined);
  session.dispose();
});
