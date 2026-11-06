import assert from 'node:assert/strict';
import test from 'node:test';
import { createFurniture, layoutStorageKey, saveLayout } from '../src/furniture/model';
import { validateVariantBook, VariantSession, variantsStorageKey } from '../src/furniture/variants';

function setup() {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const data = new Map<string, string>();
  let unavailable = false;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (unavailable) throw new Error('quota');
        data.set(key, value);
      },
    },
  });
  return {
    data,
    fail: (value: boolean) => {
      unavailable = value;
    },
    cleanup: () => {
      if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
      else Reflect.deleteProperty(globalThis, 'localStorage');
    },
  };
}

test('deleting a variant keeps the other layouts and always leaves one active', () => {
  const { cleanup } = setup();
  try {
    const session = new VariantSession();
    session.register('house', ['ground', 'upper']);
    const sofa = createFurniture({ id: 'sofa', kind: 'sofa' });
    session.save('house', 'upper', [sofa]);
    session.duplicate('house', 'Alternative');
    session.save('house', 'upper', []);
    session.deleteActive('house');
    assert.equal(session.active('house').name, 'Aménagement initial');
    assert.equal(session.load('house', 'upper')[0].id, 'sofa');
    assert.throws(() => session.deleteActive('house'), /au moins une variante/);
    const restored = new VariantSession();
    restored.register('house', ['ground', 'upper']);
    assert.equal(restored.book('house').variants.length, 1);
    assert.equal(restored.load('house', 'upper')[0].id, 'sofa');
  } finally {
    cleanup();
  }
});

test('variants migrate every legacy level without overwriting its backup and retain precise independent layouts', () => {
  const { data, cleanup } = setup();
  try {
    const sofa = createFurniture({ id: 'sofa', kind: 'sofa', width: 2.123456, position: [3, 3] });
    const desk = createFurniture({ id: 'desk', kind: 'desk', position: [4, 4] });
    saveLayout('house', 'ground', [sofa]);
    saveLayout('house', 'upstairs', [desk]);
    const backup = data.get(layoutStorageKey('house', 'ground'));
    const session = new VariantSession();
    session.register('house', ['ground', 'upstairs']);
    assert.equal(session.load('house', 'ground')[0].width, 2.123456);
    assert.equal(data.has(variantsStorageKey('house')), false);
    session.duplicate('house', 'Option B');
    const optionB = session.active('house').id;
    session.save('house', 'ground', [{ ...sofa, position: [5, 3] }]);
    session.save('house', 'upstairs', []);
    session.select('house', 'initial');
    assert.deepEqual(session.load('house', 'ground')[0].position, [3, 3]);
    assert.equal(session.load('house', 'upstairs').length, 1);
    session.select('house', optionB);
    assert.deepEqual(session.load('house', 'ground')[0].position, [5, 3]);
    assert.equal(session.load('house', 'upstairs').length, 0);
    assert.equal(data.get(layoutStorageKey('house', 'ground')), backup);
    const restored = new VariantSession();
    restored.register('house', ['ground', 'upstairs']);
    assert.equal(restored.active('house').name, 'Option B');
    assert.equal(restored.load('house', 'ground')[0].width, 2.123456);
    const returned = restored.load('house', 'ground');
    returned[0].width = 100;
    assert.equal(restored.load('house', 'ground')[0].width, 2.123456);
  } finally {
    cleanup();
  }
});

test('failed variant writes remain exportable across project switches and explicit replacement rollback', () => {
  const { fail, cleanup } = setup();
  try {
    const session = new VariantSession();
    session.register('one', ['ground']);
    session.register('two', ['ground']);
    const sofa = createFurniture({ kind: 'sofa' });
    fail(true);
    assert.throws(() => session.save('one', 'ground', [sofa]), /non sauvegardée/);
    assert.equal(session.hasUnsaved, true);
    assert.deepEqual(session.load('two', 'ground'), []);
    assert.equal(session.load('one', 'ground')[0].id, sofa.id);
    assert.throws(() => session.duplicate('one', 'Essai'), /non sauvegardée/);
    assert.equal(session.book('one').variants.length, 2);
    const exported = JSON.parse(JSON.stringify(session.book('one')));
    assert.equal(
      validateVariantBook(exported, ['ground']).variants[1].levels.ground[0].id,
      sofa.id,
    );
    const previous = session.capture('one');
    session.install('one', {
      version: 1,
      activeId: 'empty',
      variants: [{ id: 'empty', name: 'Import', levels: { ground: [] } }],
    });
    session.restore('one', previous);
    assert.equal(session.active('one').name, 'Essai');
    assert.equal(session.hasUnsaved, true);
    fail(false);
    session.save('one', 'ground', session.load('one', 'ground'));
    assert.equal(session.hasUnsaved, false);
  } finally {
    cleanup();
  }
});

test('variant JSON rejects malformed identity, active IDs, furniture and unknown levels', () => {
  const book = {
    version: 1,
    activeId: 'a',
    variants: [{ id: 'a', name: 'A', levels: { ground: [] } }],
  };
  assert.doesNotThrow(() => validateVariantBook(book, ['ground']));
  for (const bad of [
    null,
    { ...book, version: 2 },
    { ...book, activeId: 'missing' },
    { ...book, variants: [...book.variants, ...book.variants] },
    { ...book, variants: [{ id: 'a', name: '', levels: { ground: [] } }] },
    { ...book, variants: [{ id: 'a', name: 'A', levels: { unknown: [] } }] },
    { ...book, variants: [{ id: 'a', name: 'A', levels: { ground: [null] } }] },
  ])
    assert.throws(() => validateVariantBook(bad, ['ground']));
});

test('legacy imports update only their supplied active levels while named alternatives survive', () => {
  const { cleanup } = setup();
  try {
    const session = new VariantSession();
    session.register('house', ['ground', 'upstairs']);
    const sofa = createFurniture({ kind: 'sofa' });
    session.save('house', 'ground', [sofa]);
    session.duplicate('house', 'Alternative');
    const result = session.prepareImport('house', ['ground', 'new-level'], [['ground', []]]);
    assert.equal(result.variants[0].levels.ground[0].id, sofa.id);
    assert.deepEqual(result.variants[1].levels.ground, []);
    assert.deepEqual(result.variants[0].levels['new-level'], []);
    assert.equal(Object.hasOwn(result.variants[0].levels, 'upstairs'), false);
    assert.equal(session.active('house').levels.ground.length, 1);
    const roundtrip = session.prepareImport('house', ['ground', 'new-level'], [], result);
    assert.deepEqual(roundtrip, result);
    assert.throws(() => session.rename('house', 'Aménagement initial'), /déjà utilisé/);
    assert.equal(session.active('house').name, 'Alternative');
  } finally {
    cleanup();
  }
});

test('a complete legacy export can restore corrupt variant storage without writing before confirmation', () => {
  const { data, cleanup } = setup();
  try {
    data.set(variantsStorageKey('house'), 'broken');
    const session = new VariantSession();
    session.register('house', ['ground', 'upstairs']);
    assert.throws(
      () => session.prepareImport('house', ['ground', 'upstairs'], [['ground', []]]),
      /export complet/,
    );
    const sofa = createFurniture({ kind: 'sofa' });
    const prepared = session.prepareImport(
      'house',
      ['ground', 'upstairs'],
      [
        ['ground', [sofa]],
        ['upstairs', []],
      ],
    );
    assert.equal(prepared.variants[0].levels.ground[0].id, sofa.id);
    assert.equal(data.get(variantsStorageKey('house')), 'broken');
  } finally {
    cleanup();
  }
});
