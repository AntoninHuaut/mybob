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
import '@babylonjs/core/Culling/ray';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { buildWallPaint, pickWallFace } from '../src/scene/wallPaint';
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
    const vertices = worldVertices(mesh);
    const normals = mesh.getVerticesData('normal')!;
    for (let i = 0; i < vertices.length; i += 4) {
      if (Math.abs(normals[i * 3 + 2]) !== 1) continue;
      const middle = Vector3.Center(vertices[i], vertices[i + 2]);
      assert.ok(pointInPolygon([middle.x, middle.z], level.rooms[0].polygon), mesh.name);
    }
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
    assert.ok(!(x > 1.01 && x < 1.99 && y > 1.01 && y < 1.99), `vertex ${x}, ${y}`);
  }
  engine.dispose();
});

/** World-space vertices of a mesh. */
function worldVertices(mesh: Mesh): Vector3[] {
  const matrix = mesh.computeWorldMatrix(true);
  const positions = mesh.getVerticesData('position')!;
  const result: Vector3[] = [];
  for (let i = 0; i < positions.length; i += 3)
    result.push(
      Vector3.TransformCoordinates(
        new Vector3(positions[i], positions[i + 1], positions[i + 2]),
        matrix,
      ),
    );
  return result;
}

test('paint wraps the reveals of an opening and a free wall end, on its own room side only', () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const level = square();
  // The partition stops short of the top wall: its end at y = 3 is free, its foot is buried.
  level.walls[4] = { ...level.walls[4], end: [4, 3] };
  const paint = buildHouse(level, scene, fakeMaterials(scene)).paint;
  const near = (a: number, b: number) => Math.abs(a - b) < 0.005;
  const facade = worldVertices(paint.find((mesh) => mesh.name.startsWith('wall:bas:'))!);
  // Window reveals at x = 1 and x = 2, soffit at y = 2 and ledge at y = 1: interior half only.
  for (const x of [1, 2])
    assert.ok(
      facade.some((v) => near(v.x, x) && v.y > 0.99 && v.y < 2.01 && near(v.z, 0)),
      `reveal at x = ${x}`,
    );
  for (const y of [1, 2])
    assert.ok(
      facade.some((v) => near(v.y, y) && v.x > 1 && v.x < 2.01 && near(v.z, 0)),
      `${y === 2 ? 'soffit' : 'ledge'}`,
    );
  assert.ok(
    facade.every((v) => v.z > -0.001),
    'nothing on the outside half',
  );
  const partition = worldVertices(paint.find((mesh) => mesh.name.startsWith('wall:cloison:'))!);
  assert.ok(
    partition.some((v) => near(v.z, 3) && v.x > 3.89 && v.x < 4.001),
    'free end painted',
  );
  assert.ok(
    partition.every((v) => v.x < 4.001),
    'room B side stays plaster',
  );
  assert.ok(!partition.some((v) => v.z < 0.0999), 'the buried foot is not painted');
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

test('a 3D pick identifies the visible room side of the partition', () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  const level = square();
  const house = buildHouse(level, scene, fakeMaterials(scene));
  const camera = new FreeCamera('brush', new Vector3(2, 1.4, 2), scene);
  camera.setTarget(new Vector3(4, 1.4, 2));
  scene.render();
  const pick = () =>
    pickWallFace(
      scene,
      level,
      house.wallNodes,
      engine.getRenderWidth() / 2,
      engine.getRenderHeight() / 2,
    );
  assert.deepEqual(pick(), { roomId: 'a', wallId: 'cloison', side: 1 });
  camera.position.x = 6;
  camera.setTarget(new Vector3(4, 1.4, 2));
  scene.render();
  assert.deepEqual(pick(), { roomId: 'b', wallId: 'cloison', side: -1 });
  engine.dispose();
});

test('a single wall face overrides the room and survives wall renumbering in a link', () => {
  const level = square();
  level.rooms[0].wallFaces = [{ wallId: 'cloison', side: 1, color: '#123456' }];
  const doc = { ...project, levels: [level] };
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const meshes = buildHouse(level, scene, fakeMaterials(scene)).paint;
  assert.deepEqual(
    meshes
      .filter((mesh) => mesh.material?.name === 'paint:#123456')
      .map((mesh) => mesh.parent?.name),
    ['wall:cloison'],
  );
  const roundTrip = unpackShareDocument(packShareDocument(doc)).levels[0];
  assert.deepEqual(roundTrip.rooms[0].wallFaces, [
    { wallId: roundTrip.walls[4].id, side: 1, color: '#123456' },
  ]);
  const restored = withPaint(
    doc,
    parsePaintOverrides({
      rdc: { a: { faces: [] }, b: { faces: [{ wallId: 'bas', side: 1, color: '#112233' }] } },
    }),
  );
  assert.equal(restored.levels[0].rooms[0].wallFaces, undefined);
  assert.equal(restored.levels[0].rooms[0].wallColor, level.rooms[0].wallColor);
  assert.equal(restored.levels[0].rooms[1].wallFaces?.[0].color, '#112233');
  const invalid = structuredClone(project);
  invalid.levels[0].rooms[0].wallFaces = [{ wallId: 'missing', side: 1, color: '#112233' }];
  assert.throws(() => validateProject(invalid), /face de mur/i);
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

test('the wall brush keeps the room colour, persists its click and exits on Escape or right-click', async (t) => {
  const win = new Window();
  for (const [key, value] of Object.entries({
    window: win,
    document: win.document,
    localStorage: win.localStorage,
    AbortController: win.AbortController,
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() =>
      previous
        ? Object.defineProperty(globalThis, key, previous)
        : Reflect.deleteProperty(globalThis, key),
    );
  }
  const { app } = await import('../src/app/state');
  const { mountRoomPaint, paintedProject, endWallBrush } = await import('../src/app/roomPaint');
  const previous = { current: app.current, viewer: app.viewer };
  const level = square();
  app.current = { ...project, levels: [level] };
  win.document.body.innerHTML = '<button id="before"></button><canvas></canvas>';
  const canvas = win.document.querySelector('canvas')!;
  app.viewer = {
    level,
    canvas,
    mode: 'overview',
    pickWallFace: () => ({ roomId: 'a', wallId: 'bas', side: 1 }),
    repaintWalls() {},
  } as unknown as typeof app.viewer;
  t.after(() => {
    endWallBrush();
    Object.assign(app, previous);
    win.close();
  });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  mountRoomPaint(level.rooms[0], document.querySelector('#before')!, () => {});
  const button = document.querySelector<HTMLButtonElement>('[data-paint-brush]')!;
  button.click();
  document.querySelector<HTMLButtonElement>('[data-paint="#34495e"]')!.click();
  assert.equal(level.rooms[0].wallFaces, undefined);
  const click = (button: number) => {
    for (const type of ['pointerdown', 'pointerup'])
      canvas.dispatchEvent(new win.PointerEvent(type, { button, bubbles: true }));
  };
  click(0);
  assert.equal(level.rooms[0].wallColor, '#b9c4ab');
  const stored = { ...project, levels: [square()] };
  assert.deepEqual(paintedProject(stored).levels[0].rooms[0].wallFaces, [
    { wallId: 'bas', side: 1, color: '#34495e' },
  ]);
  win.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(button.getAttribute('aria-pressed'), 'false');
  button.click();
  document.querySelector<HTMLButtonElement>('[data-paint-clear]')!.click();
  click(0);
  assert.equal(paintedProject(stored).levels[0].rooms[0].wallFaces, undefined);
  click(2);
  assert.equal(button.getAttribute('aria-pressed'), 'false');
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
