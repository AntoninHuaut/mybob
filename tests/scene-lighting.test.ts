import assert from 'node:assert/strict';
import test from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { PointLight } from '@babylonjs/core/Lights/pointLight';
import type { Level } from '../src/model/types';
import { FIXTURE_LIGHT_INTENSITY } from '../src/scene/buildHouse';
import { INTERIOR_FIXTURE_INTENSITY } from '../src/scene/interiorAmbience';
import {
  applyFixtureLights,
  applyShadowTier,
  createSceneLighting,
  SceneLighting,
} from '../src/scene/sceneLighting';
import { EFFECT_TIERS, SHADOW_TIER } from '../src/scene/adaptiveResolution';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
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
  walls: [],
};

function fixture() {
  const engine = new NullEngine(),
    scene = new Scene(engine);
  const sky = new HemisphericLight('sky', Vector3.Up(), scene);
  sky.diffuse = Color3.FromHexString('#fff4df');
  sky.groundColor = Color3.FromHexString('#b6b4a2');
  const sun = new DirectionalLight('sun', new Vector3(0.5, -1, -0.45), scene);
  sun.position.set(-7, 18, 14);
  sun.diffuse = Color3.FromHexString('#fff5df');
  const lighting = new SceneLighting(scene, sky, sun);
  const done = () => {
    scene.dispose();
    engine.dispose();
  };
  return { scene, sky, sun, lighting, done };
}

test('plan lighting is neutral, then the 3D view and the visit get their own fill back', () => {
  const { sky, sun, lighting, done } = fixture();
  const diffuse = sky.diffuse.asArray(),
    ground = sky.groundColor.asArray();
  lighting.apply('overview', level);
  assert.equal(sun.intensity, 0.95);
  assert.equal(sky.intensity, 0.45, 'overview uses reduced hemispheric fill alongside sky IBL');
  lighting.apply('plan', level);
  assert.equal(sun.intensity, 0);
  assert.equal(sky.intensity, 0.9);
  assert.deepEqual(sky.diffuse.asArray(), [1, 1, 1]);
  assert.deepEqual(sky.groundColor.asArray(), [1, 1, 1]);
  lighting.apply('overview', level);
  assert.equal(sun.intensity, 0.95);
  assert.deepEqual(sky.diffuse.asArray(), diffuse);
  assert.deepEqual(sky.groundColor.asArray(), ground);
  lighting.apply('walk', level);
  assert.equal(sky.intensity, 0.42);
  assert.equal(sun.intensity, 0.95);
  assert.ok(
    sky.groundColor.r < ground[0] && sky.groundColor.g < ground[1] && sky.groundColor.b < ground[2],
    'the visit darkens the ground bounce so the interior reads top-to-bottom',
  );
  lighting.apply('overview', level);
  assert.deepEqual(sky.groundColor.asArray(), ground, 'the editor keeps its original bounce');
  done();
});

test('going from the visit to the plan and back restores the editor bounce, not the interior one', () => {
  const { sky, lighting, done } = fixture();
  const ground = sky.groundColor.asArray();
  lighting.apply('walk', level);
  lighting.apply('plan', level);
  lighting.apply('overview', level);
  assert.deepEqual(sky.groundColor.asArray(), ground);
  done();
});

test('solar previews drive the sun, keep the plan neutral and restore the initial preset', () => {
  const { sky, sun, lighting, done } = fixture();
  const initialDirection = sun.direction.clone(),
    initialPosition = sun.position.clone(),
    initialColor = sun.diffuse.asArray();
  const solar: SolarPosition = {
    altitudeDeg: 30,
    geometricAltitudeDeg: 30,
    azimuthDeg: 180,
    daylight: true,
    directionToSun: { x: 0, y: 0.5, z: Math.sqrt(0.75) },
    lightDirection: { x: 0, y: -0.5, z: -Math.sqrt(0.75) },
  };
  lighting.apply('overview', level, solar);
  assert.ok(Math.abs(sun.intensity - 0.8 * Math.sqrt(0.5)) < 1e-8);
  assert.equal(sky.intensity, 0.35);
  assert.ok(Vector3.Distance(sun.direction, new Vector3(0, -0.5, -Math.sqrt(0.75))) < 1e-8);
  const centre = new Vector3(2, level.elevation + level.ceilingHeight / 2, 2);
  assert.ok(Vector3.Distance(sun.position, centre.subtract(sun.direction.scale(30))) < 1e-8);
  lighting.apply('plan', level, solar);
  assert.equal(sun.intensity, 0);
  assert.equal(sky.intensity, 0.9);
  lighting.apply('overview', level, { ...solar, altitudeDeg: -12, daylight: false });
  assert.equal(sun.intensity, 0);
  assert.equal(sky.intensity, 0.1);
  lighting.apply('overview', level);
  assert.equal(sun.intensity, 0.95);
  assert.equal(sky.intensity, 0.45);
  assert.ok(Vector3.Distance(sun.direction, initialDirection) < 1e-8);
  assert.ok(Vector3.Distance(sun.position, initialPosition) < 1e-8);
  assert.deepEqual(sun.diffuse.asArray(), initialColor);
  done();
});

test('suppressed shadows come back exactly as they were, even when already off', () => {
  const { scene, lighting, done } = fixture();
  scene.shadowsEnabled = true;
  lighting.suppressShadows(true);
  lighting.suppressShadows(true);
  assert.equal(scene.shadowsEnabled, false);
  lighting.suppressShadows(false);
  assert.equal(scene.shadowsEnabled, true);
  scene.shadowsEnabled = false;
  lighting.suppressShadows(true);
  lighting.suppressShadows(false);
  assert.equal(scene.shadowsEnabled, false, 'a previously disabled shadow setting is restored');
  done();
});

test('ceiling fixtures are off in the plan or when switched off, brighter in the visit', () => {
  const { scene, done } = fixture();
  const point = new PointLight('fixture', new Vector3(2, 2.5, 2), scene);
  applyFixtureLights(scene, [point], 'plan', true);
  assert.equal(point.isEnabled(), false, 'plan keeps point-light hotspots disabled');
  applyFixtureLights(scene, [point], 'overview', true);
  assert.equal(point.isEnabled(), true);
  assert.equal(point.intensity, FIXTURE_LIGHT_INTENSITY);
  applyFixtureLights(scene, [point], 'walk', true);
  assert.equal(point.intensity, INTERIOR_FIXTURE_INTENSITY);
  applyFixtureLights(scene, [point], 'walk', false);
  assert.equal(point.isEnabled(), false);
  done();
});

test('the built sun starts off the level corner and casts shadows', () => {
  const engine = new NullEngine(),
    scene = new Scene(engine);
  const { lighting, shadow } = createSceneLighting(scene, level);
  assert.equal(shadow.getLight(), lighting.sun);
  assert.ok(
    Vector3.Distance(lighting.sun.position, new Vector3(-7, level.elevation + 16, 14)) < 1e-8,
  );
  scene.dispose();
  engine.dispose();
});

test('the shadow tier lowers the sun shadow filtering, and a lower tier restores it', () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  try {
    const { shadow } = createSceneLighting(scene, level);
    const full = shadow.filteringQuality;
    assert.equal(applyShadowTier(shadow, SHADOW_TIER - 1), false, 'nothing changes below it');
    assert.equal(applyShadowTier(shadow, SHADOW_TIER), true);
    assert.equal(shadow.filteringQuality, ShadowGenerator.QUALITY_LOW);
    assert.equal(applyShadowTier(shadow, EFFECT_TIERS), false, 'already lowered');
    assert.equal(applyShadowTier(shadow, 0), true);
    assert.equal(shadow.filteringQuality, full);
  } finally {
    scene.dispose();
    engine.dispose();
  }
});
