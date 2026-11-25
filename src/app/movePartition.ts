import { movePartition } from '../model/partitionMove';
import { polygonArea, wallLength } from '../model/geometry';
import type { HouseProject, Point2 } from '../model/types';
import { validateProject } from '../model/validate';
import { getBuildingPlacementIssues } from '../furniture/placement';
import { area, escapeHtml, number } from '../ui/format';
import { diagramPoint, partitionDiagram } from '../ui/partitionDiagram';
import { userMessage } from '../errorMessage';
import { closeDialog, el, openDialog } from './dom';
import { committedFurniture } from './furnitureController';
import { applyPlanEdit } from './planHistory';
import { findProject, isImported } from './projectLibrary';
import { app } from './state';

export function openPartitionMove() {
  const current = findProject(app.current.id);
  if (!current || !isImported(current.id) || app.readOnlyLink || app.viewer.mode !== 'plan') return;
  const level = app.viewer.level,
    walls = level.walls.filter((w) => !w.exterior);
  if (!walls.length) return;
  const book = app.layoutSession.book(current.id);
  const layouts = book.variants.map((v) => ({
    name: v.name,
    items: v.id === book.activeId ? committedFurniture() : (v.levels[level.id] ?? []),
  }));
  openDialog(
    'CLOISON',
    `<form id="move-partition" class="plan-form"><h2>Déplacer une cloison</h2>
    <label>Cloison <select name="wall">${walls.map((w) => `<option value="${escapeHtml(w.id)}">${escapeHtml(w.id)} · ${number(wallLength(w))} m</option>`).join('')}</select></label>
    <div id="move-diagram" style="touch-action:none"></div><label>Déplacement perpendiculaire (m)<input required name="delta" type="number" step="any" value="0"></label>
    <p>Faites glisser sur le plan ou saisissez une distance signée.</p>
    <p id="move-status" aria-live="polite"></p><div class="dialog-actions"><button type="button" class="text-button" id="move-cancel">Annuler</button><button type="submit" class="primary-button">Appliquer le déplacement</button></div></form>`,
  );
  const form = el<HTMLFormElement>('#move-partition'),
    map = el('#move-diagram'),
    status = el('#move-status');
  const select = form.elements.namedItem('wall') as HTMLSelectElement,
    delta = form.elements.namedItem('delta') as HTMLInputElement;
  const submit = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
  let draft: HouseProject | undefined,
    drag: { point: Point2; delta: number; id: number } | undefined;
  function preview() {
    draft = undefined;
    submit.disabled = true;
    try {
      const nextLevel = movePartition(level, select.value, delta.valueAsNumber);
      const wall = nextLevel.walls.find((w) => w.id === select.value)!;
      const next = {
        ...current!,
        levels: current!.levels.map((l) => (l.id === level.id ? nextLevel : l)),
      };
      validateProject(next);
      map.innerHTML = partitionDiagram(nextLevel);
      const areas = nextLevel.rooms.flatMap((r, i) =>
        r === level.rooms[i]
          ? []
          : [
              r.name +
                ' : ' +
                area(polygonArea(level.rooms[i].polygon)) +
                ' → ' +
                area(polygonArea(r.polygon)),
            ],
      );
      const openings = (wall.openings ?? []).map(
        (o) => `${o.id} · ${number(o.width)} m à ${number(o.offset)} m du début`,
      );
      const affected = layouts.flatMap((layout) =>
        layout.items
          .filter((item) =>
            getBuildingPlacementIssues(item, { ...nextLevel, walls: [wall] }).some(
              (issue) => issue.code === 'wall',
            ),
          )
          .map((item) => layout.name + ' · ' + item.name),
      );
      status.textContent = [
        ...areas,
        ...openings,
        ...(affected.length ? ['Meubles gênés : ' + affected.join(', ')] : []),
      ].join(' / ');
      if (!affected.length && delta.valueAsNumber !== 0) {
        draft = next;
        submit.disabled = false;
      }
    } catch (error) {
      map.innerHTML = partitionDiagram(level);
      status.textContent = userMessage(error, 'Déplacement impossible.');
    }
  }
  select.onchange = () => {
    delta.value = '0';
    preview();
  };
  delta.oninput = preview;
  map.onpointerdown = (event) => {
    if (event.button !== 0 || drag) return;
    const p = diagramPoint(map.querySelector('svg')!, event);
    if (!p) return;
    drag = { point: p, delta: delta.valueAsNumber || 0, id: event.pointerId };
    map.setPointerCapture(event.pointerId);
  };
  map.onpointermove = (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    const p = diagramPoint(map.querySelector('svg')!, event);
    if (!p) return;
    const wall = walls.find((w) => w.id === select.value)!,
      span = wallLength(wall);
    delta.value = String(
      Number(
        (
          drag.delta +
          ((wall.end[0] - wall.start[0]) * (p[1] - drag.point[1]) -
            (wall.end[1] - wall.start[1]) * (p[0] - drag.point[0])) /
            span
        ).toFixed(3),
      ),
    );
    preview();
    map.dataset.previewLatencyMs = String(performance.now() - event.timeStamp);
  };
  map.onlostpointercapture = () => {
    drag = undefined;
  };
  el('#move-cancel').onclick = closeDialog;
  form.onsubmit = (event) => {
    event.preventDefault();
    if (!draft) return;
    try {
      applyPlanEdit(current, draft);
      closeDialog();
    } catch (error) {
      status.textContent = userMessage(error, 'Enregistrement impossible.');
    }
  };
  preview();
}
