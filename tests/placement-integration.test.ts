import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { FurnitureLayer } from '../src/furniture/layer';
import { createFurniture } from '../src/furniture/model';
import { isSceneVisitDestination, findVisitDestination } from '../src/scene/navigation';
import { validateProject } from '../src/model/validate';

const project = validateProject(
  JSON.parse(
    await readFile(new URL('../public/projects/maison-atelier.json', import.meta.url), 'utf8'),
  ),
);
const level = project.levels[0];

test('a furnished spawn cannot trap the visitor: choose another clear floor point', () => {
  const engine = new NullEngine(),
    scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  const layer = new FurnitureLayer(scene, level);
  layer.setItems([createFurniture({ kind: 'sofa', position: level.spawn.position })]);
  assert.equal(isSceneVisitDestination(scene, level, level.spawn.position), false);
  const free = findVisitDestination(scene, level, level.spawn.position);
  assert.ok(free);
  assert.equal(isSceneVisitDestination(scene, level, free), true);
  layer.dispose();
  scene.dispose();
  engine.dispose();
});
