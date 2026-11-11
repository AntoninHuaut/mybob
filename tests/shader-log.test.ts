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
