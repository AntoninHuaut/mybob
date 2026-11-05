import assert from 'node:assert/strict';
import test from 'node:test';
import { createFurniture, footprintParts, FurnitureHistory } from '../src/furniture/model';
import { FurnitureEditorDraft } from '../src/furniture/editorDraft';
import { getBuildingPlacementIssues } from '../src/furniture/placement';
import { linkFurniture } from '../src/furniture/groups';
import type { Level } from '../src/model/types';

const level: Level = {
  id: 'test',
  name: 'Test',
  elevation: 0,
  ceilingHeight: 2.5,
  outline: [
    [0, 0],
    [8, 0],
    [8, 6],
    [0, 6],
  ],
  walls: [{ id: 'west', start: [0.1, 0], end: [0.1, 6], thickness: 0.2 }],
  rooms: [],
  lights: [],
  spawn: { position: [3, 3], yaw: 0 },
};
const edge = (item: ReturnType<typeof createFurniture>) =>
  Math.min(
    ...footprintParts(item)
      .flat()
      .map((p) => p[0]),
  );

test('growing a sofa against a wall shifts its centre toward free space and preserves a single undo', () => {
  const sofa = createFurniture({
    id: 'sofa',
    kind: 'sofa',
    width: 2,
    depth: 1,
    position: [1.2, 3],
  });
  const source = [sofa],
    history = new FurnitureHistory(source);
  const draft = new FurnitureEditorDraft(source, level, sofa.id);
  draft.update({ ...draft.selected!, width: 3 });
  assert.equal(draft.selected!.width, 3);
  assert.ok(Math.abs(edge(draft.selected!) - 0.2) < 0.0021);
  assert.ok(draft.selected!.position[0] > sofa.position[0] + 0.49);
  assert.deepEqual(getBuildingPlacementIssues(draft.selected!, level), []);
  assert.deepEqual(source, [sofa]);
  assert.equal(history.canUndo, false);
  history.commit(draft.items);
  history.undo();
  assert.deepEqual(history.items, source);
  history.redo();
  assert.equal(history.items[0].width, 3);
});

test('depth growth follows the free side for a rotated corner sofa', () => {
  const sofa = createFurniture({
    id: 'corner',
    kind: 'sofa',
    width: 2,
    depth: 1.8,
    position: [1.1, 3],
    rotation: Math.PI / 2,
    sofa: { shape: 'corner', side: 'right', seatDepth: 0.9, returnWidth: 0.9 },
  });
  const draft = new FurnitureEditorDraft([sofa], level, sofa.id);
  draft.update({ ...draft.selected!, depth: 2.4 });
  assert.equal(draft.selected!.depth, 2.4);
  assert.ok(Math.abs(edge(draft.selected!) - 0.2) < 0.0021);
  assert.deepEqual(getBuildingPlacementIssues(draft.selected!, level), []);
});

test('resizing in a corner can shift both axes and can fit an exact space between opposing walls', () => {
  const cornerLevel = {
    ...level,
    walls: [
      ...level.walls,
      {
        id: 'back',
        start: [0, 0.1] as [number, number],
        end: [8, 0.1] as [number, number],
        thickness: 0.2,
      },
    ],
  };
  const item = createFurniture({
    id: 'corner',
    kind: 'table',
    width: 1,
    depth: 1,
    position: [0.7, 0.7],
  });
  const draft = new FurnitureEditorDraft([item], cornerLevel, item.id);
  draft.update({ ...draft.selected!, width: 2, depth: 2 });
  assert.deepEqual(getBuildingPlacementIssues(draft.selected!, cornerLevel), []);
  assert.ok(draft.selected!.position.every((n) => n > 1.19));
  const narrow = {
    ...level,
    walls: [
      ...level.walls,
      {
        id: 'east',
        start: [3.3, 0] as [number, number],
        end: [3.3, 6] as [number, number],
        thickness: 0.2,
      },
    ],
  };
  const sofa = createFurniture({
    id: 'fit',
    kind: 'sofa',
    width: 2,
    depth: 1,
    position: [1.53, 3],
  });
  const fitted = new FurnitureEditorDraft([sofa], narrow, sofa.id);
  fitted.update({ ...sofa, width: 3 });
  assert.deepEqual(getBuildingPlacementIssues(fitted.selected!, narrow), []);
  assert.ok(Math.abs(fitted.selected!.position[0] - 1.7) < 0.0021);
});

test('free resizing keeps the centre, explicit placement stays explicit, and impossible growth is atomic', () => {
  const item = createFurniture({ id: 'free', kind: 'table', width: 1, depth: 1, position: [4, 3] });
  const draft = new FurnitureEditorDraft([item], level, item.id);
  draft.update({ ...item, width: 2 });
  assert.deepEqual(draft.selected!.position, item.position);
  const before = draft.items;
  assert.throws(() => draft.update({ ...draft.selected!, width: 20 }), /Placement impossible/);
  assert.deepEqual(draft.items, before);
  assert.throws(
    () => draft.update({ ...draft.selected!, width: 3, position: [0.5, 3] }),
    /Placement impossible/,
  );
  assert.deepEqual(draft.items, before);
});

test('linked furniture moves rigidly with the resized anchor and a locked member blocks relocation', () => {
  const anchor = createFurniture({
    id: 'a',
    kind: 'table',
    width: 1,
    depth: 1,
    position: [0.7, 3],
  });
  const member = createFurniture({
    id: 'b',
    kind: 'chair',
    width: 0.5,
    depth: 0.5,
    position: [2, 3],
  });
  const items = linkFurniture([anchor, member], 'a', 'b');
  const draft = new FurnitureEditorDraft(items, level, 'a');
  draft.update({ ...draft.selected!, width: 2 });
  assert.ok(Math.abs(draft.items[1].position[0] - draft.items[0].position[0] - 1.3) < 1e-9);
  const locked = items.map((item) => ({ ...item, locked: item.id === 'b' }));
  const blocked = new FurnitureEditorDraft(locked, level, 'a');
  assert.throws(() => blocked.update({ ...blocked.selected!, width: 2 }), /Placement impossible/);
  assert.deepEqual(blocked.items, locked);
});
