import assert from 'node:assert/strict';
import test from 'node:test';
import { TIMED_OUT, withTimeout } from '../src/scene/engine';

test('une initialisation void réussie n’est pas confondue avec un dépassement', async () => {
  // `engine.initAsync()` résout avec `void` : un `undefined` ne peut pas servir
  // de sentinelle, sinon WebGPU est écarté à chaque démarrage réussi.
  const initialised = await withTimeout(Promise.resolve(), 50);
  assert.notEqual(initialised, TIMED_OUT, 'WebGPU serait écarté malgré une init réussie');
  assert.equal(initialised, undefined);
});

test('withTimeout rend la valeur attendue ou la sentinelle', async () => {
  assert.equal(await withTimeout(Promise.resolve('adaptateur'), 50), 'adaptateur');
  assert.equal(await withTimeout(new Promise<string>(() => {}), 10), TIMED_OUT);
});
