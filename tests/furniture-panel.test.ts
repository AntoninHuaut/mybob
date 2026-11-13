import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import {
  Window,
  HTMLInputElement as DOMInput,
  HTMLFormElement as DOMForm,
  HTMLSelectElement as DOMSelect,
  HTMLDetailsElement as DOMDetails,
  HTMLElement as DOMElement,
  HTMLButtonElement as DOMButton,
  HTMLDialogElement as DOMDialog,
} from 'happy-dom';
import { createFurniture, FURNITURE_PRESETS, type FurnitureItem } from '../src/furniture/model';

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
      return undefined;
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

test('the add menu groups every furniture kind under a room category', () => {
  const { window, panel, cleanup } = setup();
  try {
    panel.openAdd();
    const select = window.document.querySelector<DOMSelect>(
      '#furniture-add-form select[name=kind]',
    )!;
    const groups = Array.from(select.querySelectorAll('optgroup'));
    assert.ok(groups.length > 1, 'the flat list is replaced by categories');
    for (const group of groups) assert.ok(group.getAttribute('label'));
    const kinds = groups.flatMap((group) =>
      Array.from(group.querySelectorAll('option')).map((option) => option.value),
    );
    assert.deepEqual([...kinds].sort(), Object.keys(FURNITURE_PRESETS).sort());
    assert.equal(new Set(kinds).size, kinds.length, 'no kind is listed twice');
  } finally {
    cleanup();
  }
});

test('a dressing is added as a chain of runs with derived overall dimensions', () => {
  const { window, panel, added, cleanup } = setup();
  try {
    panel.openAdd();
    const form = window.document.querySelector<DOMForm>('#furniture-add-form')!;
    const kind = form.elements.namedItem('kind') as unknown as DOMInput;
    kind.value = 'dressing';
    kind.dispatchEvent(new window.Event('change', { bubbles: true }));
    const field = (name: string) => form.elements.namedItem(name) as unknown as DOMInput;
    assert.equal(field('dressingRunLength0').value, '180');
    assert.equal(field('dressingRunDepth').value, '60');
    assert.equal(field('width').value, '180');
    assert.equal(field('depth').value, '60');
    assert.ok(field('width').disabled, 'overall width follows the runs');
    assert.ok(field('depth').disabled, 'overall depth follows the runs');
    assert.equal(form.querySelector('[data-depth-label]')!.textContent, 'Profondeur hors tout');

    form
      .querySelector('[data-dressing-add]')!
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.equal(field('dressingRunLength1').value, '120');
    const turn = form.elements.namedItem('dressingRunTurn0') as unknown as DOMSelect;
    assert.equal(turn.value, 'right');
    assert.ok(!turn.disabled, 'the first run now carries a corner');
    assert.ok((form.elements.namedItem('dressingRunTurn1') as unknown as DOMSelect).disabled);
    assert.equal(field('depth').value, '120');

    form.reportValidity = () => true;
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    assert.equal(added.length, 1);
    assert.deepEqual(added[0].dressing, {
      runDepth: 0.6,
      runs: [{ length: 1.8, turn: 'right' }, { length: 1.2 }],
    });
    assert.equal(added[0].width, 1.8);
    assert.equal(added[0].depth, 1.2);
  } finally {
    cleanup();
  }
});

test('removing a run keeps the chain valid and the last run without a corner', () => {
  const { window, panel, cleanup } = setup();
  try {
    panel.openAdd();
    const form = window.document.querySelector<DOMForm>('#furniture-add-form')!;
    const kind = form.elements.namedItem('kind') as unknown as DOMInput;
    kind.value = 'dressing';
    kind.dispatchEvent(new window.Event('change', { bubbles: true }));
    const add = form.querySelector('[data-dressing-add]')!;
    add.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    add.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.ok(form.elements.namedItem('dressingRunLength2'));
    form
      .querySelector('[data-dressing-remove="1"]')!
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.equal(form.elements.namedItem('dressingRunLength2'), null);
    assert.equal(
      (form.elements.namedItem('dressingRunTurn1') as unknown as DOMSelect).disabled,
      true,
    );
    assert.equal(form.querySelectorAll('[data-dressing-remove]').length, 2);
  } finally {
    cleanup();
  }
});

test('editing a dressing keeps untouched run lengths exact', () => {
  const { window, editor, panel, getItems, cleanup } = setup(true, 'dressing');
  try {
    panel.openEdit('sofa');
    const form = editor.querySelector<DOMForm>('form')!;
    const field = (name: string) => form.elements.namedItem(name) as unknown as DOMInput;
    assert.equal(field('dressingRunLength0').value, '180');
    form
      .querySelector('[data-dressing-add]')!
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    field('dressingRunLength1').value = '90';
    form.reportValidity = () => true;
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    const saved = getItems()[0];
    assert.deepEqual(saved.dressing, {
      runDepth: 0.6,
      runs: [{ length: 1.8, turn: 'right' }, { length: 0.9 }],
    });
    assert.equal(saved.width, 1.8);
    assert.equal(saved.depth, 0.9);
  } finally {
    cleanup();
  }
});

test('a shower asks for a tray height and the glass sides', () => {
  const { window, panel, added, cleanup } = setup();
  try {
    panel.openAdd();
    const form = window.document.querySelector<DOMForm>('#furniture-add-form')!;
    const kind = form.elements.namedItem('kind') as unknown as DOMInput;
    kind.value = 'shower';
    kind.dispatchEvent(new window.Event('change', { bubbles: true }));
    assert.ok(!form.querySelector('[data-shower-fields]')!.hasAttribute('hidden'));
    const tray = form.elements.namedItem('showerTray') as unknown as DOMInput;
    const left = form.elements.namedItem('showerPanelLeft') as unknown as DOMInput;
    const front = form.elements.namedItem('showerPanelFront') as unknown as DOMInput;
    assert.equal(tray.value, '6');
    assert.equal(left.checked, true);
    assert.equal(front.checked, false);
    tray.value = '0';
    front.checked = true;
    form.reportValidity = () => true;
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    assert.equal(added[0].showerTray, 0);
    assert.deepEqual(added[0].showerPanels, ['left', 'front']);
  } finally {
    cleanup();
  }
});

test('changing the kind keeps the preset footprint', () => {
  const { window, panel, cleanup } = setup();
  try {
    panel.openAdd();
    const form = window.document.querySelector<DOMForm>('#furniture-add-form')!;
    const kind = form.elements.namedItem('kind') as unknown as DOMInput;
    const value = (name: string) => (form.elements.namedItem(name) as unknown as DOMInput).value;
    for (const [type, width, depth] of [
      ['shower', '90', '90'],
      ['bathtub', '170', '75'],
      ['dressing', '180', '60'],
    ] as const) {
      kind.value = type;
      kind.dispatchEvent(new window.Event('change', { bubbles: true }));
      assert.equal(value('width'), width, `${type} width`);
      assert.equal(value('depth'), depth, `${type} depth`);
    }
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
    assert.equal(editor.querySelector<DOMSelect>('[data-link-target]')!.value, '');
    editor
      .querySelector('[data-furniture-action=link]')!
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.match(editor.querySelector('.furniture-edit-status')!.textContent!, /Choisissez/);
    assert.equal(getItems()[0].groupId, undefined);
    editor.querySelector<DOMSelect>('[data-link-target]')!.value = other.id;
    editor
      .querySelector('[data-furniture-action=link]')!
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.equal(getItems()[0].groupId, undefined);
    assert.equal(getItems()[0].name, 'Canapé');
    assert.equal(applied.length, 0);
    assert.match(editor.querySelector('.furniture-group-controls')!.textContent!, /2 meubles/);
    assert.equal(editor.querySelectorAll('.furniture-group-members li').length, 2);
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
    editor.querySelector<DOMSelect>('[data-link-target]')!.value = 'chair';
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
  const { window, setItems, panel, editor, applied, cleanup } = setup();
  try {
    setItems([{ ...createFurniture({ id: 'locked', position: [3, 3] }), locked: true }]);
    panel.openEdit('locked');
    editor.querySelector<DOMForm>('form')!.reportValidity = () => true;
    editor
      .querySelector('[data-furniture-action=delete]')!
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.ok(editor.hasAttribute('open'));
    assert.match(editor.querySelector('.furniture-edit-status')!.textContent!, /verrouill/);
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

test('a half-centimetre clearance stays valid and is saved exactly', () => {
  const { window, panel, editor, getItems, setItems, cleanup } = setup(true, 'cabinet');
  try {
    const original = createFurniture({
      kind: 'cabinet',
      id: 'sofa',
      position: [3, 3],
      clearances: { front: 0.125, back: 0, left: 0, right: 0 },
    });
    setItems([original]);
    panel.openEdit(original.id);
    const form = editor.querySelector<DOMForm>('form')!;
    const front = editor.querySelector<DOMInput>('input[name=front]')!;
    assert.equal(front.value, '12.5');
    // Happy DOM mis-validates every step="0.1" field, so the form itself is not
    // asserted here; the clearance fields are the ones the issue was about.
    for (const name of ['front', 'back', 'left', 'right', 'reach'])
      assert.equal(editor.querySelector<DOMInput>(`input[name=${name}]`)!.checkValidity(), true);
    editor.querySelector<DOMInput>('input[name=name]')!.value = 'Commode renommée';
    form.reportValidity = () => true;
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    const next = getItems()[0];
    assert.equal(next.name, 'Commode renommée');
    assert.equal(next.clearances?.front, 0.125);
  } finally {
    cleanup();
  }
});

test('an invalid field inside a collapsed section is revealed and focused', () => {
  const { window, panel, editor, cleanup } = setup();
  try {
    panel.openEdit('sofa');
    const advanced = editor.querySelector<DOMDetails>('.furniture-advanced')!;
    const placement = editor.querySelector<DOMDetails>('.furniture-placement')!;
    assert.equal(advanced.open, false);
    // Happy DOM wrongly rejects decimal values on step="0.1" fields; neutralise
    // that so the only invalid field is the one this test makes invalid.
    for (const input of editor.querySelectorAll<DOMInput>('input[step="0.1"]')) input.step = 'any';
    const back = editor.querySelector<DOMInput>('input[name=back]')!;
    back.value = '-3';
    back.dispatchEvent(new window.Event('invalid', { cancelable: true }));
    assert.equal(placement.open, true);
    assert.equal(advanced.open, true);
    assert.ok(window.document.activeElement === back, 'the invalid field receives focus');
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

// Keyboard focus: the panel rebuilds its HTML, which used to drop focus on <body> (WCAG 2.4.3).
const focusedKey = (window: Window) =>
  window.document.activeElement?.getAttribute('data-furniture-overlay') ??
  window.document.activeElement?.getAttribute('data-furniture-select') ??
  window.document.activeElement?.getAttribute('data-furniture-edit-id') ??
  window.document.activeElement?.getAttribute('data-furniture-action') ??
  window.document.activeElement?.tagName;

test('ticking a Repères checkbox keeps focus on that checkbox after the panel rebuilds', () => {
  const { window, container, panel, cleanup } = setup(false);
  try {
    const box = container.querySelector<DOMInput>('[data-furniture-overlay=clearances]')!;
    box.focus();
    box.checked = true;
    box.dispatchEvent(new window.Event('change', { bubbles: true }));
    panel.render(); // main.ts re-renders the panel from onOverlays
    assert.equal(focusedKey(window), 'clearances');
    assert.ok(window.document.activeElement?.isConnected);
  } finally {
    cleanup();
  }
});

test('choosing a piece in the list keeps focus on its row', () => {
  const { window, container, cleanup } = setup(false);
  try {
    const row = container.querySelector<DOMElement>('[data-furniture-select=sofa]')!;
    row.focus();
    row.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.equal(focusedKey(window), 'sofa');
  } finally {
    cleanup();
  }
});

test('Annuler and Rétablir hand focus to Ajouter when they become disabled', () => {
  const { window, container, cleanup } = setup(false);
  try {
    // Stub history is empty, so the buttons render disabled: focus must not fall to <body>.
    const undo = container.querySelector<DOMButton>('[data-furniture-action=undo]')!;
    assert.ok(undo.disabled);
    undo.removeAttribute('disabled');
    undo.focus();
    undo.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.equal(focusedKey(window), 'add');
  } finally {
    cleanup();
  }
});

test('closing the add popup returns focus to Ajouter, even though the panel was rebuilt', async () => {
  const { window, container, panel, cleanup } = setup(false);
  try {
    container.querySelector<DOMElement>('[data-furniture-action=add]')!.focus();
    panel.openAdd();
    const form = window.document.querySelector<DOMForm>('#furniture-add-form')!;
    form.reportValidity = () => true;
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    panel.render();
    await Promise.resolve();
    assert.equal(focusedKey(window), 'add');
  } finally {
    cleanup();
  }
});

test('closing the edit popup with Escape returns focus to the pencil that opened it', async () => {
  const { window, container, editor, cleanup } = setup(false);
  try {
    const pencil = container.querySelector<DOMElement>('[data-furniture-edit-id=sofa]')!;
    pencil.focus();
    pencil.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.ok(editor.hasAttribute('open'));
    (editor as unknown as DOMDialog).close();
    await Promise.resolve();
    assert.equal(focusedKey(window), 'sofa');
    assert.equal(window.document.activeElement?.hasAttribute('data-furniture-edit-id'), true);
  } finally {
    cleanup();
  }
});

test('Dupliquer inside the popup keeps focus inside the rebuilt popup', () => {
  const { window, editor, cleanup } = setup(true);
  try {
    editor.querySelector<DOMForm>('form')!.reportValidity = () => true;
    const button = editor.querySelector<DOMElement>('[data-furniture-action=duplicate]')!;
    button.focus();
    button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.equal(focusedKey(window), 'duplicate');
    assert.ok(editor.contains(window.document.activeElement));
  } finally {
    cleanup();
  }
});

test('a shower panel length is a draft: exact when untouched, saved when edited', () => {
  const { window, editor, panel, setItems, applied, cleanup } = setup(false);
  try {
    setItems([
      createFurniture({
        kind: 'shower',
        id: 'sofa',
        position: [3, 3],
        width: 1.2,
        showerPanels: ['front', 'left'],
        // Sub-millimetre value: the displayed 80.5 cm must not overwrite it when untouched.
        showerPanelSpans: { front: { length: 0.80449, from: 'right' } },
      }),
    ]);
    panel.openEdit('sofa');
    const field = (name: string) => editor.querySelector<DOMInput>(`[name=${name}]`)!;
    assert.equal(field('showerPanelFrontLength').value, '80.4');
    assert.equal(field('showerPanelFrontFrom').value, 'right');
    assert.equal(field('showerPanelLeftLength').value, '');
    // Back is not ticked: its length row is hidden and its field disabled.
    assert.equal(editor.querySelector<DOMElement>('[data-shower-span=back]')!.hidden, true);
    assert.equal(field('showerPanelBackLength').disabled, true);
    const back = field('showerPanelBack');
    back.checked = true;
    back.dispatchEvent(new window.Event('change', { bubbles: true }));
    assert.equal(editor.querySelector<DOMElement>('[data-shower-span=back]')!.hidden, false);
    assert.equal(field('showerPanelBackLength').disabled, false);
    back.checked = false;
    back.dispatchEvent(new window.Event('change', { bubbles: true }));

    const save = () => {
      const form = editor.querySelector<DOMForm>('form')!;
      form.reportValidity = () => true;
      form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    };
    save();
    assert.equal(editor.querySelector('.furniture-edit-status')!.textContent, '');
    assert.deepEqual(applied.at(-1)![0].showerPanelSpans, {
      front: { length: 0.80449, from: 'right' },
    });

    panel.openEdit('sofa');
    field('showerPanelLeftLength').value = '55';
    field('showerPanelFrontFrom').value = 'left';
    save();
    assert.deepEqual(applied.at(-1)![0].showerPanelSpans, {
      front: { length: 0.80449 },
      left: { length: 0.55 },
    });
  } finally {
    cleanup();
  }
});

test('the editing popup repaints a piece only on Save, and keeps an untouched colour exact', async () => {
  const { window, editor, panel, getItems, setItems, cleanup } = setup(false);
  try {
    setItems([{ ...getItems()[0], color: '#A5A18A' }]);
    const open = () => {
      panel.openEdit('sofa');
      const form = editor.querySelector<DOMForm>('form')!;
      form.reportValidity = () => true;
      return {
        form,
        color: form.elements.namedItem('color') as unknown as DOMInput,
        save: () =>
          form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })),
      };
    };
    let edit = open();
    assert.equal(edit.color.value, '#a5a18a', 'the control shows the stored colour');
    edit.save();
    await Promise.resolve();
    assert.equal(getItems()[0].color, '#A5A18A', 'untouched: the stored spelling is kept');

    edit = open();
    edit.color.value = '#d02828';
    editor
      .querySelector('[data-edit-close]')!
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    assert.equal(getItems()[0].color, '#A5A18A', 'Cancel discards the new colour');

    edit = open();
    edit.color.value = '#d02828';
    edit.save();
    await Promise.resolve();
    assert.equal(getItems()[0].color, '#d02828', 'Save applies it');
  } finally {
    cleanup();
  }
});

test('kitchen popup saves runs and equipment together and Cancel discards edits', () => {
  const { window, editor, panel, getItems, cleanup } = setup(true, 'kitchen');
  try {
    const form = editor.querySelector<DOMForm>('form')!;
    const field = (name: string) => form.elements.namedItem(name) as unknown as DOMInput;
    field('worktopHeight').value = '92';
    field('worktopColor').value = '#654321';
    form
      .querySelector('[data-dressing-add]')!
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    field('dressingRunLength1').value = '210';
    form
      .querySelector('[data-kitchen-add]')!
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    field('kitchenOffset0').value = '80';
    field('kitchenRun0').value = '2';
    form.reportValidity = () => true;
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    const saved = getItems()[0];
    assert.equal(saved.kitchen?.worktopHeight, 0.92);
    assert.equal(saved.kitchen?.worktopColor, '#654321');
    assert.deepEqual(saved.kitchen?.slots, [{ kind: 'sink', run: 1, offset: 0.8, width: 0.6 }]);
    panel.openEdit(saved.id);
    const again = editor.querySelector<DOMForm>('form')!;
    (again.elements.namedItem('worktopHeight') as unknown as DOMInput).value = '99';
    editor
      .querySelector('[data-edit-close]')!
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.deepEqual(getItems()[0], saved);
  } finally {
    cleanup();
  }
});

test('removing a kitchen slot preserves the exact measurements of the remaining slot', () => {
  const { window, editor, panel, setItems, getItems, cleanup } = setup(false, 'kitchen');
  try {
    const kitchen = createFurniture({
      kind: 'kitchen',
      id: 'sofa',
      position: [3, 3],
      kitchen: {
        slots: [
          { kind: 'sink', run: 0, offset: 0.12345, width: 0.5 },
          { kind: 'sink', run: 0, offset: 1.23456, width: 0.51234 },
        ],
      },
    });
    setItems([kitchen]);
    panel.openEdit(kitchen.id);
    const form = editor.querySelector<DOMForm>('form')!;
    form
      .querySelector('[data-kitchen-remove="0"]')!
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    form.reportValidity = () => true;
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    assert.deepEqual(getItems()[0].kitchen?.slots, [kitchen.kitchen!.slots[1]]);
  } finally {
    cleanup();
  }
});

test('adding a kitchen run preserves the exact unedited first run', () => {
  const { window, editor, panel, setItems, getItems, cleanup } = setup(false, 'kitchen');
  try {
    const kitchen = createFurniture({
      kind: 'kitchen',
      id: 'sofa',
      position: [3, 3],
      kitchen: {
        runs: [{ length: 3.23456 }],
        runDepth: 0.61234,
      },
    });
    setItems([kitchen]);
    panel.openEdit(kitchen.id);
    const form = editor.querySelector<DOMForm>('form')!;
    form
      .querySelector('[data-dressing-add]')!
      .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    form.reportValidity = () => true;
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    assert.equal(getItems()[0].kitchen?.runs[0].length, 3.23456);
    assert.equal(getItems()[0].kitchen?.runDepth, 0.61234);
  } finally {
    cleanup();
  }
});
