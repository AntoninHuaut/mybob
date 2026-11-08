import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import {
  FrameRateMeter,
  FRAME_RATE_FLOOR,
  FRAME_RATE_REFRESH_MS,
  frameRateIsLow,
  frameRateText,
} from '../src/ui/frameRate';

function setup() {
  const window = new Window({ url: 'http://localhost' });
  const element = window.document.createElement('span');
  element.hidden = true;
  return { element, meter: new FrameRateMeter(element as unknown as HTMLElement) };
}

test('the frame rate is rounded and never goes below zero', () => {
  assert.equal(frameRateText(59.6), '60 fps');
  assert.equal(frameRateText(59.4), '59 fps');
  assert.equal(frameRateText(-3), '0 fps');
});

test('the playability floor marks the reading, without changing it', () => {
  assert.equal(frameRateIsLow(FRAME_RATE_FLOOR - 1), true);
  assert.equal(frameRateIsLow(FRAME_RATE_FLOOR), false);
  assert.equal(frameRateText(FRAME_RATE_FLOOR - 1), '23 fps');
});

test('the counter shows at the first measurement then limits itself to four writes per second', () => {
  const { element, meter } = setup();
  meter.update(1000, 60);
  assert.equal(element.hidden, false, 'la première mesure rend le compteur visible');
  assert.equal(element.textContent, '60 fps');

  meter.update(1000 + FRAME_RATE_REFRESH_MS - 1, 12);
  assert.equal(element.textContent, '60 fps', 'une mesure trop rapprochée est ignorée');

  meter.update(1000 + FRAME_RATE_REFRESH_MS, 12);
  assert.equal(element.textContent, '12 fps');
});

test('the counter flags a frame rate below the floor', () => {
  const { element, meter } = setup();
  meter.update(0, 60);
  assert.equal(element.classList.contains('low'), false);
  meter.update(FRAME_RATE_REFRESH_MS, 18);
  assert.equal(element.classList.contains('low'), true);
  meter.update(FRAME_RATE_REFRESH_MS * 2, 45);
  assert.equal(
    element.classList.contains('low'),
    false,
    'la marque disparaît quand la cadence remonte',
  );
});
