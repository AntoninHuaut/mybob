import assert from 'node:assert/strict';
import test from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import type { Level } from '../src/model/types';
import { buildHouse } from '../src/scene/buildHouse';
import type { Materials } from '../src/scene/materials';
import { buildPlanOpenings } from '../src/scene/planOpenings';
import { buildWallCutaway } from '../src/scene/wallCutaway';
import { HouseViewer } from '../src/scene/viewer';
import type { SolarPosition } from '../src/scene/solar';

const level: Level = {
  id: 'level',
  name: 'Test',
  elevation: 2.8,
  ceilingHeight: 2.5,
  outline: [
    [0, 0],
    [4, 0],
    [4, 4],
    [0, 4],
  ],
  rooms: [],
  lights: [],
  spawn: { position: [1, 1], yaw: 0 },
  walls: [
    {
      id: 'north',
      start: [0, 0],
      end: [4, 0],
      thickness: 0.3,
      exterior: true,
      openings: [{ id: 'bay', kind: 'sliding', offset: 1, width: 2, height: 2.15 }],
    },
    { id: 'east', start: [4, 0], end: [4, 4], thickness: 0.3, exterior: true },
    { id: 'south', start: [4, 4], end: [0, 4], thickness: 0.3, exterior: true },
    { id: 'west', start: [0, 4], end: [0, 0], thickness: 0.3, exterior: true },
    { id: 'partition', start: [2, 1], end: [2, 3], thickness: 0.1 },
  ],
};

function fixture() {
  const engine = new NullEngine(),
    scene = new Scene(engine);
  const material = new StandardMaterial('shared-plaster', scene);
  const materials = Object.fromEntries(
    ['plaster', 'wood', 'concrete', 'frame', 'glass', 'metal', 'slab', 'glow', 'selection'].map(
      (key) => [key, material],
    ),
  ) as unknown as Materials;
  buildHouse(level, scene, materials);
  const facade = MeshBuilder.CreateBox('facade', { width: 4, height: 2.5, depth: 0.02 }, scene);
  facade.material = material;
  facade.metadata = { kind: 'exterior', exteriorKind: 'facade', wallId: 'north' };
  const furniture = MeshBuilder.CreateBox('furniture', { height: 2 }, scene);
  furniture.material = material;
  const floor = scene.getMeshByName('finished-floor')!;
  const markers = buildPlanOpenings(scene, level),
    cutaway = buildWallCutaway(scene, level);
  const orbit = new ArcRotateCamera('orbit', 0, 0.7, 8, Vector3.Zero(), scene);
  orbit.position.set(2, 8, -5);
  const viewer = Object.assign(Object.create(HouseViewer.prototype), {
    scene,
    level,
    orbit,
    mode: 'overview',
    exteriorView: false,
    sectionHeight: undefined,
    planOpenings: markers,
    wallCutaway: cutaway,
  }) as HouseViewer;
  return { engine, scene, material, markers, cutaway, viewer, floor, furniture, facade };
}

test('automatic display lowers only near exterior walls and preserves shared floor/furniture materials', () => {
  const { engine, scene, material, markers, cutaway, viewer, floor, furniture, facade } = fixture();
  viewer.setSectionHeight(undefined);
  const north = scene.getMeshByName('wall:north:0')!,
    south = scene.getMeshByName('wall:south:0')!,
    partition = scene.getMeshByName('wall:partition:0')!;
  assert.notEqual(north.material, material, 'auto is the default display');
  assert.equal(south.material, material);
  assert.equal(partition.material, material);
  assert.equal(facade.material, north.material, 'exterior render follows the same cut');
  assert.equal(floor.material, material);
  assert.equal(furniture.material, material);
  assert.ok(material.clipPlane == null);
  assert.equal(scene.clipPlane, null, 'automatic mode never globally clips furniture');
  assert.ok(Math.abs(north.material!.clipPlane!.d + 3.9) < 1e-8);
  assert.ok(north.material!.clipPlane!.dotCoordinate(new Vector3(0, 3.8, 0)) < 0);
  assert.ok(north.material!.clipPlane!.dotCoordinate(new Vector3(0, 4.1, 0)) > 0);
  assert.equal(north.checkCollisions, true);
  assert.equal(north.visibility, 1);
  assert.equal(north.isPickable, false);
  assert.ok(markers.wallCaps.some((mesh) => mesh.isEnabled()));
  assert.ok(
    markers.wallCaps
      .filter((mesh) => mesh.isEnabled())
      .every((mesh) => mesh.metadata.wallId === 'north'),
  );
  assert.ok(markers.meshes.every((mesh) => !mesh.isEnabled()));
  const count = scene.materials.length;
  for (let frame = 0; frame < 100; frame++) cutaway.apply('auto', [2, -5]);
  assert.equal(scene.materials.length, count, 'materials are cached, never cloned every frame');
  cutaway.dispose();
  markers.dispose();
  scene.dispose();
  engine.dispose();
});

test('full, low and automatic modes restore originals and adapt to orbit direction', () => {
  const { engine, scene, material, cutaway, markers, viewer } = fixture();
  const north = scene.getMeshByName('wall:north:0')!,
    south = scene.getMeshByName('wall:south:0')!,
    partition = scene.getMeshByName('wall:partition:0')!;
  viewer.setWallDisplay('low');
  assert.notEqual(north.material, material);
  assert.notEqual(south.material, material);
  assert.notEqual(partition.material, material);
  assert.ok(
    markers.wallCaps.some((mesh) => mesh.isEnabled() && mesh.metadata.wallId === 'partition'),
  );
  viewer.setWallDisplay('full');
  for (const mesh of [north, south, partition]) {
    assert.equal(mesh.material, material);
    assert.equal(mesh.isPickable, true);
  }
  assert.ok(markers.wallCaps.every((mesh) => !mesh.isEnabled()));
  viewer.orbit.position.set(2, 8, 9);
  viewer.setCutaway(true);
  assert.equal(north.material, material);
  assert.notEqual(south.material, material);
  assert.equal(partition.material, material);
  viewer.setCutaway(false);
  assert.equal(south.material, material);
  cutaway.dispose();
  markers.dispose();
  scene.dispose();
  engine.dispose();
});

test('plan, first person, exterior and explicit height cuts take priority over automatic wall display', () => {
  const { engine, scene, material, cutaway, markers, viewer } = fixture();
  const north = scene.getMeshByName('wall:north:0')!;
  viewer.setWallDisplay('auto');
  viewer.mode = 'plan';
  viewer.setSectionHeight(undefined);
  assert.equal(north.material, material);
  assert.ok(Math.abs(scene.clipPlane!.d + 4) < 1e-8);
  assert.ok(markers.meshes.every((mesh) => mesh.isEnabled()));
  viewer.mode = 'walk';
  viewer.setSectionHeight(undefined);
  assert.equal(scene.clipPlane, null);
  assert.equal(north.material, material);
  assert.equal(north.isPickable, true);
  assert.ok(markers.wallCaps.every((mesh) => !mesh.isEnabled()));
  viewer.mode = 'overview';
  Object.assign(viewer, { exteriorView: true });
  viewer.setSectionHeight(undefined);
  assert.equal(north.material, material);
  assert.equal(scene.clipPlane, null);
  Object.assign(viewer, { exteriorView: false });
  viewer.setSectionHeight(0.8);
  assert.equal(north.material, material, 'explicit global cut takes priority');
  assert.ok(Math.abs(scene.clipPlane!.d + 3.6) < 1e-8);
  assert.ok(
    markers.wallCaps.some((mesh) => mesh.isEnabled() && mesh.metadata.wallId === 'partition'),
  );
  viewer.setSectionHeight(undefined);
  assert.notEqual(north.material, material);
  cutaway.dispose();
  markers.dispose();
  scene.dispose();
  engine.dispose();
});

test('plan lighting is neutral and shadow-free, then restores 3D and visit light settings', () => {
  const { engine, scene, viewer, cutaway, markers } = fixture();
  const sky = new HemisphericLight('sky', Vector3.Up(), scene);
  sky.diffuse = Color3.FromHexString('#fff4df');
  sky.groundColor = Color3.FromHexString('#b6b4a2');
  const diffuse = sky.diffuse.asArray(),
    ground = sky.groundColor.asArray();
  const sun = new DirectionalLight('sun', new Vector3(0.5, -1, -0.45), scene);
  const point = new PointLight('fixture', new Vector3(2, 2.5, 2), scene);
  const ceiling = MeshBuilder.CreateBox('ceiling', {}, scene);
  Object.assign(viewer, {
    hemispheric: sky,
    sun,
    lightOn: true,
    ceilingOn: false,
    house: { ceiling, fixtures: [], pointLights: [point], highlights: new Map() },
  });
  const update = () => (viewer as unknown as { updateLighting(): void }).updateLighting();
  viewer.setWallDisplay('full');
  update();
  assert.equal(sun.intensity, 0.95);
  assert.equal(sky.intensity, 0.55);
  viewer.mode = 'plan';
  update();
  assert.equal(scene.shadowsEnabled, false);
  assert.equal(sun.intensity, 0);
  assert.equal(point.isEnabled(), false);
  assert.deepEqual(sky.diffuse.asArray(), [1, 1, 1]);
  assert.deepEqual(sky.groundColor.asArray(), [1, 1, 1]);
  viewer.setLights(false);
  viewer.setLights(true);
  assert.equal(point.isEnabled(), false, 'plan keeps point-light hotspots disabled');
  viewer.mode = 'overview';
  update();
  assert.equal(scene.shadowsEnabled, true);
  assert.equal(sun.intensity, 0.95);
  assert.equal(sky.intensity, 0.55);
  assert.deepEqual(sky.diffuse.asArray(), diffuse);
  assert.deepEqual(sky.groundColor.asArray(), ground);
  assert.equal(point.isEnabled(), true);
  scene.shadowsEnabled = false;
  viewer.mode = 'plan';
  update();
  viewer.mode = 'walk';
  update();
  assert.equal(
    scene.shadowsEnabled,
    false,
    'a previously disabled shadow setting is restored exactly',
  );
  assert.equal(sky.intensity, 0.42);
  assert.equal(sun.intensity, 0.95);
  assert.equal(ceiling.isEnabled(), true);
  assert.ok(
    sky.groundColor.r < ground[0] && sky.groundColor.g < ground[1] && sky.groundColor.b < ground[2],
    'the visit darkens the ground bounce so the interior reads top-to-bottom',
  );
  viewer.mode = 'overview';
  update();
  assert.deepEqual(sky.groundColor.asArray(), ground, 'the editor keeps its original bounce');
  cutaway.dispose();
  markers.dispose();
  scene.dispose();
  engine.dispose();
});

test('entering the plan straight from the visit snapshots the editor bounce, not the interior one', () => {
  const { engine, scene, viewer, cutaway, markers } = fixture();
  const sky = new HemisphericLight('sky', Vector3.Up(), scene);
  sky.groundColor = Color3.FromHexString('#b6b4a2');
  const ground = sky.groundColor.asArray();
  const sun = new DirectionalLight('sun', new Vector3(0.5, -1, -0.45), scene);
  const ceiling = MeshBuilder.CreateBox('ceiling', {}, scene);
  Object.assign(viewer, {
    hemispheric: sky,
    sun,
    lightOn: true,
    ceilingOn: false,
    house: { ceiling, fixtures: [], pointLights: [], highlights: new Map() },
  });
  const update = () => (viewer as unknown as { updateLighting(): void }).updateLighting();
  viewer.setWallDisplay('full');
  viewer.mode = 'walk';
  update();
  viewer.mode = 'plan';
  update();
  const snapshot = (viewer as unknown as { planLighting?: { ground: Color3 } }).planLighting;
  assert.deepEqual(
    snapshot?.ground.asArray(),
    ground,
    'the plan must not inherit the darker visit bounce',
  );
  viewer.mode = 'overview';
  update();
  assert.deepEqual(sky.groundColor.asArray(), ground);
  cutaway.dispose();
  markers.dispose();
  scene.dispose();
  engine.dispose();
});

test('solar previews drive the directional light, preserve neutral plan and restore the initial preset', () => {
  const { engine, scene, viewer, cutaway, markers } = fixture();
  const sky = new HemisphericLight('sky', Vector3.Up(), scene);
  const sun = new DirectionalLight('sun', new Vector3(0.5, -1, -0.45), scene);
  sun.position.set(-7, 18, 14);
  sun.diffuse = Color3.FromHexString('#fff5df');
  const initialDirection = sun.direction.clone(),
    initialPosition = sun.position.clone(),
    initialColor = sun.diffuse.asArray();
  const ceiling = MeshBuilder.CreateBox('ceiling', {}, scene);
  Object.assign(viewer, {
    hemispheric: sky,
    sun,
    lightOn: true,
    ceilingOn: false,
    house: { ceiling, fixtures: [], pointLights: [], highlights: new Map() },
  });
  const solar: SolarPosition = {
    altitudeDeg: 30,
    geometricAltitudeDeg: 30,
    azimuthDeg: 180,
    daylight: true,
    directionToSun: { x: 0, y: 0.5, z: Math.sqrt(0.75) },
    lightDirection: { x: 0, y: -0.5, z: -Math.sqrt(0.75) },
  };
  viewer.setWallDisplay('full');
  viewer.setSolar(solar);
  assert.ok(Math.abs(sun.intensity - 0.8 * Math.sqrt(0.5)) < 1e-8);
  assert.equal(sky.intensity, 0.35);
  assert.equal(scene.shadowsEnabled, true);
  assert.ok(Vector3.Distance(sun.direction, new Vector3(0, -0.5, -Math.sqrt(0.75))) < 1e-8);
  const centre = new Vector3(2, level.elevation + level.ceilingHeight / 2, 2);
  assert.ok(Vector3.Distance(sun.position, centre.subtract(sun.direction.scale(30))) < 1e-8);
  viewer.mode = 'plan';
  viewer.setSolar(solar);
  assert.equal(sun.intensity, 0);
  assert.equal(sky.intensity, 0.9);
  assert.equal(scene.shadowsEnabled, false);
  viewer.mode = 'overview';
  viewer.setSolar({ ...solar, altitudeDeg: -12, daylight: false });
  assert.equal(sun.intensity, 0);
  assert.equal(sky.intensity, 0.1);
  assert.equal(scene.shadowsEnabled, true);
  viewer.setSolar(undefined);
  assert.equal(sun.intensity, 0.95);
  assert.equal(sky.intensity, 0.55);
  assert.ok(Vector3.Distance(sun.direction, initialDirection) < 1e-8);
  assert.ok(Vector3.Distance(sun.position, initialPosition) < 1e-8);
  assert.deepEqual(sun.diffuse.asArray(), initialColor);
  viewer.setWallDisplay('auto');
  assert.equal(
    scene.shadowsEnabled,
    false,
    'lowered-wall editing remains readable without shadow artifacts',
  );
  Object.assign(viewer, { exteriorView: true });
  viewer.setWallDisplay('auto');
  assert.equal(scene.shadowsEnabled, true, 'complete exterior restores real shadows');
  cutaway.dispose();
  markers.dispose();
  scene.dispose();
  engine.dispose();
});
