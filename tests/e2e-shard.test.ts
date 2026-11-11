import assert from 'node:assert/strict';
import test from 'node:test';
import { balanceShards, collectedTests } from '../scripts/e2e-shard.mjs';

test('duration sharding covers every test once, balances long tests and includes new tests', () => {
  const tests = ['a', 'b', 'c', 'd', 'new'];
  const shards = balanceShards(tests, { a: 90000, b: 60000, c: 30000, d: 30000 }, 3);
  assert.deepEqual(shards.flatMap((shard) => shard.tests).sort(), [...tests].sort());
  assert.deepEqual(
    shards.map((shard) => shard.duration),
    [90000, 90000, 60000],
  );
  assert.deepEqual(
    balanceShards([...tests].reverse(), { a: 90000, b: 60000, c: 30000, d: 30000 }, 3),
    shards,
  );
  assert.throws(() => balanceShards(tests, {}, 0));
});

test('collection preserves nested describes and projects and rejects ambiguous or empty lists', () => {
  const spec = {
    file: 'view.spec.ts',
    title: 'switch',
    tests: [{ projectName: 'desktop' }, { projectName: 'touch' }],
  };
  const report = {
    suites: [
      { title: 'view.spec.ts', column: 0, suites: [{ title: 'nested', column: 1, specs: [spec] }] },
    ],
  };
  assert.deepEqual(collectedTests(report), [
    '[desktop] › view.spec.ts › nested › switch',
    '[touch] › view.spec.ts › nested › switch',
  ]);
  assert.throws(() => collectedTests({ suites: [] }));
  assert.throws(() => collectedTests({ suites: [], errors: [{ message: 'load error' }] }));
  assert.throws(() => collectedTests({ suites: [{ specs: [spec, spec] }] }));
});
