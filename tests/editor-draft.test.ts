import assert from 'node:assert/strict';
import test from 'node:test';
import { createFurniture, FurnitureHistory } from '../src/furniture/model';
import { FurnitureEditorDraft } from '../src/furniture/editorDraft';
import { linkFurniture } from '../src/furniture/groups';
import { pointInPolygon } from '../src/model/geometry';
import { getBuildingPlacementIssues } from '../src/furniture/placement';
import type { Level } from '../src/model/types';

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 0.0001, `${a} ≠ ${b}`);
const level: Level = {
  id: 'rdc',
  name: 'RDC',
  elevation: 0,
  ceilingHeight: 2.5,
  outline: [
    [0, 0],
    [10, 0],
    [10, 7],
    [0, 7],
  ],
  walls: [
    { id: 'west', start: [0.1, 0], end: [0.1, 7], thickness: 0.2 },
    { id: 'partition', start: [6, 0], end: [6, 7], thickness: 0.07 },
  ],
  rooms: [
    {
      id: 'left',
      name: 'Gauche',
      kind: 'living',
      polygon: [
        [0.2, 0],
        [5.965, 0],
        [5.965, 7],
        [0.2, 7],
      ],
      label: [3, 3],
      viewpoint: [3, 3],
    },
    {
      id: 'right',
      name: 'Droite',
      kind: 'bedroom',
      polygon: [
        [6.035, 0],
        [10, 0],
        [10, 7],
        [6.035, 7],
      ],
      label: [8, 3],
      viewpoint: [8, 3],
    },
  ],
  lights: [],
  spawn: { position: [3, 3], yaw: Math.PI },
};
const stand = () =>
  createFurniture({ id: 'stand', kind: 'tv-stand', position: [3, 3], elevation: 0.2 });
const tv = () => createFurniture({ id: 'tv', kind: 'tv', position: [3, 3], elevation: 0.75 });

test('linking, unlinking and changing properties only touch the isolated draft', () => {
  const source = [stand(), tv()],
    original = structuredClone(source),
    history = new FurnitureHistory(source);
  const draft = new FurnitureEditorDraft(source, level, 'stand');
  draft.link('tv');
  assert.ok(draft.items.every((item) => item.groupId));
  draft.update({ ...draft.selected!, position: [4, 3] });
  near(draft.items[1].position[0], 4);
  draft.unlink();
  assert.ok(draft.items.every((item) => !item.groupId));
  assert.deepEqual(source, original);
  assert.deepEqual(history.items, original);
  assert.equal(history.canUndo, false);
  const leaked = draft.items;
  leaked[0].name = 'Changed outside';
  const selection = draft.selected!;
  selection.position[0] = 100;
  assert.notEqual(draft.selected!.name, 'Changed outside');
  assert.equal(draft.selected!.position[0], 4);
});

test('all changed group members must fit before an update is staged', () => {
  const a = stand(),
    b = tv();
  b.position = [4.5, 3];
  const source = linkFurniture([a, b], 'stand', 'tv');
  const draft = new FurnitureEditorDraft(source, level, 'stand'),
    before = draft.items;
  assert.throws(
    () => draft.update({ ...draft.selected!, position: [4.5, 3] }),
    /Placement impossible/,
  );
  assert.deepEqual(draft.items, before);
  assert.equal(draft.selectedId, 'stand');
  assert.deepEqual(source, before);
});

test('snap is staged and a no-op alignment gives a useful error without changing state', () => {
  const item = createFurniture({
    id: 'table',
    kind: 'table',
    width: 1,
    depth: 0.6,
    position: [0.8, 3],
  });
  const source = [item],
    draft = new FurnitureEditorDraft(source, level, item.id);
  draft.snap();
  near(draft.selected!.position[0], 0.7);
  near(source[0].position[0], 0.8);
  const far = new FurnitureEditorDraft(
    [createFurniture({ id: 'far', position: [3, 3] })],
    level,
    'far',
  );
  const before = far.items;
  assert.throws(() => far.snap(), /Rapprochez/);
  assert.deepEqual(far.items, before);
});

test('duplicate selects a new unlinked copy, finds space in the same room and leaves the source intact', () => {
  const source = linkFurniture([stand(), tv()], 'stand', 'tv'),
    before = structuredClone(source);
  const draft = new FurnitureEditorDraft(source, level, 'stand');
  draft.duplicate();
  assert.equal(draft.items.length, 3);
  assert.notEqual(draft.selectedId, 'stand');
  assert.equal(draft.selected!.groupId, undefined);
  assert.equal(draft.selected!.locked, false);
  assert.ok(pointInPolygon(draft.selected!.position, level.rooms[0].polygon));
  assert.equal(getBuildingPlacementIssues(draft.selected!, level).length, 0);
  assert.deepEqual(source, before);
  assert.equal(draft.items.find((item) => item.id === 'stand')!.groupId, before[0].groupId);
});

test('adding a television stages its exact support position, pose and group before one explicit Save', () => {
  const source = [stand()],
    history = new FurnitureHistory(source),
    draft = new FurnitureEditorDraft(source, level, 'stand');
  draft.update({ ...draft.selected!, rotation: Math.PI / 2, name: 'Meuble du salon' });
  draft.addTelevision();
  const television = draft.selected!;
  assert.equal(television.kind, 'tv');
  assert.equal(television.tvDiagonalInches, 55);
  assert.deepEqual(television.position, [3, 3]);
  near(television.rotation, Math.PI / 2);
  near(television.elevation!, source[0].elevation! + source[0].height);
  assert.equal(television.groupId, draft.items.find((item) => item.id === 'stand')!.groupId);
  assert.deepEqual(source, [stand()]);
  assert.equal(history.canUndo, false);
  history.commit(draft.items);
  assert.equal(history.items.length, 2);
  history.undo();
  assert.deepEqual(history.items, source);
});

test('occupied or impossible television additions fail atomically instead of moving the TV away', () => {
  const source = [stand(), tv()],
    draft = new FurnitureEditorDraft(source, level, 'stand');
  assert.throws(() => draft.addTelevision(), /Impossible de poser/);
  assert.deepEqual(draft.items, source);
  assert.equal(draft.selectedId, 'stand');
  const tall = stand();
  tall.height = 2.3;
  const ceiling = new FurnitureEditorDraft([tall], level, 'stand');
  assert.throws(() => ceiling.addTelevision(), /plafond/);
  assert.equal(ceiling.items.length, 1);
  assert.equal(ceiling.selectedId, 'stand');
});

test('removal is staged, clears selection and cleans a singleton group without deleting the source', () => {
  const source = linkFurniture([stand(), tv()], 'stand', 'tv'),
    before = structuredClone(source);
  const draft = new FurnitureEditorDraft(source, level, 'tv');
  draft.remove();
  assert.equal(draft.selectedId, undefined);
  assert.equal(draft.selected, undefined);
  assert.equal(draft.items.length, 1);
  assert.equal(draft.items[0].id, 'stand');
  assert.equal(draft.items[0].groupId, undefined);
  assert.deepEqual(source, before);
  assert.throws(() => draft.unlink(), /Aucun meuble/);
});

test('locks apply inside the draft and failed operations preserve all staged changes', () => {
  const source = linkFurniture([stand(), { ...tv(), locked: true }], 'stand', 'tv');
  const draft = new FurnitureEditorDraft(source, level, 'stand');
  draft.update({ ...draft.selected!, name: 'Nouveau nom' });
  const before = draft.items;
  assert.throws(() => draft.update({ ...draft.selected!, position: [4, 3] }), /verrouillé/);
  assert.deepEqual(draft.items, before);
  const locked = new FurnitureEditorDraft(source, level, 'tv');
  assert.throws(() => locked.remove(), /verrouillé/);
  assert.throws(() => locked.snap(), /verrouillé/);
  assert.equal(locked.items.length, 2);
});

test('discarding a staged delete or duplicate leaves the original layout and history untouched', () => {
  const source = [stand()],
    before = structuredClone(source),
    history = new FurnitureHistory(source);
  const deleting = new FurnitureEditorDraft(source, level, 'stand');
  deleting.remove();
  const duplicating = new FurnitureEditorDraft(source, level, 'stand');
  duplicating.duplicate();
  assert.equal(deleting.items.length, 0);
  assert.equal(duplicating.items.length, 2);
  assert.deepEqual(history.items, before);
  assert.equal(history.canUndo, false);
  assert.deepEqual(source, before);
});
