import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AdaptiveResolution,
  EFFECT_TIERS,
  FRAME_SAMPLES,
  RENDER_SCALES,
  BLOOM_TIER,
  OCCLUSION_TIER,
  qualitySeed,
  SCALE_FLOOR,
  SHADOW_TIER,
  refreshIntervalOf,
  upscaleCap,
  upscales,
  ViewResolutions,
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
  const resolution = new AdaptiveResolution();
  assert.equal(feed(resolution, SERIES * 20, 16.7), 1);
  assert.equal(resolution.scale, 1);
});

test('a slow machine lowers resolution one step per series, down to the floor', () => {
  const resolution = new AdaptiveResolution();
  assert.equal(feed(resolution, SERIES - 1, 45), 1);
  assert.equal(feed(resolution, 1, 45), RENDER_SCALES[1]);
  assert.equal(feed(resolution, SERIES * 10, 45), RENDER_SCALES.at(-1));
  assert.ok(RENDER_SCALES.at(-1)! >= 0.67);
});

test('the scale never goes back up: resizing again would hitch', () => {
  const resolution = new AdaptiveResolution();
  feed(resolution, SERIES, 45);
  const reduced = resolution.scale;
  assert.ok(reduced < 1);
  assert.equal(feed(resolution, SERIES * 5, 8), reduced);
});

test('images that were not drawn in a row are not measured', () => {
  const resolution = new AdaptiveResolution();
  for (let frame = 0; frame < SERIES * 5; frame++) resolution.update(undefined);
  assert.equal(resolution.scale, 1);
});

test('the hitches of the start are ignored', () => {
  const resolution = new AdaptiveResolution();
  assert.equal(feed(resolution, WARMUP_FRAMES, 400), 1);
  assert.equal(feed(resolution, FRAME_SAMPLES * 3, 16.7), 1);
});

test('the hitch of a resolution change is ignored too', () => {
  const resolution = new AdaptiveResolution();
  feed(resolution, SERIES, 45);
  assert.equal(resolution.scale, RENDER_SCALES[1]);
  feed(resolution, WARMUP_FRAMES, 400);
  assert.equal(feed(resolution, FRAME_SAMPLES, 20), RENDER_SCALES[1]);
});

test('a single slow frame does not lower the resolution', () => {
  const resolution = new AdaptiveResolution();
  let scale = 1;
  for (let frame = 0; frame < SERIES * 5; frame++)
    scale = resolution.update(frame % SERIES === 0 ? 300 : 16.7);
  assert.equal(scale, 1);
});

test('resolution goes first, down to 67 %, then occlusion, shadow filtering and bloom', () => {
  const resolution = new AdaptiveResolution(EFFECT_TIERS);
  for (const scale of RENDER_SCALES.slice(1)) {
    feed(resolution, SERIES, 45);
    assert.equal(resolution.scale, scale);
    assert.equal(resolution.effectTier, 0, 'no effect goes while a resolution step is left');
  }
  for (const tier of [OCCLUSION_TIER, SHADOW_TIER, BLOOM_TIER]) {
    feed(resolution, SERIES, 45);
    assert.equal(resolution.effectTier, tier);
    assert.equal(resolution.scale, SCALE_FLOOR);
  }
  feed(resolution, SERIES * 5, 45);
  assert.equal(resolution.effectTier, EFFECT_TIERS);
});

test('a view without effects has no tier to drop', () => {
  const resolution = new AdaptiveResolution();
  feed(resolution, SERIES * 10, 45);
  assert.equal(resolution.effectTier, 0);
  assert.equal(resolution.scale, RENDER_SCALES.at(-1));
});

test('a machine holding the frame rate never leaves tier 0', () => {
  const resolution = new AdaptiveResolution(EFFECT_TIERS);
  feed(resolution, SERIES * 20, 20);
  assert.equal(resolution.effectTier, 0);
});

test('« Haute » never goes under 100 % nor drops an effect, and still sharpens', () => {
  const slow = new AdaptiveResolution(EFFECT_TIERS, { quality: 'high' });
  feed(slow, SERIES * 10, 60);
  assert.equal(slow.scale, 1);
  assert.equal(slow.effectTier, 0);
  const fast = new AdaptiveResolution(EFFECT_TIERS, { quality: 'high', cap: 1.25 });
  feed(fast, SERIES * 20, 1000 / 60);
  assert.equal(fast.scale, 1.25);
  const started = new AdaptiveResolution(EFFECT_TIERS, {
    quality: 'high',
    start: { scale: 0.67, tier: 3 },
  });
  assert.equal(started.scale, 1, 'an automatic start under 100 % is not « Haute »');
  assert.equal(started.effectTier, 0);
});

test('« Moyenne » is 67 % with every effect, « Basse » adds every reduction; neither moves', () => {
  const medium = new AdaptiveResolution(EFFECT_TIERS, { quality: 'medium', cap: 1.5 });
  feed(medium, SERIES * 10, 1000 / 60);
  feed(medium, SERIES * 10, 60);
  assert.equal(medium.scale, SCALE_FLOOR);
  assert.equal(medium.effectTier, 0);
  const low = new AdaptiveResolution(EFFECT_TIERS, { quality: 'low' });
  feed(low, SERIES * 10, 1000 / 60);
  assert.equal(low.scale, SCALE_FLOOR);
  assert.equal(low.effectTier, EFFECT_TIERS);
  assert.equal(new AdaptiveResolution(0, { quality: 'low' }).effectTier, 0, 'nothing to drop');
});

test('automatic starts where this machine left the view, scale and tier', () => {
  const resolution = new AdaptiveResolution(EFFECT_TIERS, { start: { scale: 0.8, tier: 1 } });
  assert.equal(resolution.scale, 0.8);
  assert.equal(resolution.effectTier, 1);
  feed(resolution, SERIES, 1000 / 60);
  assert.equal(resolution.effectTier, 0, 'keeping up gives the effect back first');
  assert.equal(resolution.scale, 0.8);
});

test('the GPU class seeds where automatic starts: integrated at « Moyenne », software at « Basse »', () => {
  assert.deepEqual(qualitySeed('integrated'), { scale: SCALE_FLOOR, tier: 0 });
  assert.deepEqual(qualitySeed('software'), { scale: SCALE_FLOOR, tier: EFFECT_TIERS });
  assert.equal(qualitySeed('discrete'), undefined);
  assert.equal(qualitySeed('headset'), undefined);
  assert.equal(qualitySeed('unknown'), undefined);
  const views = new ViewResolutions();
  views.configure('auto', { plan: { scale: 1, tier: 0 } }, qualitySeed('integrated'));
  assert.equal(views.for('walk').scale, SCALE_FLOOR);
  assert.equal(views.for('plan').scale, 1, 'a saved start wins over the seed');
  // Seeded low, a machine that keeps up with its screen climbs back.
  feed(views.for('overview'), SERIES * 3, 1000 / 60);
  assert.ok(views.for('overview').scale > SCALE_FLOOR);
});

test('every view, the plan included, goes down to 67 %; only the plan has no effect tier', () => {
  const views = new ViewResolutions();
  for (const view of ['plan', 'overview', 'overview+exterior', 'walk']) {
    feed(views.for(view), SERIES * 20, 45);
    assert.equal(views.for(view).scale, SCALE_FLOOR, view);
  }
  assert.equal(views.for('plan').effectTier, 0);
  assert.equal(views.for('walk').effectTier, EFFECT_TIERS);
  assert.equal(views.for('overview+exterior').effectTier, EFFECT_TIERS);
});

test('a stall is not the speed of the machine: it is never measured', () => {
  const resolution = new AdaptiveResolution();
  feed(resolution, SERIES * 10, 30_000);
  assert.equal(resolution.scale, 1);
  assert.equal(resolution.effectTier, 0);
});

test('returning to the page restarts the warm-up, so slow first images cost no effect', () => {
  const resolution = new AdaptiveResolution();
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
  const resolution = new AdaptiveResolution();
  feed(resolution, WARMUP_FRAMES + FRAME_SAMPLES - 1, 45);
  resolution.resume();
  feed(resolution, WARMUP_FRAMES, 16.7);
  feed(resolution, 1, 45);
  assert.equal(resolution.scale, 1);
});

test('the bench can pin a tier and hand it back', () => {
  const resolution = new AdaptiveResolution();
  resolution.force(1);
  assert.equal(resolution.effectTier, 1);
  resolution.force(99);
  assert.equal(resolution.effectTier, EFFECT_TIERS);
  resolution.force(undefined);
  assert.equal(resolution.effectTier, 0);
});

test('a slow but running machine, like software rendering at under 2 fps, is still measured', () => {
  const resolution = new AdaptiveResolution(EFFECT_TIERS);
  feed(resolution, SERIES * 5, 800);
  assert.equal(resolution.scale, RENDER_SCALES.at(-1));
  assert.ok(resolution.effectTier > 0);
});

test('each view keeps its own scale and tier: a slow visit leaves the plan sharp', () => {
  const views = new ViewResolutions();
  feed(views.for('walk'), SERIES * 10, 40);
  assert.equal(views.for('walk').scale, SCALE_FLOOR);
  assert.equal(views.for('walk').effectTier, EFFECT_TIERS);
  assert.equal(views.for('plan').scale, 1);
  assert.equal(views.for('overview').effectTier, 0, 'Vue 3D keeps its occlusion');
  // Vue 3D holds 40 fps on its own: it never inherits the visit's tier.
  feed(views.for('overview'), SERIES * 10, 20);
  assert.equal(views.for('overview').effectTier, 0);
  assert.equal(views.for('walk').scale, SCALE_FLOOR, 'the visit kept what it took');
});

test('entering a view again restarts its warm-up: the images around a switch are not its speed', () => {
  const views = new ViewResolutions();
  const walk = views.for('walk');
  feed(walk, SERIES, 16);
  views.for('plan');
  assert.equal(views.for('walk'), walk, 'the same resolution comes back');
  assert.equal(feed(walk, WARMUP_FRAMES + FRAME_SAMPLES - 1, 60), 1);
  assert.equal(feed(walk, 1, 60), RENDER_SCALES[1], 'the resolution goes first');
  // Asking again for the current view is no switch: only the resize's own warm-up applies.
  views.for('walk');
  assert.equal(feed(walk, WARMUP_FRAMES + FRAME_SAMPLES, 60), RENDER_SCALES[2]);
});

test('the bench pins the tier of every view, including views not yet entered', () => {
  const views = new ViewResolutions();
  views.for('walk');
  views.force(EFFECT_TIERS);
  assert.equal(views.for('walk').effectTier, EFFECT_TIERS);
  assert.equal(views.for('overview').effectTier, EFFECT_TIERS);
  views.force(undefined);
  assert.equal(views.for('walk').effectTier, 0);
});

test('leaving the page restarts the warm-up of every view', () => {
  const views = new ViewResolutions();
  const walk = views.for('walk');
  feed(walk, WARMUP_FRAMES + FRAME_SAMPLES - 1, 60);
  views.resume();
  feed(walk, WARMUP_FRAMES + FRAME_SAMPLES - 1, 60);
  assert.equal(walk.scale, 1, 'the half-measured series was dropped');
  feed(walk, 1, 60);
  assert.equal(walk.scale, RENDER_SCALES[1]);
});

test('the cap follows the screen: 150 % on 4K, 125 % on 2K, none below', () => {
  assert.equal(upscaleCap(3840, 2160, 1), 1.5);
  assert.equal(upscaleCap(2560, 1440, 1.5), 1.5, 'a 4K screen scaled to 150 %');
  assert.equal(upscaleCap(2560, 1440, 1), 1.25);
  assert.equal(upscaleCap(1920, 1080, 1), 1);
  assert.deepEqual(upscales(1.25), [1.1, 1.2, 1.25]);
  assert.deepEqual(upscales(1.5), [1.1, 1.2, 1.3, 1.4, 1.5]);
  assert.deepEqual(upscales(1), []);
});

test('a frame time sitting on a refresh rate is the screen waiting, not the machine', () => {
  for (const hz of [60, 90, 120, 144]) assert.equal(refreshIntervalOf(1000 / hz), 1000 / hz);
  assert.equal(refreshIntervalOf(1000 / 60 + 0.5), 1000 / 60);
  assert.equal(refreshIntervalOf(30), undefined, '33 fps sits on no refresh rate');
});

test('a 2K screen held at 60 Hz sharpens step by step, up to 125 %', () => {
  const resolution = new AdaptiveResolution(EFFECT_TIERS, { cap: 1.25 });
  assert.equal(feed(resolution, SERIES, 1000 / 60), 1.1);
  feed(resolution, SERIES * 20, 1000 / 60);
  assert.equal(resolution.scale, 1.25);
});

test('a 4K screen held at 144 Hz climbs to 150 %', () => {
  const resolution = new AdaptiveResolution(0, { cap: 1.5 });
  feed(resolution, SERIES * 20, 1000 / 144);
  assert.equal(resolution.scale, 1.5);
});

test('below 2K, keeping up with the screen never sharpens past 100 %', () => {
  const resolution = new AdaptiveResolution(0, { cap: 1 });
  feed(resolution, SERIES * 20, 1000 / 144);
  assert.equal(resolution.scale, 1);
});

test('falling behind the refresh at an up-scale goes back one step, for good', () => {
  const resolution = new AdaptiveResolution(EFFECT_TIERS, { cap: 1.5 });
  feed(resolution, SERIES * 3, 1000 / 60);
  assert.equal(resolution.scale, 1.3);
  feed(resolution, SERIES, 22); // 45 fps: behind 60 Hz, yet above 40 fps
  assert.equal(resolution.scale, 1.2, 'the up-scale goes, not the occlusion');
  assert.equal(resolution.effectTier, 0);
  feed(resolution, SERIES * 10, 1000 / 60);
  assert.equal(resolution.scale, 1.2, 'no more climbing in this session');
});

test('started sharp from a saved scale but not keeping up, the view steps back down', () => {
  const resolution = new AdaptiveResolution(0, { start: { scale: 1.25, tier: 0 }, cap: 1.25 });
  feed(resolution, SERIES, 21);
  assert.equal(resolution.scale, 1.2);
});

test('frame times off every refresh rate do not sharpen', () => {
  const resolution = new AdaptiveResolution(0, { cap: 1.5 });
  feed(resolution, SERIES * 10, 21); // 48 fps, CPU-bound
  assert.equal(resolution.scale, 1);
});

test('an adapted view starts where this machine left it, within the screen cap', () => {
  assert.equal(new AdaptiveResolution(0, { start: { scale: 1.3, tier: 0 }, cap: 1.5 }).scale, 1.3);
  assert.equal(
    new AdaptiveResolution(0, { start: { scale: 1.5, tier: 0 }, cap: 1.25 }).scale,
    1.25,
  );
});

test('a new policy starts every view over', () => {
  const views = new ViewResolutions(1.5);
  feed(views.for('walk'), SERIES * 2, 1000 / 60);
  assert.equal(views.for('walk').scale, 1.2);
  views.configure('medium', {});
  assert.equal(views.for('walk').scale, SCALE_FLOOR);
  views.configure('auto', { walk: { scale: 1.4, tier: 0 } });
  assert.equal(views.for('walk').scale, 1.4);
  assert.equal(views.for('plan').scale, 1);
});

test('moving to a screen with another cap starts the views over under it', () => {
  const views = new ViewResolutions(1.5);
  feed(views.for('walk'), SERIES * 20, 1000 / 60);
  assert.equal(views.for('walk').scale, 1.5);
  assert.equal(views.setCap(1), true);
  assert.equal(views.for('walk').scale, 1, 'a 1080p screen never renders above 100 %');
  assert.equal(views.setCap(1), false, 'the same cap changes nothing');
});

test('a view started without some effects gets them back first when it keeps up with the screen', () => {
  const resolution = new AdaptiveResolution(EFFECT_TIERS, { start: { scale: 0.67, tier: 2 } });
  feed(resolution, SERIES, 1000 / 60);
  assert.equal(resolution.effectTier, 1, 'an effect comes back before any sharpness');
  feed(resolution, SERIES, 1000 / 60);
  assert.equal(resolution.effectTier, 0);
  assert.equal(resolution.scale, SCALE_FLOOR);
  feed(resolution, SERIES, 1000 / 60);
  assert.equal(resolution.scale, RENDER_SCALES.at(-2));
});

test('a tier dropped in this session never comes back by itself', () => {
  const resolution = new AdaptiveResolution(EFFECT_TIERS, { start: { scale: 0.67, tier: 0 } });
  feed(resolution, SERIES, 45);
  assert.equal(resolution.effectTier, 1);
  feed(resolution, SERIES * 10, 1000 / 60);
  assert.equal(resolution.effectTier, 1);
  assert.equal(resolution.scale, SCALE_FLOOR);
});

/** Feeds `count` images of `frameMs` each on a screen measured at `displayHz`. */
function feedOn(resolution: AdaptiveResolution, count: number, frameMs: number, displayHz: number) {
  for (let frame = 0; frame < count; frame++) resolution.update(frameMs, displayHz);
  return resolution.scale;
}

test('on a measured 120 Hz screen, 60 fps is not keeping up: a view started low stays there', () => {
  const resolution = new AdaptiveResolution(EFFECT_TIERS, {
    start: { scale: SCALE_FLOOR, tier: 0 },
  });
  assert.equal(feedOn(resolution, SERIES * 5, 1000 / 60, 120), SCALE_FLOOR);
});

test('on a measured 60 Hz screen, holding 60 fps sharpens as before', () => {
  const resolution = new AdaptiveResolution(EFFECT_TIERS, {
    start: { scale: SCALE_FLOOR, tier: 0 },
  });
  assert.equal(feedOn(resolution, SERIES, 1000 / 60, 60), RENDER_SCALES.at(-2));
});

test('holding a measured 120 Hz screen sharpens, and falling behind it at an up-scale steps back', () => {
  const resolution = new AdaptiveResolution(0, { cap: 1.25 });
  assert.equal(feedOn(resolution, SERIES, 1000 / 120, 120), 1.1);
  assert.equal(feedOn(resolution, SERIES, 1000 / 60, 120), 1, '60 fps is behind 120 Hz');
});
