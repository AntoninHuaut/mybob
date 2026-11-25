import { userMessage } from '../errorMessage';
import { wallLength } from '../model/geometry';
import { editOpening } from '../model/openingEdit';
import type { Opening } from '../model/types';
import { escapeHtml, number } from '../ui/format';
import { closeDialog, el, openDialog, toast } from './dom';
import { applyPlanEdit, planHistory, restorePlanEdit } from './planHistory';
import { findProject, isImported } from './projectLibrary';
import { app } from './state';

const kinds = {
  door: 'Porte',
  window: 'Fenêtre',
  sliding: 'Baie coulissante',
  garage: 'Porte de garage',
};
export function openPlanOpenings() {
  if (app.viewer.mode !== 'plan' || app.readOnlyLink || !isImported(app.current.id)) return;
  const current = findProject(app.current.id)!;
  const levelIndex = current.levels.findIndex((level) => level.id === app.viewer.level.id);
  const level = current.levels[levelIndex];
  if (!level.walls.length) {
    toast('Ce niveau ne contient aucun mur.');
    return;
  }
  const history = planHistory(current);
  const option = (value: string, label: string) =>
    `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;
  openDialog(
    'OUVERTURES',
    `<form id="opening-form"><h2>Modifier les ouvertures</h2>
    <label>Mur <select name="wall">${level.walls.map((wall, i) => option(String(i), `${wall.id} · ${number(wallLength(wall))} m · (${wall.start.join(', ')}) → (${wall.end.join(', ')})`)).join('')}</select></label>
    <label>Ouverture <select name="opening"></select></label>
    <label>Type <select name="kind"></select></label>
    <label>Distance mesurée depuis <select name="reference"><option value="start">Le début du mur</option><option value="end">La fin du mur</option></select></label>
    ${[
      ['distance', 'Distance au jambage le plus proche'],
      ['width', 'Largeur'],
      ['height', 'Hauteur'],
      ['sill', 'Hauteur d’allège'],
    ]
      .map(
        ([key, label]) =>
          `<label>${label} (m)<input type="number" name="${key}" required min="0" step="any"></label>`,
      )
      .join('')}
    <label>Charnière <select name="hinge"><option value="start">Côté début</option><option value="end">Côté fin</option></select></label>
    <label>Sens d’ouverture <select name="swing"><option value="1">Positif</option><option value="-1">Négatif</option></select></label>
    <p role="alert" id="opening-error"></p>
    <div class="dialog-actions"><button type="button" id="undo-plan" ${history.undo.length ? '' : 'disabled'}>Annuler la modification précédente</button><button type="button" id="redo-plan" ${history.redo.length ? '' : 'disabled'}>Rétablir</button></div>
    <div class="dialog-actions"><button type="button" id="cancel-opening">Annuler</button><button type="submit">Enregistrer</button></div></form>`,
  );
  const form = el<HTMLFormElement>('#opening-form');
  const field = (name: string) =>
    form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement;
  const select = (name: string) => field(name) as HTMLSelectElement;
  const wall = () => level.walls[Number(field('wall').value)];
  const opening = () => wall().openings?.find((o) => o.id === field('opening').value);
  function syncKind() {
    const kind = field('kind').value;
    for (const key of ['sill', 'hinge', 'swing']) {
      const control = field(key);
      control.disabled = key === 'sill' ? !['window', 'sliding'].includes(kind) : kind !== 'door';
      control.closest('label')!.hidden = control.disabled;
    }
  }
  function showOpening() {
    const source = opening();
    select('kind').innerHTML = (source ? [source.kind] : (['door', 'window'] as const))
      .map((kind) => option(kind, kinds[kind]))
      .join('');
    select('kind').disabled = !!source;
    const values = {
      reference: 'start',
      distance: source?.offset ?? 0,
      width: source?.width ?? 0.9,
      height: source?.height ?? 2.05,
      sill: source?.sill ?? 0,
      hinge: source?.hinge ?? 'start',
      swing: source?.swing ?? 1,
    };
    for (const [key, value] of Object.entries(values)) field(key).value = String(value);
    syncKind();
  }
  function showWall() {
    select('opening').innerHTML =
      option('', 'Nouvelle ouverture') +
      (wall().openings ?? []).map((o) => option(o.id, `${kinds[o.kind]} · ${o.id}`)).join('');
    showOpening();
  }
  select('wall').onchange = showWall;
  select('opening').onchange = showOpening;
  select('kind').onchange = () => {
    const window = field('kind').value === 'window';
    field('height').value = window ? '1.2' : '2.05';
    field('sill').value = window ? '0.9' : '0';
    syncKind();
  };
  select('reference').onchange = () => {
    const distance = field('distance') as HTMLInputElement;
    if (Number.isFinite(distance.valueAsNumber))
      distance.value = String(
        Number(
          (wallLength(wall()) - Number(field('width').value) - distance.valueAsNumber).toFixed(12),
        ),
      );
  };
  showWall();
  function attempt(change: () => void) {
    try {
      change();
      closeDialog();
    } catch (error) {
      el('#opening-error').textContent = userMessage(error, 'Modification impossible.');
    }
  }
  el('#cancel-opening').onclick = closeDialog;
  el('#undo-plan').onclick = () => attempt(() => restorePlanEdit(current, 'undo'));
  el('#redo-plan').onclick = () => attempt(() => restorePlanEdit(current, 'redo'));
  form.onsubmit = (event) => {
    event.preventDefault();
    attempt(() => {
      const source = opening();
      const kind = field('kind').value as Opening['kind'];
      const result = editOpening(wall(), source?.id ?? crypto.randomUUID(), {
        kind,
        width: Number(field('width').value),
        height: Number(field('height').value),
        reference: field('reference').value as 'start' | 'end',
        distance: Number(field('distance').value),
        ...(!field('sill').disabled ? { sill: Number(field('sill').value) } : {}),
        ...(kind === 'door'
          ? {
              hinge: field('hinge').value as Opening['hinge'],
              swing: Number(field('swing').value) as Opening['swing'],
            }
          : {}),
      });
      const next = structuredClone(current);
      const host = next.levels[levelIndex].walls[Number(field('wall').value)];
      host.openings = source
        ? host.openings!.map((o) => (o.id === source.id ? result : o))
        : [...(host.openings ?? []), result];
      applyPlanEdit(current, next);
    });
  };
}
