import assert from 'node:assert/strict';
import test from 'node:test';
import { createFurniture, FurnitureHistory, validateFurnitureList } from '../src/furniture/model';
import {
  applyFurnitureTransform,
  constrainGroupDrag,
  groupMembers,
  linkFurniture,
  unlinkFurniture,
} from '../src/furniture/groups';
import { getBuildingPlacementIssues } from '../src/furniture/placement';
import type { Level } from '../src/model/types';

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 0.0001, `${a} ≠ ${b}`);

test('a 10 cm keyboard translation cannot tunnel a small object through a thin wall', () => {
  const thin: Level = {
    id: 'thin',
    name: 'Test',
    elevation: 0,
    ceilingHeight: 3,
    outline: [
      [0, 0],
      [10, 0],
      [10, 8],
      [0, 8],
    ],
    walls: [{ id: 'wall', start: [5, 0], end: [5, 8], thickness: 0.02 }],
    rooms: [],
    lights: [],
    spawn: { position: [2, 2], yaw: 0 },
  };
  const item = createFurniture({
    id: 'small',
    kind: 'custom',
    width: 0.05,
    depth: 0.05,
    height: 0.1,
    position: [4.95, 3],
  });
  assert.deepEqual(getBuildingPlacementIssues({ ...item, position: [5.05, 3] }, thin), []);
  const moved = constrainGroupDrag([item], item.id, [5.05, 3], thin)[0];
  assert.ok(moved.position[0] > 4.95);
  assert.ok(moved.position[0] < 4.97);
  assert.deepEqual(getBuildingPlacementIssues(moved, thin), []);
});
const level: Level = {
  id: 'room',
  name: 'Pièce',
  elevation: 0,
  ceilingHeight: 2.5,
  outline: [
    [0, 0],
    [10, 0],
    [10, 8],
    [0, 8],
  ],
  walls: [{ id: 'partition', start: [6, 0], end: [6, 8], thickness: 0.07 }],
  rooms: [
    {
      id: 'inside',
      name: 'Intérieur',
      kind: 'living',
      polygon: [
        [0, 0],
        [10, 0],
        [10, 8],
        [0, 8],
      ],
      label: [3, 3],
      viewpoint: [3, 3],
    },
  ],
  lights: [],
  spawn: { position: [2, 2], yaw: Math.PI },
};

function objects() {
  return [
    createFurniture({ id: 'stand', kind: 'tv-stand', position: [2, 2] }),
    createFurniture({ id: 'tv', kind: 'tv', position: [3, 2], rotation: 0.2 }),
    createFurniture({ id: 'chair', kind: 'chair', position: [8, 3] }),
  ];
}

test('linking merges both existing groups without affecting unrelated objects or the input', () => {
  const items = objects();
  items.push(createFurniture({ id: 'other', position: [8, 5] }));
  let linked = linkFurniture(items, 'stand', 'tv');
  linked = linkFurniture(linked, 'chair', 'other');
  const separateId = linked[2].groupId;
  assert.notEqual(linked[0].groupId, separateId);
  const merged = linkFurniture(linked, 'stand', 'chair');
  assert.equal(new Set(merged.map((i) => i.groupId)).size, 1);
  assert.equal(groupMembers(merged, 'tv').length, 4);
  assert.equal(items[0].groupId, undefined);
  const query = groupMembers(merged, 'tv');
  query[0].position[0] = 99;
  assert.equal(merged[0].position[0], 2);
  assert.deepEqual(linkFurniture(merged, 'stand', 'tv'), merged);
  assert.throws(() => linkFurniture(items, 'stand', 'stand'), /différents/);
  assert.throws(() => linkFurniture(items, 'stand', 'missing'), /n’existe plus/);
});

test('unlink removes metadata from the whole selected group and preserves other groups', () => {
  const items = objects();
  const linked = linkFurniture(items, 'stand', 'tv');
  const unlinked = unlinkFurniture(linked, 'tv');
  assert.ok(unlinked.every((i) => i.groupId === undefined));
  assert.ok(linked[0].groupId);
  assert.deepEqual(unlinkFurniture(items, 'chair'), items);
  assert.deepEqual(groupMembers(items, 'missing'), []);
});

test('joint translation, Babylon Y rotation and elevation preserve relative transforms', () => {
  const items = linkFurniture(objects(), 'stand', 'tv');
  const result = applyFurnitureTransform(items, {
    ...items[0],
    position: [4, 5],
    rotation: Math.PI / 2,
    elevation: 0.2,
    width: 2,
  });
  const tv = result.find((i) => i.id === 'tv')!;
  near(tv.position[0], 4);
  near(tv.position[1], 4);
  near(tv.rotation, 0.2 + Math.PI / 2);
  near(tv.elevation!, 0.8);
  assert.equal(tv.width, items[1].width);
  assert.equal(result[0].width, 2);
  assert.deepEqual(result[2], items[2]);
  assert.deepEqual(items[0].position, [2, 2]);
  assert.equal(tv.groupId, items[0].groupId);
});

test('resizing affects only the selected member while metadata edits may leave locked geometry unchanged', () => {
  const items = linkFurniture(objects(), 'stand', 'tv');
  items[0].position = [3.4, 2.2];
  items[1].position = [0.1, 0.2];
  items[1].locked = true;
  const resized = applyFurnitureTransform(items, { ...items[0], width: 2 });
  assert.equal(resized[0].width, 2);
  assert.deepEqual(resized[1], items[1]);
  const renamed = applyFurnitureTransform(items, { ...items[1], name: 'Écran du salon' });
  assert.equal(renamed[1].name, 'Écran du salon');
  assert.throws(
    () => applyFurnitureTransform(items, { ...items[0], position: [3, 2] }),
    /verrouillé/,
  );
  assert.throws(() => applyFurnitureTransform(items, { ...items[1], width: 2 }), /verrouillé/);
  assert.deepEqual(items[0].position, [3.4, 2.2]);
});

test('lowering one member never sends another linked object below the floor', () => {
  const items = linkFurniture(objects(), 'stand', 'tv');
  assert.throws(() => applyFurnitureTransform(items, { ...items[1], elevation: 0 }), /sous le sol/);
  assert.equal(items[0].elevation, undefined);
  assert.equal(items[1].elevation, 0.6);
});

test('one group transformation is one undoable snapshot', () => {
  const linked = linkFurniture(objects(), 'stand', 'tv');
  const history = new FurnitureHistory(linked);
  history.commit(applyFurnitureTransform(history.items, { ...linked[0], position: [3, 3] }));
  assert.equal(history.canUndo, true);
  history.undo();
  assert.deepEqual(history.items, linked);
  history.redo();
  near(history.items[0].position[0], 3);
  near(history.items[1].position[0], 4);
});

test('group drag stops all members at the earliest member collision, without shearing the group', () => {
  const items = objects();
  items[1].position = [3.5, 2];
  const linked = linkFurniture(items, 'stand', 'tv');
  const dragged = constrainGroupDrag(linked, 'stand', [7, 2], level);
  assert.ok(dragged[0].position[0] < 4);
  near(dragged[1].position[0] - dragged[0].position[0], 1.5);
  near(dragged[0].position[1], 2);
  near(dragged[1].position[1], 2);
  assert.ok(
    dragged
      .filter((i) => i.groupId === linked[0].groupId)
      .every((i) => getBuildingPlacementIssues(i, level).length === 0),
  );
  assert.deepEqual(dragged[2], linked[2]);
});

test('a locked linked member blocks a drag atomically but a no-op stays harmless', () => {
  const linked = linkFurniture(objects(), 'stand', 'tv');
  linked[1].locked = true;
  assert.throws(() => constrainGroupDrag(linked, 'stand', [3, 2], level), /verrouillé/);
  assert.deepEqual(constrainGroupDrag(linked, 'stand', [2, 2], level), linked);
  assert.deepEqual(linked[0].position, [2, 2]);
});

test('optional group ids stay compatible with old saved furniture and reject malformed metadata', () => {
  assert.equal(validateFurnitureList([createFurniture()]).length, 1);
  assert.equal(validateFurnitureList([createFurniture({ groupId: 'salon' })])[0].groupId, 'salon');
  assert.throws(() => createFurniture({ groupId: '' }), /groupe/);
  assert.throws(() => createFurniture({ groupId: 'x'.repeat(161) }), /groupe/);
  assert.throws(() => validateFurnitureList([{ ...createFurniture(), groupId: 3 }]), /groupe/);
});
