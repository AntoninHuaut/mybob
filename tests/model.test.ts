import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Ray } from '@babylonjs/core/Culling/ray';
import { Scene } from '@babylonjs/core/scene';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import '@babylonjs/core/Collisions/collisionCoordinator';
import { validateProject } from '../src/model/validate';
import { alongWall, bounds, pointInPolygon, polygonArea, wallSections } from '../src/model/geometry';
import { buildHouse, poseDoor, polygonMesh } from '../src/scene/buildHouse';
import type { Materials } from '../src/scene/materials';
import type { HouseProject } from '../src/model/types';
import { createWalkCamera, EYE_HEIGHT } from '../src/scene/walkCamera';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { Matrix } from '@babylonjs/core/Maths/math.vector';
import { Viewport } from '@babylonjs/core/Maths/math.viewport';
import { fitOverview, frameInsets } from '../src/scene/framing';

const load = async (name: string) => validateProject(JSON.parse(await readFile(new URL(`../public/projects/${name}.json`, import.meta.url), 'utf8')));
const main = await load('private-project');
const studio = await load('studio-demo');
const near = (actual: number, expected: number, tolerance = .001) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≠ ${expected}`);

test('both independent house projects validate, with distinct footprints and heights', () => {
  assert.equal(main.units, 'm'); assert.equal(studio.units, 'm');
  const b = bounds(main.levels[0].outline);
  near(b.width, 12.55); near(b.depth, 12.54); near(main.levels[0].ceilingHeight, 2.5);
  near(bounds(studio.levels[0].outline).width, 8); near(studio.levels[0].ceilingHeight, 2.7);
  assert.equal(main.levels[0].rooms.length, 10); assert.equal(studio.levels[0].rooms.length, 2);
});

test('documented room dimensions produce the expected areas', () => {
  const expected: Record<string, number> = { 'chambre-2': 9, 'chambre-3': 13.79, 'salle-de-bain': 5.6, wc: 1.62, garage: 16.53 };
  for (const [id, value] of Object.entries(expected)) {
    near(polygonArea(main.levels[0].rooms.find(r => r.id === id)!.polygon), value, .01);
  }
  near(main.levels[0].rooms.filter(r => r.kind !== 'garage').reduce((s, r) => s + r.planArea!, 0), 89.84);
});

test('all viewpoints and spawn points are inside their modeled spaces', () => {
  for (const project of [main, studio]) for (const l of project.levels) {
    assert.ok(pointInPolygon(l.spawn.position, l.outline));
    for (const r of l.rooms) {
      assert.ok(pointInPolygon(r.viewpoint, r.polygon), r.id);
      assert.ok(pointInPolygon(r.label, r.polygon), r.id);
    }
  }
});

test('reconstruction uncertainties remain explicit instead of silently replacing plan areas', () => {
  for (const r of main.levels[0].rooms) {
    if (Math.abs(polygonArea(r.polygon) - r.planArea!) > .1) assert.ok(r.note && r.note.length > 30, r.id);
  }
});

test('invalid imported projects reject units, duplicate ids, and overlapping or oversize openings', () => {
  const invalid = (mutate: (p: HouseProject) => void) => { const p = structuredClone(studio); mutate(p); assert.throws(() => validateProject(p)); };
  invalid(p => { (p as unknown as { units: string }).units = 'cm'; });
  invalid(p => { p.levels[0].walls[0].id = p.levels[0].id; });
  invalid(p => { p.levels[0].walls[0].openings![0].width = 30; });
  invalid(p => { p.levels[0].walls[0].openings!.push({ id: 'overlap', kind: 'window', offset: 4, width: 1, sill: 1, height: 1 }); });
  invalid(p => { p.levels[0].rooms[0].polygon = [[0, 0], [0, 0], [0, 0]]; });
  invalid(p => { p.levels[0].walls[0].openings![0].height = 8; });
});

test('solid wall sections leave a clear aperture at every door and window', () => {
  for (const p of [main, studio]) for (const l of p.levels) for (const w of l.walls) {
    const sections = wallSections(w, l.ceilingHeight);
    for (const o of w.openings ?? []) {
      const center = o.offset + o.width / 2, y = (o.sill ?? 0) + o.height / 2;
      assert.ok(!sections.some(s => center > s.start && center < s.end && y > s.bottom && y < s.top), o.id);
    }
  }
});

function sceneFor(project: HouseProject) {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  scene.collisionsEnabled = true;
  const material = new StandardMaterial('test', scene);
  const materials = { plaster: material, wood: material, concrete: material, frame: material, glass: material, metal: material, slab: material, glow: material, selection: material } as unknown as Materials;
  const house = buildHouse(project.levels[0], scene, materials);
  const update = () => { scene.meshes.forEach(m => m.computeWorldMatrix(true)); };
  update();
  return { engine, scene, house, update };
}

test('Babylon builds and disposes both models with finite geometry and real collision meshes', () => {
  for (const project of [main, studio]) {
    const { engine, scene, house } = sceneFor(project);
    assert.ok(scene.meshes.length > 20);
    assert.equal(house.doors.length, project.levels[0].walls.flatMap(w => w.openings ?? []).filter(o => o.kind !== 'window').length);
    for (const mesh of scene.meshes) {
      assert.ok(mesh.getVerticesData('position')?.every(Number.isFinite), mesh.name);
      if (mesh.name.startsWith('wall:')) assert.equal(mesh.checkCollisions, true);
    }
    assert.equal(house.ceiling.isEnabled(), false);
    scene.dispose(); assert.equal(scene.meshes.length, 0); engine.dispose();
  }
});

test('open hinged doors leave a ray-clear passage and closed doors block it', () => {
  const { engine, scene, house, update } = sceneFor(main);
  for (const door of house.doors.filter(d => d.opening.kind === 'door')) {
    const wall = main.levels[0].walls.find(w => w.openings?.some(o => o.id === door.id))!;
    const center = door.opening.offset + door.opening.width / 2;
    const a = alongWall(wall, center, -.4), b = alongWall(wall, center, .4);
    const start = new Vector3(a[0], 1.3, a[1]); const end = new Vector3(b[0], 1.3, b[1]);
    const ray = new Ray(start, end.subtract(start).normalize(), .8);
    door.progress = 0; poseDoor(door); update();
    assert.ok(ray.intersectsMesh(door.leaf, false).hit, `closed ${door.id}`);
    door.progress = 1; poseDoor(door); update();
    assert.ok(!ray.intersectsMesh(door.leaf, false).hit, `open ${door.id}`);
    const blockingWall = scene.meshes.filter(m => m.name.startsWith(`wall:${wall.id}:`)).find(m => ray.intersectsMesh(m, false).hit);
    assert.equal(blockingWall, undefined, `aperture ${door.id}`);
  }
  scene.dispose(); engine.dispose();
});

test('collisions stop movement through a solid wall', () => {
  const { engine, scene } = sceneFor(studio);
  const actor = MeshBuilder.CreateSphere('visitor-collider', { diameter: .2 }, scene);
  actor.ellipsoid = new Vector3(.17, .8, .17);
  actor.position.set(7.25, .8, 4);
  actor.computeWorldMatrix(true);
  actor.moveWithCollisions(new Vector3(1.5, 0, 0));
  assert.ok(actor.position.x < 7.7, `visitor crossed wall: x=${actor.position.x}`);
  scene.dispose(); engine.dispose();
});

test('the actual walk camera keeps eye height above the floor under gravity while moving', () => {
  const { engine, scene } = sceneFor(main);
  scene.gravity = new Vector3(0, -.25, 0);
  const camera = createWalkCamera(scene, main.levels[0]);
  const collide = camera as unknown as { _collideWithWorld: (direction: Vector3) => void };
  for (let i = 0; i < 30; i++) collide._collideWithWorld(new Vector3(.01, 0, 0));
  near(camera.position.y, EYE_HEIGHT, .03);
  assert.ok(camera.position.x > main.levels[0].spawn.position[0] + .2);
  scene.dispose(); engine.dispose();
});

test('every room is reachable from the living room with a 34 cm wide visitor', () => {
  const { engine, scene, update } = sceneFor(main);
  update();
  const level = main.levels[0], step = .06, radius = .17;
  const b = bounds(level.outline), cols = Math.ceil(b.width / step) + 1, rows = Math.ceil(b.depth / step) + 1;
  const obstacles = scene.meshes.filter(m => m.checkCollisions).map(m => m.getBoundingInfo().boundingBox).filter(box => box.minimumWorld.y < 1.3 && box.maximumWorld.y > 1.3);
  const free = (x: number, z: number) => pointInPolygon([x, z], level.outline) && !obstacles.some(box => {
    const dx = x - Math.max(box.minimumWorld.x, Math.min(x, box.maximumWorld.x));
    const dz = z - Math.max(box.minimumWorld.z, Math.min(z, box.maximumWorld.z));
    return dx * dx + dz * dz < radius * radius;
  });
  const startX = Math.round(level.spawn.position[0] / step), startZ = Math.round(level.spawn.position[1] / step);
  const seen = new Uint8Array(cols * rows), queue = [startZ * cols + startX];
  seen[queue[0]] = 1;
  for (let i = 0; i < queue.length; i++) {
    const cell = queue[i], x = cell % cols, z = Math.floor(cell / cols);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz, next = nz * cols + nx;
      if (nx >= 0 && nz >= 0 && nx < cols && nz < rows && !seen[next] && free(nx * step, nz * step)) { seen[next] = 1; queue.push(next); }
    }
  }
  for (const room of level.rooms) {
    const x = Math.round(room.viewpoint[0] / step), z = Math.round(room.viewpoint[1] / step);
    assert.equal(seen[z * cols + x], 1, `unreachable: ${room.id}`);
  }
  scene.dispose(); engine.dispose();
});

test('triangulation preserves concave footprint area', () => {
  const engine = new NullEngine(), scene = new Scene(engine);
  const points = main.levels[0].outline;
  const mesh = polygonMesh('test-floor', points, 0, scene);
  const positions = mesh.getVerticesData('position')!, indices = mesh.getIndices()!;
  let total = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
    total += Math.abs((positions[b] - positions[a]) * (positions[c + 2] - positions[a + 2]) - (positions[c] - positions[a]) * (positions[b + 2] - positions[a + 2])) / 2;
  }
  near(total, polygonArea(points));
  scene.dispose(); engine.dispose();
});

test('the whole house stays inside the visible frame in wide, narrow, and resized viewports', () => {
  for (const project of [main, studio]) for (const [width, height] of [[1020, 642], [764, 690], [640, 642], [450, 650], [1000, 500], [280, 600]]) {
    const engine = new NullEngine({ renderWidth: width, renderHeight: height, textureSize: 512, deterministicLockstep: false, lockstepMaxSteps: 4 });
    const scene = new Scene(engine), level = project.levels[0];
    const camera = new ArcRotateCamera('frame', Math.PI * .66, .66, 24, Vector3.Zero(), scene);
    camera.fov = .66;
    // Refit after zooming and panning, as the reset and resize controls do.
    camera.radius = 3; camera.target.set(20, 0, 20);
    fitOverview(camera, level, width, height);
    const transform = camera.getViewMatrix(true).multiply(camera.getProjectionMatrix(true));
    const inset = frameInsets(width, height), viewport = new Viewport(0, 0, width, height);
    for (const [x, z] of level.outline) for (const y of [level.elevation - .17, level.elevation + level.ceilingHeight]) {
      const p = Vector3.Project(new Vector3(x, y, z), Matrix.IdentityReadOnly, transform, viewport);
      assert.ok(p.x >= inset.left && p.x <= width - inset.right && p.y >= inset.top && p.y <= height - inset.bottom, `${project.id} at ${width}×${height}: (${p.x}, ${p.y})`);
    }
    scene.dispose(); engine.dispose();
  }
});
