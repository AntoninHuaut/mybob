import assert from 'node:assert/strict';
import test from 'node:test';
import { createHouse } from '../src/model/createHouse';
import { polygonArea } from '../src/model/geometry';
import { validateProject } from '../src/model/validate';

test('a saved rectangular house preserves clear dimensions and finished wall faces', () => {
  const house = createHouse('local-test', 'Atelier', 4, 3, 0.2);
  const restored = validateProject(JSON.parse(JSON.stringify(house)));
  const level = restored.levels[0];
  const room = level.rooms[0];
  assert.equal(room.id, house.levels[0].rooms[0].id);
  assert.equal(room.name, 'Atelier');
  assert.equal(polygonArea(room.polygon), 12);
  assert.deepEqual(level.walls[0].start, [-0.1, -0.1]);
  assert.deepEqual(level.walls[0].end, [4.1, -0.1]);
  assert.deepEqual(level.spawn.position, [2, 1.5]);
});

test('rejects a room too narrow for the visitor', () => {
  assert.throws(() => createHouse('local-test', 'Couloir', 0.25, 4, 0.2), /visite/);
});
