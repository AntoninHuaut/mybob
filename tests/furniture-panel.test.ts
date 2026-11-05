import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import {
  Window,
  HTMLInputElement as DOMInput,
  HTMLFormElement as DOMForm,
  HTMLSelectElement as DOMSelect,
} from 'happy-dom';
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
  let rejectUpdates = false;
  const applied: FurnitureItem[][] = [];
  let checks: { itemId: string; severity: 'warning' | 'error'; message: string }[] = [];
  const dialogStates: boolean[] = [];
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
      if (rejectUpdates) return false;
      items = items.map((old) => (old.id === item.id ? item : old));
    },
    onApplyDraft: (snapshot, id) => {
      if (rejectUpdates) return false;
      applied.push(structuredClone(snapshot));
      items = structuredClone(snapshot);
      selected = id;
      return true;
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
    onEdit: (id) => panel.openEdit(id),
    onDialogState: (open) => dialogStates.push(open),
    onOverlays: () => {},
    onSnap: () => {},
    getChecks: () => checks,
    onToast: () => {},
    onLink: () => {},
    onUnlink: () => {},
  });
  if (initialEditing) panel.openEdit('sofa');
  const editor = window.document.querySelector('.furniture-edit-dialog')!;
  return {
    window,
    container,
    editor,
    dialogStates,
    getItems: () => structuredClone(items),
    setRejectUpdates: (reject: boolean) => {
      rejectUpdates = reject;
    },
    panel,
    added,
    applied,
    getSelectedId: () => selected,
    setChecks: (next: typeof checks) => {
      checks = next;
    },
    setItems: (next: FurnitureItem[]) => {
      items = structuredClone(next);
    },
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
  const { window, editor: container, cleanup } = setup();
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
  const { window, editor: container, panel, cleanup } = setup();
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
  const { window, container, editor, cleanup } = setup(false);
  try {
    assert.equal(container.querySelector('.furniture-edit-form'), null);
    container
      .querySelector('[data-furniture-select]')!
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.equal(container.querySelector('.furniture-edit-form'), null);
    container
      .querySelector('[data-furniture-select]')!
      .dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
    assert.equal(container.querySelector('.furniture-edit-form'), null);
    assert.ok(editor.hasAttribute('open'));
    assert.ok(editor.querySelector('.furniture-edit-form'));
    assert.ok(editor.querySelector('input[name=width]'));
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
  const { window, editor: container, cleanup } = setup(true, 'tv');
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

test('editing popup saves explicitly and cancellation leaves the furniture unchanged', async () => {
  const { window, container, editor, panel, getItems, dialogStates, cleanup } = setup();
  try {
    assert.equal(container.querySelector('form'), null);
    const name = editor.querySelector<DOMInput>('input[name=name]')!;
    name.value = 'Brouillon annulé';
    editor
      .querySelector('[data-edit-close]')!
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    assert.equal(getItems()[0].name, 'Canapé');
    assert.ok(!editor.hasAttribute('open'));
    assert.equal(dialogStates.at(-1), false);
    panel.openEdit('sofa');
    editor.querySelector<DOMInput>('input[name=name]')!.value = 'Mon canapé';
    const form = editor.querySelector<DOMForm>('form')!;
    form.reportValidity = () => true;
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    assert.equal(getItems()[0].name, 'Mon canapé');
    assert.ok(!editor.hasAttribute('open'));
    assert.equal(dialogStates.at(-1), false);
  } finally {
    cleanup();
  }
});

test('rejected edits keep the popup and draft open without empty group boxes or favorites', () => {
  const { window, editor, setRejectUpdates, getItems, cleanup } = setup();
  try {
    assert.equal(editor.querySelector('.furniture-group-controls'), null);
    assert.equal(editor.querySelector('[data-furniture-action=favorite]'), null);
    const form = editor.querySelector<DOMForm>('form')!;
    form.reportValidity = () => true;
    editor.querySelector<DOMInput>('input[name=name]')!.value = 'À ajuster';
    setRejectUpdates(true);
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    assert.ok(editor.hasAttribute('open'));
    assert.equal(editor.querySelector<DOMInput>('input[name=name]')!.value, 'À ajuster');
    assert.equal(getItems()[0].name, 'Canapé');
    assert.ok(editor.querySelector('.furniture-edit-status')!.textContent);
  } finally {
    cleanup();
  }
});

test('row pencil opens the editor and only errors receive a list badge', () => {
  const { window, container, editor, cleanup } = setup(false);
  try {
    assert.equal(container.querySelector('.furniture-edit-selected'), null);
    container
      .querySelector('[data-furniture-edit-id]')!
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.ok(editor.hasAttribute('open'));
    assert.equal(container.querySelectorAll('.furniture-heading .eyebrow span').length, 0);
  } finally {
    cleanup();
  }
});

test('linking a draft and cancelling leaves the persisted furniture untouched', async () => {
  const { window, panel, editor, getItems, setItems, applied, cleanup } = setup();
  try {
    const other = createFurniture({ kind: 'chair', id: 'chair', position: [6, 6] });
    setItems([...getItems(), other]);
    panel.openEdit('sofa');
    editor.querySelector<DOMForm>('form')!.reportValidity = () => true;
    editor.querySelector<DOMInput>('input[name=name]')!.value = 'Nom en attente';
    editor
      .querySelector('[data-furniture-action=link]')!
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.equal(getItems()[0].groupId, undefined);
    assert.equal(getItems()[0].name, 'Canapé');
    assert.equal(applied.length, 0);
    assert.match(editor.querySelector('.furniture-group-controls')!.textContent!, /Ensemble de 2/);
    editor
      .querySelector('[data-edit-close]')!
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    assert.equal(getItems()[0].groupId, undefined);
    assert.equal(getItems()[0].name, 'Canapé');
  } finally {
    cleanup();
  }
});

test('draft link and dimensional changes are applied together in one save', () => {
  const { window, panel, editor, getItems, setItems, applied, cleanup } = setup();
  try {
    setItems([...getItems(), createFurniture({ kind: 'chair', id: 'chair', position: [6, 6] })]);
    panel.openEdit('sofa');
    editor.querySelector<DOMForm>('form')!.reportValidity = () => true;
    editor.querySelector<DOMInput>('input[name=width]')!.value = '240';
    editor
      .querySelector('[data-furniture-action=link]')!
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    const form = editor.querySelector<DOMForm>('form')!;
    form.reportValidity = () => true;
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    assert.equal(applied.length, 1);
    assert.equal(getItems()[0].width, 2.4);
    assert.ok(getItems()[0].groupId);
    assert.equal(getItems()[0].groupId, getItems()[1].groupId);
    assert.ok(!editor.hasAttribute('open'));
  } finally {
    cleanup();
  }
});

test('duplicating inside the popup remains cancellable and retains the edited source', async () => {
  const { window, editor, getItems, applied, cleanup } = setup();
  try {
    editor.querySelector<DOMForm>('form')!.reportValidity = () => true;
    editor.querySelector<DOMInput>('input[name=name]')!.value = 'Canapé choisi';
    editor
      .querySelector('[data-furniture-action=duplicate]')!
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.ok(editor.hasAttribute('open'));
    assert.match(
      editor.querySelector('input[name=name]')!.getAttribute('value')!,
      /Canapé choisi.*copie/,
    );
    assert.equal(getItems().length, 1);
    assert.equal(applied.length, 0);
    editor
      .querySelector('[data-edit-close]')!
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    assert.equal(getItems().length, 1);
    assert.equal(getItems()[0].name, 'Canapé');
  } finally {
    cleanup();
  }
});

test('adding a television inside the editor saves the staged stand and TV atomically', () => {
  const { window, editor, getItems, applied, cleanup } = setup(true, 'tv-stand');
  try {
    editor.querySelector<DOMForm>('form')!.reportValidity = () => true;
    editor
      .querySelector('[data-furniture-action=add-tv]')!
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.ok(editor.hasAttribute('open'));
    assert.ok(!editor.querySelector('[data-tv-fields]')!.hasAttribute('hidden'));
    assert.equal(getItems().length, 1);
    const form = editor.querySelector<DOMForm>('form')!;
    form.reportValidity = () => true;
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    assert.equal(applied.length, 1);
    assert.equal(getItems().length, 2);
    assert.equal(getItems()[0].groupId, getItems()[1].groupId);
  } finally {
    cleanup();
  }
});

test('removing a furniture item requires saving and can be cancelled', async () => {
  const { window, panel, editor, getItems, applied, cleanup } = setup();
  try {
    editor.querySelector<DOMForm>('form')!.reportValidity = () => true;
    editor
      .querySelector('[data-furniture-action=delete]')!
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.equal(getItems().length, 1);
    assert.ok(editor.querySelector('[data-save-draft]'));
    editor
      .querySelector('[data-edit-close]')!
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    assert.equal(getItems().length, 1);
    panel.openEdit('sofa');
    editor.querySelector<DOMForm>('form')!.reportValidity = () => true;
    editor
      .querySelector('[data-furniture-action=delete]')!
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    editor
      .querySelector('[data-save-draft]')!
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.equal(getItems().length, 0);
    assert.equal(applied.length, 1);
  } finally {
    cleanup();
  }
});

test('failed popup actions show an inline error and leave the draft form open', () => {
  const { window, editor, getItems, applied, cleanup } = setup();
  try {
    editor.querySelector<DOMForm>('form')!.reportValidity = () => true;
    editor
      .querySelector('[data-furniture-action=snap]')!
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.ok(editor.hasAttribute('open'));
    assert.match(editor.querySelector('.furniture-edit-status')!.textContent!, /Rapprochez/);
    assert.equal(getItems()[0].position[0], 3);
    assert.equal(applied.length, 0);
  } finally {
    cleanup();
  }
});

test('renaming preserves precise geometry and absent optional spaces', () => {
  const { window, panel, editor, getItems, setItems, cleanup } = setup(true, 'tv');
  try {
    const original = createFurniture({
      kind: 'tv',
      id: 'sofa',
      position: [3.123456789, 3.987654321],
      rotation: Math.PI / 7,
    });
    setItems([original]);
    panel.openEdit(original.id);
    editor.querySelector<DOMInput>('input[name=name]')!.value = 'TV renommée';
    const form = editor.querySelector<DOMForm>('form')!;
    form.reportValidity = () => true;
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    const next = getItems()[0];
    assert.equal(next.name, 'TV renommée');
    for (const key of ['width', 'depth', 'height', 'rotation', 'elevation'] as const)
      assert.equal(next[key], original[key]);
    assert.deepEqual(next.position, original.position);
    assert.equal(next.clearances, undefined);
  } finally {
    cleanup();
  }
});

for (const shape of ['corner', 'chaise'] as const) {
  test(`editing a straight sofa into ${shape} uses the displayed total and exact body depth`, () => {
    const { window, panel, editor, getItems, setItems, applied, cleanup } = setup();
    try {
      const original = createFurniture({
        kind: 'sofa',
        id: 'sofa',
        position: [3, 3],
        depth: 0.912345,
      });
      setItems([original]);
      panel.openEdit(original.id);
      const configuration = editor.querySelector<DOMSelect>('select[name=sofaShape]')!;
      configuration.value = shape;
      configuration.dispatchEvent(new window.Event('change', { bubbles: true }));
      const form = editor.querySelector<DOMForm>('form')!;
      form.reportValidity = () => true;
      form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
      assert.equal(applied.length, 1);
      assert.equal(getItems()[0].sofa?.shape, shape);
      assert.equal(getItems()[0].sofa?.seatDepth, original.depth);
      assert.equal(getItems()[0].depth, 1.8);
    } finally {
      cleanup();
    }
  });
}

test('editing an L sofa into a straight sofa preserves its exact body depth', () => {
  const { window, panel, editor, getItems, setItems, applied, cleanup } = setup();
  try {
    const original = createFurniture({
      kind: 'sofa',
      id: 'sofa',
      position: [3, 3],
      depth: 1.876543,
      sofa: { seatDepth: 0.912345, returnWidth: 0.876543 },
    });
    setItems([original]);
    panel.openEdit(original.id);
    const configuration = editor.querySelector<DOMSelect>('select[name=sofaShape]')!;
    configuration.value = 'straight';
    configuration.dispatchEvent(new window.Event('change', { bubbles: true }));
    const form = editor.querySelector<DOMForm>('form')!;
    form.reportValidity = () => true;
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    assert.equal(applied.length, 1);
    assert.equal(getItems()[0].sofa, undefined);
    assert.equal(getItems()[0].depth, original.sofa!.seatDepth);
  } finally {
    cleanup();
  }
});

test('unlocking enables draft geometry immediately and Cancel preserves the locked item', async () => {
  const { window, panel, editor, getItems, setItems, applied, cleanup } = setup();
  try {
    const original = createFurniture({ kind: 'sofa', id: 'sofa', position: [3, 3], locked: true });
    setItems([original]);
    panel.openEdit(original.id);
    const form = editor.querySelector<DOMForm>('form')!;
    const width = editor.querySelector<DOMInput>('input[name=width]')!;
    const lock = editor.querySelector<DOMInput>('input[name=locked]')!;
    assert.equal(width.disabled, true);
    lock.checked = false;
    lock.dispatchEvent(new window.Event('change', { bubbles: true }));
    assert.equal(editor.querySelector('form'), form);
    assert.equal(width.disabled, false);
    width.value = '240';
    assert.deepEqual(getItems()[0], original);
    editor
      .querySelector('[data-edit-close]')!
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    assert.equal(applied.length, 0);
    assert.deepEqual(getItems()[0], original);

    panel.openEdit(original.id);
    const nextLock = editor.querySelector<DOMInput>('input[name=locked]')!;
    nextLock.checked = false;
    nextLock.dispatchEvent(new window.Event('change', { bubbles: true }));
    editor.querySelector<DOMInput>('input[name=width]')!.value = '240';
    const nextForm = editor.querySelector<DOMForm>('form')!;
    nextForm.reportValidity = () => true;
    nextForm.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    assert.equal(applied.length, 1);
    assert.equal(getItems()[0].locked, false);
    assert.equal(getItems()[0].width, 2.4);
  } finally {
    cleanup();
  }
});

test('all diagnostics are available in one collapsed section and only errors mark furniture', () => {
  const { panel, container, setChecks, cleanup } = setup(false);
  try {
    setChecks(
      Array.from({ length: 8 }, (_, index) => ({
        itemId: 'sofa',
        severity: 'warning',
        message: `Point ${index + 1}`,
      })),
    );
    panel.render();
    assert.equal(container.querySelectorAll('.furniture-check').length, 8);
    assert.ok(!container.querySelector('.furniture-checks')!.hasAttribute('open'));
    assert.equal(container.querySelector('.furniture-alert-dot'), null);
    setChecks([{ itemId: 'sofa', severity: 'error', message: 'Chevauche un meuble' }]);
    panel.render();
    assert.ok(container.querySelector('.furniture-alert-dot'));
  } finally {
    cleanup();
  }
});

test('adding furniture does not impose suggested passage clearances', () => {
  const { window, panel, added, cleanup } = setup(false);
  try {
    panel.openAdd();
    const form = window.document.querySelector<DOMForm>('#furniture-add-form')!;
    form.reportValidity = () => true;
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    assert.equal(added.length, 1);
    assert.equal(added[0].clearances, undefined);
  } finally {
    cleanup();
  }
});

test('cancelling a staged television addition leaves the stand alone', async () => {
  const { window, editor, getItems, applied, cleanup } = setup(true, 'tv-stand');
  try {
    editor.querySelector<DOMForm>('form')!.reportValidity = () => true;
    editor
      .querySelector('[data-furniture-action=add-tv]')!
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.ok(editor.hasAttribute('open'));
    editor
      .querySelector('[data-edit-close]')!
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    assert.equal(getItems().length, 1);
    assert.equal(getItems()[0].groupId, undefined);
    assert.equal(applied.length, 0);
  } finally {
    cleanup();
  }
});
