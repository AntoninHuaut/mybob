import assert from 'node:assert/strict';
import test from 'node:test';
import { Window, HTMLButtonElement as DOMButton } from 'happy-dom';
import { confirmImportReplacement } from '../src/ui/confirmImport';

test('replacement stays pending during backup export and Cancel preserves the existing project', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const window = new Window();
  Object.defineProperty(globalThis, 'document', { configurable: true, value: window.document });
  try {
    let exports = 0;
    const states: boolean[] = [];
    const result = confirmImportReplacement(
      '<Maison>',
      (open) => states.push(open),
      () => exports++,
    );
    const dialog = window.document.querySelector('dialog')!;
    assert.equal(dialog.open, true);
    assert.equal(dialog.querySelector('h2')!.textContent, 'Remplacer « <Maison> » ?');
    assert.equal(dialog.querySelector('maison'), null);
    dialog.querySelector<DOMButton>('[data-export]')!.click();
    assert.equal(exports, 1);
    assert.equal(dialog.open, true);
    dialog.close('cancel');
    assert.equal(await result, false);
    assert.deepEqual(states, [true, false]);
    assert.equal(window.document.querySelector('dialog'), null);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});

test('replacement requires the explicit replace result', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const window = new Window();
  Object.defineProperty(globalThis, 'document', { configurable: true, value: window.document });
  try {
    const result = confirmImportReplacement('Projet', () => {});
    window.document.querySelector('dialog')!.close('replace');
    assert.equal(await result, true);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});
