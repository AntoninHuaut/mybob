import assert from 'node:assert/strict';
import test from 'node:test';
import { LayoutSession } from '../src/furniture/layoutSession';
import {
  createFurniture,
  loadLayout,
  saveLayout,
  type FurnitureItem,
} from '../src/furniture/model';

test('failed storage writes survive project/level switches and remain available for export', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const storage = new Map<string, string>();
  let failWrite = false;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (failWrite) throw new Error('QuotaExceededError');
        storage.set(key, value);
      },
    },
  });
  try {
    const session = new LayoutSession();
    const first = createFurniture({ kind: 'sofa', position: [3, 3] });
    saveLayout('project', 'ground', [first]);
    const changed = { ...first, position: [4, 3] } as FurnitureItem;
    failWrite = true;
    assert.throws(() => session.save('project', 'ground', [changed]), /sauvegarder/);
    assert.equal(session.hasUnsaved, true);
    assert.deepEqual(session.load('project', 'upstairs'), []);
    assert.deepEqual(session.load('other-project', 'ground'), []);
    assert.equal(session.load('project', 'ground')[0].position[0], 4);
    assert.equal(loadLayout('project', 'ground')[0].position[0], 3);
    const exported = session.load('project', 'ground');
    exported[0].position[0] = 99;
    assert.equal(session.load('project', 'ground')[0].position[0], 4);
    // Empty layouts must also survive a failed deletion write.
    assert.throws(() => session.save('project', 'upstairs', []));
    failWrite = false;
    session.save('project', 'ground', session.load('project', 'ground'));
    assert.equal(loadLayout('project', 'ground')[0].position[0], 4);
    assert.equal(session.hasUnsaved, true);
    session.save('project', 'upstairs', []);
    assert.equal(session.hasUnsaved, false);
    session.retain('project', 'ground', [changed]);
    const backup = session.forget('project', 'ground')!;
    assert.equal(session.hasUnsaved, false);
    session.retain('project', 'ground', backup);
    assert.equal(session.hasUnsaved, true);
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
