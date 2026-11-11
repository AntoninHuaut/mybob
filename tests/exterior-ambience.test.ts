import assert from 'node:assert/strict';
import test from 'node:test';
import { exteriorRadiance } from '../src/scene/exteriorAmbience';
test('sky has an HDR sun, darker zenith and night without a sun lobe', () => {
  const sun = { x: 0, y: 1, z: 0 };
  assert.ok(exteriorRadiance(0, 1, 0, sun)[0] > 1);
  const offAxis = { x: 1, y: 0.3, z: 0 };
  assert.ok(exteriorRadiance(0, 1, 0, offAxis)[0] < exteriorRadiance(0, 0, 1, offAxis)[0]);
  assert.ok(exteriorRadiance(0, 1, 0, { x: 0, y: -1, z: 0 })[0] < 0.1);
});
