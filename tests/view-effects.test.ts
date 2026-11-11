import assert from 'node:assert/strict';
import test from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { Camera } from '@babylonjs/core/Cameras/camera';
import { ViewEffects } from '../src/scene/viewEffects';
import { DefaultRenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline';
import { createOrbitBloom } from '../src/scene/interiorAmbience';

test('ten Plan round trips keep the orbit post-processes without rebuilding bloom', (t) => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const camera = new UniversalCamera('orbit', Vector3.Zero(), scene);
  const build = t.mock.method(
    DefaultRenderingPipeline.prototype as unknown as { _buildPipeline(): void },
    '_buildPipeline',
  );
  const effects = new ViewEffects(scene, {
    environment: () => undefined,
    taa: () => undefined,
    occlusion: () => undefined,
    bloom: () => undefined,
    orbitBloom: createOrbitBloom,
  });
  try {
    effects.updateOrbit(true, camera);
    const processes = camera._postProcesses.filter(Boolean);
    const builds = build.mock.callCount();
    assert.ok(processes.length > 0);
    for (let i = 0; i < 10; i++) {
      effects.updateOrbit(false, camera);
      effects.updateOrbit(false, camera);
      assert.equal(camera._postProcesses.filter(Boolean).length, 0, 'Plan has no bloom passes');
      effects.updateOrbit(true, camera);
      effects.updateOrbit(true, camera);
      assert.deepEqual(camera._postProcesses.filter(Boolean), processes);
    }
    assert.equal(build.mock.callCount(), builds, 'no rebuild after initial configuration');
    assert.ok(
      processes.every((process) => process?.getEffect()),
      'shaders remain owned',
    );
  } finally {
    scene.dispose();
    engine.dispose();
  }
});

function setup() {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const screen = new UniversalCamera('screen', Vector3.Zero(), scene);
  const headset = new UniversalCamera('headset', Vector3.Zero(), scene);
  const environment = new Texture(null, scene);
  const calls: string[] = [];
  const resources: {
    name: string;
    samples: number;
    expensiveBlur: boolean;
    bloomEnabled: boolean;
    disposals: number;
    dispose(): void;
  }[] = [];
  const create = (name: string, camera: Camera) => {
    calls.push(`${name}:${camera.name}`);
    const resource = {
      name,
      samples: 16,
      expensiveBlur: true,
      bloomEnabled: true,
      disposals: 0,
      dispose() {
        this.disposals++;
        calls.push(`dispose:${name}:${camera.name}`);
      },
    };
    resources.push(resource);
    return resource;
  };
  const effects = new ViewEffects(scene, {
    environment() {
      calls.push('environment');
      return environment;
    },
    taa: (_, camera) => create('taa', camera),
    occlusion: (_, camera) => create('occlusion', camera),
    bloom: (_, camera) => create('bloom', camera),
    orbitBloom: (_, camera) => create('orbit', camera),
  });
  const state = {
    active: true,
    camera: screen,
    headset: false,
    effectsEnabled: true,
    effectTier: 0,
  };
  return { engine, scene, screen, headset, effects, state, environment, calls, resources };
}

test('walk effects preserve environment and intensity and restore them on each exit', () => {
  const { engine, scene, effects, state, environment, calls } = setup();
  const original = new Texture(null, scene);
  scene.environmentTexture = original;
  scene.environmentIntensity = 0.4;
  try {
    effects.updateWalk(state);
    effects.updateWalk(state);
    assert.equal(scene.environmentTexture, environment);
    assert.deepEqual(calls, ['environment', 'taa:screen', 'occlusion:screen', 'bloom:screen']);
    effects.updateWalk({ ...state, active: false });
    assert.equal(scene.environmentTexture, original);
    assert.equal(scene.environmentIntensity, 0.4);
    effects.updateWalk(state);
    effects.updateWalk({ ...state, active: false });
    assert.equal(scene.environmentTexture, original);
    assert.equal(scene.environmentIntensity, 0.4);
    assert.equal(calls.filter((call) => call === 'environment').length, 1);
    assert.deepEqual(effects.status(false), { environment: false, occlusion: 'idle' });
    effects.updateWalk(state);
    const replacement = new Texture(null, scene);
    scene.environmentTexture = replacement;
    scene.environmentIntensity = 0.7;
    effects.updateWalk({ ...state, active: false });
    assert.equal(scene.environmentTexture, replacement, 'preserve a later environment owner');
    assert.equal(scene.environmentIntensity, 0.7);
  } finally {
    scene.dispose();
    engine.dispose();
  }
});

test('camera switches dispose the old chain before rebuilding in order, with no headset bloom', () => {
  const { engine, scene, effects, state, headset, calls, resources } = setup();
  try {
    effects.updateWalk(state);
    calls.length = 0;
    effects.updateWalk({ ...state, camera: headset, headset: true });
    assert.deepEqual(calls, [
      'dispose:occlusion:screen',
      'dispose:taa:screen',
      'dispose:bloom:screen',
      'taa:headset',
      'occlusion:headset',
    ]);
    effects.updateWalk({ ...state, camera: headset, headset: true, effectsEnabled: false });
    assert.ok(resources.every((resource) => resource.disposals === 1));
    effects.updateWalk(state);
    assert.deepEqual(calls.slice(-3), ['taa:screen', 'occlusion:screen', 'bloom:screen']);
    effects.updateOrbit(true, state.camera);
    effects.updateOrbit(false, state.camera);
    assert.equal(resources.at(-1)!.bloomEnabled, true, 'detaching does not rebuild bloom');
    effects.dispose();
    effects.dispose();
    assert.ok(resources.every((resource) => resource.disposals === 1));
    const count = calls.length;
    scene.dispose();
    assert.equal(calls.length, count, 'scene disposal does not repeat explicit cleanup');
  } finally {
    scene.dispose();
    engine.dispose();
  }
});

test('effect tiers keep lighter settings and never recreate dropped occlusion', () => {
  const { engine, scene, effects, state, resources, calls } = setup();
  try {
    effects.updateWalk({ ...state, effectTier: 2 });
    assert.equal(resources[0].samples, 8);
    assert.equal(resources[1].samples, 8);
    assert.equal(resources[1].expensiveBlur, false);
    assert.equal(effects.applyEffectTier(3), true);
    assert.equal(effects.applyEffectTier(3), false);
    effects.updateWalk({ ...state, effectTier: 3 });
    assert.equal(calls.filter((call) => call === 'occlusion:screen').length, 1);
    scene.dispose();
    assert.ok(resources.every((resource) => resource.disposals === 1));
  } finally {
    scene.dispose();
    engine.dispose();
  }
});

test('unavailable environment and occlusion are remembered only for their scene', () => {
  const engine = new NullEngine();
  let environments = 0;
  let occlusions = 0;
  try {
    for (let i = 0; i < 2; i++) {
      const scene = new Scene(engine);
      const camera = new UniversalCamera('walk', Vector3.Zero(), scene);
      const effects = new ViewEffects(scene, {
        environment() {
          environments++;
          return undefined;
        },
        occlusion() {
          occlusions++;
          return undefined;
        },
        taa: () => undefined,
        bloom: () => undefined,
        orbitBloom: () => undefined,
      });
      const state = { active: true, camera, headset: false, effectsEnabled: true, effectTier: 0 };
      for (let entry = 0; entry < 3; entry++) {
        effects.updateWalk(state);
        assert.deepEqual(effects.status(true), { environment: false, occlusion: 'unavailable' });
        effects.updateWalk({ ...state, active: false });
      }
      scene.dispose();
    }
    assert.equal(environments, 2);
    assert.equal(occlusions, 2);
  } finally {
    engine.dispose();
  }
});
