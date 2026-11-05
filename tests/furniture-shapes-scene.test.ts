import assert from 'node:assert/strict';
import test from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Ray } from '@babylonjs/core/Culling/ray';
import { FurnitureLayer } from '../src/furniture/layer';
import { createFurniture, FURNITURE_PRESETS, type FurnitureItem } from '../src/furniture/model';
import type { Level } from '../src/model/types';

const level: Level = {
  id: 'test',
  name: 'Test',
  elevation: 2,
  ceilingHeight: 3,
  outline: [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ],
  walls: [],
  rooms: [],
  lights: [],
  spawn: { position: [3, 3], yaw: 0 },
};
function setup() {
  const engine = new NullEngine();
  const scene = new Scene(engine);
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

function boundsCheck(scene: Scene, item: FurnitureItem) {
  const c = Math.cos(item.rotation),
    s = Math.sin(item.rotation);
  const baseY = level.elevation + (item.elevation ?? 0);
  for (const mesh of scene.meshes.filter((mesh) => mesh.metadata?.kind === 'furniture')) {
    mesh.computeWorldMatrix(true);
    assert.equal(mesh.checkCollisions, true);
    for (const point of mesh.getBoundingInfo().boundingBox.vectorsWorld) {
      const dx = point.x - item.position[0],
        dz = point.z - item.position[1];
      const x = dx * c - dz * s,
        z = dx * s + dz * c;
      assert.ok(Math.abs(x) <= item.width / 2 + 1e-6, `${item.kind}: width ${x}`);
      assert.ok(Math.abs(z) <= item.depth / 2 + 1e-6, `${item.kind}: depth ${z}`);
      assert.ok(
        point.y >= baseY - 1e-6 && point.y <= baseY + item.height + 1e-6,
        `${item.kind}: height ${point.y}`,
      );
    }
  }
}

test('every furniture preset renders recognisable parts inside its dimensions, including elevation', () => {
  const { scene, layer, cleanup } = setup();
  for (const kind of Object.keys(FURNITURE_PRESETS) as FurnitureItem['kind'][]) {
    const item = createFurniture({ kind, position: [3, 3], elevation: 0.6 });
    layer.setItems([item]);
    boundsCheck(scene, item);
    assert.ok(scene.meshes.length > 0);
    assert.equal(scene.getTransformNodeByName(`furniture:${item.id}`)!.position.y, 2.6);
  }
  cleanup();
});

test('corner and chaise sofas have no pickable or colliding mesh in the L void on either side', () => {
  const { scene, layer, cleanup } = setup();
  for (const side of ['left', 'right'] as const)
    for (const shape of ['corner', 'chaise'] as const)
      for (const rotation of [0, Math.PI / 2, Math.PI / 3]) {
        const item = createFurniture({
          kind: 'sofa',
          position: [4, 4],
          width: 3,
          depth: 2,
          height: 0.9,
          rotation,
          sofa: { side, shape, seatDepth: 0.9, returnWidth: 1 },
        });
        layer.setItems([item]);
        boundsCheck(scene, item);
        const meshes = scene.meshes.filter((mesh) => mesh.metadata?.kind === 'furniture');
        const world = (x: number, y: number, z: number) =>
          new Vector3(
            4 + x * Math.cos(rotation) + z * Math.sin(rotation),
            y,
            4 - x * Math.sin(rotation) + z * Math.cos(rotation),
          );
        const down = (x: number, z: number) =>
          new Ray(world(x, 5, z), new Vector3(0, -1, 0)).intersectsMeshes(meshes);
        const sign = side === 'left' ? -1 : 1;
        assert.equal(down(-sign * 0.75, 0.6).length, 0, `${shape}/${side}: L void`);
        assert.ok(down(sign, 0.6).length > 0, `${shape}/${side}: return seating`);
        assert.ok(down(0, -0.7).length > 0, `${shape}/${side}: main seating`);
        // The outer return backrest exists for a true corner, but leaves a chaise open.
        const ray = new Ray(world(sign * 1.46, 3, 0.6), new Vector3(0, -1, 0), 0.15);
        assert.equal(ray.intersectsMeshes(meshes).length > 0, shape === 'corner');
      }
  cleanup();
});

test('changing sofa side rebuilds its actual mesh while moving or elevating reuses it', () => {
  const { scene, layer, cleanup } = setup();
  const item = createFurniture({
    kind: 'sofa',
    width: 3,
    depth: 2,
    sofa: { shape: 'chaise', side: 'left', seatDepth: 0.9, returnWidth: 1 },
  });
  layer.setItems([item]);
  const original = scene.getTransformNodeByName(`furniture:${item.id}`)!;
  layer.setItems([{ ...item, position: [3, 3], elevation: 0.4 }]);
  assert.equal(scene.getTransformNodeByName(`furniture:${item.id}`), original);
  assert.equal(original.position.y, 2.4);
  layer.setItems([{ ...item, sofa: { ...item.sofa!, side: 'right' } }]);
  assert.notEqual(scene.getTransformNodeByName(`furniture:${item.id}`), original);
  cleanup();
});
