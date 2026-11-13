import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';
import type { HouseProject, Level, Point2 } from '../src/model/types';
import type { HouseViewer } from '../src/scene/viewer';
import { StairNavigation } from '../src/ui/stairNavigation';

type TestView = Pick<HouseViewer, 'level' | 'mode' | 'exteriorView' | 'measureMode' | 'projector'>;

function setup() {
  const ground: Level = {
    id: 'ground',
    name: 'Rez-de-chaussée',
    elevation: 0,
    ceilingHeight: 2.5,
    outline: [
      [0, 0],
      [6, 0],
      [6, 6],
      [0, 6],
    ],
    walls: [],
    rooms: [],
    lights: [],
    spawn: { position: [3, 3], yaw: 0 },
    stairs: [{ id: 'flight', start: [2, 1], end: [2, 4], width: 1, steps: 16, rise: 3 }],
  };
  const upper: Level = {
    ...structuredClone(ground),
    id: 'upper',
    name: 'Étage',
    elevation: 3,
    stairs: [],
  };
  const project: HouseProject = {
    schemaVersion: 1,
    id: 'synthetic',
    name: 'Maison exemple',
    description: '',
    units: 'm',
    source: { title: 'Synthetic test', status: 'test', notes: [] },
    levels: [upper, ground],
  };
  const window = new Window();
  const container = window.document.createElement('div');
  window.document.body.append(container);
  const points: { point: Point2; height?: number }[] = [];
  const visits: string[] = [];
  let visible = true;
  let projectorCalls = 0;
  const view: { -readonly [K in keyof TestView]: TestView[K] } = {
    level: ground,
    mode: 'overview',
    exteriorView: false,
    measureMode: false,
    projector: () => {
      projectorCalls++;
      return (point, height) => {
        points.push({ point, height });
        return { x: point[0] * 100, y: point[1] * 100, visible };
      };
    },
  };
  const navigation = new StairNavigation(container as unknown as HTMLElement, (id) => {
    visits.push(id);
    view.level = project.levels.find((l) => l.id === id)!;
  });
  const button = () => container.querySelector('button')!;
  return {
    project,
    ground,
    window,
    container,
    view,
    navigation,
    points,
    visits,
    button,
    setVisible: (value: boolean) => {
      visible = value;
    },
    projectorCalls: () => projectorCalls,
  };
}

test('overview stair button goes up and down at the flight midpoint using the actual level IDs', () => {
  const { project, ground, navigation, view, button, points, visits, container } = setup();
  let bubbled = 0;
  container.addEventListener('click', () => bubbled++);
  navigation.update(project, view);
  assert.equal(container.hidden, false);
  assert.equal(button().getAttribute('type'), 'button');
  assert.equal(button().getAttribute('aria-label'), 'Monter vers Étage');
  assert.equal(button().hidden, false);
  assert.equal(button().style.left, '200px');
  assert.equal(button().style.top, '250px');
  assert.deepEqual(points.at(-1), { point: [2, 2.5], height: 1.62 });
  button().click();
  assert.deepEqual(visits, ['upper']);
  assert.equal(view.mode, 'overview');
  assert.equal(bubbled, 0);
  navigation.update(project, view, false);
  assert.equal(button().getAttribute('aria-label'), 'Descendre vers Rez-de-chaussée');
  assert.deepEqual(points.at(-1), { point: [2, 2.5], height: 0.12 });
  button().click();
  assert.equal(view.level, ground);
  assert.deepEqual(visits, ['upper', 'ground']);
});

test('stair shortcuts hide outside interior overview, while measuring and outside the viewport', () => {
  const { project, navigation, view, button, container, visits, setVisible } = setup();
  navigation.update(project, view);
  for (const mode of ['plan', 'walk'] as const) {
    view.mode = mode;
    navigation.update(project, view, false);
    assert.equal(container.hidden, true);
    button().click();
    assert.deepEqual(visits, []);
  }
  view.mode = 'overview';
  view.exteriorView = true;
  navigation.update(project, view, false);
  assert.equal(container.hidden, true);
  view.exteriorView = false;
  view.measureMode = true;
  navigation.update(project, view, false);
  assert.equal(container.hidden, true);
  view.measureMode = false;
  setVisible(false);
  navigation.update(project, view, false);
  assert.equal(button().hidden, true);
  button().click();
  assert.deepEqual(visits, []);
  setVisible(true);
  navigation.update(project, view);
  assert.equal(button().hidden, false);
});

test('still frames preserve the focused button and avoid projecting the stairs again', () => {
  const { project, navigation, view, button, window, projectorCalls } = setup();
  navigation.update(project, view, false);
  const original = button();
  original.focus();
  navigation.update(project, view, false);
  assert.equal(button(), original);
  assert.equal(window.document.activeElement, original);
  assert.equal(projectorCalls(), 1);
  navigation.update(project, view, true);
  assert.equal(button(), original);
  assert.equal(projectorCalls(), 2);
});

test('unconnected levels use a view shortcut and project switches leave no stale buttons', () => {
  const { project, ground, navigation, view, container } = setup();
  navigation.update(project, view);
  navigation.update({ ...project, levels: [ground] }, view, false);
  assert.equal(container.childElementCount, 0);
  assert.equal(container.hidden, true);
  const mismatch = structuredClone(project);
  mismatch.levels.find((l) => l.id === 'upper')!.elevation = 4;
  navigation.update(mismatch, view, false);
  assert.equal(container.childElementCount, 1);
  assert.equal(container.querySelector('button')!.title, 'Voir Étage');
  navigation.update(project, view, false);
  assert.equal(container.childElementCount, 1);
});

test('a stairless attic has a round trip without adding geometry or treating it as a physical stair', () => {
  const { project, ground, navigation, view, button, points, visits } = setup();
  ground.stairs = [];
  const before = structuredClone(project);
  navigation.update(project, view);
  assert.equal(button().title, 'Voir Étage');
  assert.equal(points.length, 0, 'a floor shortcut is not projected into the room');
  button().click();
  navigation.update(project, view);
  assert.equal(button().title, 'Voir Rez-de-chaussée');
  button().click();
  assert.deepEqual(visits, ['upper', 'ground']);
  assert.deepEqual(project, before);
});

test('fallback buttons to both adjacent floors remain separate on a middle level', () => {
  const { project, ground, navigation, view, container } = setup();
  ground.stairs = [];
  const top = { ...structuredClone(ground), id: 'top', name: 'Combles', elevation: 6 };
  project.levels.push(top);
  view.level = project.levels.find((l) => l.id === 'upper')!;
  navigation.update(project, view);
  const buttons = Array.from(container.querySelectorAll('button'));
  assert.equal(buttons.length, 2);
  assert.equal(buttons[0].title, 'Voir Combles');
  assert.equal(buttons[1].title, 'Voir Rez-de-chaussée');
  assert.ok(buttons.every((button) => button.classList.contains('floor-level-button')));
  assert.ok(buttons.every((button) => button.style.left === ''));
});

test('stairless level actions mount beside the selector instead of over the living room', () => {
  const { project, ground, view, window, container } = setup();
  ground.stairs = [];
  const sidebar = window.document.createElement('div');
  window.document.body.append(sidebar);
  const visits: string[] = [];
  const navigation = new StairNavigation(
    container as unknown as HTMLElement,
    (id) => visits.push(id),
    sidebar as unknown as HTMLElement,
  );
  navigation.update(project, view);
  assert.equal(container.querySelector('button'), null);
  const button = sidebar.querySelector('button')!;
  assert.equal(button.title, 'Voir Étage');
  button.click();
  assert.deepEqual(visits, ['upper']);
  view.mode = 'walk';
  navigation.update(project, view, false);
  assert.equal(sidebar.hidden, true);
  button.click();
  assert.deepEqual(visits, ['upper']);
});
