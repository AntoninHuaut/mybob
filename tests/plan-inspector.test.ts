import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { Window } from 'happy-dom';
import { PlanInspector } from '../src/ui/planInspector';
import type { Level } from '../src/model/types';

const level: Level = {
  id: 'level',
  name: 'Rez',
  elevation: 0,
  ceilingHeight: 2.5,
  outline: [
    [0, 0],
    [4, 0],
    [4, 3],
    [0, 3],
  ],
  walls: [
    {
      id: 'wall-5',
      start: [1.5, 0],
      end: [1.5, 3],
      thickness: 0.1,
      openings: [
        { id: 'door', kind: 'door', offset: 1, width: 0.9, height: 2.05, hinge: 'start', swing: 1 },
      ],
    },
  ],
  rooms: [
    {
      id: 'room-1',
      name: 'Séjour',
      kind: 'living',
      polygon: [
        [0, 0],
        [1.5, 0],
        [1.5, 3],
        [0, 3],
      ],
      label: [0.75, 1.5],
      viewpoint: [0.75, 1.5],
      planArea: 4.4,
    },
  ],
  lights: [],
  spawn: { position: [1, 1], yaw: 0 },
};

function setup(t: TestContext) {
  const window = new Window({ url: 'http://localhost' });
  // Tests share one process: the Happy DOM document must not outlive the test.
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'document');
  t.after(() => {
    window.close();
    if (prior) Object.defineProperty(globalThis, 'document', prior);
    else Reflect.deleteProperty(globalThis, 'document');
  });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: window.document });
  const root = window.document.createElement('aside');
  window.document.body.append(root);
  const calls: unknown[][] = [];
  let fail: string | undefined;
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
      if (fail) throw new Error(fail);
    };
  const inspector = new PlanInspector(root as unknown as HTMLElement, {
    onWall: record('wall'),
    onRoom: record('room'),
    onOpening: record('opening'),
    onDelete: record('delete'),
    onSplit: record('split'),
  });
  const field = (name: string) =>
    root.querySelector(`[name="${name}"]`) as unknown as HTMLInputElement;
  const change = (name: string, value: string) => {
    field(name).value = value;
    field(name).dispatchEvent(new window.Event('input', { bubbles: true }) as unknown as Event);
    field(name).dispatchEvent(new window.Event('change', { bubbles: true }) as unknown as Event);
  };
  return { root, inspector, calls, field, change, failWith: (m?: string) => (fail = m) };
}

test('a wall shows its exact values and commits one edit per changed field', (t) => {
  const { root, inspector, calls, field, change } = setup(t);
  inspector.show(level, { kind: 'wall', id: 'wall-5' });
  assert.equal(root.hidden, false);
  assert.equal(field('length').value, '3');
  assert.equal(field('thickness').value, '0.1');
  change('thickness', '0.15');
  assert.deepEqual(calls, [['wall', 'wall-5', { thickness: 0.15 }]]);
  (root.querySelector('[data-action=split]') as unknown as HTMLButtonElement).click();
  assert.deepEqual(calls.at(-1), ['split']);
  inspector.show(undefined, undefined);
  assert.equal(root.hidden, true);
});

test('refreshing keeps the field being typed in and shows refusals in French', (t) => {
  const { inspector, field, change, failWith, root } = setup(t);
  inspector.show(level, { kind: 'wall', id: 'wall-5' });
  const input = field('length');
  input.focus();
  input.value = '2.';
  inspector.show(level, { kind: 'wall', id: 'wall-5' });
  assert.equal(field('length'), input);
  assert.equal(input.value, '2.');
  failWith('L’ouverture dépasse le bout du mur.');
  change('length', '1');
  assert.equal(
    root.querySelector('[role=alert]')!.textContent,
    'L’ouverture dépasse le bout du mur.',
  );
});

test('a room shows its name, kind and areas and is renamed on change', (t) => {
  const { root, inspector, calls, field, change } = setup(t);
  inspector.show(level, { kind: 'room', id: 'room-1' });
  assert.equal(field('name').value, 'Séjour');
  assert.equal((field('kind') as unknown as HTMLSelectElement).value, 'living');
  assert.match(root.textContent!, /4,50 m²/);
  assert.match(root.textContent!, /4,40 m²/);
  change('name', 'Bureau');
  assert.deepEqual(calls, [['room', 'room-1', { name: 'Bureau' }]]);
});

test('an opening is measured from either end of its wall', (t) => {
  const { inspector, calls, field, change, root } = setup(t);
  inspector.show(level, { kind: 'opening', wallId: 'wall-5', id: 'door' });
  assert.equal(field('distance').value, '1');
  assert.equal(field('sill'), null);
  change('reference', 'end');
  assert.equal(field('distance').value, '1.1');
  assert.deepEqual(calls, []);
  change('distance', '0.5');
  assert.deepEqual(calls, [['opening', 'wall-5', 'door', { reference: 'end', distance: 0.5 }]]);
  (root.querySelector('[data-action=delete]') as unknown as HTMLButtonElement).click();
  assert.deepEqual(calls.at(-1), ['delete']);
});
