import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AdaptiveResolution,
  EFFECT_TIERS,
  FRAME_SAMPLES,
  RENDER_SCALES,
  WARMUP_FRAMES,
} from '../src/scene/adaptiveResolution';

/** Images needed for one decision: the ignored warm-up, then one series measured. */
const SERIES = WARMUP_FRAMES + FRAME_SAMPLES;

/** Feeds `count` images of `frameMs` each and returns the last scale. */
function feed(resolution: AdaptiveResolution, count: number, frameMs: number) {
  let scale = 1;
  for (let frame = 0; frame < count; frame++) scale = resolution.update(frameMs);
  return scale;
}

test('a machine holding 60 fps always stays at full resolution', () => {
  const resolution = new AdaptiveResolution(1.5);
  assert.equal(feed(resolution, SERIES * 20, 16.7), 1);
  assert.equal(resolution.scale, 1);
});

test('a slow machine lowers resolution one step per series, down to the floor', () => {
  const resolution = new AdaptiveResolution(1.5);
  assert.equal(feed(resolution, SERIES - 1, 45), 1);
  assert.equal(feed(resolution, 1, 45), RENDER_SCALES[1]);
  assert.equal(feed(resolution, SERIES * 10, 45), RENDER_SCALES.at(-1));
  assert.ok(RENDER_SCALES.at(-1)! >= 0.67);
});

test('the scale never goes back up: resizing again would hitch', () => {
  const resolution = new AdaptiveResolution(1.5);
  feed(resolution, SERIES, 45);
  const reduced = resolution.scale;
  assert.ok(reduced < 1);
  assert.equal(feed(resolution, SERIES * 5, 8), reduced);
});

test('images that were not drawn in a row are not measured', () => {
  const resolution = new AdaptiveResolution(1.5);
  for (let frame = 0; frame < SERIES * 5; frame++) resolution.update(undefined);
  assert.equal(resolution.scale, 1);
});

test('the hitches of the start are ignored', () => {
  const resolution = new AdaptiveResolution(1.5);
  assert.equal(feed(resolution, WARMUP_FRAMES, 400), 1);
  assert.equal(feed(resolution, FRAME_SAMPLES * 3, 16.7), 1);
});

test('the hitch of a resolution change is ignored too', () => {
  const resolution = new AdaptiveResolution(1.5);
  feed(resolution, SERIES, 45);
  assert.equal(resolution.scale, RENDER_SCALES[1]);
  feed(resolution, WARMUP_FRAMES, 400);
  assert.equal(feed(resolution, FRAME_SAMPLES, 20), RENDER_SCALES[1]);
});

test('a single slow frame does not lower the resolution', () => {
  const resolution = new AdaptiveResolution(1.5);
  let scale = 1;
  for (let frame = 0; frame < SERIES * 5; frame++)
    scale = resolution.update(frame % SERIES === 0 ? 300 : 16.7);
  assert.equal(scale, 1);
});

test('effects are lowered one tier per series, only once the resolution is at its floor', () => {
  const resolution = new AdaptiveResolution(1.5);
  feed(resolution, SERIES * (RENDER_SCALES.length - 1), 45);
  assert.equal(resolution.scale, RENDER_SCALES.at(-1));
  assert.equal(resolution.effectTier, 0, 'the scale went first');
  feed(resolution, SERIES, 45);
  assert.equal(resolution.effectTier, 1);
  feed(resolution, SERIES, 45);
  assert.equal(resolution.effectTier, 2);
  feed(resolution, SERIES * 10, 45);
  assert.equal(resolution.effectTier, EFFECT_TIERS);
});

test('a machine holding the frame rate never leaves tier 0', () => {
  const resolution = new AdaptiveResolution(1.5);
  feed(resolution, SERIES * 20, 20);
  assert.equal(resolution.effectTier, 0);
});

test('resolution never falls below one pixel per CSS pixel', () => {
  for (const [ratio, expected] of [
    [1, 1],
    [1.25, 0.8],
    [1.5, 0.67],
  ] as const) {
    const resolution = new AdaptiveResolution(ratio);
    feed(resolution, SERIES * 10, 40);
    assert.equal(resolution.scale, expected);
    assert.equal(resolution.effectTier, EFFECT_TIERS);
  }
});

test('a stall is not the speed of the machine: it is never measured', () => {
  const resolution = new AdaptiveResolution(1.6);
  feed(resolution, SERIES * 10, 30_000);
  assert.equal(resolution.scale, 1);
  assert.equal(resolution.effectTier, 0);
});

test('returning to the page restarts the warm-up, so slow first images cost no effect', () => {
  const resolution = new AdaptiveResolution(1.6);
  feed(resolution, SERIES * 5, 45);
  assert.equal(resolution.scale, RENDER_SCALES.at(-1));
  const tier = resolution.effectTier;
  resolution.resume();
  feed(resolution, WARMUP_FRAMES + FRAME_SAMPLES - 1, 45);
  assert.equal(resolution.effectTier, tier);
  feed(resolution, WARMUP_FRAMES, 16.7);
  feed(resolution, FRAME_SAMPLES * 3, 16.7);
  assert.equal(resolution.effectTier, tier);
});

test('resume discards a half-measured series', () => {
  const resolution = new AdaptiveResolution(1.6);
  feed(resolution, WARMUP_FRAMES + FRAME_SAMPLES - 1, 45);
  resolution.resume();
  feed(resolution, WARMUP_FRAMES, 16.7);
  feed(resolution, 1, 45);
  assert.equal(resolution.scale, 1);
});

test('the bench can pin a tier and hand it back', () => {
  const resolution = new AdaptiveResolution(1.6);
  resolution.force(2);
  assert.equal(resolution.effectTier, 2);
  resolution.force(99);
  assert.equal(resolution.effectTier, EFFECT_TIERS);
  resolution.force(undefined);
  assert.equal(resolution.effectTier, 0);
});

test('a slow but running machine, like software rendering at under 2 fps, is still measured', () => {
  const resolution = new AdaptiveResolution(1.6);
  feed(resolution, SERIES * 5, 800);
  assert.equal(resolution.scale, RENDER_SCALES.at(-1));
  assert.ok(resolution.effectTier > 0);
});
