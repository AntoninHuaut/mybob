import assert from 'node:assert/strict';
import test from 'node:test';
import { areaGap, gapLabel, sourceDialogHtml } from '../src/ui/sourcePanel';
import type { HouseProject, Level, Room } from '../src/model/types';

const outline: [number, number][] = [
  [0, 0],
  [4, 0],
  [4, 3],
  [0, 3],
];

const room = (id: string, planArea?: number): Room => ({
  id,
  name: id,
  kind: 'living',
  polygon: outline,
  label: [2, 1.5],
  viewpoint: [2, 1.5],
  ...(planArea === undefined ? {} : { planArea }),
});

const level = (rooms: Room[]): Level => ({
  id: 'niveau',
  name: 'Niveau',
  elevation: 0,
  ceilingHeight: 2.5,
  outline,
  walls: [],
  rooms,
  lights: [],
  spawn: { position: [2, 1.5], yaw: 0 },
});

const project = (rooms: Room[], withSite = false): HouseProject => ({
  schemaVersion: 1,
  id: 'projet',
  name: 'Projet',
  description: '',
  units: 'm',
  source: { title: 'Titre du document', status: 'Démonstration', notes: ['Note du document'] },
  levels: [level(rooms)],
  ...(withSite ? { site: { boundary: outline, elevation: 0, notes: ['Note du terrain'] } } : {}),
});

test('l’écart compare la surface reconstruite à celle annoncée au plan', () => {
  assert.equal(areaGap(room('sans-plan')), undefined);
  assert.equal(areaGap(room('egal', 12)), 0);
  assert.equal(areaGap(room('plus-petit', 12.5)), -0.5);
  assert.equal(areaGap(room('plus-grand', 11.5)), 0.5);
});

test('un écart dans la tolérance s’annonce « équivalent » plutôt qu’un chiffre bruité', () => {
  assert.equal(gapLabel(undefined), '—');
  assert.equal(gapLabel(0), 'équivalent');
  assert.equal(gapLabel(0.1), 'équivalent');
  assert.equal(gapLabel(-0.1), 'équivalent');
  assert.equal(gapLabel(0.12), '+0,12 m²');
  assert.equal(gapLabel(-0.12), '−0,12 m²');
});

test('les surfaces passent avant les notes du document', () => {
  const html = sourceDialogHtml(project([room('Espace de vie', 12)]), [room('Espace de vie', 12)]);
  const table = html.indexOf('area-table');
  const notes = html.indexOf('Ce que dit le document');
  assert.ok(table > 0 && notes > 0, 'la table et les notes sont présentes');
  assert.ok(table < notes, 'la table des surfaces précède les notes');
});

test('la colonne Écart apparaît dès qu’une pièce annonce sa surface au plan', () => {
  const compared = sourceDialogHtml(project([room('Espace de vie', 12)]), [
    room('Espace de vie', 12),
  ]);
  assert.match(compared, /<th>Écart<\/th>/);
  assert.match(compared, /équivalent/);
  assert.doesNotMatch(compared, /n’annonce pas de surface au plan/);

  const bare = sourceDialogHtml(project([room('Espace de vie')]), [room('Espace de vie')]);
  assert.doesNotMatch(bare, /<th>Écart<\/th>/);
  assert.match(bare, /n’annonce pas de surface au plan/);
});

test('un écart significatif est signalé dans sa cellule', () => {
  const html = sourceDialogHtml(project([room('Salle d’eau', 11.5)]), [room('Salle d’eau', 11.5)]);
  assert.match(html, /class="area-gap differs">\+0,50 m²/);
});

test('le terrain n’apparaît que si le projet en déclare un', () => {
  const rooms = [room('Espace de vie', 12)];
  assert.doesNotMatch(sourceDialogHtml(project(rooms), rooms), /Terrain et extérieur/);
  assert.match(sourceDialogHtml(project(rooms, true), rooms), /Terrain et extérieur/);
});
