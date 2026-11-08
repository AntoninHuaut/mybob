import assert from 'node:assert/strict';
import test from 'node:test';
import { VariantSession, variantsStorageKey, STALE_MESSAGE } from '../src/furniture/variants';
import { createFurniture } from '../src/furniture/model';

function withStorage(run: (storage: Map<string, string>) => void) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
      removeItem: (key: string) => void storage.delete(key),
    },
  });
  try {
    run(storage);
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
}

function openTab() {
  const session = new VariantSession();
  session.register('p', ['ground']);
  session.active('p');
  return session;
}

test('the second tab cannot overwrite the first one’s work', () =>
  withStorage((storage) => {
    const a = openTab();
    const b = openTab();
    const stale: string[] = [];
    b.onStale = (id) => stale.push(id);
    a.save('p', 'ground', [createFurniture({ kind: 'sofa', position: [3, 3] })]);
    const written = storage.get(variantsStorageKey('p'));
    assert.throws(
      () => b.save('p', 'ground', [createFurniture({ kind: 'table', position: [2, 2] })]),
      new Error(STALE_MESSAGE),
    );
    assert.equal(storage.get(variantsStorageKey('p')), written);
    assert.equal(b.isStale('p'), true);
    assert.deepEqual(stale, ['p']);
    // Even without a new comparison, the tab stays read-only.
    assert.throws(() => b.select('p', 'initial'), new Error(STALE_MESSAGE));
  }));

test('a lone tab keeps saving normally', () =>
  withStorage(() => {
    const a = openTab();
    a.save('p', 'ground', [createFurniture({ kind: 'sofa', position: [3, 3] })]);
    a.save('p', 'ground', [createFurniture({ kind: 'table', position: [1, 1] })]);
    assert.equal(a.isStale('p'), false);
    assert.equal(a.load('p', 'ground')[0].kind, 'table');
  }));

test('the storage event switches the tab to read-only before any write', () =>
  withStorage(() => {
    const a = openTab();
    a.markStale('p');
    assert.throws(
      () => a.save('p', 'ground', [createFurniture({ kind: 'sofa', position: [3, 3] })]),
      new Error(STALE_MESSAGE),
    );
  }));
