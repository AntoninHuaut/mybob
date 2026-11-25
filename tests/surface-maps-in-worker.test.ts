import assert from 'node:assert/strict';
import test from 'node:test';
import { generateMapsInWorker } from '../src/scene/surfaceMapsInWorker';

class FakeWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  terminated = false;
  terminate() {
    this.terminated = true;
  }
}

test('the maps a worker sends are adopted, and the worker is closed', async () => {
  const worker = new FakeWorker();
  const adopted: unknown[] = [];
  const done = generateMapsInWorker(
    () => worker as unknown as Worker,
    (maps) => adopted.push(maps),
  );
  const maps = { surface: {}, furniture: {} };
  worker.onmessage?.({ data: maps });
  await done;
  assert.deepEqual(adopted, [maps]);
  assert.equal(worker.terminated, true);
});

test('a failing or missing worker leaves the generation to the main thread', async () => {
  const worker = new FakeWorker();
  const adopted: unknown[] = [];
  const failed = generateMapsInWorker(
    () => worker as unknown as Worker,
    (maps) => adopted.push(maps),
  );
  worker.onerror?.();
  await failed;
  assert.equal(worker.terminated, true);
  await generateMapsInWorker(
    () => {
      throw new Error('no workers here');
    },
    (maps) => adopted.push(maps),
  );
  assert.deepEqual(adopted, []);
});

test('a worker that never answers is given up after the timeout', async () => {
  const worker = new FakeWorker();
  const adopted: unknown[] = [];
  await generateMapsInWorker(
    () => worker as unknown as Worker,
    (maps) => adopted.push(maps),
    10,
  );
  assert.equal(worker.terminated, true);
  worker.onmessage?.({ data: { surface: {}, furniture: {} } });
  assert.deepEqual(adopted, [], 'a late answer is ignored: the main thread generated the maps');
});
