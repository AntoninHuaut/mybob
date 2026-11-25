import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Window } from 'happy-dom';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { validateProject } from '../src/model/validate';
import type { HouseProject } from '../src/model/types';

/** maison-atelier (it has a plot) stacked three times: a fictitious house with a level below and above. */
async function stackedHouse(): Promise<HouseProject> {
  const house = JSON.parse(
    await readFile(new URL('../public/projects/maison-atelier.json', import.meta.url), 'utf8'),
  );
  const [ground] = house.levels;
  // Every identifier in a project is unique: each copy prefixes its walls, rooms and openings.
  const prefixed = (value: unknown, prefix: string): unknown =>
    Array.isArray(value)
      ? value.map((item) => prefixed(item, prefix))
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.entries(value).map(([key, item]) => [
              key,
              key === 'id' && typeof item === 'string'
                ? `${prefix}${item}`
                : prefixed(item, prefix),
            ]),
          )
        : value;
  house.levels = ['rdc', 'etage', 'combles'].map((id, index) => ({
    ...(prefixed(ground, `${id}-`) as object),
    id,
    name: id,
    elevation: index * 3,
  }));
  return validateProject(house);
}

test('only the displayed level is built until Vue 3D or Extérieur shows the others', async () => {
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
  const canvas = window.document.createElement('canvas');
  window.document.body.append(canvas);
  const viewer = new HouseViewer(canvas as unknown as HTMLCanvasElement, engine);
  try {
    const project = await stackedHouse();
    const built = () =>
      project.levels
        .filter((level) => viewer.scene.getTransformNodeByName(`level:${level.id}`))
        .map((level) => level.id);
    viewer.load(project, 'etage');
    viewer.setMode('plan');
    viewer.scene.render();
    assert.deepEqual(built(), ['etage'], 'Plan never shows another level');
    viewer.setMode('overview');
    viewer.scene.render();
    assert.deepEqual(built(), ['rdc', 'etage'], 'Vue 3D stacks the levels below');
    viewer.setMode('overview', true);
    viewer.scene.render();
    assert.deepEqual(built(), ['rdc', 'etage', 'combles'], 'Extérieur shows every level');
  } finally {
    viewer.dispose();
    names.forEach((name, index) => {
      const descriptor = previous[index];
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
});
