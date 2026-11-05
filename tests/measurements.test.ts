import assert from 'node:assert/strict';
import test from 'node:test';
import { measurementsFromForm, sofaDiagram } from '../src/furniture/measurements';
import { createFurniture, footprintParts } from '../src/furniture/model';
import { polygonArea } from '../src/model/geometry';

function measured(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

test('sofa form converts body depth and total extended depth without asking for their difference', () => {
  const data = measured({
    width: '300',
    depth: '115',
    height: '100',
    returnDepth: '236',
    returnWidth: '116',
    sofaShape: 'corner',
    sofaSide: 'right',
  });
  const item = createFurniture({ kind: 'sofa', ...measurementsFromForm(data, 'sofa') });
  assert.equal(item.width, 3);
  assert.equal(item.depth, 2.36);
  assert.equal(item.height, 1);
  assert.equal(item.sofa?.seatDepth, 1.15);
  assert.equal(item.sofa?.returnWidth, 1.16);
  assert.equal(item.sofa?.side, 'right');
  const occupied = footprintParts(item).reduce((sum, p) => sum + polygonArea(p), 0);
  assert.ok(Math.abs(occupied - (3 * 1.15 + 1.16 * (2.36 - 1.15))) < 1e-9);
  assert.match(sofaDiagram(data), /236 cm/);
  assert.match(sofaDiagram(data), /115 cm/);
  assert.doesNotMatch(sofaDiagram(data), /121 cm/);
});

test('ordinary furniture and straight sofas ignore the hidden return dimensions', () => {
  const data = measured({
    width: '160',
    depth: '40',
    height: '55',
    elevation: '0',
    sofaShape: 'straight',
    returnDepth: '236',
    returnWidth: '116',
  });
  assert.equal(measurementsFromForm(data, 'tv-stand').depth, 0.4);
  assert.equal(measurementsFromForm(data, 'sofa').sofa, undefined);
  assert.equal(measurementsFromForm(data, 'sofa').depth, 0.4);
});
