import assert from 'node:assert/strict';
import test from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { FurnitureLayer } from '../src/furniture/layer';
import { createFurniture, televisionDimensions, type FurnitureItem } from '../src/furniture/model';
import type { Level } from '../src/model/types';

const level: Level = {
  id: 'test',
  name: 'Test',
  elevation: 0,
  ceilingHeight: 5,
  outline: [
    [0, 0],
    [15, 0],
    [15, 15],
    [0, 15],
  ],
  walls: [],
  rooms: [],
  lights: [],
  spawn: { position: [5, 5], yaw: 0 },
};
const near = (value: number, target: number) =>
  assert.ok(Math.abs(value - target) < 1e-6, `${value} != ${target}`);
function setup() {
  const engine = new NullEngine(),
    scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  const layer = new FurnitureLayer(scene, level);
  return {
    scene,
    layer,
    cleanup: () => {
      layer.dispose();
      scene.dispose();
      engine.dispose();
    },
  };
}
function screenBounds(scene: Scene, id: string) {
  const screen = scene.meshes.find((mesh) => mesh.material?.name === `furniture:${id}:screen`)!;
  assert.ok(screen);
  screen.computeWorldMatrix(true);
  return screen.getBoundingInfo().boundingBox;
}

test('the visible screen has exactly the stated diagonal and 16:9 ratio across TV sizes and depths', () => {
  const { scene, layer, cleanup } = setup();
  for (const inches of [5, 32, 55, 98, 300])
    for (const depth of [0.05, 0.18, 0.7]) {
      const dimensions = televisionDimensions(inches);
      const item = createFurniture({
        id: 'tv',
        kind: 'tv',
        ...dimensions,
        depth,
        tvDiagonalInches: inches,
        position: [5, 5],
        elevation: 0.6,
      });
      layer.setItems([item]);
      const screen = screenBounds(scene, item.id);
      const width = screen.maximumWorld.x - screen.minimumWorld.x;
      const height = screen.maximumWorld.y - screen.minimumWorld.y;
      near(width / height, 16 / 9);
      near(Math.hypot(width, height), inches * 0.0254);
      near(width, dimensions.screenWidth);
      near(height, dimensions.screenHeight);
      for (const mesh of scene.meshes.filter((mesh) => mesh.metadata?.kind === 'furniture')) {
        mesh.computeWorldMatrix(true);
        const box = mesh.getBoundingInfo().boundingBox;
        assert.ok(
          box.minimumWorld.x >= 5 - item.width / 2 - 1e-6 &&
            box.maximumWorld.x <= 5 + item.width / 2 + 1e-6,
        );
        assert.ok(
          box.minimumWorld.z >= 5 - depth / 2 - 1e-6 && box.maximumWorld.z <= 5 + depth / 2 + 1e-6,
        );
        assert.ok(
          box.minimumWorld.y >= 0.6 - 1e-6 && box.maximumWorld.y <= 0.6 + item.height + 1e-6,
        );
      }
    }
  cleanup();
});

test('legacy TV dimensions keep their existing generic rendering and metadata changes rebuild meshes', () => {
  const { scene, layer, cleanup } = setup();
  const dimensions = televisionDimensions(55);
  const item: FurnitureItem = createFurniture({
    id: 'tv',
    kind: 'tv',
    ...dimensions,
    tvDiagonalInches: 55,
    position: [5, 5],
  });
  layer.setItems([item]);
  const previous = scene.getTransformNodeByName('furniture:tv');
  const legacy = { ...item };
  delete legacy.tvDiagonalInches;
  layer.setItems([legacy]);
  assert.notEqual(scene.getTransformNodeByName('furniture:tv'), previous);
  const box = screenBounds(scene, 'tv');
  near(box.maximumWorld.x - box.minimumWorld.x, item.width * 0.96);
  near(box.maximumWorld.y - box.minimumWorld.y, item.height * 0.84);
  cleanup();
});

test('a custom outer size that just contains the screen keeps its diagonal without overflowing', () => {
  const { scene, layer, cleanup } = setup();
  const dimensions = televisionDimensions(55);
  const item = createFurniture({
    id: 'tv',
    kind: 'tv',
    tvDiagonalInches: 55,
    width: dimensions.screenWidth,
    height: dimensions.screenHeight,
    depth: 0.11,
    position: [5, 5],
    elevation: 0.6,
  });
  layer.setItems([item]);
  const screen = screenBounds(scene, item.id);
  near(screen.maximumWorld.x - screen.minimumWorld.x, dimensions.screenWidth);
  near(screen.maximumWorld.y - screen.minimumWorld.y, dimensions.screenHeight);
  for (const mesh of scene.meshes.filter((mesh) => mesh.metadata?.kind === 'furniture')) {
    mesh.computeWorldMatrix(true);
    const box = mesh.getBoundingInfo().boundingBox;
    assert.ok(box.minimumWorld.y >= 0.6 - 1e-6 && box.maximumWorld.y <= 0.6 + item.height + 1e-6);
  }
  cleanup();
});
