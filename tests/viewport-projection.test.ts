import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import { ViewportProjection } from '../src/ui/viewportProjection';
import type { FrameInfo, HouseViewer } from '../src/scene/viewer';
import type { Level } from '../src/model/types';

const level: Level = {
  id: 'test',
  name: 'Test level',
  elevation: 3,
  ceilingHeight: 2.5,
  outline: [
    [0, 0],
    [4, 0],
    [4, 3],
    [0, 3],
  ],
  walls: [],
  rooms: [
    {
      id: 'small',
      name: 'Small room',
      kind: 'bathroom',
      polygon: [
        [0, 0],
        [1, 0],
        [1, 2],
        [0, 2],
      ],
      label: [0.5, 1],
      viewpoint: [0.5, 1],
      floorOffset: -0.12,
    },
  ],
  lights: [],
  spawn: { position: [2, 2], yaw: 0 },
};
const frame: FrameInfo = {
  position: [2, 1],
  headingDegrees: 45,
  planUpDegrees: 90,
  roomId: 'small',
  nearDoor: true,
  nearFurnitureId: 'sofa',
  locked: false,
};
const preferences = { showLabels: true, showDimensions: true, northAngleDeg: 10 };

test('still frames skip projection and camera movement restores it immediately', () => {
  const { projection, view, heights } = setup();
  const still = { ...frame, cameraMoved: false };
  projection.update(view, still, preferences);
  const count = heights.length;
  projection.update(view, still, preferences);
  assert.equal(heights.length, count);
  projection.update(view, { ...frame, cameraMoved: true }, preferences);
  assert.ok(heights.length > count);
  const movedCount = heights.length;
  projection.update(view, still, { ...preferences, selectedRoomId: 'small' });
  assert.ok(heights.length > movedCount);
});

function setup(
  getObstacles: () => { x: number; y: number; width: number; height: number }[] = () => [],
) {
  const window = new Window();
  window.document.body.innerHTML = `<div id="viewport">
    <div id="orientation-arrow"></div><div id="scene-labels"><button data-label="small"></button></div>
    <span id="width-label"></span><span id="depth-label"></span>
    <div id="walk-start" hidden></div><div id="door-prompt"></div><div id="stair-prompt" hidden><span id="stair-prompt-label"></span></div><div id="furniture-edit-prompt"></div>
    <button id="resume-walk"></button><svg><g id="map-marker"></g></svg><span id="mini-caption"></span>
  </div>`;
  const viewport = window.document.querySelector('#viewport')! as unknown as HTMLElement;
  Object.defineProperties(viewport, { clientWidth: { value: 500 }, clientHeight: { value: 400 } });
  const moves: { x: number; y: number; visible: boolean }[] = [];
  const projection = new ViewportProjection(
    viewport,
    { moveTo: (point) => moves.push(point) },
    getObstacles,
  );
  const heights: (number | undefined)[] = [];
  const view: Pick<HouseViewer, 'mode' | 'level' | 'measureMode' | 'measurement' | 'project'> = {
    mode: 'overview',
    level,
    measureMode: false,
    measurement: undefined,
    project(_point, height) {
      heights.push(height);
      return { x: 200, y: 150, visible: true };
    },
  };
  const el = (selector: string) => viewport.querySelector<HTMLElement>(selector)!;
  return { window, viewport, projection, view, moves, heights, el };
}

test('viewport labels retain selected small rooms and follow replacements after project reload', () => {
  const { projection, view, el } = setup();
  projection.update(view, frame, preferences);
  assert.equal(el('[data-label]').hidden, true);
  assert.equal(el('#orientation-arrow').style.transform, 'rotate(100deg)');
  projection.update(view, frame, { ...preferences, selectedRoomId: 'small' });
  assert.equal(el('[data-label]').hidden, false);
  assert.equal(el('[data-label]').style.left, '200px');
  const old = el('[data-label]');
  el('#scene-labels').innerHTML = '<button data-label="small"></button>';
  projection.update(view, frame, { ...preferences, selectedRoomId: 'small' });
  assert.equal(old.isConnected, false);
  assert.equal(el('[data-label]').style.left, '200px');
  assert.equal(el('#width-label').textContent, '4,00 m');
  assert.equal(el('#depth-label').textContent, '3,00 m');
});

test('measurement projection uses the lowered floor, and the walk HUD respects dialogs and capture', () => {
  const { window, projection, view, el, moves, heights } = setup();
  view.measurement = { a: [0.2, 0.5], b: [0.8, 1.5] };
  projection.update(view, frame, preferences);
  assert.ok(Math.abs(heights.at(-1)! - -0.02) < 1e-9);
  assert.deepEqual(moves, [{ x: 200, y: 150, visible: true }]);
  Object.assign(view, { mode: 'walk', measurement: undefined });
  projection.update(view, frame, preferences);
  assert.equal(el('#mini-caption').textContent, 'Small room');
  assert.equal(el('#map-marker').getAttribute('transform'), 'translate(2 1) rotate(45)');
  assert.equal(el('#door-prompt').hidden, false);
  assert.equal(el('#furniture-edit-prompt').hidden, false);
  assert.equal(el('#resume-walk').hidden, false);
  assert.equal(el('#stair-prompt').hidden, true);
  projection.update(view, { ...frame, nearStair: 'down' }, preferences);
  assert.equal(el('#stair-prompt').hidden, false);
  assert.equal(el('#stair-prompt-label').textContent, 'Descendre');
  window.document.body.insertAdjacentHTML('beforeend', '<dialog open></dialog>');
  projection.update(view, { ...frame, locked: true }, preferences);
  assert.equal(el('#furniture-edit-prompt').hidden, true);
  assert.equal(el('#resume-walk').hidden, true);
  el('#walk-start').hidden = false;
  projection.update(view, frame, preferences);
  assert.equal(el('#door-prompt').hidden, true);
  assert.equal(el('#resume-walk').hidden, true);
  Object.assign(view, { mode: 'plan' });
  projection.update(view, frame, preferences);
  assert.equal(el('#map-marker').getAttribute('visibility'), 'hidden');
});

test('keyboard selection changes invalidate still-frame label obstacles', () => {
  const { projection, view, heights, window } = setup();
  const still = { ...frame, cameraMoved: false };
  projection.update(view, still, preferences);
  const count = heights.length;
  projection.update(view, still, preferences);
  assert.equal(heights.length, count);
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  projection.update(view, still, preferences);
  assert.ok(heights.length > count);
});

test('furniture revisions move labels away from changed obstacles without idle layout work', () => {
  let obstacles = [{ x: 0, y: 0, width: 30, height: 30 }];
  let queries = 0;
  const { projection, view, el } = setup(() => {
    queries++;
    return obstacles;
  });
  Object.assign(view, { mode: 'plan' });
  const label = el('[data-label]');
  Object.defineProperties(label, { offsetWidth: { value: 100 }, offsetHeight: { value: 24 } });
  const still = { ...frame, cameraMoved: false, furnitureObstaclesRevision: 1 };
  projection.update(view, still, preferences);
  const first = [label.style.left, label.style.top, label.hidden];
  assert.equal(queries, 1);
  projection.update(view, still, preferences);
  assert.equal(queries, 1);
  obstacles = [{ x: 140, y: 120, width: 120, height: 60 }];
  projection.update(view, { ...still, furnitureObstaclesRevision: 2 }, preferences);
  assert.equal(queries, 2);
  assert.notDeepEqual([label.style.left, label.style.top, label.hidden], first);
  projection.update(view, { ...still, furnitureObstaclesRevision: 2 }, preferences);
  assert.equal(queries, 2);
});
