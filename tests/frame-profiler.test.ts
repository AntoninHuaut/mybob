import assert from 'node:assert/strict';
import test from 'node:test';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { PerfCounter } from '@babylonjs/core/Misc/perfCounter';
import {
  distribution,
  FrameRecorder,
  profileLines,
  profileView,
  summariseFrames,
  type ProfilerCounters,
} from '../src/scene/frameProfiler';

test('the distribution reads the nearest-rank median and 95th percentile', () => {
  const values = Array.from({ length: 20 }, (_, index) => index + 1).reverse();
  assert.deepEqual(distribution(values), { median: 10, p95: 19 });
  assert.deepEqual(distribution([]), { median: 0, p95: 0 });
});

function counter(values: { current: number; count?: number }): PerfCounter {
  return values as unknown as PerfCounter;
}

test('a GPU time is taken only when a new query result landed, in milliseconds', () => {
  const gpu = { current: 4_000_000, count: 3 };
  const counters: ProfilerCounters = {
    frame: counter({ current: 2 }),
    drawCalls: counter({ current: 120 }),
    selection: counter({ current: 0.3 }),
    gpu: counter(gpu),
    dispose() {},
  };
  const recorder = new FrameRecorder(counters);
  recorder.start(1000);
  recorder.record(); // the result already there at the start is not this profile's
  gpu.count = 4;
  gpu.current = 6_000_000;
  recorder.record();
  recorder.record(); // same result: not counted twice
  const profile = recorder.stop(1500);
  assert.equal(profile.frames, 3);
  assert.equal(profile.durationMs, 500);
  assert.deepEqual(profile.gpu, { median: 6, p95: 6, samples: 1 });
  assert.deepEqual(profile.drawCalls, { median: 120, p95: 120 });
});

test('the report says when the browser cannot time the GPU, and when nothing was drawn', () => {
  const profile = summariseFrames(
    [
      { cpuMs: 3.25, drawCalls: 80, selectionMs: 0.5 },
      { cpuMs: 4.5, drawCalls: 82, selectionMs: 0.4 },
    ],
    1000,
  );
  const lines = profileLines(profile, 'visite');
  assert.match(lines[0], /visite · 2 images en 1,0 s \(2 fps\)/);
  assert.match(lines[1], /non mesurable/);
  assert.match(lines[2], /médiane 3,3 · p95 4,5 ms/);
  assert.match(lines[4], /médiane 80 · p95 82 par image/);
  assert.deepEqual(profileLines(summariseFrames([], 1000), 'plan'), [
    '[profil] plan · aucune image mesurée',
  ]);
});

test('a profile draws every image while it runs, then releases the hold and its counters', async () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  new FreeCamera('camera', new Vector3(0, 0, -5), scene);
  MeshBuilder.CreateBox('box', {}, scene);
  let holds = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  const viewer = {
    engine,
    scene,
    holdRendering() {
      holds++;
      timer = setInterval(() => scene.render(), 5);
      return () => {
        holds--;
        clearInterval(timer);
      };
    },
  };
  const observersBefore = scene.onAfterRenderObservable.observers.length;
  try {
    const profile = await profileView(viewer, 120);
    assert.ok(profile.frames > 0, 'images were recorded');
    assert.equal(profile.gpu, undefined, 'NullEngine has no timer query');
    // NullEngine reports no draw call; a real engine counts each one in `_reportDrawCall`.
    assert.ok(Number.isFinite(profile.cpu.median), 'the render time is read');
    assert.equal(holds, 0, 'the hold is released');
    // Babylon removes an observer on the next tick.
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(scene.onAfterRenderObservable.observers.length, observersBefore);
  } finally {
    clearInterval(timer);
    scene.dispose();
    engine.dispose();
  }
});
