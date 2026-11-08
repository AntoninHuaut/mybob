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

test('une machine qui tient 60 fps reste toujours en pleine résolution', () => {
  const resolution = new AdaptiveResolution();
  assert.equal(move(resolution, FRAME_SAMPLES * 20, 16.7), 1);
  assert.equal(resolution.motionScale, 1);
});

test('une machine lente baisse la résolution en mouvement, un cran par série d’images', () => {
  const resolution = new AdaptiveResolution();
  assert.equal(move(resolution, FRAME_SAMPLES - 1, 45), 1);
  assert.equal(move(resolution, 1, 45, 1000), MOTION_SCALES[1]);
  assert.equal(move(resolution, FRAME_SAMPLES * 10, 45, 2000), MOTION_SCALES.at(-1));
});

test('à l’arrêt, l’image revient en pleine résolution, et le palier appris reste pour la suite', () => {
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

test('une machine très lente saute un cran', () => {
  const resolution = new AdaptiveResolution();
  assert.equal(move(resolution, FRAME_SAMPLES, 150), MOTION_SCALES[2]);
});

test('une image lente isolée ne fait pas baisser la résolution', () => {
  const resolution = new AdaptiveResolution();
  let scale = 1;
  for (let frame = 0; frame < FRAME_SAMPLES * 5; frame++)
    scale = resolution.update(frame * 17, true, frame % FRAME_SAMPLES === 0 ? 300 : 16.7);
  assert.equal(scale, 1);
});

test('avec de la marge, la résolution remonte d’un cran', () => {
  const resolution = new AdaptiveResolution();
  move(resolution, FRAME_SAMPLES * 2, 45);
  const reduced = resolution.motionScale;
  move(resolution, FRAME_SAMPLES, 10, 10000);
  assert.ok(resolution.motionScale > reduced);
});
