import assert from 'node:assert/strict';
import test from 'node:test';
import type { Wall } from '../src/model/types';
import { editOpening } from '../src/model/openingEdit';

test('measuring from the wall end preserves the opening type and door options', () => {
  const wall: Wall = {
    id: 'wall',
    start: [0, 0],
    end: [4, 0],
    thickness: 0.2,
    openings: [
      { id: 'door', kind: 'door', width: 1, height: 2, offset: 1, glazed: true, leaves: 2 },
    ],
  };
  const result = editOpening(wall, 'door', {
    kind: 'door',
    width: 0.9,
    height: 2,
    distance: 0.4,
    reference: 'end',
    hinge: 'end',
    swing: -1,
  });
  assert.ok(Math.abs(result.offset - 2.7) < 1e-9);
  assert.equal(result.glazed, true);
  assert.equal(result.leaves, 2);
  assert.equal(wall.openings![0].offset, 1);
});

test('window edits keep the sill on a valid imported jamb within the schema tolerance', () => {
  const source = {
    id: 'window',
    kind: 'window' as const,
    width: 0.9,
    height: 1,
    sill: 0.85,
    offset: 3.1005,
  };
  const wall: Wall = { id: 'wall', start: [0, 0], end: [4, 0], thickness: 0.2, openings: [source] };
  const result = editOpening(wall, source.id, {
    ...source,
    height: 1.2,
    reference: 'start',
    distance: source.offset,
  });
  assert.equal(result.sill, 0.85);
  assert.equal(result.offset, source.offset);
  assert.throws(
    () => editOpening(wall, 'other', { ...source, reference: 'start', distance: 2.5 }),
    /chevauche/,
  );
  assert.throws(
    () => editOpening(wall, 'other', { ...source, reference: 'start', distance: 3.5 }),
    /dépasse/,
  );
});
