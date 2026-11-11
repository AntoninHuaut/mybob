import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** List every collected test exactly once, preserving describe and project names. */
export function collectedTests(report) {
  if (report.errors?.length) throw new Error(JSON.stringify(report.errors));
  const tests = [];
  const visit = (suite, parents = []) => {
    const titles = suite.column ? [...parents, suite.title] : parents;
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests) {
        tests.push(`[${test.projectName}] › ${spec.file} › ${[...titles, spec.title].join(' › ')}`);
      }
    }
    for (const child of suite.suites ?? []) visit(child, titles);
  };
  for (const suite of report.suites) visit(suite);
  if (!tests.length || new Set(tests).size !== tests.length)
    throw new Error('Empty or ambiguous test list');
  return tests;
}

/** Longest first; each test goes to the shard with the least estimated work. */
export function balanceShards(tests, durations, count) {
  if (!Number.isInteger(count) || count < 1) throw new Error('Invalid shard count');
  const shards = Array.from({ length: count }, () => ({ tests: [], duration: 0 }));
  const estimate = (test) => durations[test] ?? 30_000;
  for (const test of [...tests].sort(
    (a, b) => estimate(b) - estimate(a) || a.localeCompare(b, 'en'),
  )) {
    const shard = shards.reduce((best, next) => (next.duration < best.duration ? next : best));
    shard.tests.push(test);
    shard.duration += estimate(test);
  }
  return shards;
}

function main() {
  const match = /^(\d+)\/(\d+)$/.exec(process.argv[2] ?? '');
  if (!match) throw new Error('Usage: node scripts/e2e-shard.mjs <index>/<count> [--list]');
  const [, index, count] = match.map(Number);
  if (index < 1 || index > count) throw new Error('Invalid shard index');
  const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');
  const collected = spawnSync(process.execPath, [cli, 'test', '--list', '--reporter=json'], {
    encoding: 'utf8',
  });
  if (collected.status !== 0) throw new Error(collected.stderr || collected.stdout);
  const tests = collectedTests(JSON.parse(collected.stdout));
  const durations = JSON.parse(
    readFileSync(new URL('./e2e-durations.json', import.meta.url), 'utf8'),
  );
  const shards = balanceShards(tests, durations, count);
  const shard = shards[index - 1];
  console.log(
    `Shard ${index}/${count}: ${shard.tests.length}/${tests.length} tests, estimated ${(shard.duration / 1000).toFixed(1)} s of worker time`,
  );
  const directory = mkdtempSync(join(tmpdir(), 'mybob-e2e-'));
  try {
    const file = join(directory, 'tests.txt');
    writeFileSync(file, shard.tests.join('\n'));
    const run = spawnSync(
      process.execPath,
      [cli, 'test', '--test-list', file, ...process.argv.slice(3)],
      { stdio: 'inherit' },
    );
    process.exitCode = run.status ?? 1;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
