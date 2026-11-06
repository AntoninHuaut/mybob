import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { Window, HTMLInputElement as DOMInput, HTMLSelectElement as DOMSelect } from 'happy-dom';
import { createFurniture, type FurnitureItem } from '../src/furniture/model';
import type { SnapSettings } from '../src/furniture/arrangement';

registerHooks({
  load(url, context, next) {
    return url.endsWith('.css')
      ? { format: 'module', source: '', shortCircuit: true }
      : next(url, context);
  },
});
const { ArrangementPanel } = await import('../src/ui/arrangementPanel');

test('precise placement selects several items, preserves active controls and applies one snapshot', () => {
  const window = new Window({ url: 'http://localhost' });
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: window.document });
  const host = window.document.createElement('div');
  window.document.body.append(host);
  let ids: string[] = [];
  let items = [
    createFurniture({ id: 'a', position: [2, 2] }),
    createFurniture({ id: 'b', position: [5, 5] }),
  ];
  const applied: FurnitureItem[][] = [];
  const settings: SnapSettings[] = [];
  const panel = new ArrangementPanel(host as unknown as HTMLElement, {
    getItems: () => items,
    getSelectedIds: () => ids,
    getLevel: () => ({
      id: 'level',
      name: 'Pièce',
      elevation: 0,
      ceilingHeight: 3,
      outline: [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
      walls: [],
      rooms: [],
      lights: [],
      spawn: { position: [2, 2], yaw: 0 },
    }),
    onSelection: (next) => {
      ids = next;
    },
    onApply: (next) => {
      applied.push(next);
      items = next;
      return true;
    },
    onSnapSettings: (next) => {
      settings.push(next);
    },
  });
  try {
    for (const input of host.querySelectorAll<DOMInput>('[data-arrangement-select]')) {
      input.checked = true;
      input.dispatchEvent(new window.Event('change', { bubbles: true }));
    }
    assert.deepEqual(ids, ['a', 'b']);
    const axis = host.querySelector<DOMSelect>('[data-arrangement-axis]')!;
    axis.value = 'z';
    panel.render();
    assert.equal(host.querySelector('[data-arrangement-axis]'), axis);
    assert.equal(axis.value, 'z');
    host
      .querySelector('[data-align]')!
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.equal(applied.length, 1);
    assert.equal(items[0].position[1], items[1].position[1]);
    assert.deepEqual(panel.snapSettings, { grid: false, gridSize: 0.1 });
    const grid = host.querySelector<DOMInput>('[data-snap-grid]')!;
    grid.checked = true;
    grid.dispatchEvent(new window.Event('change', { bubbles: true }));
    assert.deepEqual(settings.at(-1), { grid: true, gridSize: 0.1 });
    host.querySelector<DOMInput>('[data-grid-size]')!.value = '';
    grid.checked = false;
    grid.dispatchEvent(new window.Event('change', { bubbles: true }));
    assert.deepEqual(settings.at(-1), { grid: false, gridSize: 0.1 });
    host
      .querySelector('[data-clear-selection]')!
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.deepEqual(ids, []);
  } finally {
    panel.dispose();
    window.close();
    if (prior) Object.defineProperty(globalThis, 'document', prior);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});
