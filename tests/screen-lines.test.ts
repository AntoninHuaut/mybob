import assert from 'node:assert/strict';
import test from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { createScreenLines, screenLinePixelWidth } from '../src/scene/screenLines';

test('line widths follow rendered pixels per CSS pixel, including adaptive resolution', () => {
  assert.equal(screenLinePixelWidth(1.5, 800, 800), 3);
  assert.equal(screenLinePixelWidth(1.5, 1600, 800), 6);
  assert.equal(screenLinePixelWidth(1.5, 1072, 800), 4.02);
});

test('screen lines update geometry without accumulating points or leaking materials', () => {
  const engine = new NullEngine(),
    scene = new Scene(engine);
  try {
    const line = createScreenLines(
      'test',
      [[Vector3.Zero(), new Vector3(1, 0, 0)]],
      scene,
      Color3.Red(),
    );
    const material = line.material;
    for (let i = 0; i < 20; i++) line.setPoints([[0, 0, 0, i + 1, 0, 0]]);
    assert.equal(line.points.length, 1);
    assert.equal(line.points[0].length, 6);
    assert.equal(line.material, material);
    assert.equal(line.isPickable, false);
    assert.equal(line.checkCollisions, false);
    assert.equal(line.greasedLineMaterial?.sizeAttenuation, true);
    line.dispose();
    assert.equal(scene.materials.includes(material!), false, 'line owns its unique material');
  } finally {
    scene.dispose();
    engine.dispose();
  }
});

test('screen-line material follows resize scaling and releases its resize observer', (t) => {
  const engine = new NullEngine(),
    scene = new Scene(engine);
  let height = 800;
  t.mock.method(engine, 'getRenderHeight', () => height);
  t.mock.method(engine, 'getRenderingCanvas', () => ({ clientHeight: 800 }) as HTMLCanvasElement);
  const before = engine.onResizeObservable.observers.length;
  try {
    const line = createScreenLines(
      'resizable',
      [[Vector3.Zero(), new Vector3(1, 0, 0)]],
      scene,
      Color3.Red(),
    );
    assert.equal(line.greasedLineMaterial!.width, 3);
    height = 1600;
    engine.onResizeObservable.notifyObservers(engine);
    assert.equal(line.greasedLineMaterial!.width, 6);
    height = 1072;
    engine.onResizeObservable.notifyObservers(engine);
    assert.equal(line.greasedLineMaterial!.width, 4.02);
    line.dispose();
    assert.equal(
      engine.onResizeObservable.observers.filter((o) => !o._willBeUnregistered).length,
      before,
    );
  } finally {
    scene.dispose();
    engine.dispose();
  }
});
