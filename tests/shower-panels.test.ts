import assert from 'node:assert/strict';
import test from 'node:test';
import { createFurniture, validateFurnitureList } from '../src/furniture/model';
import { showerOpening, showerPanelRects } from '../src/furniture/showerPanels';
import { measurementsFromForm } from '../src/furniture/measurements';

const near = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≠ ${expected}`);

test('a panel without a span covers its whole side, as before', () => {
  const shower = createFurniture({
    kind: 'shower',
    width: 1.2,
    depth: 0.9,
    showerPanels: ['left', 'front'],
  });
  const [left, front] = showerPanelRects(shower);
  near(left.sizeZ, 0.9);
  near(left.z, 0);
  near(front.sizeX, 1.2);
  near(front.x, 0);
  near(showerOpening(shower, 'front'), 0);
  near(showerOpening(shower, 'back'), 1.2);
});

test('a 120 cm shower with an 80 cm front panel leaves 40 cm open', () => {
  const shower = createFurniture({
    kind: 'shower',
    width: 1.2,
    depth: 0.9,
    showerPanels: ['front'],
    showerPanelSpans: { front: { length: 0.8 } },
  });
  const [front] = showerPanelRects(shower);
  near(front.sizeX, 0.8);
  // Starts at the left edge (-0.6) and ends 40 cm short of the right edge.
  near(front.x - front.sizeX / 2, -0.6);
  near(front.x + front.sizeX / 2, 0.2);
  near(showerOpening(shower, 'front'), 0.4);
});

test('a front panel can start from the right, a side panel always starts at the back', () => {
  const shower = createFurniture({
    kind: 'shower',
    width: 1.2,
    depth: 0.9,
    showerPanels: ['front', 'left'],
    showerPanelSpans: { front: { length: 0.8, from: 'right' }, left: { length: 0.5 } },
  });
  const [front, left] = showerPanelRects(shower);
  near(front.x + front.sizeX / 2, 0.6);
  near(front.x - front.sizeX / 2, -0.2);
  near(left.z - left.sizeZ / 2, -0.45);
  near(left.z + left.sizeZ / 2, 0.05);
  near(showerOpening(shower, 'left'), 0.4);
});

test('a span longer than its side is clamped, so shrinking a shower never invalidates it', () => {
  const shower = createFurniture({
    kind: 'shower',
    width: 1.2,
    showerPanels: ['front'],
    showerPanelSpans: { front: { length: 1.1 } },
  });
  const shrunk = validateFurnitureList([{ ...shower, width: 0.7 }])[0];
  near(showerPanelRects(shrunk)[0].sizeX, 0.7);
});

test('spans are validated: only ticked sides, sane lengths, direction only on front and back', () => {
  const spans = (value: unknown, panels = ['front']) =>
    createFurniture({
      kind: 'shower',
      showerPanels: panels as never,
      showerPanelSpans: value as never,
    });
  assert.throws(() => spans({ back: { length: 0.5 } }), /longueur/);
  assert.throws(() => spans({ front: { length: 0 } }), /longueur/);
  assert.throws(() => spans({ front: { length: Number.NaN } }), /longueur/);
  assert.throws(() => spans({ front: { length: 99 } }), /longueur/);
  assert.throws(() => spans({ left: { length: 0.5, from: 'right' } }, ['left']), /longueur/);
  assert.throws(() => spans({ top: { length: 0.5 } }), /longueur/);
  assert.throws(() =>
    createFurniture({ kind: 'table', showerPanelSpans: { front: { length: 1 } } }),
  );
  assert.doesNotThrow(() => spans({ front: { length: 0.5, from: 'right' } }));
});

test('the form reads a length per ticked side and ignores blanks and unticked sides', () => {
  const data = new FormData();
  data.set('width', '120');
  data.set('depth', '90');
  data.set('height', '200');
  data.set('showerTray', '6');
  data.set('showerPanelFront', 'on');
  data.set('showerPanelFrontLength', '80');
  data.set('showerPanelFrontFrom', 'right');
  data.set('showerPanelLeft', 'on');
  data.set('showerPanelLeftLength', '');
  data.set('showerPanelBackLength', '30');
  const read = measurementsFromForm(data, 'shower');
  assert.deepEqual(read.showerPanels, ['left', 'front']);
  assert.deepEqual(read.showerPanelSpans, { front: { length: 0.8, from: 'right' } });
  data.delete('showerPanelFrontLength');
  assert.equal(measurementsFromForm(data, 'shower').showerPanelSpans, undefined);
});
