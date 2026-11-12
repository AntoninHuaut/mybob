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

const RESULT_LINE =
  /[✓✘]\s+\d+\s+(\[[^\]]+\]) › e2e\/(\S+?):\d+:\d+ › (.*) \(([\d.]+)(ms|s|m)\)\s*$/;
const UNIT_MS = { ms: 1, s: 1000, m: 60_000 };

/** Read every finished test and its duration from a text shard log (Playwright list reporter). */
export function parseShardLog(text) {
  const results = [];
  for (const line of text.split('\n')) {
    const match = RESULT_LINE.exec(line);
    if (!match) continue;
    const [, project, file, title, value, unit] = match;
    results.push([`${project} › ${file} › ${title}`, Math.round(Number(value) * UNIT_MS[unit])]);
  }
  return results;
}

/** Median duration per test over several shard logs, sorted by test name. */
export function medianDurations(logs) {
  const samples = new Map();
  for (const [test, ms] of logs.flatMap(parseShardLog)) {
    samples.set(test, [...(samples.get(test) ?? []), ms]);
  }
  return Object.fromEntries(
    [...samples]
      .sort(([a], [b]) => a.localeCompare(b, 'en'))
      .map(([test, values]) => {
        const sorted = values.sort((a, b) => a - b);
        const middle = sorted.length / 2;
        const median = Number.isInteger(middle)
          ? (sorted[middle - 1] + sorted[middle]) / 2
          : sorted[Math.floor(middle)];
        return [test, Math.round(median)];
      }),
  );
}

function refresh(files) {
  if (!files.length) throw new Error('Usage: node scripts/e2e-shard.mjs --refresh <log>...');
  const durations = medianDurations(files.map((file) => readFileSync(file, 'utf8')));
  if (!Object.keys(durations).length) throw new Error('No test result found in the logs');
  writeFileSync(
    new URL('./e2e-durations.json', import.meta.url),
    `${JSON.stringify(durations, null, 2)}\n`,
  );
  console.log(`Recorded ${Object.keys(durations).length} tests from ${files.length} logs`);
}

function main() {
  if (process.argv[2] === '--refresh') return refresh(process.argv.slice(3));
  const match = /^(\d+)\/(\d+)$/.exec(process.argv[2] ?? '');
  if (!match)
    throw new Error(
      'Usage: node scripts/e2e-shard.mjs <index>/<count> [--list] | --refresh <log>...',
    );
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
