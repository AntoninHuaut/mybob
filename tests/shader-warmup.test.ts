import assert from 'node:assert/strict';
import test from 'node:test';
import {
  READY_IN_A_ROW,
  ViewWarmth,
  WARM_UP_MAX_FRAMES,
  WARM_UP_MIN_FRAMES,
  viewKey,
  warmFrames,
} from '../src/scene/shaderWarmup';

const noWait = () => Promise.resolve();

test('warm-up draws the minimum frames when effects are ready at once', async () => {
  let drawn = 0;
  const frames = await warmFrames({ renderFrame: () => drawn++, effectsReady: () => true }, noWait);
  assert.equal(frames, WARM_UP_MIN_FRAMES);
  assert.equal(drawn, WARM_UP_MIN_FRAMES);
});

test('warm-up keeps drawing until the view is ready several frames in a row', async () => {
  assert.equal(READY_IN_A_ROW, 3);
  // Ready after frames 5, 7, 8 and 9: the streak is broken by frame 6.
  const readyAfterFrame = new Set([5, 7, 8, 9]);
  let drawn = 0;
  const frames = await warmFrames(
    { renderFrame: () => drawn++, effectsReady: () => readyAfterFrame.has(drawn) },
    noWait,
  );
  assert.equal(frames, 9);
});

test('warm-up never draws past the cap, even if a compile is stuck', async () => {
  let drawn = 0;
  const frames = await warmFrames(
    { renderFrame: () => drawn++, effectsReady: () => false },
    noWait,
  );
  assert.equal(frames, WARM_UP_MAX_FRAMES);
});

test('warm-up lets the browser breathe between frames', async () => {
  const log: string[] = [];
  await warmFrames(
    { renderFrame: () => log.push('frame'), effectsReady: () => true },
    async () => void log.push('yield'),
  );
  assert.deepEqual(log.slice(0, 4), ['frame', 'yield', 'frame', 'yield']);
});

test('the exterior is its own view, only in the overview', () => {
  assert.equal(viewKey('overview', true), 'overview+exterior');
  assert.equal(viewKey('overview', false), 'overview');
  assert.equal(viewKey('plan', true), 'plan');
  assert.equal(viewKey('walk', false), 'walk');
});

test('a view is cold until marked, and a new scene makes every view cold again', () => {
  const warmth = new ViewWarmth();
  assert.ok(warmth.untouched);
  assert.ok(warmth.isCold('overview'));
  warmth.markWarm('overview');
  assert.ok(!warmth.untouched);
  assert.ok(!warmth.isCold('overview'));
  assert.ok(warmth.isCold('plan'));
  warmth.reset();
  assert.ok(warmth.untouched);
  assert.ok(warmth.isCold('overview'));
});
