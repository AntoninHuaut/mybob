import assert from 'node:assert/strict';
import test from 'node:test';
import {
  balanceShards,
  collectedTests,
  medianDurations,
  parseShardLog,
} from '../scripts/e2e-shard.mjs';

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

test('shard logs refresh durations with the median of every finished test', () => {
  const line = (title: string, time: string) =>
    `2026-11-12T10:00:00.0Z   ✓   3 [desktop-chromium] › e2e/view.spec.ts:12:1 › ${title} (${time})`;
  const logs = [
    [line('slow › nested', '1.5m'), line('fast', '900ms'), '  12 passed (5.2m)'].join('\n'),
    [line('slow › nested', '60.0s'), line('fast', '1.1s')].join('\n'),
    line('slow › nested', '2.0m').replace('✓', '✘'),
  ];
  assert.deepEqual(parseShardLog(logs[0]), [
    ['[desktop-chromium] › view.spec.ts › slow › nested', 90000],
    ['[desktop-chromium] › view.spec.ts › fast', 900],
  ]);
  assert.deepEqual(medianDurations(logs), {
    '[desktop-chromium] › view.spec.ts › fast': 1000,
    '[desktop-chromium] › view.spec.ts › slow › nested': 90000,
  });
});
