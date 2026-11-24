import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { Window } from 'happy-dom';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { buildHouse } from '../src/scene/buildHouse';
import type { Materials } from '../src/scene/materials';
import { buildWallPaint } from '../src/scene/wallPaint';
import { buildWallCutaway } from '../src/scene/wallCutaway';
import { pointInPolygon } from '../src/model/geometry';
import { parsePaintOverrides, wallSideSpans, withPaint } from '../src/model/paint';
import { validateProject } from '../src/model/validate';
import { packShareDocument, unpackShareDocument } from '../src/model/linkPacker';
import type { HouseProject, Level, Wall } from '../src/model/types';
import { roomPaintHtml, syncRoomPaint } from '../src/ui/roomPanels';

const project: HouseProject = validateProject(
  JSON.parse(readFileSync('public/projects/maison-atelier.json', 'utf8')),
);

function square(): Level {
  // Two rooms side by side along the bottom wall, split by a partition at x = 4.
  const wall = (id: string, start: [number, number], end: [number, number]): Wall => ({
    id,
    start,
    end,
    thickness: 0.2,
  });
  return {
    id: 'rdc',
    name: 'Rez-de-chaussée',
    elevation: 0,
    ceilingHeight: 2.5,
    outline: [
      [-0.1, -0.1],
      [8.1, -0.1],
      [8.1, 4.1],
      [-0.1, 4.1],
    ],
    walls: [
      {
        ...wall('bas', [0, 0], [8, 0]),
        exterior: true,
        openings: [{ id: 'fenetre', kind: 'window', offset: 1, width: 1, height: 1, sill: 1 }],
      },
      { ...wall('droite', [8, 0], [8, 4]), exterior: true },
      { ...wall('haut', [8, 4], [0, 4]), exterior: true },
      { ...wall('gauche', [0, 4], [0, 0]), exterior: true },
      wall('cloison', [4, 0], [4, 4]),
    ],
    rooms: [
      {
        id: 'a',
        name: 'A',
        kind: 'living',
        polygon: [
          [0.1, 0.1],
          [3.9, 0.1],
          [3.9, 3.9],
          [0.1, 3.9],
        ],
        label: [2, 2],
        viewpoint: [2, 2],
        wallColor: '#b9c4ab',
      },
      {
        id: 'b',
        name: 'B',
        kind: 'bedroom',
        polygon: [
          [4.1, 0.1],
          [7.9, 0.1],
          [7.9, 3.9],
          [4.1, 3.9],
        ],
        label: [6, 2],
        viewpoint: [6, 2],
      },
    ],
    lights: [],
    spawn: { position: [2, 2], yaw: 0 },
  };
}

function fakeMaterials(scene: Scene) {
  const material = new StandardMaterial('test', scene);
  const paints = new Map<string, StandardMaterial>();
  return {
    plaster: material,
    wood: material,
    concrete: material,
    frame: material,
    glass: material,
    metal: material,
    slab: material,
    glow: material,
    selection: material,
    paint: (color: string) => {
      if (!paints.has(color)) paints.set(color, new StandardMaterial(`paint:${color}`, scene));
      return paints.get(color)!;
    },
  } as unknown as Materials;
}

/** World-space point at the middle of a paint mesh's bounding box. */
function centre(mesh: Mesh) {
  mesh.computeWorldMatrix(true);
  mesh.refreshBoundingInfo();
  const { minimumWorld, maximumWorld } = mesh.getBoundingInfo().boundingBox;
  return Vector3.Center(minimumWorld, maximumWorld);
}

test('stored paint choices keep valid colours and nulls, and drop the rest', () => {
  assert.deepEqual(
    parsePaintOverrides({
      rdc: { a: '#B9C4AB', b: null, c: 'rouge', d: 3 },
      etage: 'oops',
      vide: {},
    }),
    { rdc: { a: '#b9c4ab', b: null } },
  );
  assert.deepEqual(parsePaintOverrides(null), {});
  assert.deepEqual(parsePaintOverrides([1]), {});
});

test('local paint overrides the project colour and never touches the stored project', () => {
  const level = square();
  const stored: HouseProject = { ...project, levels: [level] };
  const painted = withPaint(stored, { rdc: { a: null, b: '#34495e' } });
  const [a, b] = painted.levels[0].rooms;
  assert.equal(a.wallColor, undefined);
  assert.equal(b.wallColor, '#34495e');
  // Fresh rooms even without a choice: painting the result must not reach the original.
  const untouched = withPaint(stored, {});
  untouched.levels[0].rooms[0].wallColor = '#000000';
  assert.equal(level.rooms[0].wallColor, '#b9c4ab');
  assert.equal(level.rooms[1].wallColor, undefined);
});

test('a wall shared by two rooms on one side is cut at their boundary', () => {
  const level = square();
  const bottom = level.walls[0];
  // Positive offset is on the left of start → end: inside the house for this wall.
  const spans = wallSideSpans(level, bottom, 0, 8, 0.11);
  assert.deepEqual(
    spans.map(({ start, end, room }) => [room.id, +start.toFixed(3), +end.toFixed(3)]),
    [
      ['a', 0.1, 3.9],
      ['b', 4.1, 7.9],
    ],
  );
  assert.deepEqual(wallSideSpans(level, bottom, 0, 8, -0.11), []);
});

test('a painted room gets paint on its own side of each wall, around the openings', () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const level = square();
  const house = buildHouse(level, scene, fakeMaterials(scene));
  const paint = house.paint;
  assert.ok(paint.length >= 4, `${paint.length} painted walls`);
  for (const mesh of paint) {
    assert.match(mesh.name, /^wall:[a-z]+:paint:a$/);
    assert.equal(mesh.isPickable, false);
    assert.equal(mesh.checkCollisions, false);
    assert.equal(mesh.material?.name, 'paint:#b9c4ab');
    const middle = centre(mesh);
    assert.ok(pointInPolygon([middle.x, middle.z], level.rooms[0].polygon), mesh.name);
  }
  // The partition is painted on room A's side only.
  const partition = paint.filter((mesh) => mesh.name.startsWith('wall:cloison:'));
  assert.equal(partition.length, 1);
  assert.ok(centre(partition[0]).x < 4);
  // The window leaves a hole: no paint vertex stands inside it.
  const facade = paint.find((mesh) => mesh.name.startsWith('wall:bas:'))!;
  const positions = facade.getVerticesData('position')!;
  for (let i = 0; i < positions.length; i += 3) {
    const [x, y] = [positions[i], positions[i + 1]];
    assert.ok(!(x > 1.001 && x < 1.999 && y > 1.001 && y < 1.999), `vertex ${x}, ${y}`);
  }
  engine.dispose();
});

test('the façade cutaway clips paint with its wall, and a repaint replaces only the paint', () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const level = square();
  const materials = fakeMaterials(scene);
  const house = buildHouse(level, scene, materials);
  const cutaway = buildWallCutaway(scene, level);
  cutaway.apply('low', [2, -10]);
  for (const mesh of house.paint) assert.ok(mesh.material?.clipPlane, mesh.name);
  cutaway.dispose();
  const plaster = scene.meshes.length - house.paint.length;
  level.rooms[0].wallColor = undefined;
  level.rooms[1].wallColor = '#34495e';
  house.paint.forEach((mesh) => mesh.dispose());
  house.paint = buildWallPaint(level, scene, materials, house.wallNodes, house.wallPieces);
  assert.ok(house.paint.every((mesh) => mesh.name.endsWith(':paint:b')));
  assert.ok(house.paint.every((mesh) => centre(mesh).x > 4));
  assert.equal(scene.meshes.length, plaster + house.paint.length);
  engine.dispose();
});

test('wall paint is validated, and travels in the share link', () => {
  const painted = structuredClone(project);
  painted.levels[0].rooms[1].wallColor = '#c9876b';
  assert.equal(validateProject(painted).levels[0].rooms[1].wallColor, '#c9876b');
  const wrong = structuredClone(project);
  (wrong.levels[0].rooms[1] as { wallColor?: unknown }).wallColor = 'rouge';
  assert.throws(() => validateProject(wrong), /peinture des murs/i);
  const unpacked = unpackShareDocument(packShareDocument(painted));
  assert.equal(unpacked.levels[0].rooms[1].wallColor, '#c9876b');
  assert.equal(unpacked.levels[0].rooms[0].wallColor, undefined);
});

test('the room card presses the current paint and updates without replacing the picker', () => {
  const window = new Window();
  const host = window.document.createElement('div');
  host.innerHTML = roomPaintHtml({ ...square().rooms[0] });
  const pressed = () =>
    [...host.querySelectorAll('[aria-pressed="true"]')].map(
      (element) => (element as unknown as HTMLElement).dataset.paint ?? 'custom',
    );
  assert.deepEqual(pressed(), ['#b9c4ab']);
  assert.equal((host.querySelector('[data-paint-clear]') as unknown as HTMLElement).hidden, false);
  const input = host.querySelector('[data-paint-custom]');
  syncRoomPaint(host as unknown as ParentNode, '#123456');
  assert.deepEqual(pressed(), ['custom']);
  assert.equal(host.querySelector('[data-paint-custom]'), input);
  assert.equal((input as unknown as HTMLInputElement).value, '#123456');
  syncRoomPaint(host as unknown as ParentNode, undefined);
  assert.deepEqual(pressed(), []);
  assert.equal((host.querySelector('[data-paint-clear]') as unknown as HTMLElement).hidden, true);
  window.close();
});
