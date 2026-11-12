import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Window } from 'happy-dom';
import { MaterialDefines } from '@babylonjs/core/Materials/materialDefines';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { installCanonicalDefineOrder } from '../src/scene/canonicalDefines';
import { validateProject } from '../src/model/validate';

test('the same defines give the same string, whatever order they were first set in', () => {
  installCanonicalDefineOrder();
  installCanonicalDefineOrder();
  const plan = new MaterialDefines() as MaterialDefines & Record<string, unknown>;
  plan.LIGHT0 = true;
  plan.LIGHTCOUNT = 1;
  plan.rebuild();
  // The overview adds a light the plan never saw: it lands after LIGHTCOUNT.
  plan.LIGHT1 = true;
  plan.LIGHTCOUNT = 2;
  plan.rebuild();
  const overview = new MaterialDefines() as MaterialDefines & Record<string, unknown>;
  overview.LIGHT0 = true;
  overview.LIGHT1 = true;
  overview.LIGHTCOUNT = 2;
  overview.rebuild();
  assert.equal(plan.toString(), overview.toString());
});

/**
 * The real viewer on a NullEngine: NullEngine links nothing, but it asks the
 * engine for every program by its define string, which is the cache key a
 * browser links against.
 */
test('going back to a prepared view after the plan asks for no new program', async () => {
  const window = new Window({ url: 'http://localhost' });
  const names = ['window', 'document', 'ResizeObserver'] as const;
  const previous = names.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
  const define = (name: string, value: unknown) =>
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  define('window', window);
  define('document', window.document);
  define(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const engine = new NullEngine();
  // No pixels on a NullEngine: only the canvas drawing API is stubbed.
  const context = new Proxy(
    {},
    { get: (_target, key) => (key === 'measureText' ? () => ({ width: 10 }) : () => {}) },
  );
  (engine as unknown as { createCanvas: unknown }).createCanvas = (
    width: number,
    height: number,
  ) => ({ width, height, getContext: () => context });
  const { HouseViewer } = await import('../src/scene/viewer');
  const host = window.document.createElement('div');
  const canvas = window.document.createElement('canvas');
  host.append(canvas);
  window.document.body.append(host);
  const viewer = new HouseViewer(canvas as unknown as HTMLCanvasElement, engine);
  try {
    const project = validateProject(
      JSON.parse(
        await readFile(new URL('../public/projects/studio-demo.json', import.meta.url), 'utf8'),
      ),
    );
    viewer.load(project);
    const programs = () =>
      Object.keys((engine as unknown as { _compiledEffects: object })._compiledEffects).length;
    const draw = () => {
      for (let frame = 0; frame < 12; frame++) viewer.scene.render();
    };
    draw();
    viewer.setMode('walk');
    draw();
    viewer.setMode('overview', true);
    draw();
    viewer.setMode('plan');
    draw();
    const before = programs();
    viewer.setMode('overview');
    draw();
    assert.equal(programs(), before, 'the overview reuses the programs it already linked');
  } finally {
    viewer.dispose();
    names.forEach((name, index) => {
      const descriptor = previous[index];
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
});
