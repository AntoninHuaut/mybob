import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Window } from 'happy-dom';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { createSkyLayer, SKY_STOPS, skyPixels } from '../src/scene/sky';
import { validateProject } from '../src/model/validate';

const hex = (data: Uint8Array, row: number) =>
  `#${[0, 1, 2].map((c) => data[row * 4 + c].toString(16).padStart(2, '0')).join('')}`;

test('the sky texture runs from the horizon at the bottom to the zenith at the top, below 0.9', () => {
  const data = skyPixels(64);
  assert.equal(hex(data, 0), SKY_STOPS.at(-1)![1], 'row 0 is the bottom of the screen: horizon');
  assert.equal(hex(data, 63), SKY_STOPS[0][1], 'the last row is the top of the screen: zenith');
  for (let row = 0; row < 64; row++) {
    assert.equal(data[row * 4 + 3], 255, 'opaque: the sky hides the clear colour');
    for (let c = 0; c < 3; c++)
      assert.ok(data[row * 4 + c] / 255 <= 0.9, 'below the orbit bloom threshold');
  }
  // Blue falls steadily from the zenith to the horizon: no band, no jump at a stop.
  for (let row = 1; row < 64; row++)
    assert.ok(data[row * 4 + 2] <= data[(row - 1) * 4 + 2] + 1, `blue at row ${row}`);
});

test('the sky layer is a disabled background layer until the viewer turns it on', () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  try {
    const layer = createSkyLayer(scene);
    assert.equal(layer.isBackground, true);
    assert.equal(layer.isEnabled, false);
    const size = layer.texture!.getSize();
    assert.deepEqual([size.width, size.height], [1, 64]);
  } finally {
    scene.dispose();
    engine.dispose();
  }
});

/** The real viewer on a NullEngine, as in `canonical-defines.test.ts`. */
test('the sky shows in Vue 3D and Extérieur only, and a transparent export leaves it out', async () => {
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
    viewer.load(
      validateProject(
        JSON.parse(
          await readFile(new URL('../public/projects/studio-demo.json', import.meta.url), 'utf8'),
        ),
      ),
    );
    const sky = () => viewer.scene.layers.find((layer) => layer.name === 'sky')!;
    assert.equal(sky().isEnabled, true, 'the landing Vue 3D shows the sky');
    viewer.setMode('plan');
    assert.equal(sky().isEnabled, false, 'the plan keeps its flat background');
    viewer.setMode('overview', true);
    assert.equal(sky().isEnabled, true, 'Extérieur shows the sky');

    // Watch the layer during the capture's render: hidden for a transparent export only.
    const seen: boolean[] = [];
    const render = viewer.scene.render.bind(viewer.scene);
    viewer.scene.render = (...args: Parameters<typeof render>) => {
      seen.push(sky().isEnabled);
      return render(...args);
    };
    const drawImage = () => {};
    const create = window.document.createElement.bind(window.document);
    window.document.createElement = ((tag: string) =>
      tag === 'canvas'
        ? { width: 0, height: 0, getContext: () => ({ drawImage }) }
        : create(tag)) as typeof window.document.createElement;
    viewer.captureCanvas(false, false);
    assert.ok(seen.length > 0 && seen.every((on) => !on), 'transparent: no sky in the image');
    assert.equal(sky().isEnabled, true, 'restored after the capture');
    seen.length = 0;
    viewer.captureCanvas(false, true);
    assert.ok(seen.length > 0 && seen.every((on) => on), 'opaque: the sky is in the image');
    window.document.createElement = create;
  } finally {
    viewer.dispose();
    names.forEach((name, index) => {
      const descriptor = previous[index];
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
});
