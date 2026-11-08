import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AdaptiveResolution,
  FRAME_SAMPLES,
  MOTION_SCALES,
  REST_DELAY_MS,
} from '../src/scene/adaptiveResolution';

/** Feeds `count` moving images of `frameMs` each and returns the last scale. */
function move(resolution: AdaptiveResolution, count: number, frameMs: number, start = 0) {
  let scale = 1;
  for (let frame = 0; frame < count; frame++)
    scale = resolution.update(start + frame * frameMs, true, frameMs);
  return scale;
}

test('a machine holding 60 fps always stays at full resolution', () => {
  const resolution = new AdaptiveResolution();
  assert.equal(move(resolution, FRAME_SAMPLES * 20, 16.7), 1);
  assert.equal(resolution.motionScale, 1);
});

test('a slow machine lowers resolution while moving, one step per series of frames', () => {
  const resolution = new AdaptiveResolution();
  assert.equal(move(resolution, FRAME_SAMPLES - 1, 45), 1);
  assert.equal(move(resolution, 1, 45, 1000), MOTION_SCALES[1]);
  assert.equal(move(resolution, FRAME_SAMPLES * 10, 45, 2000), MOTION_SCALES.at(-1));
});

test('when still, the image returns to full resolution, and the learnt step stays for later', () => {
  const resolution = new AdaptiveResolution();
  move(resolution, FRAME_SAMPLES * 2, 45);
  const learnt = resolution.motionScale;
  assert.ok(learnt < 1);
  const stop = FRAME_SAMPLES * 2 * 45;
  assert.equal(resolution.update(stop + REST_DELAY_MS / 2, false), learnt);
  assert.equal(resolution.update(stop + REST_DELAY_MS, false), 1);
  // The next motion starts directly at the level learnt.
  assert.equal(resolution.update(stop + 5000, true, undefined), learnt);
});

test('a very slow machine skips a step', () => {
  const resolution = new AdaptiveResolution();
  assert.equal(move(resolution, FRAME_SAMPLES, 150), MOTION_SCALES[2]);
});

test('a single slow frame does not lower the resolution', () => {
  const resolution = new AdaptiveResolution();
  let scale = 1;
  for (let frame = 0; frame < FRAME_SAMPLES * 5; frame++)
    scale = resolution.update(frame * 17, true, frame % FRAME_SAMPLES === 0 ? 300 : 16.7);
  assert.equal(scale, 1);
});

test('with headroom, resolution goes back up one step', () => {
  const resolution = new AdaptiveResolution();
  move(resolution, FRAME_SAMPLES * 2, 45);
  const reduced = resolution.motionScale;
  move(resolution, FRAME_SAMPLES, 10, 10000);
  assert.ok(resolution.motionScale > reduced);
});
