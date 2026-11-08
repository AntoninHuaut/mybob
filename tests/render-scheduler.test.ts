import assert from 'node:assert/strict';
import test from 'node:test';
import {
  IDLE_REFRESH_MS,
  RENDER_SETTLE_FRAMES,
  RenderScheduler,
} from '../src/scene/renderScheduler';

const still = () => false;

/** Runs `frames` loop turns 16 ms apart and counts the images drawn. */
function run(
  scheduler: RenderScheduler,
  frames: number,
  start = 0,
  signature: (frame: number) => string = () => 'camera',
  busy: () => boolean = still,
) {
  let drawn = 0;
  for (let frame = 0; frame < frames; frame++)
    if (scheduler.shouldRender(start + frame * 16, signature(frame), busy)) drawn++;
  return drawn;
}

test('a still scene finishes its smoothing then stops redrawing', () => {
  const scheduler = new RenderScheduler();
  assert.equal(run(scheduler, RENDER_SETTLE_FRAMES), RENDER_SETTLE_FRAMES);
  assert.equal(scheduler.idle, true);
  // Half a second of rest: nothing drawn.
  assert.equal(run(scheduler, 30, RENDER_SETTLE_FRAMES * 16), 0);
});

test('at rest, one frame per second catches up a change nobody announced', () => {
  const scheduler = new RenderScheduler();
  run(scheduler, RENDER_SETTLE_FRAMES);
  const frames = Math.ceil((3 * IDLE_REFRESH_MS) / 16);
  const drawn = run(scheduler, frames, RENDER_SETTLE_FRAMES * 16);
  assert.ok(drawn >= 2 && drawn <= 3, `${drawn} images en trois secondes de repos`);
});

test('a moving camera is redrawn on every frame, then for the smoothing time', () => {
  const scheduler = new RenderScheduler();
  run(scheduler, RENDER_SETTLE_FRAMES);
  const moving = run(scheduler, 20, 1000, (frame) => `camera-${frame}`);
  assert.equal(moving, 20);
  // The last position stays: the TAA still gets its settle frames, then rest.
  const after = run(scheduler, RENDER_SETTLE_FRAMES + 10, 2000, () => 'camera-19');
  assert.equal(after, RENDER_SETTLE_FRAMES - 1);
});

test('an explicit request restarts drawing', () => {
  const scheduler = new RenderScheduler();
  run(scheduler, RENDER_SETTLE_FRAMES);
  scheduler.request();
  assert.equal(scheduler.idle, false);
  assert.equal(run(scheduler, RENDER_SETTLE_FRAMES + 5, 600), RENDER_SETTLE_FRAMES);
});

test('held key, swinging door or compiling shader: drawing continues', () => {
  const scheduler = new RenderScheduler();
  run(scheduler, RENDER_SETTLE_FRAMES);
  let busy = true;
  assert.equal(
    run(scheduler, 100, 600, undefined, () => busy),
    100,
  );
  busy = false;
  const after = run(scheduler, RENDER_SETTLE_FRAMES * 2, 3000, undefined, () => busy);
  assert.ok(after <= RENDER_SETTLE_FRAMES, `${after} images après la fin de l’activité`);
});

test('the busy state is only consulted once the scene is set', () => {
  const scheduler = new RenderScheduler();
  let asked = 0;
  run(scheduler, RENDER_SETTLE_FRAMES - 1, 0, undefined, () => {
    asked++;
    return false;
  });
  assert.equal(asked, 0);
});
