import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { Window, HTMLInputElement as DOMInput, HTMLFormElement as DOMForm } from 'happy-dom';
import { createFurniture, type FurnitureItem } from '../src/furniture/model';

// Unit tests exercise the DOM controller; styles and WebGL are intentionally absent.
registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
    return nextLoad(url, context);
  },
});
const { FurniturePanel } = await import('../src/furniture/panel');

function setup(initialEditing = true, initialKind: FurnitureItem['kind'] = 'sofa') {
  let editing = initialEditing;
  const window = new Window({ url: 'http://localhost' });
  const names = [
    'document',
    'HTMLElement',
    'HTMLInputElement',
    'HTMLSelectElement',
    'HTMLTextAreaElement',
    'FormData',
    'localStorage',
  ] as const;
  const saved = new Map(
    names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
  );
  for (const name of names)
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value: window[name],
    });
  const container = window.document.createElement('div');
  window.document.body.append(container);
  let items = [createFurniture({ kind: initialKind, id: 'sofa', position: [3, 3] })];
  let selected: string | undefined = 'sofa';
  const added: FurnitureItem[] = [];
  const panel = new FurniturePanel(container as unknown as HTMLElement, {
    getItems: () => structuredClone(items),
    getSelectedId: () => selected,
    getLevel: () => ({
      id: 'test',
      name: 'Test',
      elevation: 0,
      ceilingHeight: 2.5,
      outline: [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
      walls: [],
      rooms: [],
      lights: [],
      spawn: { position: [3, 3], yaw: 0 },
    }),
    getAddPosition: () => [3, 3],
    onAdd: (item) => {
      added.push(item);
    },
    onUpdate: (item) => {
      items = items.map((old) => (old.id === item.id ? item : old));
    },
    onDelete: () => {},
    onDuplicate: () => {},
    onSelect: (id) => {
      selected = id;
    },
    onUndo: () => {},
    onRedo: () => {},
    canUndo: () => false,
    canRedo: () => false,
    onEdit: () => {
      editing = true;
      panel.render();
    },
    isEditing: () => editing,
    onOverlays: () => {},
    onSnap: () => {},
    getChecks: () => [],
    onToast: () => {},
    onLink: () => {},
    onUnlink: () => {},
  });
  return {
    window,
    container,
    panel,
    added,
    cleanup: () => {
      panel.dispose();
      window.close();
      for (const name of names) {
        const prior = saved.get(name);
        if (prior) Object.defineProperty(globalThis, name, prior);
        else Reflect.deleteProperty(globalThis, name);
      }
    },
  };
}

test('clicking a native configuration control or summary does not rebuild the editing form', () => {
  const { window, container, cleanup } = setup();
  try {
    const form = container.querySelector('form')!;
    const name = container.querySelector<DOMInput>('input[name=name]')!;
    name.value = 'Mon canapé en cours';
    const details = container.querySelector('details.furniture-advanced')!;
    details.setAttribute('open', '');
    const shape = container.querySelector('select[name=sofaShape]')!;
    shape.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.equal(container.querySelector('form'), form);
    assert.equal(container.querySelector('details.furniture-advanced'), details);
    assert.ok(details.hasAttribute('open'));
    details
      .querySelector('summary')!
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.equal(container.querySelector('form'), form);
    assert.equal(
      container.querySelector<DOMInput>('input[name=name]')!.value,
      'Mon canapé en cours',
    );
  } finally {
    cleanup();
  }
});

test('leaving the panel keeps unapplied input and open sections intact', async () => {
  const { window, container, panel, cleanup } = setup();
  try {
    const name = container.querySelector<DOMInput>('input[name=name]')!;
    name.focus();
    name.value = 'Brouillon conservé';
    const details = container.querySelector('details.furniture-advanced')!;
    details.setAttribute('open', '');
    const outside = window.document.createElement('button');
    window.document.body.append(outside);
    outside.focus();
    await Promise.resolve();
    assert.equal(
      container.querySelector<DOMInput>('input[name=name]')!.value,
      'Brouillon conservé',
    );
    assert.equal(container.querySelector('details.furniture-advanced'), details);
    panel.render();
    assert.ok(
      container.querySelector('details.furniture-advanced')!.hasAttribute('open'),
      'model updates preserve expanded details',
    );
  } finally {
    cleanup();
  }
});

test('the addition dialog accepts body depth and extended total depth as displayed', () => {
  const { window, panel, added, cleanup } = setup();
  try {
    panel.openAdd();
    const form = window.document.querySelector<DOMForm>('#furniture-add-form')!;
    const input = (name: string, value: string) => {
      (form.elements.namedItem(name) as unknown as DOMInput).value = value;
    };
    input('sofaShape', 'corner');
    (form.elements.namedItem('sofaShape') as unknown as DOMInput).dispatchEvent(
      new window.Event('change', { bubbles: true }),
    );
    for (const [name, value] of Object.entries({
      width: '300',
      depth: '115',
      height: '100',
      returnDepth: '236',
      returnWidth: '116',
      sofaSide: 'right',
    }))
      input(name, value);
    // Range and geometry validation are covered separately; bypass emulated floating-step checks.
    form.reportValidity = () => true;
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    assert.equal(
      added.length,
      1,
      window.document.querySelector('.furniture-add-status')?.textContent ?? '',
    );
    assert.equal(added[0].depth, 2.36);
    assert.equal(added[0].sofa?.seatDepth, 1.15);
    assert.equal(added[0].sofa?.returnWidth, 1.16);
    assert.equal(window.document.querySelector('[data-source-mode]'), null);
  } finally {
    cleanup();
  }
});

test('single selection stays compact and a double-click opens the dimensional editor', () => {
  const { window, container, cleanup } = setup(false);
  try {
    assert.equal(container.querySelector('.furniture-edit-form'), null);
    container
      .querySelector('[data-furniture-select]')!
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.equal(container.querySelector('.furniture-edit-form'), null);
    container
      .querySelector('[data-furniture-select]')!
      .dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
    assert.ok(container.querySelector('.furniture-edit-form'));
    assert.ok(container.querySelector('input[name=width]'));
  } finally {
    cleanup();
  }
});

test('TV creation asks for inches and keeps raw dimensions collapsed', () => {
  const { window, panel, added, cleanup } = setup();
  try {
    panel.openAdd();
    const form = window.document.querySelector<DOMForm>('#furniture-add-form')!;
    const kind = form.elements.namedItem('kind') as unknown as DOMInput;
    kind.value = 'tv';
    kind.dispatchEvent(new window.Event('change', { bubbles: true }));
    const inches = form.elements.namedItem('tvDiagonal') as unknown as DOMInput;
    assert.equal(inches.value, '55');
    assert.ok(!form.querySelector('[data-tv-fields]')!.hasAttribute('hidden'));
    assert.ok(!form.querySelector('[data-dimensions]')!.hasAttribute('open'));
    inches.value = '65';
    inches.dispatchEvent(new window.Event('input', { bubbles: true }));
    form.reportValidity = () => true;
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    assert.equal(added.length, 1);
    assert.equal(added[0].tvDiagonalInches, 65);
    assert.ok(added[0].width > 1.45 && added[0].width < 1.47);
    assert.equal(added[0].depth, 0.18);
  } finally {
    cleanup();
  }
});

test('editing TV inches keeps the diagonal control visible and updates its dimensions', () => {
  const { window, container, cleanup } = setup(true, 'tv');
  try {
    const inches = container.querySelector<DOMInput>('input[name=tvDiagonal]')!;
    assert.equal(inches.value, '55');
    inches.value = '65';
    inches.dispatchEvent(new window.Event('input', { bubbles: true }));
    assert.ok(!container.querySelector('[data-tv-fields]')!.hasAttribute('hidden'));
    assert.ok(!container.querySelector('[data-tv-fields]')!.hasAttribute('disabled'));
    const width = Number(container.querySelector<DOMInput>('input[name=width]')!.value);
    assert.ok(width > 145 && width < 147);
    assert.equal(inches.value, '65');
  } finally {
    cleanup();
  }
});
