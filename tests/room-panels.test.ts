import assert from 'node:assert/strict';
import test from 'node:test';
import { roomSummaryHtml } from '../src/ui/roomPanels';
import type { Level, Room } from '../src/model/types';

const icon = () => '';

const room = (id: string, kind: Room['kind'], planArea?: number): Room => ({
  id,
  name: id,
  kind,
  polygon: [
    [0, 0],
    [4, 0],
    [4, 3],
    [0, 3],
  ],
  label: [2, 1.5],
  viewpoint: [2, 1.5],
  ...(planArea === undefined ? {} : { planArea }),
});

const level = (rooms: Room[]): Level => ({
  id: 'niveau',
  name: 'Niveau',
  elevation: 0,
  ceilingHeight: 2.5,
  outline: [
    [0, 0],
    [4, 0],
    [4, 3],
    [0, 3],
  ],
  walls: [],
  rooms,
  lights: [],
  spawn: { position: [2, 1.5], yaw: 0 },
});

test('the living area is the plan’s stated one when rooms declare planArea', () => {
  const html = roomSummaryHtml(level([room('sejour', 'living', 12)]), {
    areasFromPlan: true,
    icon,
  });
  assert.match(html, /<strong>12,00<\/strong><span>m² habitables au plan/);
});

test('the living area stays computed without planArea', () => {
  const html = roomSummaryHtml(level([room('sejour', 'living')]), {
    areasFromPlan: false,
    icon,
  });
  assert.match(html, /<strong>12,00<\/strong><span>m² habitables</);
  assert.doesNotMatch(html, /au plan/);
});

test('the garage is kept out of the living total', () => {
  const html = roomSummaryHtml(
    level([room('sejour', 'living', 12), room('garage', 'garage', 18)]),
    { areasFromPlan: true, icon },
  );
  assert.match(html, /<strong>12,00<\/strong><span>m² habitables au plan/);
  assert.match(html, /Garage <span>18,00 m²/);
});
