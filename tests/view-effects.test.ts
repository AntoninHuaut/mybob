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

test('walk effects release their environment on exit and preserve a later owner', () => {
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
    assert.equal(scene.environmentTexture, null);
    assert.equal(scene.environmentIntensity, 1);
    effects.updateWalk(state);
    effects.updateWalk({ ...state, active: false });
    assert.equal(scene.environmentTexture, null);
    assert.equal(scene.environmentIntensity, 1);
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

test('mode environment selection reuses sky, removes it in Plan and disposes once', () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  let builds = 0;
  const sky = new Texture(null, scene);
  const effects = new ViewEffects(
    scene,
    {
      environment: () => undefined,
      taa: () => undefined,
      occlusion: () => undefined,
      bloom: () => undefined,
      orbitBloom: () => undefined,
    },
    () => {
      builds++;
      return sky;
    },
  );
  try {
    const direction = new Vector3(-1, -1, 0);
    effects.updateEnvironment('overview', direction);
    assert.equal(scene.environmentTexture, sky);
    effects.updateEnvironment('plan', direction);
    assert.equal(scene.environmentTexture, null);
    effects.updateEnvironment('overview', direction);
    assert.equal(scene.environmentTexture, sky);
    assert.equal(builds, 1);
    effects.dispose();
    assert.equal(scene.environmentTexture, null);
  } finally {
    scene.dispose();
    engine.dispose();
  }
});

test('solar rebuilds coalesce snapshots, invalidate rendering and dispose replaced textures once', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const directions: number[][] = [];
  const textures: Texture[] = [];
  const disposals: ReturnType<typeof t.mock.method>[] = [];
  let invalidations = 0;
  const effects = new ViewEffects(
    scene,
    undefined,
    (_scene, direction) => {
      directions.push(direction.asArray());
      const texture = new Texture(null, scene);
      textures.push(texture);
      disposals.push(t.mock.method(texture, 'dispose'));
      return texture;
    },
    () => invalidations++,
  );
  try {
    effects.updateEnvironment('overview', new Vector3(0, -1, 0));
    assert.equal(effects.status(false).environment, true);
    const latest = new Vector3(1, -1, 0);
    effects.updateEnvironment('overview', new Vector3(-1, -1, 0));
    t.mock.timers.tick(100);
    effects.updateEnvironment('overview', latest);
    latest.set(99, 99, 99);
    t.mock.timers.tick(149);
    assert.equal(textures.length, 1);
    t.mock.timers.tick(1);
    assert.deepEqual(directions, [
      [0, -1, 0],
      [1, -1, 0],
    ]);
    assert.equal(invalidations, 2, 'async replacement requests a frame');
    assert.equal(disposals[0].mock.callCount(), 1);
    effects.updateEnvironment('overview', new Vector3(1, -1, 0));
    t.mock.timers.tick(1000);
    assert.equal(textures.length, 2, 'snapshot key agrees with generated texture');
    effects.dispose();
    effects.dispose();
    assert.equal(disposals[0].mock.callCount(), 1);
    assert.equal(disposals[1].mock.callCount(), 1);
  } finally {
    scene.dispose();
    engine.dispose();
  }
});

test('Plan, walk and scene disposal cancel pending solar work', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const engine = new NullEngine();
  for (const exit of ['plan', 'walk', 'dispose'] as const) {
    const scene = new Scene(engine);
    let builds = 0,
      invalidations = 0;
    const effects = new ViewEffects(
      scene,
      undefined,
      () => {
        builds++;
        return new Texture(null, scene);
      },
      () => invalidations++,
    );
    effects.updateEnvironment('overview', new Vector3(0, -1, 0));
    effects.updateEnvironment('overview', new Vector3(1, -1, 0));
    if (exit === 'dispose') scene.dispose();
    else effects.updateEnvironment(exit, new Vector3(1, -1, 0));
    const selected = scene.environmentTexture;
    t.mock.timers.tick(1000);
    assert.equal(builds, 1, exit);
    assert.equal(invalidations, 1, exit);
    assert.equal(scene.environmentTexture, selected, exit);
    if (exit === 'plan') assert.equal(effects.status(false).environment, false);
    effects.dispose();
    scene.dispose();
  }
  engine.dispose();
});

test('orbit temporal refinement waits for a rendered frame and precedes reused bloom', (t) => {
  const engine = new NullEngine(),
    scene = new Scene(engine),
    camera = new UniversalCamera('orbit', Vector3.Zero(), scene);
  let frame = 0;
  t.mock.method(scene, 'getFrameId', () => frame);
  const calls: string[] = [];
  const temporal = {
    samples: 16,
    isEnabled: true,
    factor: 0.05,
    disableOnCameraMove: true,
    dispose: () => calls.push('dispose:taa'),
  };
  const bloom = { bloomEnabled: true, dispose: () => calls.push('dispose:bloom') };
  const factories = {
    environment: () => undefined,
    taa: () => undefined,
    occlusion: () => undefined,
    bloom: () => undefined,
    orbitBloom: () => {
      calls.push('bloom');
      return bloom;
    },
    orbitTaa: () => {
      calls.push('taa');
      return temporal;
    },
  };
  const effects = new ViewEffects(scene, factories);
  try {
    effects.updateOrbit(true, camera);
    assert.deepEqual(
      calls,
      ['bloom'],
      'initial frame can render without unsupported temporal setup',
    );
    frame = 1;
    effects.updateOrbit(true, camera);
    assert.deepEqual(
      calls,
      ['bloom', 'dispose:bloom', 'taa', 'bloom'],
      'first supported temporal chain precedes bloom',
    );
    effects.updateOrbit(false, camera);
    assert.equal(temporal.isEnabled, false, 'Plan detaches temporal refinement');
    effects.updateOrbit(true, camera);
    assert.equal(temporal.isEnabled, true);
    effects.applyEffectTier(3);
    assert.equal(temporal.samples, 16, 'orbit refinement is outside walk tiers');
    effects.dispose();
    effects.dispose();
    assert.equal(calls.filter((c) => c === 'dispose:taa').length, 1);
    assert.equal(
      calls.filter((c) => c === 'bloom').length,
      2,
      'only the initial order correction rebuilds bloom',
    );
  } finally {
    scene.dispose();
    engine.dispose();
  }
});

import { createOrbitTaa } from '../src/scene/interiorAmbience';

test('real orbit temporal chain keeps motion MSAA and precedes bloom across Plan round trips', (t) => {
  const engine = new NullEngine(),
    scene = new Scene(engine),
    camera = new UniversalCamera('orbit', Vector3.Zero(), scene);
  engine.getCaps().texelFetch = true;
  t.mock.method(scene, 'getFrameId', () => 1);
  let temporal: ReturnType<typeof createOrbitTaa>;
  const effects = new ViewEffects(scene, {
    environment: () => undefined,
    taa: () => undefined,
    occlusion: () => undefined,
    bloom: () => undefined,
    orbitTaa: (s, c) => (temporal = createOrbitTaa(s, c)),
    orbitBloom: createOrbitBloom,
  });
  try {
    effects.updateOrbit(true, camera);
    assert.ok(temporal, 'capable engine creates temporal pipeline');
    assert.equal(temporal.samples, 16);
    assert.equal(temporal.msaaSamples, 4);
    assert.equal(temporal.disableOnCameraMove, true);
    assert.equal(temporal.reprojectHistory, false, 'orbit has no velocity pre-pass cost');
    const chain = camera._postProcesses.filter(Boolean);
    assert.deepEqual(
      chain.slice(0, 2).map((p) => p!.name),
      ['TAA', 'TAAPass'],
    );
    assert.ok(chain.length > 2);
    for (let i = 0; i < 3; i++) {
      effects.updateOrbit(false, camera);
      assert.equal(camera._postProcesses.filter(Boolean).length, 0);
      effects.updateOrbit(true, camera);
      assert.deepEqual(camera._postProcesses.filter(Boolean), chain);
    }
    let count = 0;
    const dispose = t.mock.method(temporal, 'dispose');
    effects.renderCapture(() => {
      count++;
      assert.equal(temporal!.factor, 1 / count);
      assert.equal(temporal!.disableOnCameraMove, false);
    });
    assert.equal(count, 16);
    assert.equal(temporal.disableOnCameraMove, true);
    const originalFactor = temporal.factor;
    assert.throws(
      () =>
        effects.renderCapture(() => {
          throw new Error('capture aborted');
        }),
      /capture aborted/,
    );
    assert.equal(temporal.factor, originalFactor);
    assert.equal(temporal.disableOnCameraMove, true);
    effects.dispose();
    effects.dispose();
    assert.equal(dispose.mock.callCount(), 1);
  } finally {
    scene.dispose();
    engine.dispose();
  }
});

import { RenderScheduler } from '../src/scene/renderScheduler';
test('orbit setup invalidates once and still reaches the scheduler idle state', () => {
  const engine = new NullEngine(),
    scene = new Scene(engine),
    camera = new UniversalCamera('orbit', Vector3.Zero(), scene);
  const scheduler = new RenderScheduler();
  let invalidations = 0;
  scene.getFrameId = () => 1;
  const effects = new ViewEffects(
    scene,
    {
      environment: () => undefined,
      taa: () => undefined,
      occlusion: () => undefined,
      bloom: () => undefined,
      orbitBloom: () => undefined,
      orbitTaa: () => ({
        samples: 16,
        isEnabled: true,
        factor: 0.05,
        disableOnCameraMove: true,
        dispose() {},
      }),
    },
    undefined,
    () => {
      invalidations++;
      scheduler.request();
    },
  );
  try {
    effects.updateOrbit(true, camera);
    let rendered = 0;
    for (let frame = 0; frame < 100; frame++) {
      if (scheduler.shouldRender(frame * 8, 'same-camera', () => false)) {
        rendered++;
        effects.updateOrbit(true, camera);
      }
    }
    assert.equal(invalidations, 1);
    assert.equal(rendered, 32);
    assert.equal(scheduler.idle, true);
  } finally {
    effects.dispose();
    scene.dispose();
    engine.dispose();
  }
});

test('temporal effects are reported while the visit chain or the orbit refinement is on screen', () => {
  const { engine, scene, screen, effects, state } = setup();
  try {
    assert.equal(effects.temporalActive, false, 'nothing before the visit');
    effects.updateWalk({ ...state, effectTier: 0 });
    assert.equal(effects.temporalActive, true, 'the visit TAA and occlusion');
    effects.updateWalk({ ...state, active: false });
    assert.equal(effects.temporalActive, false, 'released with the visit');
    void screen;
  } finally {
    scene.dispose();
    engine.dispose();
  }
});

test('the orbit refinement counts only while enabled, so Plan keeps its idle redraw', () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const camera = new UniversalCamera('orbit', new Vector3(), scene);
  const temporal = {
    samples: 16,
    isEnabled: true,
    factor: 0.1,
    disableOnCameraMove: true,
    dispose() {},
  };
  const effects = new ViewEffects(scene, {
    environment: () => undefined,
    taa: () => undefined,
    occlusion: () => undefined,
    bloom: () => undefined,
    orbitBloom: () => undefined,
    orbitTaa: () => temporal,
  });
  try {
    scene.render();
    effects.updateOrbit(true, camera);
    assert.equal(effects.temporalActive, true);
    effects.updateOrbit(false, camera);
    assert.equal(effects.temporalActive, false);
  } finally {
    effects.dispose();
    scene.dispose();
    engine.dispose();
  }
});
