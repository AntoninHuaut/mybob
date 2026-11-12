import assert from 'node:assert/strict';
import test from 'node:test';
import { paintSky, SKY_STOPS, skyCss } from '../src/scene/sky';

test('the sky stays at or below 0.9 and runs from zenith to horizon', () => {
  for (const [, color] of SKY_STOPS) {
    for (const offset of [1, 3, 5]) {
      const channel = parseInt(color.slice(offset, offset + 2), 16) / 255;
      assert.ok(channel <= 0.9, `${color} must not reach the bloom range`);
    }
  }
  assert.deepEqual(
    SKY_STOPS.map(([offset]) => offset),
    [...SKY_STOPS.map(([offset]) => offset)].sort((a, b) => a - b),
  );
  assert.equal(SKY_STOPS[0][0], 0);
  assert.equal(SKY_STOPS.at(-1)![0], 1);
});

test('the export paints the same stops as the CSS, over the scene rectangle only', () => {
  const stops: Array<[number, string]> = [];
  const calls: unknown[][] = [];
  const context = {
    fillStyle: undefined as unknown,
    createLinearGradient: (...args: number[]) => {
      calls.push(['gradient', ...args]);
      return { addColorStop: (offset: number, color: string) => void stops.push([offset, color]) };
    },
    fillRect: (...args: number[]) => void calls.push(['fill', ...args]),
  };
  paintSky(context, 0, 64, 800, 600);
  assert.deepEqual(calls, [
    ['gradient', 0, 64, 0, 664],
    ['fill', 0, 64, 800, 600],
  ]);
  assert.deepEqual(stops, SKY_STOPS);
  for (const [offset, color] of SKY_STOPS)
    assert.ok(skyCss().includes(`${color} ${offset * 100}%`));
});
