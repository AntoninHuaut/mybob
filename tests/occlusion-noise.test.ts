import assert from 'node:assert/strict';
import test from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { ThinSSAO2RenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/thinSSAO2RenderingPipeline';
import type { SSAO2RenderingPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssao2RenderingPipeline';
import {
  ECONOMY_SAMPLES,
  hammersleyKernel,
  NOISE_FRAMES,
  noisePattern,
  RotatingOcclusionNoise,
  ssaoPostProcessOf,
  stillCamera,
} from '../src/scene/occlusionNoise';

test('each noise pattern is seeded, distinct, and made of unit vectors like Babylon’s', () => {
  const first = noisePattern(1, 16);
  assert.deepEqual(noisePattern(1, 16), first, 'the same seed gives the same pattern');
  assert.notDeepEqual(noisePattern(2, 16), first);
  for (let index = 0; index < first.length; index += 4) {
    const length = Math.hypot(first[index] / 255, first[index + 1] / 255);
    assert.ok(length > 0.98 && length <= 1.0001, `texel ${index / 4} has length ${length}`);
    assert.equal(first[index + 2], 0);
    assert.equal(first[index + 3], 255);
  }
});

/** The real thin pipeline, wrapped the way `SSAO2RenderingPipeline` holds it. */
function fixture() {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const camera = new FreeCamera('camera', new Vector3(0, 1, -5), scene);
  const thin = new ThinSSAO2RenderingPipeline('occlusion', scene);
  thin.samples = 16;
  const pipeline = { _thinSSAORenderingPipeline: thin } as unknown as SSAO2RenderingPipeline;
  return { engine, scene, camera, pipeline };
}

test('Babylon still keeps the noise where the candidate reaches it', () => {
  const { engine, scene, pipeline } = fixture();
  try {
    // Renovate merges Babylon updates: a renamed private field must fail here, not on the bench.
    const pass = ssaoPostProcessOf(pipeline);
    assert.ok(pass, 'ThinSSAO2RenderingPipeline._ssaoPostProcess._randomTexture');
    assert.equal(pass.samples, 16);
    assert.equal(
      ssaoPostProcessOf({} as SSAO2RenderingPipeline),
      undefined,
      'an unknown shape is refused, not guessed',
    );
  } finally {
    scene.dispose();
    engine.dispose();
  }
});

test('the noise turns only while the antialiasing accumulates, and dispose restores production', () => {
  const { engine, scene, pipeline } = fixture();
  try {
    const pass = ssaoPostProcessOf(pipeline)!;
    const original = pass._randomTexture;
    let accumulating = true;
    const noise = RotatingOcclusionNoise.apply(pipeline, scene, () => accumulating)!;
    assert.equal(pass.samples, ECONOMY_SAMPLES);
    assert.deepEqual(pass._sampleSphere, hammersleyKernel(ECONOMY_SAMPLES));
    const seen = new Set();
    for (let frame = 0; frame < NOISE_FRAMES; frame++) {
      scene.render();
      seen.add(pass._randomTexture);
    }
    assert.equal(seen.size, NOISE_FRAMES, 'one pattern per image over a cycle');
    assert.ok(!seen.has(original));
    accumulating = false;
    const held = pass._randomTexture;
    scene.render();
    scene.render();
    assert.equal(pass._randomTexture, held, 'a moving orbit keeps one pattern');
    noise.dispose(scene);
    assert.equal(pass._randomTexture, original);
    assert.equal(pass.samples, 16);
    assert.deepEqual(pass._sampleSphere, hammersleyKernel(16), 'production kernel is back');
  } finally {
    scene.dispose();
    engine.dispose();
  }
});

test('the kernel matches Babylon’s own at 16 samples and stays in the upper hemisphere', () => {
  const { engine, scene, pipeline } = fixture();
  try {
    const babylon = ssaoPostProcessOf(pipeline)!._sampleSphere!;
    const ours = hammersleyKernel(16);
    assert.equal(ours.length, babylon.length);
    ours.forEach((value, index) => assert.ok(Math.abs(value - babylon[index]) < 1e-9));
    const eight = hammersleyKernel(8);
    for (let index = 0; index < eight.length; index += 3) assert.ok(eight[index + 2] >= 0.15);
  } finally {
    scene.dispose();
    engine.dispose();
  }
});

test('the orbit accumulates only on a camera that did not move since the last image', () => {
  const { engine, scene, camera } = fixture();
  try {
    const still = stillCamera(camera);
    assert.equal(still(), false, 'the first image has no previous one');
    assert.equal(still(), true);
    camera.position.x += 1;
    assert.equal(still(), false);
    assert.equal(still(), true);
  } finally {
    scene.dispose();
    engine.dispose();
  }
});
