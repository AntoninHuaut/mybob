import { alongWall, polygonArea, wallLength } from '../model/geometry';
import { divideRoom, type Junction } from '../model/roomPartition';
import { validateProject } from '../model/validate';
import type { HouseProject, Point2 } from '../model/types';
import { area, escapeHtml, number } from '../ui/format';
import { partitionDiagram, diagramPoint } from '../ui/partitionDiagram';
import { getBuildingPlacementIssues } from '../furniture/placement';
import { userMessage } from '../errorMessage';
import { el, openDialog, closeDialog } from './dom';
import { committedFurniture } from './furnitureController';
import { applyPlanEdit } from './planHistory';
import { findProject, isImported } from './projectLibrary';
import { app } from './state';

export function openRoomDivision() {
  const current = findProject(app.current.id);
  if (!current || !isImported(current.id) || app.readOnlyLink || app.viewer.mode !== 'plan') return;
  const index = current.levels.findIndex((l) => l.id === app.viewer.level.id);
  const level = app.viewer.level;
  if (!level.rooms.length || level.walls.length < 2) return;
  const ids: [string, string] = [crypto.randomUUID(), crypto.randomUUID()];
  const options = level.walls
    .map(
      (w) =>
        `<option value="${escapeHtml(w.id)}">${escapeHtml(w.id)} · ${number(wallLength(w))} m</option>`,
    )
    .join('');
  const endpoint = (
    i: number,
  ) => `<fieldset><legend>Raccord ${i + 1}</legend><label>Mur <select name="wall${i}">${options}</select></label>
    <label>Distance depuis le début (m)<input type="number" name="offset${i}" min="0" step="any" required></label></fieldset>`;
  openDialog(
    'CLOISON',
    `<form id="partition-form"><h2>Diviser une pièce</h2>
    <label>Pièce <select name="room">${level.rooms.map((r) => `<option value="${escapeHtml(r.id)}">${escapeHtml(r.name)}</option>`).join('')}</select></label>
    <p>Pointez deux murs sur le plan ou saisissez les distances des raccords.</p><div id="partition-diagram"></div>
    ${endpoint(0)}${endpoint(1)}
    <label>Épaisseur de la cloison (m)<input name="thickness" type="number" value="0.10" min="0.001" step="any" required></label>
    <label>Pièce conservant la référence du plan<input required name="first"></label>
    <label>Nouvelle pièce<input required name="second" value="Bureau"></label>
    <p id="partition-status" aria-live="polite"></p><div class="dialog-actions"><button type="button" id="partition-cancel">Annuler</button><button type="submit">Confirmer la division</button></div></form>`,
  );
  const form = el<HTMLFormElement>('#partition-form'),
    map = el('#partition-diagram'),
    status = el('#partition-status');
  const field = (key: string) =>
    form.elements.namedItem(key) as HTMLInputElement | HTMLSelectElement;
  const host = (i: number) => level.walls.find((w) => w.id === field('wall' + i).value)!;
  const source = () => level.rooms.find((r) => r.id === field('room').value)!;
  let draft: HouseProject | undefined,
    pick = 0;
  const furniture = committedFurniture();
  const midpoint = (i: number) => (field('offset' + i).value = String(wallLength(host(i)) / 2));
  function preview() {
    draft = undefined;
    const submit = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
    submit.disabled = true;
    try {
      const ends = [0, 1].map((i) => ({
        wallId: host(i).id,
        offset: (field('offset' + i) as HTMLInputElement).valueAsNumber,
      })) as [Junction, Junction];
      const nextLevel = divideRoom(
        level,
        source().id,
        ends,
        Number(field('thickness').value),
        [field('first').value, field('second').value],
        ids,
      );
      map.innerHTML = partitionDiagram(nextLevel);
      const blocked = furniture.filter((item) =>
        getBuildingPlacementIssues(item, { ...nextLevel, walls: [nextLevel.walls.at(-1)!] }).some(
          (issue) => issue.code === 'wall',
        ),
      );
      if (blocked.length)
        throw new Error('La cloison gêne : ' + blocked.map((i) => i.name).join(', '));
      const next = {
        ...current!,
        levels: current!.levels.map((l, i) => (i === index ? nextLevel : l)),
      };
      draft = validateProject(next);
      status.textContent = nextLevel.rooms
        .filter((r) => r.id === source().id || r.id === ids[1])
        .map((r) => r.name + ' : ' + area(polygonArea(r.polygon)))
        .join(' · ');
      submit.disabled = false;
    } catch (error) {
      map.innerHTML = partitionDiagram(level);
      status.textContent = userMessage(error, 'Division impossible.');
    }
  }
  map.onpointerdown = (event) => {
    const svg = map.querySelector('svg')!,
      p = diagramPoint(svg, event);
    if (!p) return;
    const nearest = level.walls
      .map((w) => {
        const span = wallLength(w),
          dx = w.end[0] - w.start[0],
          dz = w.end[1] - w.start[1];
        const offset = Math.max(
          0,
          Math.min(span, ((p[0] - w.start[0]) * dx + (p[1] - w.start[1]) * dz) / span),
        );
        const q: Point2 = alongWall(w, offset);
        return { wall: w, offset, distance: Math.hypot(q[0] - p[0], q[1] - p[1]) };
      })
      .sort((a, b) => a.distance - b.distance)[0];
    field('wall' + pick).value = nearest.wall.id;
    field('offset' + pick).value = String(nearest.offset);
    pick = 1 - pick;
    preview();
  };
  field('room').value = app.selectedRoom?.id ?? level.rooms[0].id;
  field('first').value = source().name;
  field('wall1').value = level.walls[Math.min(2, level.walls.length - 1)].id;
  midpoint(0);
  midpoint(1);
  preview();
  form.oninput = (event) => {
    const key = (event.target as HTMLInputElement).name;
    if (key === 'room') field('first').value = source().name;
    if (key === 'wall0' || key === 'wall1') midpoint(key === 'wall0' ? 0 : 1);
    preview();
  };
  el('#partition-cancel').onclick = closeDialog;
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
}
