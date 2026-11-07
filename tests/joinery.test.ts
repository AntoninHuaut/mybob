import assert from 'node:assert/strict';
import test from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { buildHouse, poseDoor } from '../src/scene/buildHouse';
import type { Materials } from '../src/scene/materials';
import type { Level } from '../src/model/types';

const near = (actual: number, expected: number, tolerance = 0.001) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≠ ${expected}`);

function sceneFor(walls: Level['walls']) {
  const engine = new NullEngine(),
    scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  const material = new StandardMaterial('test', scene);
  const materials = {
    plaster: material,
    wood: material,
    concrete: material,
    frame: material,
    glass: material,
    metal: material,
    slab: material,
    glow: material,
    selection: material,
  } as unknown as Materials;
  const level: Level = {
    id: 'rdc',
    name: 'RDC',
    elevation: 0,
    ceilingHeight: 2.5,
    outline: [
      [0, 0],
      [8, 0],
      [8, 6],
      [0, 6],
    ],
    walls,
    rooms: [
      {
        id: 'sejour',
        name: 'Séjour',
        kind: 'living',
        polygon: [
          [0.2, 0.2],
          [7.8, 0.2],
          [7.8, 5.8],
          [0.2, 5.8],
        ],
        label: [4, 3],
        viewpoint: [4, 3],
      },
    ],
    lights: [],
    spawn: { position: [4, 3], yaw: 0 },
  };
  const house = buildHouse(level, scene, materials);
  scene.meshes.forEach((mesh) => mesh.computeWorldMatrix(true));
  return { engine, scene, house };
}

test('a sliding window with a sill sits on its apron wall and slides sideways', () => {
  const { engine, scene, house } = sceneFor([
    {
      id: 'nord',
      start: [0, 0.15],
      end: [8, 0.15],
      thickness: 0.3,
      exterior: true,
      openings: [
        { id: 'coulissante', kind: 'sliding', offset: 2, width: 1.8, height: 1.05, sill: 1.1 },
      ],
    },
  ]);
  const door = house.doors.find((d) => d.id === 'coulissante')!;
  assert.ok(door, 'a silled sliding window is a door instance');
  const panel = scene.getMeshByName('sliding-panel:coulissante')!;
  const fixed = scene.getMeshByName('sliding-fixed:coulissante')!;
  const apron = scene.getMeshByName('sill:coulissante')!;
  assert.ok(panel && fixed && apron);
  const box = panel.getBoundingInfo().boundingBox;
  near(box.minimumWorld.y, 1.1 + 0.035, 0.03);
  near(box.maximumWorld.y, 1.1 + 1.05 - 0.035, 0.03);
  door.progress = 1;
  poseDoor(door);
  near(panel.position.x, (1.8 - 0.05) / 4 + (1.8 - 0.05) / 2);
  // The moving half is now behind the fixed half, still inside the opening.
  assert.ok(panel.position.x < door.opening.offset + door.opening.width);
  scene.dispose();
  engine.dispose();
});

test('a glazed door swings open like a French window and keeps a glass pane', () => {
  const { engine, scene, house } = sceneFor([
    {
      id: 'sud',
      start: [0, 5.85],
      end: [8, 5.85],
      thickness: 0.3,
      exterior: true,
      openings: [
        {
          id: 'porte-fenetre',
          kind: 'door',
          offset: 2,
          width: 1.2,
          height: 2.15,
          exterior: true,
          glazed: true,
          hinge: 'start',
          swing: 1,
        },
      ],
    },
  ]);
  const door = house.doors.find((d) => d.id === 'porte-fenetre')!;
  assert.ok(door, 'a glazed exterior door is an openable door instance');
  assert.equal(door.open, false, 'an exterior French window starts closed');
  const pane = scene.getMeshByName('door-pane:porte-fenetre')!;
  const stile = scene.getMeshByName('door-stile:porte-fenetre:0')!;
  const rail = scene.getMeshByName('door-rail:porte-fenetre:1')!;
  assert.ok(pane && stile && rail);
  assert.deepEqual(pane.metadata, { kind: 'door', id: 'porte-fenetre' });
  const closed = door.pivot.rotation.y;
  near(closed, 0);
  door.progress = 1;
  poseDoor(door);
  near(door.pivot.rotation.y, Math.PI / 2);
  scene.dispose();
  engine.dispose();
});
