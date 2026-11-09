import assert from 'node:assert/strict';
import test from 'node:test';
import {
  Window,
  HTMLInputElement as DOMInput,
  HTMLSelectElement as DOMSelect,
  HTMLFormElement as DOMForm,
} from 'happy-dom';
import { VariantsPanel } from '../src/ui/variantsPanel';
import type { VariantBook } from '../src/furniture/variants';
import type { Level } from '../src/model/types';
import type { FurnitureItem } from '../src/furniture/model';

test('variant naming keeps native input while typing, cancels without callbacks and switches explicitly', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const window = new Window();
  Object.defineProperty(globalThis, 'document', { configurable: true, value: window.document });
  try {
    const host = window.document.createElement('section');
    window.document.body.append(host);
    const book: VariantBook = {
      version: 1,
      activeId: 'a',
      variants: [
        { id: 'a', name: 'A', levels: {} },
        { id: 'b', name: 'B', levels: {} },
      ],
    };
    const actions: string[] = [];
    const panel = new VariantsPanel(host as unknown as HTMLElement, {
      getBook: () => book,
      onSelect: (id) => actions.push(`select:${id}`),
      onDuplicate: (name) => actions.push(`duplicate:${name}`),
      onRename: (name) => actions.push(`rename:${name}`),
      onDelete: () => actions.push('delete'),
      onError: (message) => assert.fail(message),
    });
    panel.render();
    host
      .querySelector('[data-variant-action=delete]')!
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.match(host.textContent!, /Supprimer « A »/);
    host
      .querySelector('[data-variant-action=cancel]')!
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.deepEqual(actions, []);
    host
      .querySelector('[data-variant-action=delete]')!
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    host
      .querySelector('[data-variant-action=confirm-delete]')!
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.deepEqual(actions, ['delete']);
    actions.length = 0;
    panel.finishEditing();
    host
      .querySelector('[data-variant-action=duplicate]')!
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    const input = host.querySelector<DOMInput>('[name=variantName]')!;
    input.value = 'Salon lumineux';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.equal(host.querySelector('[name=variantName]'), input);
    host
      .querySelector('[data-variant-action=cancel]')!
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.deepEqual(actions, []);
    host
      .querySelector('[data-variant-action=duplicate]')!
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    host.querySelector<DOMInput>('[name=variantName]')!.value = 'Option C';
    host
      .querySelector<DOMForm>('form')!
      .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    assert.deepEqual(actions, ['duplicate:Option C']);
    panel.finishEditing();
    host
      .querySelector('[data-variant-action=rename]')!
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    host
      .querySelector<DOMForm>('form')!
      .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    assert.equal(
      host.querySelector('[name=variantName]'),
      null,
      'saving the unchanged name closes the form',
    );
    assert.deepEqual(
      actions,
      ['duplicate:Option C'],
      'an unchanged name does not trigger a storage write',
    );
    const select = host.querySelector<DOMSelect>('[name=layoutVariant]')!;
    select.value = 'b';
    select.dispatchEvent(new window.Event('change', { bubbles: true }));
    assert.deepEqual(actions, ['duplicate:Option C', 'select:b']);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});

test('variant thumbnails preview each layout of the current level and select on click', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const window = new Window();
  Object.defineProperty(globalThis, 'document', { configurable: true, value: window.document });
  try {
    const host = window.document.createElement('section');
    window.document.body.append(host);
    const level = {
      id: 'rdc',
      name: 'Rez-de-chaussée',
      elevation: 0,
      ceilingHeight: 2.5,
      outline: [
        [0, 0],
        [6, 0],
        [6, 5],
        [0, 5],
      ],
      walls: [],
      rooms: [
        {
          id: 'salon',
          name: 'Salon',
          kind: 'living',
          polygon: [
            [0, 0],
            [6, 0],
            [6, 5],
            [0, 5],
          ],
          label: [3, 2.5],
        },
      ],
      lights: [],
      spawn: { position: [1, 1], yaw: 0 },
    } as unknown as Level;
    const item = (id: string, x: number, color: string): FurnitureItem => ({
      id,
      name: id,
      kind: 'sofa' as const,
      width: 2,
      depth: 0.9,
      height: 0.8,
      position: [x, 1] as [number, number],
      rotation: 0,
      locked: false,
      color,
    });
    const book: VariantBook = {
      version: 1,
      activeId: 'a',
      variants: [
        { id: 'a', name: 'Salon', levels: { rdc: [item('a1', 1, '#5e7f6f')] } },
        { id: 'b', name: 'Autre', levels: { rdc: [item('b1', 4, '#d66b4e')] } },
      ],
    };
    const actions: string[] = [];
    const panel = new VariantsPanel(host as unknown as HTMLElement, {
      getBook: () => book,
      getLevel: () => level,
      onSelect: (id) => actions.push(`select:${id}`),
      onDuplicate: () => {},
      onRename: () => {},
      onDelete: () => {},
      onError: (message) => assert.fail(message),
    });
    panel.render();
    const thumbs = host.querySelectorAll('[data-variant-thumb]');
    assert.equal(thumbs.length, 2);
    assert.match(thumbs[0]!.innerHTML, /fill="#5e7f6f"/);
    assert.match(thumbs[1]!.innerHTML, /fill="#d66b4e"/);
    assert.equal(thumbs[0]!.getAttribute('aria-pressed'), 'true');
    assert.equal(thumbs[1]!.getAttribute('aria-pressed'), 'false');
    (thumbs[1] as unknown as HTMLElement).dispatchEvent(
      new window.MouseEvent('click', { bubbles: true }) as unknown as Event,
    );
    assert.deepEqual(actions, ['select:b']);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});
