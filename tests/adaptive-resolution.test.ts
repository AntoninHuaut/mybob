import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AdaptiveResolution,
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
