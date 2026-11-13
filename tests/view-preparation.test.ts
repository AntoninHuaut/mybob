import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Window } from 'happy-dom';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Effect } from '@babylonjs/core/Materials/effect';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { validateProject } from '../src/model/validate';

async function setup(t: test.TestContext) {
  const window = new Window({ url: 'http://localhost' });
  const globals = {
    window,
    document: window.document,
    ResizeObserver: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
    requestAnimationFrame: (callback: FrameRequestCallback) =>
      setTimeout(() => callback(performance.now()), 0),
  };
  const previous = Object.fromEntries(
    Object.keys(globals).map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
  );
  for (const [name, value] of Object.entries(globals))
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  const persistent = Effect.PersistentMode;
  Effect.PersistentMode = true;
  const engine = new NullEngine();
  const context = new Proxy(
    {},
    { get: (_target, key) => (key === 'measureText' ? () => ({ width: 10 }) : () => {}) },
  );
  t.mock.method(engine, 'createCanvas', (width: number, height: number) => ({
    width,
    height,
    getContext: () => context,
  }));
  let loop!: () => void;
  t.mock.method(engine, 'runRenderLoop', (callback: () => void) => {
    loop = callback;
  });
  const { HouseViewer } = await import('../src/scene/viewer');
  const canvas = window.document.createElement('canvas');
  window.document.body.append(canvas);
  const viewer = new HouseViewer(canvas as unknown as HTMLCanvasElement, engine);
  t.after(() => {
    viewer.dispose();
    window.close();
    Effect.PersistentMode = persistent;
    for (const name of Object.keys(globals)) {
      const descriptor = previous[name];
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  });
  const project = validateProject(
    JSON.parse(
      await readFile(new URL('../public/projects/studio-demo.json', import.meta.url), 'utf8'),
    ),
  );
  viewer.load(project);
  loop();
  await viewer.whenReady();
  return { viewer, engine, loop };
}

test('a prepared overview rotates and zooms without requesting another shader', async (t) => {
  const { viewer, engine, loop } = await setup(t);
  const keys = () =>
    Object.keys((engine as unknown as { _compiledEffects: object })._compiledEffects).sort();
  const prepared = keys();
  const camera = viewer.scene.activeCamera as ArcRotateCamera;
  const initial = { alpha: camera.alpha, beta: camera.beta, radius: camera.radius };
  for (let turn = 0; turn < 4; turn++) {
    camera.alpha += Math.PI / 2;
    for (let frame = 0; frame < 12; frame++) {
      loop();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    assert.deepEqual(
      keys(),
      prepared,
      'every cutaway variant was linked behind the preparation overlay',
    );
  }
  for (const radius of [initial.radius * 0.85, initial.radius * 1.15, initial.radius]) {
    camera.radius = radius;
    for (let frame = 0; frame < 12; frame++) {
      loop();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    assert.deepEqual(keys(), prepared, 'zooming reuses the prepared programs');
  }
  assert.equal(camera.beta, initial.beta);
  assert.equal(camera.radius, initial.radius);
});

test('late compilation cannot lower quality and restarts the measurement warm-up', async (t) => {
  const { viewer, engine, loop } = await setup(t);
  const { WARMUP_FRAMES, FRAME_SAMPLES } = await import('../src/scene/adaptiveResolution');
  let clock = performance.now();
  t.mock.method(performance, 'now', () => clock);
  const draw = (count: number, ms: number) => {
    for (let frame = 0; frame < count; frame++) {
      clock += ms;
      viewer.requestRender();
      loop();
    }
  };
  draw(WARMUP_FRAMES + FRAME_SAMPLES, 16);
  draw(FRAME_SAMPLES - 1, 40);
  t.mock.method(engine, 'areAllEffectsReady', () => false);
  draw(FRAME_SAMPLES * 2, 120);
  assert.equal(viewer.currentEffectTier, 0, 'compilation is not steady rendering cost');
  t.mock.method(engine, 'areAllEffectsReady', () => true);
  draw(WARMUP_FRAMES, 40);
  assert.equal(viewer.currentEffectTier, 0, 'the first images after compilation are ignored too');
  draw(FRAME_SAMPLES, 40);
  assert.equal(viewer.currentEffectTier, 1, 'a genuinely slow prepared view still adapts');
});
