import assert from 'node:assert/strict';
import test from 'node:test';
import { FurnitureClipboard } from '../src/furniture/clipboard';
import { chairsAroundTable } from '../src/furniture/tableChairs';
import { createFurniture, FurnitureHistory, localToWorld } from '../src/furniture/model';
import { checkFurniture } from '../src/furniture/checks';
import type { Level } from '../src/model/types';

const level: Level = {
  id: 'room',
  name: 'Test',
  elevation: 0,
  ceilingHeight: 2.5,
  outline: [
    [0, 0],
    [10, 0],
    [10, 8],
    [0, 8],
  ],
  walls: [],
  rooms: [],
  lights: [],
  spawn: { position: [5, 4], yaw: 0 },
};
const options = { width: 0.45, depth: 0.5, gap: 0.05, linked: true };

test('clipboard snapshots survive source edits and paste creates fresh unlocked independent IDs', () => {
  const clipboard = new FurnitureClipboard();
  assert.equal(clipboard.paste(), undefined);
  const source = createFurniture({
    id: 'a',
    kind: 'chair',
    position: [3, 3],
    locked: true,
    groupId: 'group',
  });
  clipboard.copy(source);
  source.width = 2;
  const a = clipboard.paste()!,
    b = clipboard.paste()!;
  assert.notEqual(a.id, source.id);
  assert.notEqual(a.id, b.id);
  assert.equal(a.width, 0.45);
  assert.equal(a.locked, false);
  assert.equal(a.groupId, undefined);
  a.position[0] = 9;
  assert.deepEqual(clipboard.paste()!.position, [3, 3]);
});

test('eight chairs face a rotated table, fit physically and are one undoable change', () => {
  for (const rotation of [0, Math.PI / 2, Math.PI / 5]) {
    const table = createFurniture({ id: 'table', kind: 'table', position: [5, 4], rotation });
    const source = [table],
      history = new FurnitureHistory(source);
    const placed = chairsAroundTable(source, table.id, 8, level, options);
    assert.equal(placed.length, 9);
    assert.equal(new Set(placed.map((item) => item.id)).size, 9);
    assert.ok(placed.every((item) => item.groupId === placed[0].groupId));
    assert.deepEqual(
      checkFurniture(placed, level).filter((issue) => issue.severity === 'error'),
      [],
    );
    for (const chair of placed.slice(1)) {
      const forward = localToWorld(chair, 0, 1);
      const dot =
        (forward[0] - chair.position[0]) * (table.position[0] - chair.position[0]) +
        (forward[1] - chair.position[1]) * (table.position[1] - chair.position[1]);
      assert.ok(dot > 0);
    }
    assert.equal(table.groupId, undefined);
    history.commit(placed);
    history.undo();
    assert.deepEqual(history.items, source);
    history.redo();
    assert.equal(history.items.length, 9);
  }
});

test('chair placement rejects blocked, oversized and duplicate rings atomically without mandatory gaps', () => {
  const table = createFurniture({ id: 'table', kind: 'table', position: [5, 4] });
  const source = [table],
    original = structuredClone(source);
  assert.throws(() => chairsAroundTable(source, table.id, 16, level, options), /ne tiennent pas/);
  assert.throws(() => chairsAroundTable(source, table.id, 0, level, options), /1 à 16/);
  const wall = {
    ...level,
    walls: [
      {
        id: 'wall',
        start: [0, 3.3] as [number, number],
        end: [10, 3.3] as [number, number],
        thickness: 0.2,
      },
    ],
  };
  assert.throws(() => chairsAroundTable(source, table.id, 8, wall, options), /Pas assez de place/);
  const placed = chairsAroundTable(source, table.id, 8, level, {
    ...options,
    linked: false,
    gap: 0,
  });
  assert.ok(placed.every((item) => !item.groupId));
  assert.throws(() => chairsAroundTable(placed, table.id, 8, level, options), /Pas assez de place/);
  assert.deepEqual(source, original);
});
