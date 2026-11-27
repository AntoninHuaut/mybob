import assert from 'node:assert/strict';
import test from 'node:test';
import { centimetres } from '../src/ui/format';

test('plan lengths read in centimetres, to the millimetre', () => {
  assert.equal(centimetres(4.2), '420 cm');
  assert.equal(centimetres(0.125), '12,5 cm');
  assert.equal(centimetres(1.65), '165 cm');
  assert.equal(centimetres(0.1234), '12,3 cm');
});
