import assert from 'node:assert/strict';
import test from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { FurnitureLayer } from '../src/furniture/layer';
import { createFurniture } from '../src/furniture/model';
import type { Level } from '../src/model/types';

test('a constant furniture depth is distinguishable from an equal gap that changes when moved', () => {
  const level: Level = {
    id: 'generic',
    name: 'Pièce',
    elevation: 0,
    ceilingHeight: 3,
    outline: [
      [0, 0],
      [8, 0],
      [8, 6],
      [0, 6],
    ],
    walls: [],
    rooms: [],
    lights: [],
    spawn: { position: [3, 3], yaw: 0 },
  };
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const layer = new FurnitureLayer(scene, level);
  const item = createFurniture({
    id: 'table',
    kind: 'coffee-table',
    width: 1.2,
    depth: 0.6,
    position: [1.2, 3],
  });
  layer.setItems([item]);
  layer.select(item.id);
  layer.setOverlays({ distances: true, clearances: false, openings: false });
  const overlay = (name: string) =>
    scene.meshes.filter((mesh) => mesh.name === name).map((mesh) => mesh.metadata);
  assert.equal(overlay('furniture:width')[0].labelText, 'Larg. 1.20 m');
  assert.equal(overlay('furniture:depth')[0].labelText, 'Prof. 0.60 m');
  assert.equal(overlay('furniture:depth')[0].measurementKind, 'depth');
  assert.ok(
    overlay('furniture:wall-distance').some(
      (meta) => meta.labelText === 'Écart 0.60 m' && meta.measurementKind === 'gap',
    ),
  );
  layer.setItems([{ ...item, position: [1.5, 3] }]);
  assert.equal(overlay('furniture:depth')[0].labelText, 'Prof. 0.60 m');
  assert.ok(overlay('furniture:wall-distance').some((meta) => meta.labelText === 'Écart 0.90 m'));
  assert.ok(!overlay('furniture:wall-distance').some((meta) => meta.labelText === 'Écart 0.60 m'));
  layer.dispose();
  scene.dispose();
  engine.dispose();
});
