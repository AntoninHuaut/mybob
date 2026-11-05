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
      onError: (message) => assert.fail(message),
    });
    panel.render();
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
