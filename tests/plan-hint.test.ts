import assert from 'node:assert/strict';
import test from 'node:test';
import { planHint, planHintHtml, planToolForKey } from '../src/ui/planHint';

test('an empty house points to the wall tool first', () => {
  const hint = planHint({ tool: 'select', walls: 0, corners: 0 });
  assert.match(hint.text, /Murs/);
  assert.deepEqual(hint.keys[0], ['M', 'Murs']);
});

test('the wall tool says how to start, continue, close and stop', () => {
  assert.match(planHint({ tool: 'wall', walls: 0, corners: 0 }).text, /premier angle/);
  assert.match(planHint({ tool: 'wall', walls: 4, corners: 0 }).text, /cloison/);
  const drawing = planHint({ tool: 'wall', walls: 0, corners: 2 });
  assert.match(drawing.text, /longueur en centimètres/);
  assert.deepEqual(
    drawing.keys.map(([key]) => key),
    ['Entrée', 'Maj', '⌫', 'Échap'],
  );
  assert.match(planHint({ tool: 'wall', walls: 0, corners: 3, target: 'close' }).text, /fermer/);
  assert.match(planHint({ tool: 'wall', walls: 4, corners: 1, target: 'join' }).text, /terminer/i);
});

test('door and window tools ask for a wall and stay armed until Échap', () => {
  const door = planHint({ tool: 'door', walls: 4, corners: 0 });
  assert.match(door.text, /porte/);
  assert.match(door.text, /à la suite/);
  assert.deepEqual(door.keys, [['Échap', 'Sélection']]);
  assert.match(planHint({ tool: 'window', walls: 4, corners: 0 }).text, /fenêtre/);
});

test('the selection tool explains what a click and a drag do', () => {
  assert.match(planHint({ tool: 'select', walls: 4, corners: 0 }).text, /Cliquez/);
  const wall = planHint({ tool: 'select', walls: 4, corners: 0, selection: 'wall' });
  assert.match(wall.text, /Glissez/);
  assert.deepEqual(
    wall.keys.map(([key]) => key),
    ['Suppr', 'Échap'],
  );
  const room = planHint({ tool: 'select', walls: 4, corners: 0, selection: 'room' });
  assert.deepEqual(
    room.keys.map(([key]) => key),
    ['Échap'],
  );
});

test('a notice replaces the hint and escapes its text', () => {
  const hint = planHint({ tool: 'select', walls: 4, corners: 0 });
  assert.match(planHintHtml(hint), /<kbd>/);
  const html = planHintHtml(hint, { text: 'Mur <trop> court', tone: 'error' });
  assert.match(html, /Mur &lt;trop&gt; court/);
  assert.doesNotMatch(html, /<kbd>/);
});

test('tool keys ignore modifiers and unrelated letters', () => {
  const key = (k: string, extra: Partial<KeyboardEvent> = {}) =>
    planToolForKey({ key: k, ctrlKey: false, metaKey: false, altKey: false, ...extra });
  assert.equal(key('v'), 'select');
  assert.equal(key('M'), 'wall');
  assert.equal(key('p'), 'door');
  assert.equal(key('f'), 'window');
  assert.equal(key('v', { ctrlKey: true }), undefined);
  assert.equal(key('z'), undefined);
});
