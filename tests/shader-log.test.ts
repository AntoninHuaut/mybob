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

test('the summary sums each preparation and counts the links after a view is ready', () => {
  let clock = 0;
  const log = new ShaderLog(() => clock);
  const { engine, link } = fakeEngine();
  (engine as { getCaps?: () => object }).getCaps = () => ({});
  log.attach(engine);
  assert.match(log.summary().at(-1) ?? '', /aucune vue préparée/);
  log.markView('orbit', 'start', 'plugins');
  link('pbr@a', {}, () => (clock += 90));
  log.mark('  image 1');
  link('pbr@b', {}, () => (clock += 60));
  log.markView('orbit', 'end', 'plugins');
  link('pbr@late', {}, () => (clock += 25));
  log.markView('walk', 'start', 'plugins');
  link('pbr@c', {}, () => (clock += 200));
  log.markView('walk', 'end', 'plugins');
  assert.deepEqual(log.summary(), [
    '[shaders] compilation parallèle (KHR_parallel_shader_compile) : non (chaque liaison bloque)',
    '[shaders] préparation orbit : 2 programmes · 150 ms',
    '[shaders] préparation walk : 1 programmes · 200 ms',
    '[shaders] 1 programmes · 25 ms hors préparation',
  ]);
  assert.ok(log.report().includes('── prête : walk · plugins'));
});
