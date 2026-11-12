import assert from 'node:assert/strict';
import test from 'node:test';
import { ShaderLog, type ShaderLogEngine } from '../src/scene/shaderLog';

type Listener = (engine: unknown, state: { target?: unknown }) => void;

function fakeEngine() {
  const before: Listener[] = [];
  const after: Listener[] = [];
  const cache: Record<string, unknown> = {};
  const engine = {
    _compiledEffects: cache,
    onBeforeShaderCompilationObservable: { add: (cb: Listener) => before.push(cb) },
    onAfterShaderCompilationObservable: { add: (cb: Listener) => after.push(cb) },
  } as unknown as ShaderLogEngine;
  const link = (key: string, program: object, advance: () => void) => {
    cache[key] = {};
    before.forEach((cb) => cb(engine, { target: program }));
    advance();
    after.forEach((cb) => cb(engine, { target: program }));
  };
  return { engine, link };
}

test('a link is timed and named after the effect cache entry that appeared', () => {
  let clock = 0;
  const log = new ShaderLog(() => clock);
  const { engine, link } = fakeEngine();
  log.attach(engine);
  clock = 100;
  log.mark('plan');
  link('pbr@defines', {}, () => (clock += 90));
  link('shadow@x', {}, () => (clock += 40));
  assert.deepEqual(
    log.entries.map((e) => [e.kind, Math.round(e.at), Math.round(e.ms), e.label]),
    [
      ['mark', 100, 0, 'plan'],
      ['link', 100, 90, 'pbr@defines'],
      ['link', 190, 40, 'shadow@x'],
    ],
  );
  assert.match(log.report(), /2 programmes liés · 130 ms/);
});

test('the log keeps a bounded history', () => {
  const log = new ShaderLog(() => 0);
  for (let i = 0; i < 700; i++) log.mark(`m${i}`);
  assert.ok(log.entries.length <= 600);
  assert.equal(log.entries.at(-1)?.label, 'm699');
});

function preparedLog(caps: object) {
  let clock = 0;
  const log = new ShaderLog(() => clock);
  const { engine, link } = fakeEngine();
  (engine as { getCaps?: () => object }).getCaps = () => caps;
  log.attach(engine);
  assert.match(log.summary().at(-1) ?? '', /aucune vue préparée/);
  log.markView('orbit', 'start', 'plugins');
  // Two links in flight at once: their latencies overlap.
  link('pbr@a', {}, () => (clock += 900));
  link('pbr@b', {}, () => (clock += 600));
  log.mark('  image 1');
  log.markView('orbit', 'end', 'plugins');
  link('pbr@late', {}, () => (clock += 25));
  log.markView('walk', 'start', 'plugins');
  link('pbr@c', {}, () => (clock += 200));
  log.markView('walk', 'end', 'plugins');
  return log;
}

test('without parallel linking, each preparation shows its overlay time and blocking sum', () => {
  const log = preparedLog({});
  assert.deepEqual(log.summary(), [
    '[shaders] compilation parallèle (KHR_parallel_shader_compile) : non (chaque liaison bloque la page)',
    '[shaders] préparation orbit : 1.50 s · 2 programmes · 1500 ms bloquants',
    '[shaders] préparation walk : 0.20 s · 1 programmes · 200 ms bloquants',
    '[shaders] 1 programmes liés après une préparation',
  ]);
  assert.match(log.report(), /4 programmes liés · 1725 ms bloquants au total/);
  assert.ok(log.report().includes('── prête : walk · plugins'));
});

test('with parallel linking, link durations are latencies and are never summed', () => {
  const log = preparedLog({ parallelShaderCompile: {} });
  assert.deepEqual(log.summary(), [
    '[shaders] compilation parallèle (KHR_parallel_shader_compile) : oui (les durées de liaison sont des latences, pas des blocages)',
    '[shaders] préparation orbit : 1.50 s · 2 programmes',
    '[shaders] préparation walk : 0.20 s · 1 programmes',
    '[shaders] 1 programmes liés après une préparation',
  ]);
  assert.doesNotMatch(log.report(), /bloquants/);
});
