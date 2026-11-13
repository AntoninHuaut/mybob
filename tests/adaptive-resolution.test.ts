import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AdaptiveResolution,
  EFFECT_TIERS,
  FRAME_SAMPLES,
  RENDER_SCALES,
  pinnableScales,
  refreshIntervalOf,
  upscaleCap,
  upscales,
  ViewResolutions,
  VISIT_SCALE_FLOOR,
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

test('the occlusion goes first, then the resolution, one step per series', () => {
  const resolution = new AdaptiveResolution(1.5, 1, EFFECT_TIERS);
  feed(resolution, SERIES, 45);
  assert.equal(resolution.effectTier, 1, 'the occlusion went first');
  assert.equal(resolution.scale, 1);
  feed(resolution, SERIES, 45);
  assert.equal(resolution.scale, RENDER_SCALES[1]);
  feed(resolution, SERIES * 10, 45);
  assert.equal(resolution.effectTier, EFFECT_TIERS);
  assert.equal(resolution.scale, RENDER_SCALES.at(-1));
});

test('a view without occlusion has no tier to drop: its resolution goes first', () => {
  const resolution = new AdaptiveResolution(1.5);
  feed(resolution, SERIES * 10, 45);
  assert.equal(resolution.effectTier, 0);
  assert.equal(resolution.scale, RENDER_SCALES.at(-1));
});

test('a machine holding the frame rate never leaves tier 0', () => {
  const resolution = new AdaptiveResolution(1.5);
  feed(resolution, SERIES * 20, 20);
  assert.equal(resolution.effectTier, 0);
});

test('outside the visit, resolution never falls below one pixel per CSS pixel', () => {
  for (const [ratio, expected] of [
    [1, 1],
    [1.25, 0.8],
    [1.5, 0.67],
  ] as const) {
    const resolution = new AdaptiveResolution(ratio, 1, EFFECT_TIERS);
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
  resolution.force(1);
  assert.equal(resolution.effectTier, 1);
  resolution.force(99);
  assert.equal(resolution.effectTier, EFFECT_TIERS);
  resolution.force(undefined);
  assert.equal(resolution.effectTier, 0);
});

test('a slow but running machine, like software rendering at under 2 fps, is still measured', () => {
  const resolution = new AdaptiveResolution(1.6, 1, EFFECT_TIERS);
  feed(resolution, SERIES * 5, 800);
  assert.equal(resolution.scale, RENDER_SCALES.at(-1));
  assert.ok(resolution.effectTier > 0);
});

test('the visit drops its occlusion, then goes down step by step to its fixed floor', () => {
  for (const [ratio, expected] of [
    [1, VISIT_SCALE_FLOOR],
    [1.25, VISIT_SCALE_FLOOR],
    [1.5, VISIT_SCALE_FLOOR],
    [2, VISIT_SCALE_FLOOR],
  ] as const) {
    const resolution = new AdaptiveResolution(ratio, VISIT_SCALE_FLOOR, EFFECT_TIERS);
    assert.equal(feed(resolution, SERIES, 40), 1, 'the occlusion goes first');
    assert.equal(resolution.effectTier, EFFECT_TIERS);
    feed(resolution, SERIES * 10, 40);
    assert.equal(resolution.scale, expected);
    assert.equal(resolution.effectTier, EFFECT_TIERS);
  }
});

test('each view keeps its own scale and tier: a slow visit leaves the plan sharp', () => {
  const views = new ViewResolutions(1);
  feed(views.for('walk'), SERIES * 10, 40);
  assert.equal(views.for('walk').scale, VISIT_SCALE_FLOOR);
  assert.equal(views.for('walk').effectTier, EFFECT_TIERS);
  assert.equal(views.for('plan').scale, 1);
  assert.equal(views.for('overview').effectTier, 0, 'Vue 3D keeps its occlusion');
  // Vue 3D holds 40 fps on its own: it never inherits the visit's tier.
  feed(views.for('overview'), SERIES * 10, 20);
  assert.equal(views.for('overview').effectTier, 0);
  assert.equal(views.for('walk').scale, VISIT_SCALE_FLOOR, 'the visit kept what it took');
});

test('entering a view again restarts its warm-up: the images around a switch are not its speed', () => {
  const views = new ViewResolutions(1.5);
  const walk = views.for('walk');
  feed(walk, SERIES, 16);
  views.for('plan');
  assert.equal(views.for('walk'), walk, 'the same resolution comes back');
  assert.equal(feed(walk, WARMUP_FRAMES + FRAME_SAMPLES - 1, 60), 1);
  feed(walk, 1, 60);
  assert.equal(walk.effectTier, EFFECT_TIERS, 'the occlusion goes first');
  assert.equal(feed(walk, WARMUP_FRAMES + FRAME_SAMPLES, 60), RENDER_SCALES[1]);
  // Asking again for the current view is no switch: only the resize's own warm-up applies.
  views.for('walk');
  assert.equal(feed(walk, WARMUP_FRAMES + FRAME_SAMPLES, 60), RENDER_SCALES[2]);
});

test('the bench pins the tier of every view, including views not yet entered', () => {
  const views = new ViewResolutions(1);
  views.for('walk');
  views.force(EFFECT_TIERS);
  assert.equal(views.for('walk').effectTier, EFFECT_TIERS);
  assert.equal(views.for('overview').effectTier, EFFECT_TIERS);
  views.force(undefined);
  assert.equal(views.for('walk').effectTier, 0);
});

test('leaving the page restarts the warm-up of every view', () => {
  const views = new ViewResolutions(1.5);
  const walk = views.for('walk');
  feed(walk, WARMUP_FRAMES + FRAME_SAMPLES - 1, 60);
  views.resume();
  feed(walk, WARMUP_FRAMES + FRAME_SAMPLES - 1, 60);
  assert.equal(walk.effectTier, 0, 'the half-measured series was dropped');
  feed(walk, 1, 60);
  assert.equal(walk.effectTier, EFFECT_TIERS);
});

test('the cap follows the screen: 150 % on 4K, 125 % on 2K, none below', () => {
  assert.equal(upscaleCap(3840, 2160, 1), 1.5);
  assert.equal(upscaleCap(2560, 1440, 1.5), 1.5, 'a 4K screen scaled to 150 %');
  assert.equal(upscaleCap(2560, 1440, 1), 1.25);
  assert.equal(upscaleCap(1920, 1080, 1), 1);
  assert.deepEqual(upscales(1.25), [1.1, 1.2, 1.25]);
  assert.deepEqual(upscales(1.5), [1.1, 1.2, 1.3, 1.4, 1.5]);
  assert.deepEqual(upscales(1), []);
  assert.deepEqual(pinnableScales(1.25), [0.67, 0.8, 0.9, 1, 1.1, 1.2, 1.25]);
});

test('a frame time sitting on a refresh rate is the screen waiting, not the machine', () => {
  for (const hz of [60, 90, 120, 144]) assert.equal(refreshIntervalOf(1000 / hz), 1000 / hz);
  assert.equal(refreshIntervalOf(1000 / 60 + 0.5), 1000 / 60);
  assert.equal(refreshIntervalOf(30), undefined, '33 fps sits on no refresh rate');
});

test('a 2K screen held at 60 Hz sharpens step by step, up to 125 %', () => {
  const resolution = new AdaptiveResolution(1, 1, EFFECT_TIERS, { cap: 1.25 });
  assert.equal(feed(resolution, SERIES, 1000 / 60), 1.1);
  feed(resolution, SERIES * 20, 1000 / 60);
  assert.equal(resolution.scale, 1.25);
});

test('a 4K screen held at 144 Hz climbs to 150 %', () => {
  const resolution = new AdaptiveResolution(1, 1, 0, { cap: 1.5 });
  feed(resolution, SERIES * 20, 1000 / 144);
  assert.equal(resolution.scale, 1.5);
});

test('below 2K, keeping up with the screen never sharpens past 100 %', () => {
  const resolution = new AdaptiveResolution(1, 1, 0, { cap: 1 });
  feed(resolution, SERIES * 20, 1000 / 144);
  assert.equal(resolution.scale, 1);
});

test('falling behind the refresh at an up-scale goes back one step, for good', () => {
  const resolution = new AdaptiveResolution(1, 1, EFFECT_TIERS, { cap: 1.5 });
  feed(resolution, SERIES * 3, 1000 / 60);
  assert.equal(resolution.scale, 1.3);
  feed(resolution, SERIES, 22); // 45 fps: behind 60 Hz, yet above 40 fps
  assert.equal(resolution.scale, 1.2, 'the up-scale goes, not the occlusion');
  assert.equal(resolution.effectTier, 0);
  feed(resolution, SERIES * 10, 1000 / 60);
  assert.equal(resolution.scale, 1.2, 'no more climbing in this session');
});

test('started sharp from a saved scale but not keeping up, the view steps back down', () => {
  const resolution = new AdaptiveResolution(1, 1, 0, { start: 1.25, cap: 1.25 });
  feed(resolution, SERIES, 21);
  assert.equal(resolution.scale, 1.2);
});

test('frame times off every refresh rate do not sharpen', () => {
  const resolution = new AdaptiveResolution(1, 1, 0, { cap: 1.5 });
  feed(resolution, SERIES * 10, 21); // 48 fps, CPU-bound
  assert.equal(resolution.scale, 1);
});

test('an adapted view starts where this machine left it; a pinned one never moves', () => {
  assert.equal(new AdaptiveResolution(1, 1, 0, { start: 1.3, cap: 1.5 }).scale, 1.3);
  assert.equal(new AdaptiveResolution(1, 1, 0, { start: 1.5, cap: 1.25 }).scale, 1.25);
  const pinned = new AdaptiveResolution(1, 1, 0, { fixed: 1.2, cap: 1.25 });
  feed(pinned, SERIES * 10, 1000 / 60);
  assert.equal(pinned.scale, 1.2);
  feed(pinned, SERIES * 10, 60);
  assert.equal(pinned.scale, 1.2);
});

test('a new policy starts every view over', () => {
  const views = new ViewResolutions(1, 1.5);
  feed(views.for('walk'), SERIES * 2, 1000 / 60);
  assert.equal(views.for('walk').scale, 1.2);
  views.configure(0.8, {});
  assert.equal(views.for('walk').scale, 0.8);
  views.configure(undefined, { walk: 1.4 });
  assert.equal(views.for('walk').scale, 1.4);
  assert.equal(views.for('plan').scale, 1);
});
