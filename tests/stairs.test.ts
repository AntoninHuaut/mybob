import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { buildHouse } from '../src/scene/buildHouse';
import type { Materials } from '../src/scene/materials';
import type { HouseProject, Level } from '../src/model/types';
import { pointInPolygon } from '../src/model/geometry';
import {
  levelAbove,
  levelBelow,
  STAIR_CLEARANCE,
  stairPassage,
  stairsDown,
} from '../src/model/stairs';

const base: HouseProject = JSON.parse(
  await readFile(new URL('../public/projects/maison-atelier.json', import.meta.url), 'utf8'),
);

/** The demonstration house with an attic: a flight from 1,1 to 1,4 rising 2.7 m into its void. */
function twoLevels(): HouseProject {
  const project = structuredClone(base);
  const ground = project.levels[0];
  ground.stairs = [{ id: 'flight', start: [1, 1], end: [1, 4], width: 0.9, steps: 15, rise: 2.7 }];
  const attic: Level = {
    ...structuredClone(ground),
    id: 'attic',
    name: 'Combles',
    elevation: ground.elevation + 2.7,
    stairs: [],
    floorVoids: [
      [
        [0.5, 1],
        [1.5, 1],
        [1.5, 4.6],
        [0.5, 4.6],
      ],
    ],
  };
  project.levels.push(attic);
  return project;
}

const near = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≠ ${expected}`);

test('the levels around a level are the nearest ones by elevation', () => {
  const project = twoLevels();
  const [ground, attic] = project.levels;
  assert.equal(levelAbove(project, ground)?.id, 'attic');
  assert.equal(levelBelow(project, attic)?.id, ground.id);
  assert.equal(levelAbove(project, attic), undefined);
  assert.equal(levelBelow(project, ground), undefined);
});

test('going up lands past the flight, out of the floor void, facing the way it climbed', () => {
  const project = twoLevels();
  const passage = stairPassage(project, project.levels[0], 'flight', 'up');
  assert.ok(passage);
  assert.equal(passage.levelId, 'attic');
  assert.deepEqual(passage.heading, [0, 1]);
  // The void reaches 4.6: 4 + 0.5 is still over it, 4 + 0.75 is not.
  near(passage.arrival[0], 1);
  near(passage.arrival[1], 4.75);
  assert.ok(!pointInPolygon(passage.arrival, project.levels[1].floorVoids![0]));
});

test('going down lands before the first riser, facing away from the flight', () => {
  const project = twoLevels();
  const attic = project.levels[1];
  assert.deepEqual(
    stairsDown(project, attic).map(({ stair, base }) => [stair.id, base.id]),
    [['flight', project.levels[0].id]],
  );
  const passage = stairPassage(project, attic, 'flight', 'down');
  assert.ok(passage);
  assert.equal(passage.levelId, project.levels[0].id);
  assert.deepEqual(passage.heading, [-0, -1]);
  near(passage.arrival[1], 1 - STAIR_CLEARANCE);
});

test('a flight whose rise misses the level above leads nowhere', () => {
  const project = twoLevels();
  project.levels[0].stairs![0].rise = 2.2;
  assert.equal(stairPassage(project, project.levels[0], 'flight', 'up'), undefined);
  assert.deepEqual(stairsDown(project, project.levels[1]), []);
  assert.equal(stairPassage(project, project.levels[0], 'missing', 'up'), undefined);
});

test('treads name their stair; the flight going down hangs in the void, never collided', () => {
  const project = twoLevels();
  const engine = new NullEngine();
  const scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  const material = new StandardMaterial('test', scene);
  const materials = new Proxy({}, { get: () => material }) as unknown as Materials;
  try {
    const ground = buildHouse(project.levels[0], scene, materials);
    const up = ground.root.getChildMeshes().filter((mesh) => mesh.metadata?.kind === 'stair');
    assert.equal(up.length, 15);
    assert.ok(up.every((mesh) => mesh.metadata.direction === 'up' && mesh.checkCollisions));
    assert.deepEqual(ground.stairsDown, []);

    const attic = project.levels[1];
    const house = buildHouse(attic, scene, materials, undefined, [], undefined, [
      ...stairsDown(project, attic),
    ]);
    assert.equal(house.stairsDown.length, 15);
    for (const step of house.stairsDown) {
      assert.deepEqual({ ...step.metadata }, { kind: 'stair', id: 'flight', direction: 'down' });
      assert.equal(step.checkCollisions, false);
      step.computeWorldMatrix(true);
      const top = step.getBoundingInfo().boundingBox.maximumWorld.y;
      assert.ok(top <= attic.elevation + 1e-6, `tread top ${top} above the attic floor`);
    }
  } finally {
    scene.dispose();
    engine.dispose();
  }
});
