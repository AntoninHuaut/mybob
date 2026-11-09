import assert from 'node:assert/strict';
import test from 'node:test';
import { isOwnStaleHash } from '../src/model/shareLink';

test('the last published hash is the tab’s own, whatever the page showed when left', () => {
  assert.equal(isOwnStaleHash('#p1:b', ['#p1:a', '#p1:b'], '#p1:b'), true);
  assert.equal(isOwnStaleHash('#p1:b', ['#p1:a', '#p1:b'], null), true);
});

test('a reload overtaken by a later write recognises its older own hash', () => {
  // The reload left with #p1:a, a debounced write published #p1:b before the page went away.
  assert.equal(isOwnStaleHash('#p1:a', ['#p1:a', '#p1:b'], '#p1:b'), true);
  assert.equal(isOwnStaleHash('#p1:a', ['#p1:a', '#p1:b'], ''), true);
});

test('going back to an older link of this tab is still a link', () => {
  assert.equal(isOwnStaleHash('#p1:a', ['#p1:a', '#p1:b'], '#p1:a'), false);
});

test('a hash this tab never published is a link', () => {
  assert.equal(isOwnStaleHash('#p1:z', ['#p1:a', '#p1:b'], '#p1:b'), false);
  assert.equal(isOwnStaleHash('#p1:a', [], null), false);
});
