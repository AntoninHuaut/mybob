import assert from 'node:assert/strict';
import test from 'node:test';
import { televisionDimensions } from '../src/furniture/television';
import { createFurniture, FURNITURE_PRESETS, validateFurnitureList } from '../src/furniture/model';

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-10, `${a} ≠ ${b}`);

test('television screen dimensions preserve the exact inch diagonal and 16:9 aspect ratio', () => {
  for (const inches of [5, 32, 43, 55, 65, 75, 85, 100, 300]) {
    const size = televisionDimensions(inches);
    near(Math.hypot(size.screenWidth, size.screenHeight), inches * 0.0254);
    near(size.screenWidth / size.screenHeight, 16 / 9);
    near(size.width - size.screenWidth, 0.02);
    near(size.height - size.screenHeight, 0.08);
    near(size.depth, 0.18);
  }
});

test('invalid diagonal values fail explicitly', () => {
  for (const inches of [NaN, Infinity, 0, 4.9, 300.1])
    assert.throws(() => televisionDimensions(inches), /diagonale/);
});

test('new TVs default to 55 inches and derive chassis dimensions from another chosen diagonal', () => {
  const defaults = createFurniture({ kind: 'tv' }),
    size55 = televisionDimensions(55);
  assert.equal(defaults.tvDiagonalInches, 55);
  near(defaults.width, size55.width);
  near(defaults.height, size55.height);
  near(defaults.depth, size55.depth);
  assert.equal(FURNITURE_PRESETS.tv.tvDiagonalInches, 55);
  const large = createFurniture({ kind: 'tv', tvDiagonalInches: 65 }),
    size65 = televisionDimensions(65);
  near(large.width, size65.width);
  near(large.height, size65.height);
  assert.equal(large.tvDiagonalInches, 65);
});

test('explicit advanced dimensions stay authoritative and incompatible diagonal metadata is removed', () => {
  const size = televisionDimensions(65);
  const wider = createFurniture({
    kind: 'tv',
    tvDiagonalInches: 65,
    width: size.width + 0.2,
    depth: 0.25,
  });
  near(wider.width, size.width + 0.2);
  near(wider.depth, 0.25);
  near(wider.height, size.height);
  assert.equal(wider.tvDiagonalInches, 65);
  const custom = createFurniture({
    kind: 'tv',
    tvDiagonalInches: 65,
    width: 1,
    height: 0.7,
    depth: 0.1,
  });
  assert.equal(custom.width, 1);
  assert.equal(custom.height, 0.7);
  assert.equal(custom.depth, 0.1);
  assert.equal(custom.tvDiagonalInches, undefined);
});

test('legacy TV dimensions without diagonal metadata survive validation and duplication', () => {
  const legacy = createFurniture({
    kind: 'tv',
    width: 1.23,
    depth: 0.12,
    height: 0.75,
    elevation: 0,
  });
  assert.equal(legacy.tvDiagonalInches, undefined);
  assert.deepEqual(validateFurnitureList([legacy])[0], legacy);
  const duplicate = createFurniture({ ...legacy, id: undefined });
  assert.notEqual(duplicate.id, legacy.id);
  assert.equal(duplicate.tvDiagonalInches, undefined);
  assert.equal(duplicate.width, 1.23);
  assert.equal(duplicate.height, 0.75);
  assert.equal(duplicate.depth, 0.12);
  const known = createFurniture({ kind: 'tv', tvDiagonalInches: 75 });
  const copied = createFurniture({ ...known, id: undefined });
  assert.equal(copied.tvDiagonalInches, 75);
  near(copied.width, known.width);
  near(copied.height, known.height);
});

test('imported diagonal metadata must describe an actual TV screen fitting within the declared chassis', () => {
  assert.throws(
    () => validateFurnitureList([{ ...createFurniture(), tvDiagonalInches: 55 }]),
    /diagonale/,
  );
  assert.throws(
    () => validateFurnitureList([{ ...createFurniture({ kind: 'tv' }), tvDiagonalInches: 301 }]),
    /diagonale/,
  );
  assert.throws(
    () => validateFurnitureList([{ ...createFurniture({ kind: 'tv' }), width: 0.5 }]),
    /écran/,
  );
  const panelOnly = {
    ...createFurniture({ kind: 'tv' }),
    height: televisionDimensions(55).screenHeight,
  };
  assert.equal(
    validateFurnitureList([panelOnly])[0].tvDiagonalInches,
    55,
    'custom bezels/feet are not constrained to the approximate default',
  );
});
